'use strict'

// Diagnostics for a pane that is not behaving: what this install is, what the
// watcher can see, and which chat the pane bound.
//
// The report answers only from evidence. A chat is named by an explicit id, by
// the watcher found in the process table, or by the binding that watcher
// published. When none of those exists the report says `null` instead of naming
// the newest chat on disk, which usually belongs to another pane.

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { createBinding, readPublished, safeChatId } = require('./binding')
const { createHerdr } = require('./herdr')

function findOnPath(command, searchPath, extensions) {
  for (const dir of String(searchPath || '').split(path.delimiter)) {
    if (!dir) continue
    // Windows resolves `freebuff` to `freebuff.cmd` through PATHEXT; Unix has a
    // single suffix and it is empty.
    for (const extension of extensions) {
      const candidate = path.join(dir, command + extension)
      try {
        fs.accessSync(candidate, fs.constants.X_OK)
        return candidate
      } catch {}
    }
  }
  return ''
}

function versionOf(platform, command) {
  if (!command) return null
  try {
    const invocation = platform.invocation(command, ['--version'])
    return String(
      execFileSync(invocation.file, invocation.args, {
        ...invocation.options,
        encoding: 'utf8',
        timeout: 1500,
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    ).trim()
  } catch {
    return null
  }
}

function manifestInfo(pluginRoot) {
  const file = path.join(pluginRoot, 'herdr-plugin.toml')
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

// The doctor action is invoked with only Herdr's pane context. Find the watcher
// already running for that pane so the report describes the real launcher/child
// tree instead of an empty argument set. Pane ids are scoped to a Herdr session,
// so compare the watcher's inherited socket path with the doctor's own context
// before selecting one.
function findWatcherForPane(platform, pluginRoot, paneId, sessionIdentity) {
  const result = {
    watcher: null,
    candidates: [],
    ambiguous: false,
    reason: 'not-found',
    sessionIdentity,
  }
  if (!paneId) return { ...result, reason: 'no-pane' }
  const script = path.join(pluginRoot, 'scripts', 'status-watcher.js')
  const table = platform.argvTable()
  if (!table.length && !platform.seesProcessTable) {
    // This host has no cheap process table, so the seam returns none. Say that
    // rather than reporting a watcher that cannot be seen from here.
    return { ...result, reason: 'process-table-unavailable' }
  }
  for (const { pid, args } of table) {
    if (!platform.pidAlive(pid)) continue
    const scriptIndex = args.indexOf(script)
    if (scriptIndex < 0 || args[scriptIndex + 2] !== paneId) continue
    const launcherPid = Number(args[scriptIndex + 1])
    if (!Number.isInteger(launcherPid) || launcherPid <= 0) continue
    const explicitChatId = safeChatId(args[scriptIndex + 3])
      ? args[scriptIndex + 3]
      : ''
    result.candidates.push({
      watcherPid: pid,
      launcherPid,
      explicitChatId,
      sessionSocket: platform.envOf(pid, 'HERDR_SOCKET_PATH') || '',
    })
  }

  if (sessionIdentity) {
    const matches = result.candidates.filter(
      (candidate) => candidate.sessionSocket === sessionIdentity,
    )
    if (matches.length === 1) {
      result.watcher = matches[0]
      result.reason = 'session-match'
    } else if (matches.length > 1) {
      result.ambiguous = true
      result.reason = 'multiple-session-matches'
    } else if (result.candidates.length > 0) {
      result.ambiguous = true
      result.reason = 'no-session-match'
    }
    return result
  }

  if (result.candidates.length === 1) {
    result.watcher = result.candidates[0]
    result.reason = 'single-candidate'
  } else if (result.candidates.length > 1) {
    result.ambiguous = true
    result.reason = 'session-identity-unavailable'
  }
  return result
}

// Windows only. Group Policy outranks the `-ExecutionPolicy Bypass` the manifest
// passes, and it is the first thing to check when a pane opens and closes again,
// so record what each scope says.
function executionPolicy(platform) {
  const invocation = platform.invocation('powershell', [
    '-NoProfile',
    '-Command',
    "@(Get-ExecutionPolicy -List | Select-Object @{n='Scope';e={$_.Scope.ToString()}},@{n='ExecutionPolicy';e={$_.ExecutionPolicy.ToString()}}) | ConvertTo-Json -Compress",
  ])
  try {
    const out = execFileSync(invocation.file, invocation.args, {
      ...invocation.options,
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const parsed = JSON.parse(String(out))
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return null
  }
}

function run({ platform, env, launcherPid = 0, chatId = '', pidRefreshMs = 2000 }) {
  const explicitChatId = chatId
  const explicitLauncherPid = launcherPid
  const watcherLookup =
    !launcherPid && env.paneId
      ? findWatcherForPane(platform, env.pluginRoot, env.paneId, env.socketPath)
      : null
  const watcher = watcherLookup ? watcherLookup.watcher : null
  if (watcher) {
    launcherPid = watcher.launcherPid
    if (!chatId) chatId = watcher.explicitChatId
  }

  // Where the process table cannot be searched, the watcher publishes its pane
  // binding instead, and it is the only truthful source for this pane.
  const published = readPublished({
    platform,
    configDir: env.configDir,
    projectName: env.projectName,
    paneId: env.paneId,
  })
  if (published && !launcherPid) launcherPid = published.launcherPid

  const binding = createBinding({
    platform,
    configDir: env.configDir,
    projectName: env.projectName,
    paneId: env.paneId,
    launcherPid,
    pidRefreshMs,
  })
  const herdr = createHerdr({
    platform,
    bin: env.herdrBin,
    paneId: env.paneId,
    env: env.herdrEnabled,
    pluginRoot: env.pluginRoot,
    debug: env.debug,
  })

  const bin =
    env.freebuffBin ||
    findOnPath('freebuff', env.path, platform.pathExtensions())
  const children = launcherPid ? [...platform.descendants(launcherPid)] : []
  let chatDir = chatId ? binding.chatDirFor(chatId) : ''
  if (!chatDir && published) chatDir = published.chatDir
  if (!chatDir && platform.seesOpenFiles && launcherPid) {
    // An open file descriptor, or a log line written by a pid this launcher
    // owns, is evidence of which chat is in play. A directory timestamp is only
    // a resemblance, so this never names the newest chat on disk.
    binding.refresh(true)
    const found = binding.resolve()
    if (found) chatDir = found.chatDir
  }
  const boundChatId = chatDir ? path.basename(chatDir) : chatId
  const sessionMatched = watcher
    ? watcherLookup.sessionIdentity
      ? watcher.sessionSocket === watcherLookup.sessionIdentity
      : null
    : false

  return {
    platform: {
      name: platform.name,
      seesOpenFiles: platform.seesOpenFiles,
      seesProcessTable: platform.seesProcessTable,
      node: process.execPath,
      nodeVersion: process.version,
      executionPolicy: executionPolicy(platform),
    },
    plugin: manifestInfo(env.pluginRoot),
    herdr: {
      env: env.herdrEnabled,
      paneId: env.paneId || null,
      binPath: env.herdrBin,
      version: versionOf(platform, env.herdrBin),
    },
    freebuff: {
      binary: bin || null,
      version: versionOf(platform, bin),
      configDir: env.configDir,
      projectName: env.projectName,
      chats: binding.recentChats(),
    },
    process: {
      watcherPid: watcher ? watcher.watcherPid : published ? published.watcherPid : null,
      launcherPid: launcherPid || null,
      launcherAlive: launcherPid ? platform.pidAlive(launcherPid) : null,
      descendants: children,
    },
    doctor: {
      session: watcherLookup
        ? {
            socketPath: watcherLookup.sessionIdentity || null,
            matched: sessionMatched,
            ambiguous: watcherLookup.ambiguous,
            reason: watcherLookup.reason,
            candidateCount: watcherLookup.candidates.length,
          }
        : {
            socketPath: env.socketPath || null,
            matched: false,
            ambiguous: false,
            reason: explicitLauncherPid ? 'explicit-launcher' : 'no-pane',
            candidateCount: 0,
          },
      // Which source named the watcher, launcher, and chat above.
      bindingSource: watcher
        ? 'process-table'
        : published
          ? 'published-binding'
          : explicitLauncherPid
            ? 'explicit-launcher'
            : null,
    },
    binding: {
      explicitChatId: explicitChatId || null,
      chatId: boundChatId || null,
      chatDir: chatDir || null,
    },
    resume: {
      argv: boundChatId ? herdr.resumeArgv(boundChatId) : [],
    },
  }
}

module.exports = { run }
