import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execute = promisify(execFile)
test('Linux inspection is read-only and invalid ownership and recovery paths fail closed', { skip: process.platform !== 'linux' }, async (t) => {
  const home = await fs.mkdtemp(path.join(tmpdir(), 'dsh-remote-test-'))
  t.after(() => fs.rm(home, { recursive: true, force: true }))
  const root = path.join(home, '.local/share/dsh-desktop')
  async function request(value) {
    const input = Buffer.from(JSON.stringify(value)).toString('base64')
    let stdout
    try {
      ({ stdout } = await execute(process.execPath, [fileURLToPath(new URL('../dist/remote.cjs', import.meta.url)), input], { env: { ...process.env, HOME: home, DSH_SSH_ROOT: root, DSH_EXISTING_BIN: '' } }))
    }
    catch (error) {
      stdout = error.stdout
    }
    return JSON.parse(stdout.split('\n').find(line => line.startsWith('DSH_SSH_RESULT:')).slice('DSH_SSH_RESULT:'.length))
  }
  const first = await request({ action: 'status' })
  assert.equal(first.ok, true)
  assert.equal(first.value.installed, false)
  await assert.rejects(fs.stat(root), { code: 'ENOENT' })
  assert.match((await request({ action: 'shell', command: 'ignored' })).error, /REQUEST_INVALID/)
  await fs.mkdir(root, { recursive: true })
  const stateFile = path.join(root, 'state.json')
  await fs.writeFile(stateFile, JSON.stringify({ format: 1, data: '/outside', version: 'dsh-0.1.1-rc.2-1' }))
  assert.match((await request({ action: 'stop' })).error, /STATE_INVALID/)
  const state = { format: 1, data: path.join(home, '.dsh'), version: 'dsh-0.1.1-rc.2-1', recovery: { backup: '/outside', version: 'dsh-0.1.1-rc.1-1' } }
  await fs.writeFile(stateFile, JSON.stringify(state))
  assert.match((await request({ action: 'restore' })).error, /CONFIRMATION_REQUIRED/)
  assert.match((await request({ action: 'restore', confirm: true })).error, /RECOVERY_PATH_INVALID/)
  assert.deepEqual(JSON.parse(await fs.readFile(stateFile, 'utf8')), state)
})
