import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

test('stdio host edits persisted connections and exits when its desktop pipe closes', async (t) => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'dsh-ssh-worker-'))
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/worker.js', import.meta.url)), path.join(dir, 'connections.json')], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  t.after(async () => {
    if (child.exitCode === null)
      child.kill()
    await fs.rm(dir, { recursive: true, force: true })
  })
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]()
  let id = 0
  async function request(method, params = {}) {
    child.stdin.write(`${JSON.stringify({ id: ++id, method, params })}\n`)
    const reply = JSON.parse((await lines.next()).value)
    assert.equal(reply.id, id)
    return reply
  }
  assert.equal((await request('execute', { script: 'not an allowed operation' })).ok, false)
  const saved = await request('save', { name: 'SSH test', host: 'offline-test.invalid' })
  assert.equal(saved.ok, true)
  const record = saved.value[0]
  const edited = await request('save', { ...record, name: 'Renamed', port: 2222 })
  assert.equal(edited.value[0].name, 'Renamed')
  assert.equal(edited.value[0].port, 2222)
  assert.equal((await request('remove', { id: record.id })).value.length, 0)
  const closed = once(child, 'close')
  child.stdin.end()
  const [code] = await closed
  assert.equal(code, 0)
}, { timeout: 10000 })
