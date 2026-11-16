#!/usr/bin/env node
/**
 * Freebuff lifecycle watcher for Herdr.
 *
 * Freebuff's npm launcher is the pane process. It spawns the terminal binary as
 * a child, and that child writes the chat log. The watcher therefore starts
 * with the launcher PID, resolves its live descendants, and accepts only log
 * lines written by one of those PIDs.
 *
 * The important signals are:
 *   log.jsonl           turn start/end, written synchronously by Freebuff
 *   chat-messages.json  ask_user blocks and the interruption marker
 *
 * The checkpoint is authoritative for blocked state. The pane screen is only a
 * fallback when the checkpoint is missing or unreadable.
 *
 * Usage: status-watcher.js <launcher-pid> <pane-id> [chat-id]
 *        status-watcher.js --doctor [launcher-pid] [chat-id]
 *
 * Environment:
 *   HERDR_ENV=1, HERDR_PANE_ID, HERDR_BIN_PATH   injected by Herdr
 *   HERDR_PLUGIN_ROOT                            plugin root for resume argv
 *   FREEBUFF_CONFIG_DIR                          override config directory
 *   FREEBUFF_PROJECT_NAME                        override project basename
 *   FREEBUFF_SESSION_START_SOURCE                startup|resume
 *   FREEBUFF_WATCHER_DEBUG=1                     debug output to stderr
 *   FREEBUFF_WATCHER_POLL_MS                     poll interval
 *   FREEBUFF_WATCHER_PID_REFRESH_MS              descendant refresh interval
 *   FREEBUFF_WATCHER_SCREEN_FALLBACK_MS          screen fallback throttle
 */

'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile, execFileSync } = require('child_process')

const POLL_INTERVAL_MS = Number(process.env.FREEBUFF_WATCHER_POLL_MS || 500)
const PID_REFRESH_MS = Number(process.env.FREEBUFF_WATCHER_PID_REFRESH_MS || 2000)
const SCREEN_FALLBACK_MS = Number(
  process.env.FREEBUFF_WATCHER_SCREEN_FALLBACK_MS || 5000,
)
const CHECKPOINT_TAIL_BYTES = 24 * 1024 * 1024
const INITIAL_LOG_TAIL_BYTES = 1024 * 1024
const LOG_TAIL_BYTES = 8192
const SCREEN_LINES = 60

const DEBUG = process.env.FREEBUFF_WATCHER_DEBUG === '1'
function debug(...args) {
  if (!DEBUG) return
  process.stderr.write(
    `[freebuff-watcher ${new Date().toISOString()}] ${args.map(String).join(' ')}\n`,
  )
}

const PLUGIN_ROOT =
  process.env.HERDR_PLUGIN_ROOT || path.resolve(__dirname, '..')
const HERDR_BIN = process.env.HERDR_BIN_PATH || 'herdr'
const HERDR_ENV = process.env.HERDR_ENV === '1'

function configDir() {
  if (process.env.FREEBUFF_CONFIG_DIR) return process.env.FREEBUFF_CONFIG_DIR
  return path.join(os.homedir(), '.config', 'manicode')
}

function projectsRoot() {
  return path.join(configDir(), 'projects')
}

function projectName() {
  return process.env.FREEBUFF_PROJECT_NAME || path.basename(process.cwd())
}

function isDirectory(value) {
  try {
    return fs.statSync(value).isDirectory()
  } catch {
    return false
  }
}

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

function safeChatId(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !value.includes('..') &&
    !value.includes('/') &&
    !/[^A-Za-z0-9._:-]/.test(value)
  )
}

/* ----------------------------- Herdr reports ----------------------------- */

let seq = 0
function nextSeq() {
  if (seq === 0) seq = Date.now() * 1000
  return ++seq
}

function reportArgs(state, message) {
  const args = [
    'pane', 'report-agent', PANE_ID,
    '--source', 'freebuff',
    '--agent', 'freebuff',
    '--state', state,
    '--seq', String(nextSeq()),
  ]
  if (message) args.push('--message', message.slice(0, 500))
  return args
}

function report(state, message) {
  if (!HERDR_ENV || !PANE_ID) return
  execFile(HERDR_BIN, reportArgs(state, message), (err) => {
    if (err) debug('report-agent failed:', err.message)
  })
}

function reportSync(state, message) {
  if (!HERDR_ENV || !PANE_ID) return false
  try {
    execFileSync(HERDR_BIN, reportArgs(state, message), {
      timeout: 2000,
      stdio: 'ignore',
    })
    return true
  } catch (err) {
    debug('report-agent failed:', err.message)
    return false
  }
}

function safeResumeArg(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !/[\u0000-\u001f']/.test(value)
  )
}

