'use strict'

// Unix implementation of the platform seam: Linux answers through procfs,
// macOS through ps and lsof. Both are cheaper than anything the alternative
// platforms offer, so the poll interval does not change between them.

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

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
    return childrenByPs(pid)
  }
}

// Without procfs (macOS) one ps call answers the whole parent/child map, and
// `-A -o pid=,ppid=` is accepted by both BSD and GNU ps. The table is cached for
// longer than a refresh cycle so a deep tree costs one call.
let psTreeCache = { at: 0, rows: [] }

function psTreeRows() {
  const now = Date.now()
  if (now - psTreeCache.at < 500 && psTreeCache.rows.length) return psTreeCache.rows
  let out
  try {
    out = execFileSync('ps', ['-A', '-o', 'pid=,ppid='], {
      encoding: 'utf8',
      timeout: 1000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return []
  }
  const rows = out
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter((cols) => cols.length === 2 && cols.every(Number.isInteger))
  psTreeCache = { at: now, rows }
  return rows
}

function childrenByPs(pid) {
  return psTreeRows()
    .filter(([, parent]) => parent === pid)
    .map(([child]) => child)
    .filter((value) => Number.isInteger(value) && value > 0)
}

// Open file targets for a process. procfs answers directly; macOS has no
// procfs, and lsof reports the same open-file table (`-F n` gives one name per
// line). A missing lsof is not fatal: binding falls back to the pid scan.
function fdTargets(pid) {
  const dir = `/proc/${pid}/fd`
  try {
    const targets = []
    for (const fd of fs.readdirSync(dir)) {
      try {
        targets.push(fs.readlinkSync(`${dir}/${fd}`))
      } catch {}
    }
    return targets
  } catch {}
  // PATH from a Herdr-spawned process does not always include /usr/sbin, where
  // macOS keeps lsof.
  for (const bin of ['lsof', '/usr/sbin/lsof']) {
    try {
      const out = execFileSync(bin, ['-w', '-p', String(pid), '-Fn'], {
        encoding: 'utf8',
        timeout: 2000,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      return out
        .split('\n')
        .filter((line) => line.startsWith('n') && line.length > 1)
        .map((line) => line.slice(1))
    } catch {}
  }
  return []
}

function descendants(rootPid, found = new Set(), depth = 0) {
  if (depth > 12) return found
  for (const child of readChildren(rootPid)) {
    if (found.has(child) || child === rootPid) continue
    found.add(child)
    descendants(child, found, depth + 1)
  }
  return found
}

function envOf(pid, name) {
  let text
  try {
    text = fs.readFileSync(`/proc/${pid}/environ`, 'utf8')
  } catch {
    // macOS: `ps -E` appends the environment to the command line. Values there
    // are space-separated, which is enough for the socket path this reads.
    try {
      text = execFileSync('ps', ['-E', '-p', String(pid)], {
        encoding: 'utf8',
        timeout: 1000,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch {
      return null
    }
    const flattened = text.replace(/\n/g, ' ')
    const at = flattened.indexOf(` ${name}=`)
    if (at < 0) return null
    const rest = flattened.slice(at + name.length + 2)
    const end = rest.search(/\s/)
    return end < 0 ? rest : rest.slice(0, end)
  }
  for (const entry of text.split('\0')) {
    const equals = entry.indexOf('=')
    if (equals > 0 && entry.slice(0, equals) === name) {
      return entry.slice(equals + 1)
    }
  }
  return null
}

// Every visible process with its argv. procfs answers directly; without procfs
// (macOS) one ps call gives the same table.
function argvTable() {
  const rows = []
  try {
    for (const entry of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(entry)) continue
      const pid = Number(entry)
      try {
        if (fs.statSync(`/proc/${entry}`).uid !== process.getuid()) continue
      } catch {
        continue
      }
      try {
        rows.push({
          pid,
          args: fs.readFileSync(`/proc/${entry}/cmdline`, 'utf8').split('\0').filter(Boolean),
        })
      } catch {}
    }
    if (rows.length) return rows
  } catch {}
  try {
    const out = execFileSync('ps', ['-A', '-o', 'pid=,command='], {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    for (const line of out.trim().split('\n')) {
      const match = line.trim().match(/^(\d+)\s+(.*)$/)
      if (!match) continue
      rows.push({ pid: Number(match[1]), args: match[2].split(/\s+/) })
    }
  } catch {}
  return rows
}

module.exports = {
  name: process.platform,
  seesOpenFiles: true,
  seesProcessTable: true,
  pidAlive,
  descendants,
  fdTargets,
  envOf,
  argvTable,
  pathExtensions() {
    return ['']
  },
  invocation(file, args) {
    return { file, args }
  },
  launchArgv(pluginRoot, mode, chatId) {
    return ['--', 'sh', path.join(pluginRoot, 'scripts', 'launch.sh'), mode, chatId]
  },
}
