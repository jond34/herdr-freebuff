'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')

const REPO = path.resolve(__dirname, '..')
const unix = require(path.join(REPO, 'scripts', 'platform', 'unix.js'))
const windows = require(path.join(REPO, 'scripts', 'platform', 'windows.js'))
const {
  createBinding,
  readPublished,
  stateFileFor,
} = require(path.join(REPO, 'scripts', 'watcher', 'binding.js'))

// Requiring the watcher must not start a loop.
require(path.join(REPO, 'scripts', 'status-watcher.js'))

// A seam that sees no open files and no other processes, but can still test
// liveness. Binding then has to use freshness and the chat log, which is what a
// host without a process table does. Injecting it keeps these assertions on the
// same path everywhere the suite runs, instead of taking the fd path on Linux
// and the freshness path on Windows.
const blindSeam = {
  name: 'blind',
  seesOpenFiles: false,
  seesProcessTable: false,
  pidAlive: unix.pidAlive,
  descendants: () => new Set(),
}

const PANE = 'w1:pA'

function sandbox(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-bind-')))
  t.after(() =>
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
  )
  const box = {
    configDir: path.join(root, 'manicode'),
    projectName: 'project-a',
  }
  box.make = (id, options = {}) => chat(box, id, options)
  box.binding = (options = {}) =>
    createBinding({
      platform: blindSeam,
      configDir: box.configDir,
      projectName: box.projectName,
      paneId: PANE,
      launcherPid: process.pid,
      ...options,
    })
  box.published = () =>
    readPublished({
      platform: blindSeam,
      configDir: box.configDir,
      projectName: box.projectName,
      paneId: PANE,
    })
  return box
}

function chat(box, id, options = {}) {
  const dir = path.join(
    box.configDir,
    'projects',
    box.projectName,
    'chats',
    id,
  )
  fs.mkdirSync(dir, { recursive: true })
  const pid = options.pid === undefined ? process.pid : options.pid
  if (pid) {
    fs.writeFileSync(
      path.join(dir, 'log.jsonl'),
      JSON.stringify({ ts: '2026-01-01T00:00:00.000Z', pid, msg: 'Main prompt finished' }) + '\n',
    )
  }
  const age = options.ageMs || 0
  if (age && fs.existsSync(path.join(dir, 'log.jsonl'))) {
    const when = new Date(Date.now() - age)
    fs.utimesSync(path.join(dir, 'log.jsonl'), when, when)
  }
  return dir
}

function liveChild() {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  })
  return child
}

function deadPid() {
  const result = spawnSync(process.execPath, ['-e', ''], { stdio: 'ignore' })
  return result.pid
}

test('each seam says what it can see, not which host it is', () => {
  assert.equal(windows.seesOpenFiles, false)
  assert.equal(windows.seesProcessTable, false)
  assert.deepEqual([...windows.descendants(1)], [])
  assert.deepEqual(windows.fdTargets(1), [])
  assert.equal(windows.envOf(1, 'HERDR_SOCKET_PATH'), null)
  assert.deepEqual(windows.argvTable(), [])
  assert.equal(unix.seesOpenFiles, true)
  assert.equal(unix.seesProcessTable, true)
  assert.equal(unix.pidAlive(process.pid), true)
  assert.equal(unix.pidAlive(deadPid()), false)
})

test('a script shim is run through cmd.exe, a real executable is not', () => {
  const direct = windows.invocation('C:\\tools\\herdr.exe', ['pane', 'get', '1'])
  assert.equal(direct.file, 'C:\\tools\\herdr.exe')
  assert.deepEqual(direct.args, ['pane', 'get', '1'])

  const shim = windows.invocation('C:\\npm\\freebuff.cmd', ['--version'])
  assert.equal(shim.file, 'cmd.exe')
  assert.deepEqual(shim.args.slice(0, 3), ['/d', '/s', '/c'])
  assert.match(shim.args[3], /^""C:\\npm\\freebuff\.cmd" "--version""$/)
  assert.equal(shim.options.windowsVerbatimArguments, true)

  const unixDirect = unix.invocation('/usr/local/bin/herdr', ['pane', 'get', '1'])
  assert.equal(unixDirect.file, '/usr/local/bin/herdr')
  assert.deepEqual(unixDirect.args, ['pane', 'get', '1'])
})

