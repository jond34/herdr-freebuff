'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')

const REPO = path.resolve(__dirname, '..')
const LAUNCH = path.join(REPO, 'scripts', 'launch.sh')
const DOCTOR = path.join(REPO, 'scripts', 'doctor.sh')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function writeExecutable(file, body) {
  fs.writeFileSync(file, body)
  fs.chmodSync(file, 0o755)
}

function setup(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-freebuff-')))
  const config = path.join(root, 'manicode')
  const projectName = 'project-a'
  const projectDir = path.join(root, projectName)
  fs.mkdirSync(projectDir, { recursive: true })

  const stub = path.join(root, 'stub-herdr.js')
  writeExecutable(
    stub,
    `#!/usr/bin/env node
'use strict'
const fs = require('fs')
const args = process.argv.slice(2)
fs.appendFileSync(process.env.HERDR_STUB_LOG, JSON.stringify(args) + '\\n')
if (args[0] === 'pane' && args[1] === 'read') {
  try {
    process.stdout.write(fs.readFileSync(process.env.HERDR_STUB_PANE_FILE, 'utf8'))
  } catch {}
}
`,
  )

  const fakeChild = path.join(root, 'fake-child.js')
  writeExecutable(
    fakeChild,
    `#!/usr/bin/env node
'use strict'
const fs = require('fs')
const path = require('path')
const chat = process.env.FAKE_CHAT_DIR
fs.mkdirSync(chat, { recursive: true })
const log = path.join(chat, 'log.jsonl')
const messages = path.join(chat, 'chat-messages.json')
const logFd = fs.openSync(log, 'a')
if (!fs.existsSync(messages)) fs.writeFileSync(messages, '[]')
const messagesFd = fs.openSync(messages, 'r')
fs.writeFileSync(process.env.FAKE_CHILD_PID_FILE, String(process.pid))
const timer = setInterval(() => {}, 1000)
function stop() {
  clearInterval(timer)
  try { fs.closeSync(logFd) } catch {}
  try { fs.closeSync(messagesFd) } catch {}
  process.exit(0)
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
`,
  )

  const fakeLauncher = path.join(root, 'fake-freebuff.sh')
  writeExecutable(
    fakeLauncher,
    `#!/bin/sh
: > "$FAKE_ARGS_FILE"
for arg in "$@"; do printf '%s\\n' "$arg" >> "$FAKE_ARGS_FILE"; done
node "$FAKE_CHILD_SCRIPT" &
child=$!
printf '%s\\n' "$child" > "$FAKE_CHILD_PID_FILE"
wait "$child"
`,
  )

  const calls = path.join(root, 'herdr-calls.jsonl')
  const paneFile = path.join(root, 'pane.txt')
  fs.writeFileSync(calls, '')
  fs.writeFileSync(paneFile, '')

  const ctx = {
    root,
    config,
    projectName,
    projectDir,
    stub,
    calls,
    paneFile,
    fakeLauncher,
    fakeChild,
    launchers: [],
    seq: 0,
  }

  t.after(async () => {
    for (const pane of ctx.launchers) {
      try { pane.proc.kill('SIGTERM') } catch {}
    }
    await sleep(100)
    for (const pane of ctx.launchers) {
      const pid = readPid(pane.pidFile)
      if (pid) {
        try { process.kill(pid, 'SIGTERM') } catch {}
      }
    }
    await sleep(300)
    // A pane that is still finishing its exit can create a file between the
    // readdir and the rmdir, so let the removal retry instead of failing the
    // test that already passed its assertions.
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  })

  return ctx
}

function createChat(ctx, chatId) {
  const dir = path.join(
    ctx.config,
    'projects',
    ctx.projectName,
    'chats',
    chatId,
  )
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'log.jsonl'), '')
  fs.writeFileSync(path.join(dir, 'chat-messages.json'), '[]')
  return dir
}

function writeLog(chatDir, pid, msg, extra = {}) {
  fs.appendFileSync(
    path.join(chatDir, 'log.jsonl'),
    JSON.stringify({
      level: 'INFO',
      timestamp: new Date().toISOString(),
      pid,
      msg,
      ...extra,
    }) + '\n',
  )
}

function writeCheckpoint(chatDir, messages) {
  fs.writeFileSync(
    path.join(chatDir, 'chat-messages.json'),
    JSON.stringify(messages),
  )
}

