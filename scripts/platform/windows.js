'use strict'

// Windows implementation of the platform seam.
//
// Windows offers no cheap process tree: the only complete answer is a CIM
// query, which measured 370-560ms and would run on every 500ms poll, so the
// watcher does not attempt one. It binds to the chat log written after it
// started and treats the launcher pid it was given as its only tree.

const path = require('path')

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // A process owned by another user answers EPERM on Windows too. It exists.
    return err.code === 'EPERM'
  }
}

// npm installs a `.cmd` shim, and Node cannot execute one directly (EINVAL
// since CVE-2024-27980). `cmd.exe /d /s /c` is the documented escape; `/d`
// skips AutoRun and `/s` makes the quote handling predictable. The arguments
// this wraps are ours and carry no double quotes, which the `/c` line could not
// survive.
function invocation(file, args) {
  if (!/\.(cmd|bat)$/i.test(file)) return { file, args }
  const line = [file, ...args].map((value) => `"${value}"`).join(' ')
  return {
    file: 'cmd.exe',
    args: ['/d', '/s', '/c', `"${line}"`],
    options: { windowsVerbatimArguments: true },
  }
}

module.exports = {
  name: process.platform,
  seesOpenFiles: false,
  seesProcessTable: false,
  pidAlive,
  descendants() {
    return new Set()
  },
  fdTargets() {
    return []
  },
  envOf() {
    return null
  },
  argvTable() {
    return []
  },
  pathExtensions() {
    const declared = process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD'
    return declared
      .split(';')
      .filter(Boolean)
      .map((extension) => extension.toLowerCase())
  },
  invocation,
  launchArgv(pluginRoot, mode, chatId) {
    return [
      '--',
      'powershell',
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(pluginRoot, 'scripts', 'windows', 'launch.ps1'),
      mode,
      chatId,
    ]
  },
}