test('launch argv points each host at its own launcher', () => {
  assert.deepEqual(unix.launchArgv('/plugin', 'resume-named', 'abc'), [
    '--',
    'sh',
    path.join('/plugin', 'scripts', 'launch.sh'),
    'resume-named',
    'abc',
  ])

  const argv = windows.launchArgv('C:\\plugin', 'resume-named', 'abc')
  assert.deepEqual(argv.slice(0, 2), ['--', 'powershell'])
  assert.ok(argv.includes('-ExecutionPolicy'))
  assert.ok(argv.includes('Bypass'))
  assert.equal(argv[argv.indexOf('-File') + 1], path.join('C:\\plugin', 'scripts', 'windows', 'launch.ps1'))
  assert.deepEqual(argv.slice(-2), ['resume-named', 'abc'])
})

test('PATH resolution uses the host suffix list', (t) => {
  assert.deepEqual(unix.pathExtensions(), [''])
  const previous = process.env.PATHEXT
  process.env.PATHEXT = '.COM;.EXE;.BAT;.CMD'
  t.after(() => {
    if (previous === undefined) delete process.env.PATHEXT
    else process.env.PATHEXT = previous
  })
  assert.deepEqual(windows.pathExtensions(), ['.com', '.exe', '.bat', '.cmd'])
})

test('binding ignores a chat written before this watcher started', (t) => {
  const box = sandbox(t)
  const stale = box.make('stale', { ageMs: 60 * 60 * 1000 })
  const fresh = box.make('fresh')

  const early = box.binding({ bornAt: Date.now() - 60 * 1000 })
  assert.equal(early.resolve().chatDir, fresh)
  assert.notEqual(early.resolve().chatDir, stale)
  assert.equal(early.resolve().source, 'log-fresh')

  const late = box.binding({ bornAt: Date.now() + 60 * 1000 })
  assert.equal(late.resolve(), null)
})

test('binding picks the newest fresh chat when two appeared', (t) => {
  const box = sandbox(t)
  const first = box.make('first')
  const second = box.make('second')
  const when = new Date(Date.now() + 1000)
  fs.utimesSync(path.join(second, 'log.jsonl'), when, when)
  fs.utimesSync(second, when, when)

  const found = box.binding({ bornAt: Date.now() - 60 * 1000 }).resolve()
  assert.equal(found.chatDir, second)
  assert.notEqual(first, second)
})

test('a claim on a recycled pid needs the writer to still be alive', (t) => {
  const box = sandbox(t)
  const child = liveChild()
  t.after(() => child.kill())
  const dir = box.make('written-by-child', { pid: child.pid })

  // The pid is a live process but not one this launcher owns, which is exactly
  // the case the binding has to resolve from the log.
  const binding = box.binding({ bornAt: Date.now() - 60 * 1000 })
  assert.equal(binding.owns(child.pid), false)
  assert.equal(binding.resolve().chatDir, dir)
  assert.equal(binding.owns(child.pid), true)
})

test('a binding whose writer exited is not kept', (t) => {
  const box = sandbox(t)
  const gone = deadPid()
  const stale = box.make('dead-writer', { pid: gone })
  const live = box.make('live-writer')

  const binding = box.binding({ bornAt: Date.now() - 60 * 1000 })
  t.after(() => binding.release())
  binding.bind(stale)
  assert.equal(binding.resolve().chatDir, live)
  assert.notEqual(binding.resolve().chatDir, stale)
})

test('a published binding round-trips, and a forged one is refused', (t) => {
  const box = sandbox(t)
  const dir = box.make('chat-1')
  const binding = box.binding()
  t.after(() => binding.release())

  assert.equal(box.published(), null)
  binding.bind(dir)
  const read = box.published()
  assert.equal(read.chatDir, dir)
  assert.equal(read.launcherPid, process.pid)

  const file = stateFileFor(PANE)
  const write = (payload) => fs.writeFileSync(file, JSON.stringify(payload) + '\n')

  // A chat directory outside this project is not this pane's chat.
  write({ paneId: PANE, watcherPid: process.pid, launcherPid: process.pid, chatDir: os.tmpdir() })
  assert.equal(box.published(), null)

  // A writer that has gone leaves a leftover, not a binding.
  write({ paneId: PANE, watcherPid: deadPid(), launcherPid: process.pid, chatDir: dir })
  assert.equal(box.published(), null)

  binding.bind(dir)
  assert.equal(box.published().chatDir, dir)
  binding.release()
  assert.equal(box.published(), null)
})
