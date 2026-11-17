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
 * This file is the only place the process reads its environment, and the only
 * place that decides what runs: one poll, one shutdown path, one entrypoint.
 * The four modules beside it own the decisions:
 *
 *   watcher/binding.js  which chat this pane owns, and where chats live
 *   watcher/turns.js    idle / working / blocked, from log and checkpoint
 *   watcher/herdr.js    the pane reports and the resume argv
 *   watcher/doctor.js   diagnostics, answered from evidence only
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

const os = require('os')
const path = require('path')
const platform = require('./platform')
const { createBinding } = require('./watcher/binding')
const { createTurns } = require('./watcher/turns')
const { createHerdr } = require('./watcher/herdr')
const doctor = require('./watcher/doctor')

const DEBUG = process.env.FREEBUFF_WATCHER_DEBUG === '1'
function debug(...args) {
  if (!DEBUG) return
  process.stderr.write(
    `[freebuff-watcher ${new Date().toISOString()}] ${args.map(String).join(' ')}\n`,
  )
}

// Everything the process learns from its environment, read once. The modules
// take what they need as arguments.
const ENV = {
  paneId: process.env.HERDR_PANE_ID || '',
  socketPath: process.env.HERDR_SOCKET_PATH || '',
  path: process.env.PATH || '',
  pluginRoot: process.env.HERDR_PLUGIN_ROOT || path.resolve(__dirname, '..'),
  herdrBin: process.env.HERDR_BIN_PATH || 'herdr',
  herdrEnabled: process.env.HERDR_ENV === '1',
  configDir:
    process.env.FREEBUFF_CONFIG_DIR ||
    path.join(os.homedir(), '.config', 'manicode'),
  projectName: process.env.FREEBUFF_PROJECT_NAME || path.basename(process.cwd()),
  freebuffBin: process.env.FREEBUFF_BIN_PATH || '',
  startSource:
    process.env.FREEBUFF_SESSION_START_SOURCE === 'resume' ? 'resume' : 'startup',
  pollMs: Number(process.env.FREEBUFF_WATCHER_POLL_MS || 500),
  pidRefreshMs: Number(process.env.FREEBUFF_WATCHER_PID_REFRESH_MS || 2000),
  screenFallbackMs: Number(process.env.FREEBUFF_WATCHER_SCREEN_FALLBACK_MS || 5000),
  // Everything this watcher may claim as its own was written after it started:
  // a chat log older than this belongs to a session another pane launched.
  bornAt: Date.now(),
  debug,
}

const argv = process.argv.slice(2)
const LAUNCHER_PID = Number(argv[0] || 0)
const PANE_ID = argv[1] || ENV.paneId
const START_CHAT_ID = argv[2] || ''

// `--doctor` answers with a report and exits; everything below it belongs to
// the watcher itself.
if (argv.includes('--doctor')) {
  const extra = argv.filter((value) => value !== '--doctor')
  const report = doctor.run({
    platform,
    launcherPid: Number(extra[0] || 0),
    chatId: extra[1] || '',
    pidRefreshMs: ENV.pidRefreshMs,
    env: ENV,
  })
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  process.exit(0)
}

const binding = createBinding({
  platform,
  configDir: ENV.configDir,
  projectName: ENV.projectName,
  paneId: PANE_ID,
  launcherPid: LAUNCHER_PID,
  explicitChatId: START_CHAT_ID,
  bornAt: ENV.bornAt,
  pidRefreshMs: ENV.pidRefreshMs,
})

const herdr = createHerdr({
  platform,
  bin: ENV.herdrBin,
  paneId: PANE_ID,
  env: ENV.herdrEnabled,
  pluginRoot: ENV.pluginRoot,
  debug,
})

const turns = createTurns({
  binding,
  readPaneText: herdr.readPaneText,
  screenFallbackMs: ENV.screenFallbackMs,
  emit: (state, message, options) =>
    options && options.sync
      ? herdr.reportSync(state, message)
      : herdr.report(state, message),
})

let sessionReported = ''
let sessionCount = 0
let shuttingDown = false

function bindChat(chatDir) {
  turns.bind(chatDir)
  debug('bound chat:', chatDir)
  binding.bind(chatDir)
}

function maybeReportSession() {
  const chatDir = turns.chatDir
  if (!chatDir) return
  const chatId = path.basename(chatDir)
  if (sessionReported === chatId) return
  sessionReported = chatId
  herdr.reportSession(chatId, chatDir, ENV.startSource, sessionCount === 0)
  sessionCount += 1
}

function shutdown(reason) {
  if (shuttingDown) return
  shuttingDown = true
  debug('shutdown:', reason)
  herdr.release()
  binding.release()
  process.exit(0)
}

function loop() {
  if (!platform.pidAlive(LAUNCHER_PID)) {
    shutdown('Freebuff launcher exited')
    return
  }

  binding.refresh()
  const found = binding.resolve()
  if (found && found.chatDir !== turns.chatDir) bindChat(found.chatDir)

  // tick() tails the log and evaluates the checkpoint for the bound chat, then
  // reports whatever that derives to.
  turns.tick()
  maybeReportSession()
  setTimeout(loop, ENV.pollMs)
}

/* ------------------------------- Startup -------------------------------- */

function start() {
  if (!ENV.herdrEnabled || !PANE_ID) {
    debug('not inside a Herdr pane; exiting')
    process.exit(0)
  }
  if (!Number.isInteger(LAUNCHER_PID) || LAUNCHER_PID <= 0) {
    debug('missing or invalid launcher pid')
    process.exit(1)
  }

  binding.refresh(true)
  turns.begin()

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => shutdown(`received ${signal}`))
  }
  process.on('uncaughtException', (err) => {
    debug('uncaught exception:', err && err.stack ? err.stack : err)
    shutdown('uncaught exception')
  })

  debug(`starting: launcher=${LAUNCHER_PID} pane=${PANE_ID} chat=${START_CHAT_ID || '-'}`)
  loop()
}

if (require.main === module) start()
