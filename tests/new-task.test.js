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
require('fs').appendFileSync(process.env.HERDR_STUB_LOG, JSON.stringify(process.argv.slice(2)) + '\\n')
`,
  )
  fs.chmodSync(stub, 0o755)

  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return { root, calls, stub }
}

function run(ctx, context) {
  const result = spawnSync('sh', [SCRIPT], {
    cwd: ctx.root,
    encoding: 'utf8',
    env: {
      ...process.env,
      HERDR_ENV: '1',
      HERDR_BIN_PATH: ctx.stub,
      HERDR_STUB_LOG: ctx.calls,
      HERDR_PLUGIN_CONTEXT_JSON: context === undefined ? '' : JSON.stringify(context),
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

test('opens the pane in the focused pane directory', (t) => {
  const ctx = setup(t)
  const { result, calls } = run(ctx, {
    focused_pane_id: 'w9:p3',
    focused_pane_cwd: '/work/repo/packages/api',
    workspace_cwd: '/work/repo',
  })

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(calls, [open('/work/repo/packages/api')])
})

test('falls back to the workspace directory', (t) => {
  const ctx = setup(t)
  const { result, calls } = run(ctx, { workspace_id: 'w9', workspace_cwd: '/work/repo' })

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(calls, [open('/work/repo')])
})

test('falls back to the working directory without a context', (t) => {
  const ctx = setup(t)
  const { result, calls } = run(ctx)

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(calls, [open(ctx.root)])
})

// The tests above cover the script; this covers the wiring that makes
// `prefix+f` reach it. An action with an inline command would open the pane in
// the plugin directory again, and the tests would still pass.
test('the new-task action runs this script against the declared pane', () => {
  const toml = fs.readFileSync(path.join(REPO, 'herdr-plugin.toml'), 'utf8')
  const action = toml
    .split('[[actions]]')
    .find((block) => /^id = "new-task"$/m.test(block))

  assert.ok(action, 'herdr-plugin.toml declares a new-task action')
  assert.match(action, /^command = \["sh", "scripts\/new-task\.sh"\]$/m)

  const pluginId = /^id = "(\S+)"$/m.exec(toml)[1]
  assert.ok(
    toml.split('[[panes]]').some((block) => /^id = "task"$/m.test(block)),
    'the task pane the action opens is declared',
  )

  const script = fs.readFileSync(SCRIPT, 'utf8')
  assert.ok(script.includes(`--plugin ${pluginId}`), 'script opens this plugin')
  assert.ok(script.includes('--entrypoint task'), 'script opens the task pane')
  assert.ok(script.includes('--cwd'), 'script passes the directory through')
})
