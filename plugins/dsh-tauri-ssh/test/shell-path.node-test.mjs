import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { test } from 'node:test'
import { promisify } from 'node:util'

for (const [name, initialization] of [
  ['failed initialization', 'exit 7\n'],
  ['excessive initialization output', 'head -c 70000 /dev/zero | tr "\\000" x\n'],
]) {
  test(`SSH bootstrap reports scan failure for ${name}`, { skip: process.platform !== 'linux' }, async (t) => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-ssh-shell-failure-'))
    t.after(() => rm(home, { recursive: true, force: true }))
    await writeFile(join(home, '.bashrc'), initialization)
    const script = await readFile(new URL('../src/shell-path.sh', import.meta.url), 'utf8')
    const file = join(home, 'probe.sh')
    await writeFile(file, script)
    await assert.rejects(promisify(execFile)('/bin/sh', [file], {
      env: { ...process.env, HOME: home, SHELL: '/bin/bash', PATH: '/usr/bin:/bin' },
      timeout: 20000,
    }), (error) => {
      assert.match(error.stderr, /CLI_SCAN_FAILED/)
      assert.doesNotMatch(error.stderr, /NOT_INSTALLED|NOT_DETECTED/)
      return true
    })
  })
}

test('SSH bootstrap sees bashrc-only commands and keeps initialization noise out of its result', { skip: process.platform !== 'linux' }, async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-ssh-shell-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  await mkdir(join(home, 'tools'))
  for (const name of ['dsh', 'node', 'opencode', 'nga', 'claude', 'codeagent']) {
    const entry = join(home, 'tools', name)
    await writeFile(entry, '#!/bin/sh\nexit 0\n')
    await chmod(entry, 0o700)
  }
  await writeFile(join(home, '.bashrc'), 'case $- in *i*) ;; *) return;; esac\necho shell-startup-noise\nexport PATH="$HOME/tools:/usr/bin:/bin"\n')
  const script = await readFile(new URL('../src/shell-path.sh', import.meta.url), 'utf8')
  const file = join(home, 'probe.sh')
  await writeFile(file, `${script}\nfor product in dsh node opencode nga claude codeagent; do command -v "$product"; done\n`)
  const { stdout } = await promisify(execFile)('/bin/sh', [file], { env: { ...process.env, HOME: home, SHELL: '/bin/bash', PATH: '/usr/bin:/bin' }, timeout: 20000 })
  assert.equal(stdout.includes('shell-startup-noise'), false)
  assert.deepEqual(stdout.trim().split('\n'), ['dsh', 'node', 'opencode', 'nga', 'claude', 'codeagent'].map(name => join(home, 'tools', name)))
})
