'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const REPO = path.resolve(__dirname, '..')
const REGISTER = path.join(REPO, 'scripts', 'register-pane.sh')

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-freebuff-register-'))
  const calls = path.join(root, 'calls.jsonl')
  fs.writeFileSync(calls, '')

  const stub = path.join(root, 'stub-herdr.js')
  fs.writeFileSync(
    stub,
    `#!/usr/bin/env node
'use strict'
const fs = require('fs')
fs.appendFileSync(process.env.HERDR_STUB_LOG, JSON.stringify(process.argv.slice(2)) + '\\n')
`,
  )
  fs.chmodSync(stub, 0o755)

  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return { root, calls, stub }
}

function run(ctx, args, env = {}) {
  const result = spawnSync('sh', [REGISTER, ...args], {
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

test('registers the pane it is given', (t) => {
  const ctx = setup(t)
  const { result, calls } = run(ctx, ['w1:p2'])

  assert.equal(result.status, 0, result.stderr)
  assert.equal(calls.length, 1)

  const [call] = calls
  assert.match(call.at(-1), /^\d+$/, 'seq is a number')
  assert.deepEqual(call.slice(0, -1), [
    'pane',
    'report-agent',
    'w1:p2',
    '--source',
    'freebuff',
    '--agent',
    'freebuff',
    '--state',
    'unknown',
    '--seq',
  ])
})

test('falls back to the pane the action was invoked on', (t) => {
  const ctx = setup(t)
  const { result, calls } = run(ctx, [], { HERDR_ACTIVE_PANE_ID: 'w3:p4' })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][2], 'w3:p4')
})

test('refuses to guess a pane', (t) => {
  const ctx = setup(t)
  const { result, calls } = run(ctx, [])

  assert.equal(result.status, 1)
  assert.match(result.stderr, /no pane id/)
  assert.equal(calls.length, 0, 'herdr is never called without a pane')
})
