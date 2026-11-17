'use strict'

// What this pane is doing: idle, working, or blocked.
//
// Freebuff writes two files. `log.jsonl` records turn start and end and is
// written synchronously. `chat-messages.json` is the checkpoint that carries
// ask_user blocks and the interruption marker, and it is authoritative for
// blocked state; the pane screen is only a fallback for when the checkpoint is
// missing or unreadable.
//
// The caller sees three moves: `begin()` for the first report, `bind(dir)` when
// the binding names a chat, and `tick()` on every poll. Emitted reports go
// through `emit`, so this module never learns how a state reaches Herdr.

const fs = require('fs')
const path = require('path')

const CHECKPOINT_TAIL_BYTES = 24 * 1024 * 1024
const INITIAL_LOG_TAIL_BYTES = 1024 * 1024

function readTail(file, maxBytes) {
  const stat = fs.statSync(file)
  const start = Math.max(0, stat.size - maxBytes)
  const fd = fs.openSync(file, 'r')
  try {
    const buffer = Buffer.alloc(stat.size - start)
    fs.readSync(fd, buffer, 0, buffer.length, start)
    return buffer.toString('utf8')
  } finally {
    fs.closeSync(fd)
  }
}

function createTurns({ binding, readPaneText, screenFallbackMs = 5000, emit }) {
  let chatDir = ''
  let reportedState = ''
  let turnActive = false
  let openAskUser = false
  let interrupted = false

  let checkpointMtime = 0
  let checkpointRevision = 0
  let lastScreenFallback = 0

  const tailers = new Map()
  let boundLogExisted = false
  let boundLogSize = 0

  /* ------------------------------- State --------------------------------- */

  function deriveState() {
    if (openAskUser && !interrupted) return 'blocked'
    if (turnActive) return 'working'
    return 'idle'
  }

  function deriveAndReport(message) {
    const next = deriveState()
    if (next === reportedState) return
    reportedState = next
    emit(next, message || null)
  }

  function blocksHaveOpenAskUser(blocks) {
    if (!Array.isArray(blocks)) return false
    for (const block of blocks) {
      if (!block) continue
      if (block.type === 'ask-user') {
        if (block.answers === undefined && block.skipped !== true) return true
        continue
      }
      if (block.type === 'tool' && block.toolName === 'ask_user') return true
    }
    return false
  }

  function blocksHaveInterruption(blocks) {
    try {
      return JSON.stringify(blocks).includes('[response interrupted]')
    } catch {
      return false
    }
  }

  function readCheckpoint(dir) {
    const file = path.join(dir, 'chat-messages.json')
    let text
    try {
      text = readTail(file, CHECKPOINT_TAIL_BYTES)
    } catch {
      return null
    }

    let messages
    try {
      messages = JSON.parse(text.slice(text.indexOf('[')))
    } catch {
      return null
    }
    if (!Array.isArray(messages)) return null

    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i]
      if (!message || message.variant !== 'ai') continue
      return {
        openAskUser: blocksHaveOpenAskUser(message.blocks),
        interrupted: blocksHaveInterruption(message.blocks),
      }
    }
    return { openAskUser: false, interrupted: false }
  }

  function screenShowsAskUser(text) {
    return text.includes('Some questions for you')
  }

  function screenFallback() {
    const now = Date.now()
    if (now - lastScreenFallback < screenFallbackMs) return
    lastScreenFallback = now
    const revision = checkpointRevision
    readPaneText((ok, text) => {
      if (!ok) return
      // A checkpoint that arrived while the pane was being read is newer and
      // authoritative; do not let the stale screen result overwrite it.
      if (revision !== checkpointRevision) return
      openAskUser = screenShowsAskUser(text)
      deriveAndReport(openAskUser ? 'Waiting for ask_user' : null)
    })
  }

  function evaluateCheckpoint(dir) {
    const file = path.join(dir, 'chat-messages.json')
    let stat
    try {
      stat = fs.statSync(file)
    } catch {
      screenFallback()
      return
    }
    if (stat.mtimeMs === checkpointMtime) return
    checkpointMtime = stat.mtimeMs
    checkpointRevision += 1

    const checkpoint = readCheckpoint(dir)
    if (!checkpoint) {
      screenFallback()
      return
    }

    openAskUser = checkpoint.openAskUser
    interrupted = checkpoint.interrupted
    if (interrupted) turnActive = false
    deriveAndReport(openAskUser && !interrupted ? 'Waiting for ask_user' : null)
  }

  /* ------------------------------ Log tailing ----------------------------- */

  function tailLog(dir) {
    const file = path.join(dir, 'log.jsonl')
    let stat
    try {
      stat = fs.statSync(file)
    } catch {
      return
    }

    let tailer = tailers.get(dir)
    if (!tailer) {
      const replay = boundLogExisted && boundLogSize > 0
      const start = replay ? Math.max(0, stat.size - INITIAL_LOG_TAIL_BYTES) : 0
      tailer = {
        offset: start,
        lineBuffer: '',
        initial: replay,
        skipPartial: start > 0,
      }
      tailers.set(dir, tailer)
    }

    if (stat.size < tailer.offset) {
      tailer.offset = 0
      tailer.lineBuffer = ''
      tailer.initial = true
      tailer.skipPartial = false
    }
    if (stat.size === tailer.offset) {
      // An empty log has no history to replay. Mark it live now so a fast first
      // turn still emits working before idle.
      if (tailer.initial) tailer.initial = false
      return
    }

    let buffer
    try {
      const fd = fs.openSync(file, 'r')
      try {
        buffer = Buffer.alloc(stat.size - tailer.offset)
        fs.readSync(fd, buffer, 0, buffer.length, tailer.offset)
      } finally {
        fs.closeSync(fd)
      }
    } catch {
      return
    }

    tailer.offset = stat.size
    let chunk = tailer.lineBuffer + buffer.toString('utf8')

    if (tailer.skipPartial) {
      const newline = chunk.indexOf('\n')
      if (newline < 0) {
        tailer.lineBuffer = chunk
        return
      }
      chunk = chunk.slice(newline + 1)
      tailer.skipPartial = false
    }

    const lines = chunk.split('\n')
    tailer.lineBuffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.trim()) continue
      const changed = handleLogLine(line)
      if (changed && !tailer.initial) deriveAndReport()
    }

    if (tailer.initial) {
      tailer.initial = false
      deriveAndReport()
    }
  }

  function handleLogLine(line) {
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      return false
    }

    const pid = Number(entry.pid)
    if (!Number.isInteger(pid) || pid <= 0) return false

    // The log can contain lines from older processes and other panes.
    if (!binding.owns(pid)) return false

    const message = String(entry.msg || '')
    if (message.startsWith('[send-message] Sending message')) {
      turnActive = true
      openAskUser = false
      interrupted = false
      return true
    }
    if (
      message === 'Main prompt finished' ||
      message.startsWith('[chat-runtime] Freebuff session over')
    ) {
      turnActive = false
      return true
    }
    if (message.startsWith('Start agent ') && / step \d+/.test(message)) {
      turnActive = true
      openAskUser = false
      interrupted = false
      return true
    }
    if (
      message.startsWith('End agent ') &&
      entry.data &&
      entry.data.shouldEndTurn === true
    ) {
      turnActive = false
      return true
    }
    if (message.includes('[response interrupted]')) {
      turnActive = false
      interrupted = true
      return true
    }
    return false
  }

  /* -------------------------------- Moves -------------------------------- */

  function begin() {
    if (emit('idle', 'Freebuff starting', { sync: true })) reportedState = 'idle'
  }

  function bind(next) {
    chatDir = next
    turnActive = false
    openAskUser = false
    interrupted = false
    checkpointMtime = 0
    checkpointRevision += 1
    lastScreenFallback = 0
    tailers.delete(next)

    // If the log is created or first written after binding, those lines are
    // live events, not replay history. Without this distinction a fast first
    // turn can collapse to idle before it is ever reported as working.
    try {
      boundLogExisted = true
      boundLogSize = fs.statSync(path.join(next, 'log.jsonl')).size
    } catch {
      boundLogExisted = false
      boundLogSize = 0
    }
  }

  function tick() {
    if (chatDir) {
      // The log cursor is established by bind(), so a turn that starts
      // immediately after pane creation is not mistaken for replay history.
      tailLog(chatDir)
      evaluateCheckpoint(chatDir)
    }
    deriveAndReport()
  }

  return {
    begin,
    bind,
    tick,
    get chatDir() {
      return chatDir
    },
  }
}

module.exports = { createTurns }
