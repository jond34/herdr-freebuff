'use strict'

// Which chat this pane is writing to, and where chats live.
//
// Two hosts answer this differently and the caller does not find out which:
//
//   a host that can see open files and the process tree asks it directly — the
//   chat log the launcher holds open is named by an fd, or by a log line whose
//   pid this launcher owns.
//
//   a host that cannot binds the chat log written after the watcher started and
//   keeps that binding while its writer lives. Freshness stands in for identity
//   there: a recycled pid cannot produce a log written after the pane launched.
//
// `resolve()` returns a directory and the source that named it, or null. It
// never guesses from a directory timestamp alone; a chat nobody can prove is a
// chat this pane does not claim.
//
// The caller is expected to call `bind()` with what `resolve()` returned, and
// `release()` on the way out.

const fs = require('fs')
const os = require('os')
const path = require('path')

const LOG_TAIL_BYTES = 8192

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

function positiveInt(value) {
  return Number.isInteger(value) && value > 0
}

function stateFileFor(paneId) {
  return path.join(
    os.tmpdir(),
    'herdr-freebuff-bind',
    `${String(paneId || 'pane').replace(/[^A-Za-z0-9._-]/g, '_')}.json`,
  )
}

// What the watcher published for a pane, if it is still the truth. This is the
// trust boundary: the file lives in a shared temp directory, so every field has
// to agree before the value is used, and the writer has to still be alive or
// the entry is a leftover from a pane that has gone.
function readPublished({ platform, configDir, projectName, paneId }) {
  // Only a host that publishes has anything to read.
  if (platform.seesProcessTable) return null
  let payload
  try {
    payload = JSON.parse(fs.readFileSync(stateFileFor(paneId), 'utf8'))
  } catch {
    return null
  }
  if (!payload || typeof payload !== 'object') return null
  if (payload.paneId !== paneId) return null
  if (!positiveInt(payload.watcherPid) || !positiveInt(payload.launcherPid)) return null
  if (!platform.pidAlive(payload.watcherPid)) return null
  const dir = payload.chatDir
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) return null
  const chatsDir = path.join(configDir, 'projects', projectName, 'chats')
  if (path.dirname(dir) !== chatsDir) return null
  if (!isDirectory(dir)) return null
  return {
    paneId,
    watcherPid: payload.watcherPid,
    launcherPid: payload.launcherPid,
    chatDir: dir,
  }
}

