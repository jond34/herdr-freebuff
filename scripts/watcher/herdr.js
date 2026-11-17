'use strict'

// Every call this plugin makes into Herdr about its pane: state reports, the
// session report that carries the resume argv, releasing the agent on exit, and
// reading the visible screen.
//
// Herdr may be an executable or a script shim depending on how it was
// installed, so each call resolves through the seam's invocation. Nothing here
// throws at the caller: a failed report is a debug line, because a pane that
// cannot be described is still a pane the user is typing in.

const { execFile, execFileSync } = require('child_process')

const SCREEN_LINES = 60

function safeResumeArg(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !/[\u0000-\u001f']/.test(value)
  )
}

function createHerdr({ platform, bin, paneId, env, pluginRoot, debug = () => {} }) {
  let seq = 0

  function nextSeq() {
    if (seq === 0) seq = Date.now() * 1000
    return ++seq
  }

  function execHerdr(args, options, callback) {
    const command = platform.invocation(bin, args)
    return execFile(
      command.file,
      command.args,
      { ...options, ...command.options },
      callback,
    )
  }

  function execHerdrSync(args, options) {
    const command = platform.invocation(bin, args)
    return execFileSync(command.file, command.args, {
      ...options,
      ...command.options,
    })
  }

  function reportArgs(state, message) {
    const args = [
      'pane', 'report-agent', paneId,
      '--source', 'freebuff',
      '--agent', 'freebuff',
      '--state', state,
      '--seq', String(nextSeq()),
    ]
    if (message) args.push('--message', message.slice(0, 500))
    return args
  }

  function report(state, message) {
    if (!env || !paneId) return
    execHerdr(reportArgs(state, message), {}, (err) => {
      if (err) debug('report-agent failed:', err.message)
    })
  }

  function reportSync(state, message) {
    if (!env || !paneId) return false
    try {
      execHerdrSync(reportArgs(state, message), {
        timeout: 2000,
        stdio: 'ignore',
      })
      return true
    } catch (err) {
      debug('report-agent failed:', err.message)
      return false
    }
  }

  function resumeArgv(chatId) {
    const argv = platform.launchArgv(pluginRoot, 'resume-named', chatId)
    return argv.every(safeResumeArg) ? argv : []
  }

  function reportSession(chatId, chatDir, startSource, first) {
    if (!env || !paneId) return
    const args = [
      'pane', 'report-agent-session', paneId,
      '--source', 'freebuff',
      '--agent', 'freebuff',
      '--seq', String(nextSeq()),
      '--agent-session-id', chatId,
      '--agent-session-path', chatDir,
      '--session-start-source', first ? startSource : 'resume',
    ]
    args.push(...resumeArgv(chatId))
    execHerdr(args, {}, (err) => {
      if (err) debug('report-agent-session failed:', err.message)
    })
  }

  function release() {
    if (!env || !paneId) return
    try {
      execHerdrSync(
        [
          'pane', 'release-agent', paneId,
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
    if (!env || !paneId) return callback(false, '')
    execHerdr(
      ['pane', 'read', paneId, '--source', 'visible', '--lines', String(SCREEN_LINES)],
      { maxBuffer: 1024 * 1024 },
      (err, stdout) => callback(!err, err ? '' : String(stdout || '')),
    )
  }

  return {
    report,
    reportSync,
    reportSession,
    release,
    readPaneText,
    resumeArgv,
  }
}

module.exports = { createHerdr }
