'use strict'

// The manifest declares each entrypoint twice, once per host family. Herdr picks
// the entry whose `platforms` matches, so a missing twin means the plugin is
// absent on that host, and a Windows entry without its suffix is an id Herdr
// refuses to load at all. Neither failure is visible from a shell check, hence
// this file.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const REPO = path.resolve(__dirname, '..')
const text = fs.readFileSync(path.join(REPO, 'herdr-plugin.toml'), 'utf8')
const changelog = fs.readFileSync(path.join(REPO, 'CHANGELOG.md'), 'utf8')

const WINDOWS_SCRIPT = /\$env:HERDR_PLUGIN_ROOT\/scripts\/windows\/([a-z-]+\.ps1)"/
const SHELL_SCRIPT = /scripts\/([a-z-]+\.sh)/

function topLevel(key) {
  const match = text.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm'))
  return match ? match[1] : null
}

function topLevelValue(key) {
  const match = text.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, 'm'))
  return match ? match[1] : null
}

function entries() {
  const out = []
  let current = null
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const header = line.match(/^\[\[(panes|actions)\]\]$/)
    if (header) {
      current = { kind: header[1], fields: {} }
      out.push(current)
      continue
    }
    if (!current || !line || line.startsWith('#')) continue
    const field = line.match(/^([a-z_]+)\s*=\s*(.+)$/)
    if (field) current.fields[field[1]] = field[2]
  }
  return out
}

const list = entries()
const parse = (raw) => JSON.parse(raw)

function scriptExists(relative) {
  return fs.existsSync(path.join(REPO, relative))
}

test('the manifest keeps one identity and one version', () => {
  assert.equal(topLevel('id'), 'freebuff.integration')
  assert.equal(topLevel('name'), 'Freebuff')
  assert.equal(topLevel('min_herdr_version'), '0.9.5')
  const version = topLevel('version')
  assert.match(version, /^\d+\.\d+\.\d+$/)
  assert.ok(changelog.includes(`## ${version} `), `CHANGELOG.md has no entry for ${version}`)
})

test('every host Herdr ships for is claimed', () => {
  const declared = parse(topLevelValue('platforms'))
  assert.deepEqual(declared.sort(), ['linux', 'macos', 'windows'])
})

const baseId = (id) => id.replace(/-windows$/, '')

test('each entrypoint has exactly one entry per host family', () => {
  const groups = new Map()
  for (const entry of list) {
    const key = `${entry.kind}:${baseId(parse(entry.fields.id))}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(entry)
  }
  assert.ok(groups.size >= 5)
  for (const [key, group] of groups) {
    assert.equal(group.length, 2, `${key} should have two host entries`)
    const hosts = group.map((entry) => parse(entry.fields.platforms).sort())
    assert.deepEqual(hosts[0], ['linux', 'macos'], `${key} has no shell twin`)
    assert.deepEqual(hosts[1], ['windows'], `${key} has no Windows twin`)
    // Herdr 0.9.5 refuses a manifest with a repeated id, even when the entries
    // claim different platforms, so the pair has to differ by name.
    const base = key.split(':')[1]
    assert.equal(parse(group[1].fields.id), `${base}-windows`, `${key} Windows id`)
    // A title and placement that drift between twins is a listing that changes
    // shape with the host.
    assert.equal(group[0].fields.title, group[1].fields.title, `${key} titles differ`)
    assert.equal(group[0].fields.placement, group[1].fields.placement, `${key} placement differs`)
    assert.equal(group[0].fields.contexts, group[1].fields.contexts, `${key} contexts differ`)
  }
})

test('no id is declared twice', () => {
  const seen = new Set()
  for (const entry of list) {
    const key = `${entry.kind}:${parse(entry.fields.id)}`
    assert.equal(seen.has(key), false, `${key} is declared twice`)
    seen.add(key)
  }
})

test('Windows entries run PowerShell and reach a script that exists', () => {
  for (const entry of list) {
    if (!parse(entry.fields.platforms).includes('windows')) continue
    const command = parse(entry.fields.command)
    assert.equal(command[0], 'powershell')
    for (const flag of ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command']) {
      assert.ok(command.includes(flag), `${entry.fields.id} is missing ${flag}`)
    }
    const script = command.join(' ').match(WINDOWS_SCRIPT)
    assert.ok(script, `${entry.fields.id} does not resolve its script through HERDR_PLUGIN_ROOT`)
    assert.ok(
      scriptExists(path.join('scripts', 'windows', script[1])),
      `missing scripts/windows/${script[1]}`,
    )
  }
})

test('shell entries reach a script that exists', () => {
  for (const entry of list) {
    if (!parse(entry.fields.platforms).includes('linux')) continue
    const command = parse(entry.fields.command)
    assert.equal(command[0], 'sh')
    const script = command.join(' ').match(SHELL_SCRIPT)
    assert.ok(script, `${entry.fields.id} names no shell script`)
    assert.ok(scriptExists(path.join('scripts', script[1])), `missing scripts/${script[1]}`)
  }
})

test('every Windows script is wired to an entrypoint', () => {
  const dir = path.join(REPO, 'scripts', 'windows')
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.ps1'))
  const referenced = new Set()
  for (const entry of list) {
    if (!parse(entry.fields.platforms).includes('windows')) continue
    const script = parse(entry.fields.command).join(' ').match(WINDOWS_SCRIPT)
    if (script) referenced.add(script[1])
  }
  for (const file of files) {
    if (file === 'common.ps1') continue
    assert.ok(referenced.has(file), `scripts/windows/${file} is not reachable from the manifest`)
  }
  for (const entrypoint of ['launch.ps1', 'doctor.ps1', 'new-task.ps1', 'register-pane.ps1']) {
    assert.ok(files.includes(entrypoint), `missing scripts/windows/${entrypoint}`)
  }
})

test('resume argv names the Windows launcher', () => {
  const windows = require(path.join(REPO, 'scripts', 'platform', 'windows.js'))
  const argv = windows.launchArgv('C:\\plugin', 'resume-named', 'chat-1')
  assert.ok(argv.some((value) => value.endsWith(path.join('scripts', 'windows', 'launch.ps1'))))
})