function resumeArgv(chatId) {
  const argv = [
    '--',
    'sh',
    path.join(PLUGIN_ROOT, 'scripts', 'launch.sh'),
    'resume-named',
    chatId,
  ]
  return argv.every(safeResumeArg) ? argv : []
}

function reportSession(chatId, chatDir, startSource, first) {
  if (!HERDR_ENV || !PANE_ID) return
  const args = [
    'pane', 'report-agent-session', PANE_ID,
    '--source', 'freebuff',
    '--agent', 'freebuff',
    '--seq', String(nextSeq()),
    '--agent-session-id', chatId,
    '--agent-session-path', chatDir,
    '--session-start-source', first ? startSource : 'resume',
  ]
  args.push(...resumeArgv(chatId))
  execFile(HERDR_BIN, args, (err) => {
    if (err) debug('report-agent-session failed:', err.message)
  })
}

function releaseAgent() {
  if (!HERDR_ENV || !PANE_ID) return
  try {
    execFileSync(
      HERDR_BIN,
      [
        'pane', 'release-agent', PANE_ID,
        '--source', 'freebuff',
        '--agent', 'freebuff',
        '--seq', String(nextSeq()),
      ],
      { timeout: 2000, stdio: 'ignore' },
    )
  } catch (err) {
    debug('release-agent failed:', err.message)
  }
}

function readPaneText(callback) {
  if (!HERDR_ENV || !PANE_ID) return callback(false, '')
  execFile(
    HERDR_BIN,
    ['pane', 'read', PANE_ID, '--source', 'visible', '--lines', String(SCREEN_LINES)],
    { maxBuffer: 1024 * 1024 },
    (err, stdout) => callback(!err, err ? '' : String(stdout || '')),
  )
}

/* ------------------------------ PID tracking ----------------------------- */

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err.code === 'EPERM'
  }
}

