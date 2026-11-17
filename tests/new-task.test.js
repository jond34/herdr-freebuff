'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const REPO = path.resolve(__dirname, '..')
const SCRIPT = path.join(REPO, 'scripts', 'new-task.sh')

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-freebuff-new-task-'))
  const calls = path.join(root, 'calls.jsonl')
  fs.writeFileSync(calls, '')

  const stub = path.join(root, 'stub-herdr.js')
  fs.writeFileSync(
    stub,
    `#!/usr/bin/env node
'use strict'
const fs = require('fs')
const args = process.argv.slice(2)
fs.appendFileSync(process.env.HERDR_STUB_LOG, JSON.stringify(args) + '\\n')
if (args[0] === 'pane' && args[1] === 'get') {
  if (process.env.HERDR_STUB_FAIL) process.exit(1)
  const pane = { pane_id: args[2], cwd: process.env.HERDR_STUB_CWD }
  if (process.env.HERDR_STUB_FG_CWD) pane.foreground_cwd = process.env.HERDR_STUB_FG_CWD
  process.stdout.write(JSON.stringify({ id: 'cli:pane:get', result: { pane } }))
}
`,
  )
  fs.chmodSync(stub, 0o755)

  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return { root, calls, stub }
}

function run(ctx, env = {}) {
  const result = spawnSync('sh', [SCRIPT], {
    cwd: ctx.root,
    encoding: 'utf8',
    env: {
      ...process.env,
      HERDR_ENV: '1',
      HERDR_BIN_PATH: ctx.stub,
      HERDR_STUB_LOG: ctx.calls,
      HERDR_ACTIVE_PANE_ID: '',
      HERDR_PANE_ID: '',
      ...env,
    },
  })
  const calls = fs
    .readFileSync(ctx.calls, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  return { result, calls }
}

const open = (cwd) => [
  'plugin',
  'pane',
  'open',
  '--plugin',
  'freebuff.integration',
  '--entrypoint',
  'task',
  '--placement',
  'split',
  '--focus',
  '--cwd',
  cwd,
]

test('opens the pane where the action was invoked', (t) => {
  const ctx = setup(t)
  const { result, calls } = run(ctx, {
    HERDR_ACTIVE_PANE_ID: 'w9:p3',
    HERDR_STUB_CWD: '/work/repo',
    HERDR_STUB_FG_CWD: '/work/repo/packages/api',
  })

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(calls[0], ['pane', 'get', 'w9:p3'])
  assert.deepEqual(calls[1], open('/work/repo/packages/api'))
})

test('uses the pane directory when the foreground one is missing', (t) => {
  const ctx = setup(t)
  const { result, calls } = run(ctx, {
    HERDR_ACTIVE_PANE_ID: 'w9:p3',
    HERDR_STUB_CWD: '/work/repo',
  })

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(calls[1], open('/work/repo'))
})

test('falls back to the working directory when the pane cannot be read', (t) => {
  const ctx = setup(t)
  const { result, calls } = run(ctx, {
    HERDR_ACTIVE_PANE_ID: 'w9:p3',
    HERDR_STUB_CWD: '/work/repo',
    HERDR_STUB_FAIL: '1',
  })

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(calls[1], open(ctx.root))
})
