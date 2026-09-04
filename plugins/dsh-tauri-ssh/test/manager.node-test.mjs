import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { it } from 'node:test'
import { apply } from '../src/index.js'
import { SshManager } from '../src/manager.js'
import { sshArgs, validateTarget } from '../src/transport.js'

function transport(run = async () => ({ installed: true, running: true, port: 3080 })) {
  return {
    children: [],
    killed: [],
    run,
    launch() {
      const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stderr: new PassThrough() })
      this.children.push(child)
      return child
    },
    async kill(child) {
      if (child) {
        this.killed.push(child)
        child.emit('close', 0)
      }
    },
    async dispose() {},
  }
}

it('system SSH operands preserve ambient configuration and cannot become options or shell fragments', () => {
  assert.deepEqual(validateTarget({ host: 'my-linux', user: '', port: '' }), { host: 'my-linux', user: '', port: undefined })
  assert.equal(validateTarget({ host: '::1' }).host, '::1')
  for (const host of ['-oProxyCommand=bad', 'host;whoami', 'host\nother', 'user@host', 'https://host'])
    assert.throws(() => validateTarget({ host }), /SSH_HOST_INVALID/)
  assert.throws(() => validateTarget({ host: 'host', user: '-root' }), /SSH_USER_INVALID/)
  assert.throws(() => validateTarget({ host: 'host', port: 65536 }), /SSH_PORT_INVALID/)
  const args = sshArgs({ host: 'my-linux' }, { local: 32123, remote: 3080 })
  assert.ok(args.includes('127.0.0.1:32123:127.0.0.1:3080'))
  assert.ok(args.includes('BatchMode=yes'))
  assert.ok(!args.some(item => item.includes('StrictHostKeyChecking') || item.includes('IdentityFile')))
  assert.deepEqual(args.slice(-2), ['--', 'my-linux'])
  assert.deepEqual(sshArgs({ host: 'host', user: 'alice', port: 2222 }).slice(-3), ['--', 'host', 'sh -s'])
})

it('saved connections can be renamed, edited and deleted without remote mutation', async (t) => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'dsh-ssh-test-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const store = path.join(directory, 'connections.json')
  const adapter = transport(() => {
    throw new Error('unexpected remote mutation')
  })
  const manager = new SshManager({ storagePath: store, transport: adapter })
  t.after(() => manager.dispose())
  const [record] = await manager.save({ name: 'A', host: 'linux-a' })
  await manager.save({ id: record.id, name: 'Development', host: 'linux-a' })
  await manager.save({ name: 'B', host: 'linux-b' })
  assert.equal((await manager.list())[0].name, 'Development')
  await assert.rejects(manager.save({ name: 'Duplicate', host: 'linux-a' }), /DUPLICATE/)
  await manager.save({ id: record.id, name: 'Development', host: 'linux-c', port: 2222 })
  const reopened = new SshManager({ storagePath: store, transport: adapter })
  t.after(() => reopened.dispose())
  assert.equal((await reopened.list())[0].port, 2222)
  await manager.remove(record.id)
  assert.deepEqual((await manager.list()).map(item => item.name), ['B'])
  assert.ok(!(await fs.readFile(store, 'utf8')).includes('password'))
})

it('persistence failure leaves the previous connection visible', async (t) => {
  const manager = new SshManager({ transport: transport() })
  t.after(() => manager.dispose())
  const [record] = await manager.save({ name: 'Original', host: 'host' })
  manager.persist = async () => {
    throw new Error('disk full')
  }
  await assert.rejects(manager.save({ ...record, name: 'Changed' }), /disk full/)
  assert.equal((await manager.list())[0].name, 'Original')
  await assert.rejects(manager.remove(record.id), /disk full/)
  assert.equal((await manager.list()).length, 1)
})

it('disconnect during SSH detection prevents a late tunnel or restart', async (t) => {
  let finish
  const pending = new Promise((resolve) => {
    finish = resolve
  })
  const adapter = transport(() => pending)
  const manager = new SshManager({ transport: adapter })
  t.after(() => manager.dispose())
  const [record] = await manager.save({ name: 'A', host: 'linux-a' })
  const connecting = manager.enable(record.id, true)
  await new Promise(resolve => setImmediate(resolve))
  await manager.enable(record.id, false)
  finish({ installed: true, running: false, port: 3080 })
  await connecting
  assert.equal(adapter.children.length, 0)
  assert.equal((await manager.list())[0].state, 'disconnected')
})

it('concurrent hosts own separate tunnels; dispose kills local tunnels without stopping DSH', async (t) => {
  const actions = []
  const adapter = transport(async (_, request) => {
    actions.push(request.action)
    return { installed: true, running: true, port: 3080 }
  })
  const manager = new SshManager({ transport: adapter })
  t.after(() => manager.dispose())
  t.mock.method(globalThis, 'fetch', async (_, options) => ({ ok: true, json: async () => ({ rpcId: JSON.parse(options.body).rpcId, result: { ok: true } }) }))
  await manager.save({ name: 'A', host: 'a' })
  await manager.save({ name: 'B', host: 'b' })
  const records = await manager.list()
  await manager.enable(records[0].id, true)
  while ((await manager.list())[0].state === 'connecting')
    await new Promise(resolve => setImmediate(resolve))
  await manager.enable(records[1].id, true)
  while ((await manager.list())[1].state === 'connecting')
    await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual((await manager.list()).map(item => item.state), ['connected', 'connected'])
  assert.notEqual((await manager.list())[0].url, (await manager.list())[1].url)
  await manager.enable(records[0].id, false)
  assert.equal((await manager.list())[1].state, 'connected')
  await manager.dispose()
  assert.equal(adapter.killed.length, 2)
  assert.deepEqual(actions, ['status', 'auth', 'status', 'auth'])
})

it('a host mutation excludes another operation and connection editing', async (t) => {
  let finish
  const adapter = transport(() => new Promise((resolve) => {
    finish = resolve
  }))
  const manager = new SshManager({ transport: adapter })
  t.after(() => manager.dispose())
  const [record] = await manager.save({ name: 'A', host: 'a' })
  const first = manager.operation(record.id, { action: 'upgrade' })
  await new Promise(resolve => setImmediate(resolve))
  await assert.rejects(manager.operation(record.id, { action: 'stop' }), /BUSY/)
  await assert.rejects(manager.save({ ...record, host: 'b' }), /BUSY/)
  await assert.rejects(manager.remove(record.id), /BUSY/)
  finish({ installed: true, running: true })
  await first
})

it('cordis disposal owns manager lifetime', async () => {
  let manager
  let cleanup
  apply({
    provide(name, service) {
      assert.equal(name, 'dshSsh')
      manager = service
    },
    effect(start) { cleanup = start() },
  })
  assert.ok(manager instanceof SshManager)
  cleanup()
  assert.equal(manager.disposed, true)
})