function createBinding({
  platform,
  configDir,
  projectName,
  paneId,
  launcherPid,
  explicitChatId = '',
  bornAt = Date.now(),
  pidRefreshMs = 2000,
}) {
  const projectsRoot = path.join(configDir, 'projects')
  const chatsDir = path.join(projectsRoot, projectName, 'chats')
  const stateFile = stateFileFor(paneId)

  let activePids = new Set()
  let lastPidRefresh = 0
  let sticky = ''

  /* ------------------------------- PIDs ---------------------------------- */

  function refresh(force = false) {
    const now = Date.now()
    if (!force && now - lastPidRefresh < pidRefreshMs) return
    lastPidRefresh = now

    const next = new Set()
    if (platform.pidAlive(launcherPid)) next.add(launcherPid)
    // Keep previously discovered pids that are still alive. This covers
    // reparenting, a transient read failure, and hosts with no tree to walk
    // that learn the writing pid from the chat log instead.
    for (const pid of activePids) {
      if (platform.pidAlive(pid)) next.add(pid)
    }
    for (const pid of platform.descendants(launcherPid)) {
      if (platform.pidAlive(pid)) next.add(pid)
    }
    activePids = next
  }

  // A log line from a pid this launcher does not own belongs to another pane or
  // an older process. Resolve a just-spawned child once before rejecting it.
  function owns(pid) {
    if (activePids.has(pid)) return true
    refresh(true)
    return activePids.has(pid)
  }

  // Every pid in the recent tail of a chat log. On hosts without procfs this is
  // the only place the writing pid can be learned from.
  function logTailPids(dir) {
    let text
    try {
      text = readTail(path.join(dir, 'log.jsonl'), LOG_TAIL_BYTES)
    } catch {
      return []
    }
    const pids = new Set()
    const pattern = /"pid"\s*:\s*(\d+)/g
    let match
    while ((match = pattern.exec(text)) !== null) pids.add(Number(match[1]))
    return [...pids]
  }

  function logTailHasActivePid(dir) {
    return logTailPids(dir).some((pid) => activePids.has(pid))
  }

  /* --------------------------- Chat discovery ---------------------------- */

  function chatDirByProcFd() {
    // The seam reports resolved paths on macOS, and /var is a symlink to
    // /private/var, so the projects root has to be matched in both forms.
    const roots = [projectsRoot]
    try {
      const resolved = fs.realpathSync(projectsRoot)
      if (resolved !== projectsRoot) roots.push(resolved)
    } catch {}
    let best = ''
    let bestMtime = 0
    for (const pid of activePids) {
      for (const target of platform.fdTargets(pid)) {
        const matched = roots.find((candidate) => target.startsWith(candidate + path.sep))
        if (!matched) continue
        const segments = target.slice(matched.length + 1).split(path.sep)
        if (segments.length < 4 || segments[1] !== 'chats') continue
        const dir = path.join(projectsRoot, segments[0], 'chats', segments[2])
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
    let projects
    try {
      projects = fs.readdirSync(projectsRoot)
    } catch {
      return ''
    }

    for (const project of projects) {
      const dir = path.join(projectsRoot, project, 'chats')
      let names
      try {
        names = fs.readdirSync(dir)
      } catch {
        continue
      }
      const candidates = []
      for (const name of names) {
        const full = path.join(dir, name)
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

  function logWrittenSince(dir, sinceMs) {
    try {
      return fs.statSync(path.join(dir, 'log.jsonl')).mtimeMs >= sinceMs
    } catch {
      return false
    }
  }

  function chatDirByFreshLog() {
    let projects
    try {
      projects = fs.readdirSync(projectsRoot)
    } catch {
      return ''
    }

    const candidates = []
    for (const project of projects) {
      const dir = path.join(projectsRoot, project, 'chats')
      let names
      try {
        names = fs.readdirSync(dir)
      } catch {
        continue
      }
      for (const name of names) {
        const full = path.join(dir, name)
        if (!isDirectory(full) || !logWrittenSince(full, bornAt)) continue
        try {
          candidates.push({ full, mtime: fs.statSync(full).mtimeMs })
        } catch {}
      }
    }

    candidates.sort((a, b) => b.mtime - a.mtime)
    for (const candidate of candidates.slice(0, 20)) {
      const live = logTailPids(candidate.full).filter((pid) => platform.pidAlive(pid))
      if (!live.length) continue
      // The writing pid is never a descendant here, so the log is the only
      // source of it: without this, every log line would be rejected.
      for (const pid of live) activePids.add(pid)
      return candidate.full
    }
    return ''
  }

  function chatDirFor(chatId) {
    if (!safeChatId(chatId)) return ''
    const dir = path.join(chatsDir, chatId)
    return isDirectory(dir) ? dir : ''
  }

  function explicitDir() {
    return chatDirFor(explicitChatId)
  }

  function stickyLive() {
    if (!sticky || !isDirectory(sticky)) return false
    return logTailPids(sticky).some((pid) => platform.pidAlive(pid))
  }

  function resolve() {
    if (explicitChatId) {
      // An explicit resume target is valid only if it exists. Do not fall back:
      // Freebuff silently falls back to the newest chat on a missing
      // --continue target, which would defeat the explicit id.
      const dir = explicitDir()
      return dir ? { chatDir: dir, source: 'explicit' } : null
    }
    if (!platform.seesOpenFiles) {
      // Keep the binding this pane already made: another pane in the same
      // project can create a newer chat, and this watcher must not follow it.
      if (stickyLive()) return { chatDir: sticky, source: 'sticky' }
      const fresh = chatDirByFreshLog()
      return fresh ? { chatDir: fresh, source: 'log-fresh' } : null
    }
    const byFd = chatDirByProcFd()
    if (byFd) return { chatDir: byFd, source: 'proc-fd' }
    const byScan = chatDirByPidScan()
    return byScan ? { chatDir: byScan, source: 'pid-scan' } : null
  }

  /* ------------------------------ Published ------------------------------ */

  function publish(chatDir) {
    try {
      fs.mkdirSync(path.dirname(stateFile), { recursive: true })
      fs.writeFileSync(
        stateFile,
        JSON.stringify({
          paneId,
          watcherPid: process.pid,
          launcherPid,
          chatDir,
        }) + '\n',
      )
      return true
    } catch {
      // A report is a convenience, never a reason to stop watching a pane.
      return false
    }
  }

  function recentChats() {
    let names
    try {
      names = fs.readdirSync(chatsDir)
    } catch {
      return []
    }
    const chats = []
    for (const name of names) {
      const full = path.join(chatsDir, name)
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

  function bind(chatDir) {
    sticky = chatDir
    // A host with no process table cannot be asked which chat this pane bound,
    // so publish it for `doctor`. Hosts that can be asked need no file.
    if (!platform.seesProcessTable) publish(chatDir)
  }

  function release() {
    sticky = ''
    if (platform.seesProcessTable) return
    try {
      fs.unlinkSync(stateFile)
    } catch {}
  }

  return {
    chatDirFor,
    refresh,
    owns,
    resolve,
    bind,
    release,
    recentChats,
  }
}

module.exports = { createBinding, readPublished, safeChatId, stateFileFor }