function startPane(ctx, options = {}) {
  const pane = options.pane || `pane-${++ctx.seq}`
  const label = options.label || pane
  const pidFile = path.join(ctx.root, `${label}.child.pid`)
  const argsFile = path.join(ctx.root, `${label}.args`)
  fs.rmSync(pidFile, { force: true })
  fs.rmSync(argsFile, { force: true })

  const env = {
    ...process.env,
    HERDR_ENV: '1',
    HERDR_PANE_ID: pane,
    HERDR_BIN_PATH: ctx.stub,
    HERDR_STUB_LOG: ctx.calls,
    HERDR_STUB_PANE_FILE: ctx.paneFile,
    HERDR_PLUGIN_ROOT: REPO,
    FREEBUFF_CONFIG_DIR: ctx.config,
    FREEBUFF_BIN_PATH: ctx.fakeLauncher,
    FREEBUFF_WATCHER_POLL_MS: '40',
    FREEBUFF_WATCHER_PID_REFRESH_MS: '40',
    FREEBUFF_WATCHER_SCREEN_FALLBACK_MS: '0',
    FAKE_CHILD_SCRIPT: ctx.fakeChild,
    FAKE_CHAT_DIR: options.chatDir || path.join(ctx.root, 'outside-chat'),
    FAKE_CHILD_PID_FILE: pidFile,
    FAKE_ARGS_FILE: argsFile,
    ...options.env,
  }

  const args = [LAUNCH, options.mode || 'task']
  if (options.mode === 'resume-named') args.push(options.chatId)

  const proc = spawn('sh', args, {
    cwd: options.cwd || ctx.projectDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const paneState = { proc, pane, label, pidFile, argsFile, stdout: '', stderr: '' }
  if (proc.stdout) proc.stdout.on('data', (chunk) => { paneState.stdout += String(chunk) })
  if (proc.stderr) proc.stderr.on('data', (chunk) => { paneState.stderr += String(chunk) })
  ctx.launchers.push(paneState)
  return paneState
}

function doctorEnv(ctx, options = {}) {
  const env = {
    ...process.env,
    HERDR_ENV: '1',
    HERDR_PANE_ID: options.pane || '',
    HERDR_PLUGIN_ROOT: REPO,
    FREEBUFF_CONFIG_DIR: ctx.config,
    FREEBUFF_BIN_PATH: ctx.fakeLauncher,
  }
  delete env.HERDR_SOCKET_PATH
  if (options.socketPath) env.HERDR_SOCKET_PATH = options.socketPath
  return env
}

function readPid(file) {
  try {
    const value = Number(fs.readFileSync(file, 'utf8').trim())
    return Number.isInteger(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

async function waitForChild(pane) {
  return waitFor(`child pid for ${pane.pane}`, () => readPid(pane.pidFile))
}

function readArgs(pane) {
  try {
    return fs.readFileSync(pane.argsFile, 'utf8').split('\n').filter(Boolean)
  } catch {
    return null
  }
}

function readCalls(ctx) {
  let text = ''
  try { text = fs.readFileSync(ctx.calls, 'utf8') } catch { return [] }
  const calls = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try { calls.push(JSON.parse(line)) } catch {}
  }
  return calls
}

function callsFor(ctx, pane, command) {
  return readCalls(ctx).filter(
    (args) => args[0] === 'pane' && args[1] === command && args[2] === pane,
  )
}

function seqOf(args) {
  const value = Number(argValue(args, '--seq'))
  return Number.isFinite(value) ? value : 0
}

function states(ctx, pane) {
  // The stub records command completion order, while Herdr orders reports by
  // --seq. Sort the same way the real integration does.
  return callsFor(ctx, pane, 'report-agent')
    .sort((a, b) => seqOf(a) - seqOf(b))
    .map((args) => argValue(args, '--state'))
    .filter(Boolean)
}

function sessions(ctx, pane) {
  return callsFor(ctx, pane, 'report-agent-session')
}

function argValue(args, flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

function resumeArgs(args) {
  const index = args.indexOf('--')
  return index >= 0 ? args.slice(index + 1) : []
}

async function waitFor(description, predicate, timeoutMs = 8000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const value = predicate()
    if (value) return value
    await sleep(25)
  }
  throw new Error(`timed out waiting for ${description}`)
}

test('launch task binds the child PID, reports state/session, and releases', { timeout: 20000 }, async (t) => {
  const ctx = setup(t)
  const chat = createChat(ctx, 'chat-1')
  const pane = startPane(ctx, { pane: 'pane-a', chatDir: chat })
  const childPid = await waitForChild(pane)

  await waitFor('startup idle', () => states(ctx, 'pane-a').includes('idle'))
  await waitFor('session report', () => sessions(ctx, 'pane-a').length > 0)

  const session = sessions(ctx, 'pane-a')[0]
  assert.equal(argValue(session, '--agent-session-id'), 'chat-1')
  assert.equal(argValue(session, '--agent-session-path'), chat)
  assert.equal(argValue(session, '--session-start-source'), 'startup')
  assert.deepEqual(resumeArgs(session), [
    'sh',
    path.join(REPO, 'scripts', 'launch.sh'),
    'resume-named',
    'chat-1',
  ])

  const beforeFirstTurn = states(ctx, 'pane-a').length
  writeLog(chat, childPid, '[send-message] Sending message with sdk run config')
  writeLog(chat, childPid, 'Main prompt finished')
  await waitFor('first fast turn emits working then idle', () => {
    const seen = states(ctx, 'pane-a').slice(beforeFirstTurn)
    return seen.includes('working') && seen.at(-1) === 'idle'
  })

  writeLog(chat, childPid, '[send-message] Sending message with sdk run config')
  await waitFor('working after turn start', () => states(ctx, 'pane-a').at(-1) === 'working')

  writeLog(chat, childPid, 'End agent base3 step 3', { data: { shouldEndTurn: true } })
  await waitFor('idle after End agent shouldEndTurn', () => states(ctx, 'pane-a').at(-1) === 'idle')

  const beforeFastTurn = states(ctx, 'pane-a').length
  writeLog(chat, childPid, '[send-message] Sending message with sdk run config')
  writeLog(chat, childPid, 'Main prompt finished')
  await waitFor('fast turn emits working then idle', () => {
    const seen = states(ctx, 'pane-a').slice(beforeFastTurn)
    return seen.includes('working') && seen.at(-1) === 'idle'
  })

  pane.proc.kill('SIGTERM')
  await waitFor('release-agent after launcher exit', () => callsFor(ctx, 'pane-a', 'release-agent').length === 1)
  assert.ok(!states(ctx, 'pane-a').includes('unknown'))
})

test('two panes in one project stay isolated by child PID', { timeout: 20000 }, async (t) => {
  const ctx = setup(t)
  const chatA = createChat(ctx, 'chat-a')
  const chatB = createChat(ctx, 'chat-b')
  const paneA = startPane(ctx, { pane: 'pane-a', chatDir: chatA })
  const paneB = startPane(ctx, { pane: 'pane-b', chatDir: chatB })
  const childA = await waitForChild(paneA)
  const childB = await waitForChild(paneB)

  await waitFor('both sessions', () => sessions(ctx, 'pane-a').length === 1 && sessions(ctx, 'pane-b').length === 1)
  assert.equal(argValue(sessions(ctx, 'pane-a')[0], '--agent-session-id'), 'chat-a')
  assert.equal(argValue(sessions(ctx, 'pane-b')[0], '--agent-session-id'), 'chat-b')

  writeLog(chatA, childA, '[send-message] Sending message with sdk run config')
  await waitFor('pane A working', () => states(ctx, 'pane-a').at(-1) === 'working')
  await sleep(120)
  assert.equal(states(ctx, 'pane-b').at(-1), 'idle')

  writeLog(chatB, childB, '[send-message] Sending message with sdk run config')
  await waitFor('pane B working', () => states(ctx, 'pane-b').at(-1) === 'working')

  writeLog(chatA, childA, 'Main prompt finished')
  await waitFor('pane A idle', () => states(ctx, 'pane-a').at(-1) === 'idle')
  assert.equal(states(ctx, 'pane-b').at(-1), 'working')
})

test('a log line from a pid the launcher does not own is ignored', { timeout: 20000 }, async (t) => {
  const ctx = setup(t)
  const chat = createChat(ctx, 'chat-1')
  const pane = startPane(ctx, { pane: 'pane-a', chatDir: chat })
  await waitForChild(pane)
  await waitFor('session report', () => sessions(ctx, 'pane-a').length === 1)

  const foreign = spawnSync(process.execPath, ['-e', '']).pid
  const before = states(ctx, 'pane-a').length
  writeLog(chat, foreign, '[send-message] Sending message with sdk run config')
  await sleep(400)
  assert.deepEqual(states(ctx, 'pane-a').slice(before), [], 'a foreign pid must not move the pane')
})

test('unresolved chat never falls back to an unrelated newest chat', { timeout: 20000 }, async (t) => {
  const ctx = setup(t)
  const own = createChat(ctx, 'chat-own')
  const unrelated = createChat(ctx, 'chat-new')
  writeLog(unrelated, 999999, '[send-message] Sending message with sdk run config')
  fs.utimesSync(unrelated, new Date(), new Date())

  const pane = startPane(ctx, { pane: 'pane-a', chatDir: path.join(ctx.root, 'outside-chat') })
  const childPid = await waitForChild(pane)
  await waitFor('startup idle', () => states(ctx, 'pane-a').includes('idle'))

  await sleep(800)
  assert.equal(sessions(ctx, 'pane-a').length, 0, 'must not bind the unrelated newest chat')

  writeLog(own, childPid, '[send-message] Sending message with sdk run config')
  await waitFor('own chat session', () => sessions(ctx, 'pane-a').length === 1)
  assert.equal(argValue(sessions(ctx, 'pane-a')[0], '--agent-session-id'), 'chat-own')
})

test('checkpoint ask_user blocks, interruption clears it, and answer resumes', { timeout: 20000 }, async (t) => {
  const ctx = setup(t)
  const chat = createChat(ctx, 'chat-1')
  const pane = startPane(ctx, { pane: 'pane-a', chatDir: chat })
  const childPid = await waitForChild(pane)
  await waitFor('session report', () => sessions(ctx, 'pane-a').length === 1)

  writeCheckpoint(chat, [
    { variant: 'user', content: 'hi' },
    {
      variant: 'ai',
      blocks: [{
        type: 'tool',
        toolName: 'ask_user',
        input: { questions: [{ question: 'choose', options: [{ label: 'A' }, { label: 'B' }] }] },
      }],
    },
  ])
  await waitFor('blocked ask_user', () => states(ctx, 'pane-a').at(-1) === 'blocked')

  writeCheckpoint(chat, [
    { variant: 'user', content: 'hi' },
    {
      variant: 'ai',
      blocks: [
        { type: 'tool', toolName: 'ask_user', input: { questions: [] } },
        { type: 'text', content: '[response interrupted]' },
      ],
    },
  ])
  await waitFor('interrupted block clears', () => states(ctx, 'pane-a').at(-1) === 'idle')

  writeCheckpoint(chat, [
    { variant: 'user', content: 'hi' },
    { variant: 'ai', blocks: [{ type: 'ask-user', questions: [], answers: { q: 'A' } }] },
  ])
  writeLog(chat, childPid, 'Start agent base3 step 2')
  await waitFor('answer resumes working', () => states(ctx, 'pane-a').at(-1) === 'working')
})

test('missing checkpoint uses exact ask-user screen fallback, not model picker', { timeout: 20000 }, async (t) => {
  const ctx = setup(t)
  const chat = createChat(ctx, 'chat-1')
  const pane = startPane(ctx, { pane: 'pane-a', chatDir: chat })
  const childPid = await waitForChild(pane)
  await waitFor('session report', () => sessions(ctx, 'pane-a').length === 1)

  writeLog(chat, childPid, '[send-message] Sending message with sdk run config')
  await waitFor('working', () => states(ctx, 'pane-a').at(-1) === 'working')

  fs.rmSync(path.join(chat, 'chat-messages.json'))
  fs.writeFileSync(ctx.paneFile, '↑↓ choose model ... Enter select\n')
  await sleep(300)
  assert.notEqual(states(ctx, 'pane-a').at(-1), 'blocked', 'model picker must not block')

  fs.writeFileSync(ctx.paneFile, '╭─ Some questions for you ─╮\n ↑↓ navigate\n')
  await waitFor('exact popup blocks', () => states(ctx, 'pane-a').at(-1) === 'blocked')

  writeCheckpoint(chat, [])
  await waitFor('checkpoint clears fallback block', () => states(ctx, 'pane-a').at(-1) !== 'blocked')
})

test('resume-named validates and forwards the chat, resume-last stays project-scoped', { timeout: 20000 }, async (t) => {
  const ctx = setup(t)
  const chat = createChat(ctx, 'chat-1')

  const named = startPane(ctx, {
    pane: 'pane-named',
    mode: 'resume-named',
    chatId: 'chat-1',
    chatDir: chat,
  })
  await waitForChild(named)
  await waitFor('resume-named args', () => readArgs(named))
  assert.deepEqual(readArgs(named), ['--continue', 'chat-1'])
  await waitFor('resume session', () => sessions(ctx, 'pane-named').length === 1)
  assert.equal(argValue(sessions(ctx, 'pane-named')[0], '--session-start-source'), 'resume')

  const missingArgs = path.join(ctx.root, 'missing.args')
  const missing = spawnSync(
    'sh',
    [LAUNCH, 'resume-named', 'missing-chat'],
    {
      cwd: ctx.projectDir,
      env: {
        ...process.env,
        HERDR_ENV: '1',
        HERDR_PANE_ID: 'pane-missing',
        HERDR_BIN_PATH: ctx.stub,
        HERDR_STUB_LOG: ctx.calls,
        HERDR_STUB_PANE_FILE: ctx.paneFile,
        HERDR_PLUGIN_ROOT: REPO,
        FREEBUFF_CONFIG_DIR: ctx.config,
        FREEBUFF_BIN_PATH: ctx.fakeLauncher,
        FAKE_CHILD_SCRIPT: ctx.fakeChild,
        FAKE_CHAT_DIR: chat,
        FAKE_CHILD_PID_FILE: path.join(ctx.root, 'missing.child.pid'),
        FAKE_ARGS_FILE: missingArgs,
      },
      encoding: 'utf8',
      timeout: 5000,
    },
  )
  assert.notEqual(missing.status, 0)
  assert.equal(fs.existsSync(missingArgs), false, 'invalid resume must not launch Freebuff')

  const last = startPane(ctx, {
    pane: 'pane-last',
    mode: 'resume-last',
    chatDir: chat,
  })
  await waitForChild(last)
  await waitFor('resume-last args', () => readArgs(last))
  assert.deepEqual(readArgs(last), ['--continue'])
  await waitFor('resume-last session', () => sessions(ctx, 'pane-last').length === 1)
  assert.equal(argValue(sessions(ctx, 'pane-last')[0], '--agent-session-id'), 'chat-1')
})

test('doctor discovers the pane watcher and its chat binding', { timeout: 20000 }, async (t) => {
  const ctx = setup(t)
  const chat = createChat(ctx, 'chat-doctor')
  const pane = startPane(ctx, { pane: 'pane-doctor', chatDir: chat })
  const childPid = await waitForChild(pane)
  await waitFor('doctor session report', () => sessions(ctx, 'pane-doctor').length > 0)

  const result = spawnSync('sh', [DOCTOR], {
    cwd: ctx.projectDir,
    env: {
      ...process.env,
      HERDR_ENV: '1',
      HERDR_PANE_ID: 'pane-doctor',
      HERDR_PLUGIN_ROOT: REPO,
      FREEBUFF_CONFIG_DIR: ctx.config,
      FREEBUFF_BIN_PATH: ctx.fakeLauncher,
    },
    encoding: 'utf8',
    timeout: 5000,
  })
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.equal(report.process.launcherPid, pane.proc.pid)
  assert.equal(report.process.launcherAlive, true)
  assert.ok(report.process.descendants.includes(childPid))
  assert.equal(report.binding.chatId, 'chat-doctor')
  assert.equal(report.binding.chatDir, chat)
  assert.deepEqual(report.resume.argv, [
    '--',
    'sh',
    path.join(REPO, 'scripts', 'launch.sh'),
    'resume-named',
    'chat-doctor',
  ])
})

test('doctor selects the watcher from the matching Herdr session', { timeout: 20000 }, async (t) => {
  const ctx = setup(t)
  const chatA = createChat(ctx, 'chat-a')
  const chatB = createChat(ctx, 'chat-b')
  const socketA = path.join(ctx.root, 'session-a.sock')
  const socketB = path.join(ctx.root, 'session-b.sock')
  const paneA = startPane(ctx, {
    pane: 'w1:p2',
    label: 'session-a',
    chatDir: chatA,
    env: { HERDR_SOCKET_PATH: socketA },
  })
  const paneB = startPane(ctx, {
    pane: 'w1:p2',
    label: 'session-b',
    chatDir: chatB,
    env: { HERDR_SOCKET_PATH: socketB },
  })
  const childA = await waitForChild(paneA)
  const childB = await waitForChild(paneB)
  await waitFor('both session reports', () => {
    const ids = sessions(ctx, 'w1:p2').map((session) =>
      argValue(session, '--agent-session-id'),
    )
    return ids.includes('chat-a') && ids.includes('chat-b')
  })

  const result = spawnSync('sh', [DOCTOR], {
    cwd: ctx.projectDir,
    env: doctorEnv(ctx, { pane: 'w1:p2', socketPath: socketA }),
    encoding: 'utf8',
    timeout: 5000,
  })
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.equal(report.process.launcherPid, paneA.proc.pid)
  assert.equal(report.process.launcherAlive, true)
  assert.ok(report.process.descendants.includes(childA))
  assert.ok(!report.process.descendants.includes(childB))
  assert.equal(report.binding.chatId, 'chat-a')
  assert.equal(report.binding.chatDir, chatA)
  assert.deepEqual(report.resume.argv, [
    '--',
    'sh',
    path.join(REPO, 'scripts', 'launch.sh'),
    'resume-named',
    'chat-a',
  ])
  assert.equal(report.doctor.session.matched, true)
  assert.equal(report.doctor.session.ambiguous, false)
  assert.equal(report.doctor.session.reason, 'session-match')
  assert.equal(report.doctor.session.candidateCount, 2)
})

test('doctor refuses to choose between same-pane watchers without session identity', { timeout: 20000 }, async (t) => {
  const ctx = setup(t)
  const chatA = createChat(ctx, 'chat-a')
  const chatB = createChat(ctx, 'chat-b')
  const paneA = startPane(ctx, {
    pane: 'w1:p2',
    label: 'session-a',
    chatDir: chatA,
    env: { HERDR_SOCKET_PATH: path.join(ctx.root, 'session-a.sock') },
  })
  const paneB = startPane(ctx, {
    pane: 'w1:p2',
    label: 'session-b',
    chatDir: chatB,
    env: { HERDR_SOCKET_PATH: path.join(ctx.root, 'session-b.sock') },
  })
  await waitForChild(paneA)
  await waitForChild(paneB)
  await waitFor('both session reports', () => {
    const ids = sessions(ctx, 'w1:p2').map((session) =>
      argValue(session, '--agent-session-id'),
    )
    return ids.includes('chat-a') && ids.includes('chat-b')
  })

  const result = spawnSync('sh', [DOCTOR], {
    cwd: ctx.projectDir,
    env: doctorEnv(ctx, { pane: 'w1:p2' }),
    encoding: 'utf8',
    timeout: 5000,
  })
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.equal(report.process.watcherPid, null)
  assert.equal(report.process.launcherPid, null)
  assert.equal(report.binding.chatId, null)
  assert.equal(report.doctor.session.matched, false)
  assert.equal(report.doctor.session.ambiguous, true)
  assert.equal(report.doctor.session.reason, 'session-identity-unavailable')
  assert.equal(report.doctor.session.candidateCount, 2)
})

test('doctor emits JSON evidence without chat content', { timeout: 10000 }, async (t) => {
  const ctx = setup(t)
  createChat(ctx, 'chat-1')

  const result = spawnSync('sh', [DOCTOR], {
    cwd: ctx.projectDir,
    env: {
      ...process.env,
      HERDR_ENV: '0',
      FREEBUFF_CONFIG_DIR: ctx.config,
      FREEBUFF_BIN_PATH: ctx.fakeLauncher,
    },
    encoding: 'utf8',
    timeout: 5000,
  })
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.equal(report.plugin.manifest, true)
  assert.equal(report.freebuff.configDir, ctx.config)
  assert.equal(report.freebuff.projectName, 'project-a')
  assert.ok(report.freebuff.chats.some((chat) => chat.id === 'chat-1'))
  assert.equal(JSON.stringify(report).includes('Sending message'), false)
  // A chat on disk is listed, never claimed: with no watcher and no published
  // binding this pane has no chat, so the report says so.
  assert.equal(report.doctor.bindingSource, null)
  assert.equal(report.binding.chatId, null)
  assert.equal(report.binding.chatDir, null)
})