function readChildren(pid) {
  const procChildren = `/proc/${pid}/task/${pid}/children`
  try {
    return fs
      .readFileSync(procChildren, 'utf8')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(Number)
      .filter((value) => Number.isInteger(value) && value > 0)
  } catch {
    try {
      const out = execFileSync(
        'ps',
        ['-o', 'pid=', '--ppid', String(pid)],
        { encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'] },
      )
      return out
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map(Number)
        .filter((value) => Number.isInteger(value) && value > 0)
    } catch {
      return []
    }
  }
}

function collectDescendants(rootPid, found = new Set(), depth = 0) {
  if (depth > 12) return found
  for (const child of readChildren(rootPid)) {
    if (found.has(child) || child === rootPid) continue
    found.add(child)
    collectDescendants(child, found, depth + 1)
  }
  return found
}

let activePids = new Set()
let lastPidRefresh = 0

function refreshPids(force = false) {
  const now = Date.now()
  if (!force && now - lastPidRefresh < PID_REFRESH_MS) return
  lastPidRefresh = now

  const next = new Set()
  if (pidAlive(LAUNCHER_PID)) next.add(LAUNCHER_PID)
  // Keep previously discovered descendants that are still alive. This covers
  // reparenting and a transient /proc read failure without retaining dead PIDs.
  for (const pid of activePids) {
    if (pidAlive(pid)) next.add(pid)
  }
  for (const pid of collectDescendants(LAUNCHER_PID)) {
    if (pidAlive(pid)) next.add(pid)
  }
  activePids = next
}

function logTailHasActivePid(chatDir) {
  const file = path.join(chatDir, 'log.jsonl')
  let text
  try {
    text = readTail(file, LOG_TAIL_BYTES)
  } catch {
    return false
  }
  const pattern = /"pid"\s*:\s*(\d+)/g
  let match
  while ((match = pattern.exec(text)) !== null) {
    if (activePids.has(Number(match[1]))) return true
  }
  return false
}

/* ---------------------------- Chat attribution --------------------------- */

function chatDirByProcFd() {
  const root = projectsRoot()
  let best = ''
  let bestMtime = 0
  for (const pid of activePids) {
    let fds
    try {
      fds = fs.readdirSync(`/proc/${pid}/fd`)
    } catch {
      continue
    }
    for (const fd of fds) {
      let target
      try {
        target = fs.readlinkSync(`/proc/${pid}/fd/${fd}`)
      } catch {
        continue
      }
      if (!target.startsWith(root + path.sep)) continue
      const segments = target.slice(root.length + 1).split(path.sep)
      if (segments.length < 4 || segments[1] !== 'chats') continue
      const dir = path.join(root, segments[0], 'chats', segments[2])
      if (!isDirectory(dir)) continue
      try {
        const mtime = fs.statSync(dir).mtimeMs
        if (mtime > bestMtime) {
          bestMtime = mtime
          best = dir
        }
      } catch {}
    }
  }
  return best
}

function chatDirByPidScan() {
  const root = projectsRoot()
  let projects
  try {
    projects = fs.readdirSync(root)
  } catch {
    return ''
  }

  for (const project of projects) {
    const chatsDir = path.join(root, project, 'chats')
    let names
    try {
      names = fs.readdirSync(chatsDir)
    } catch {
      continue
    }
    const candidates = []
    for (const name of names) {
      const full = path.join(chatsDir, name)
      if (!isDirectory(full)) continue
      try {
        candidates.push({ full, mtime: fs.statSync(full).mtimeMs })
      } catch {}
    }
    candidates.sort((a, b) => b.mtime - a.mtime)
    for (const candidate of candidates.slice(0, 50)) {
      if (logTailHasActivePid(candidate.full)) return candidate.full
    }
  }
  return ''
}

function explicitChatDir(chatId) {
  if (!safeChatId(chatId)) return ''
  const dir = path.join(
    projectsRoot(),
    projectName(),
    'chats',
    chatId,
  )
  return isDirectory(dir) ? dir : ''
}

function resolveChatDir() {
  if (START_CHAT_ID) {
    // An explicit resume target is valid only if it exists. Do not fall back:
    // Freebuff silently falls back to the newest chat on a missing --continue
    // target, which would defeat the whole point of the explicit ID.
    return explicitChatDir(START_CHAT_ID)
  }
  return chatDirByProcFd() || chatDirByPidScan()
}

/* ------------------------------- State ---------------------------------- */

let reportedState = ''
let turnActive = false
let openAskUser = false
let interrupted = false

function deriveState() {
  if (openAskUser && !interrupted) return 'blocked'
  if (turnActive) return 'working'
  return 'idle'
}

function deriveAndReport(message) {
  const next = deriveState()
  if (next === reportedState) return
  reportedState = next
  report(next, message || null)
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

function readCheckpoint(chatDir) {
  const file = path.join(chatDir, 'chat-messages.json')
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

let checkpointMtime = 0
let checkpointRevision = 0
let lastScreenFallback = 0

function screenShowsAskUser(text) {
  return text.includes('Some questions for you')
}

function screenFallback() {
  const now = Date.now()
  if (now - lastScreenFallback < SCREEN_FALLBACK_MS) return
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

function evaluateCheckpoint(chatDir) {
  const file = path.join(chatDir, 'chat-messages.json')
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

  const checkpoint = readCheckpoint(chatDir)
  if (!checkpoint) {
    screenFallback()
    return
  }

  openAskUser = checkpoint.openAskUser
  interrupted = checkpoint.interrupted
  if (interrupted) turnActive = false
  deriveAndReport(openAskUser && !interrupted ? 'Waiting for ask_user' : null)
}

/* ------------------------------ Log tailing ------------------------------ */

const tailers = new Map()

function tailLog(chatDir) {
  const file = path.join(chatDir, 'log.jsonl')
  let stat
  try {
    stat = fs.statSync(file)
  } catch {
    return
  }

  let tailer = tailers.get(chatDir)
  if (!tailer) {
    const replay = boundLogExisted && boundLogSize > 0
    const start = replay
      ? Math.max(0, stat.size - INITIAL_LOG_TAIL_BYTES)
      : 0
    tailer = {
      offset: start,
      lineBuffer: '',
      initial: replay,
      skipPartial: start > 0,
    }
    tailers.set(chatDir, tailer)
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

  // The log can contain lines from older processes and other panes. Resolve a
  // just-spawned child once before rejecting its first line.
  if (!activePids.has(pid)) {
    refreshPids(true)
    if (!activePids.has(pid)) return false
  }

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

/* ------------------------------- Main loop ------------------------------- */

const argv = process.argv.slice(2)
const LAUNCHER_PID = Number(argv[0] || 0)
const PANE_ID = argv[1] || process.env.HERDR_PANE_ID || ''
const START_CHAT_ID = argv[2] || ''
const START_SOURCE =
  process.env.FREEBUFF_SESSION_START_SOURCE === 'resume' ? 'resume' : 'startup'

if (argv.includes('--doctor')) {
  runDoctor(argv.filter((value) => value !== '--doctor'))
  process.exit(0)
}

let boundChatDir = ''
let boundLogExisted = false
let boundLogSize = 0
let sessionReported = ''
let sessionCount = 0
let shuttingDown = false

function bindChat(chatDir) {
  boundChatDir = chatDir
  turnActive = false
  openAskUser = false
  interrupted = false
  checkpointMtime = 0
  checkpointRevision += 1
  lastScreenFallback = 0
  tailers.delete(chatDir)

  // If the log is created or first written after binding, those lines are live
  // events, not replay history. Without this distinction a fast first turn can
  // collapse to idle before it is ever reported as working.
  const logFile = path.join(chatDir, 'log.jsonl')
  try {
    const logStat = fs.statSync(logFile)
    boundLogExisted = true
    boundLogSize = logStat.size
  } catch {
    boundLogExisted = false
    boundLogSize = 0
  }
  debug('bound chat:', chatDir)
}

function maybeReportSession() {
  if (!boundChatDir) return
  const chatId = path.basename(boundChatDir)
  if (sessionReported === chatId) return
  sessionReported = chatId
  reportSession(chatId, boundChatDir, START_SOURCE, sessionCount === 0)
  sessionCount += 1
}

function shutdown(reason) {
  if (shuttingDown) return
  shuttingDown = true
  debug('shutdown:', reason)
  releaseAgent()
  process.exit(0)
}

function loop() {
  if (!pidAlive(LAUNCHER_PID)) {
    shutdown('Freebuff launcher exited')
    return
  }

  refreshPids()
  const chatDir = resolveChatDir()
  if (chatDir && chatDir !== boundChatDir) bindChat(chatDir)

  if (boundChatDir) {
    // Establish the initial log cursor before announcing the session. This
    // keeps a turn that starts immediately after pane creation from being
    // mistaken for replayed history.
    tailLog(boundChatDir)
    evaluateCheckpoint(boundChatDir)
    maybeReportSession()
  }

  deriveAndReport()
  setTimeout(loop, POLL_INTERVAL_MS)
}

/* ------------------------------- Doctor --------------------------------- */

function findOnPath(command) {
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue
    const candidate = path.join(dir, command)
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      return candidate
    } catch {}
  }
  return ''
}

function versionOf(command) {
  if (!command) return null
  try {
    return String(
      execFileSync(command, ['--version'], {
        encoding: 'utf8',
        timeout: 1500,
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    ).trim()
  } catch {
    return null
  }
}

function manifestInfo() {
  const file = path.join(PLUGIN_ROOT, 'herdr-plugin.toml')
  let text = ''
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {}
  const read = (key) => {
    const match = text.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm'))
    return match ? match[1] : null
  }
  return {
    path: file,
    manifest: fs.existsSync(file),
    id: read('id'),
    version: read('version'),
    minHerdrVersion: read('min_herdr_version'),
  }
}

function recentChats() {
  const dir = path.join(projectsRoot(), projectName(), 'chats')
  let names
  try {
    names = fs.readdirSync(dir)
  } catch {
    return []
  }
  const chats = []
  for (const name of names) {
    const full = path.join(dir, name)
    if (!isDirectory(full)) continue
    try {
      const stat = fs.statSync(full)
      chats.push({
        id: name,
        path: full,
        mtimeMs: stat.mtimeMs,
        hasLog: fs.existsSync(path.join(full, 'log.jsonl')),
        hasMessages: fs.existsSync(path.join(full, 'chat-messages.json')),
      })
    } catch {}
  }
  chats.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return chats.slice(0, 20)
}

function runDoctor(extra) {
  const launcherPid = Number(extra[0] || 0)
  const chatId = extra[1] || ''
  const bin = process.env.FREEBUFF_BIN_PATH || findOnPath('freebuff')
  const children = launcherPid ? [...collectDescendants(launcherPid)] : []
  const report = {
    plugin: manifestInfo(),
    herdr: {
      env: HERDR_ENV,
      paneId: process.env.HERDR_PANE_ID || null,
      binPath: HERDR_BIN,
      version: versionOf(HERDR_BIN),
    },
    freebuff: {
      binary: bin || null,
      version: versionOf(bin),
      configDir: configDir(),
      projectName: projectName(),
      chats: recentChats(),
    },
    process: {
      launcherPid: launcherPid || null,
      launcherAlive: launcherPid ? pidAlive(launcherPid) : null,
      descendants: children,
    },
    binding: {
      explicitChatId: chatId || START_CHAT_ID || null,
      chatDir: chatId
        ? explicitChatDir(chatId)
        : START_CHAT_ID
          ? explicitChatDir(START_CHAT_ID)
          : null,
    },
    resume: {
      argv: chatId ? resumeArgv(chatId) : [],
    },
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
}

/* ------------------------------- Startup -------------------------------- */

if (!HERDR_ENV || !PANE_ID) {
  debug('not inside a Herdr pane; exiting')
  process.exit(0)
}
if (!Number.isInteger(LAUNCHER_PID) || LAUNCHER_PID <= 0) {
  debug('missing or invalid launcher pid')
  process.exit(1)
}

refreshPids(true)
if (reportSync('idle', 'Freebuff starting')) reportedState = 'idle'

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => shutdown(`received ${signal}`))
}
process.on('uncaughtException', (err) => {
  debug('uncaught exception:', err && err.stack ? err.stack : err)
  shutdown('uncaught exception')
})

debug(`starting: launcher=${LAUNCHER_PID} pane=${PANE_ID} chat=${START_CHAT_ID || '-'}`)
loop()
