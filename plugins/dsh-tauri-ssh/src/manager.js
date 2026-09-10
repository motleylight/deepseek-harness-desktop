import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import path from 'node:path'
// eslint-disable-next-line antfu/no-import-dist -- The shipped worker uses the self-contained proxy bundle without installing dependencies.
import proxyModule from '../dist/proxy.cjs'
import { probeDsh } from './health.js'
import { SshTransport, unusedPort, validateTarget } from './transport.js'

const { createDshProxy } = proxyModule

/** One manager owns local tunnels; every remote mutation also takes a remote host lock. */
export class SshManager {
  constructor({ storagePath, transport = new SshTransport() } = {}) {
    this.storagePath = storagePath
    this.transport = transport
    this.records = []
    this.runtime = new Map()
    this.locks = new Map()
    this.saving = Promise.resolve()
    this.disposed = false
    this.ready = this.load()
    this.ready.catch(() => { /* Public methods report invalid saved configuration through the RPC response. */ })
  }

  async load() {
    if (!this.storagePath)
      return
    try {
      const data = JSON.parse(await fs.readFile(this.storagePath, 'utf8'))
      if (data.format !== 1 || !Array.isArray(data.connections))
        throw new Error('SSH_CONFIG_FORMAT_INVALID')
      this.records = data.connections.map((record) => {
        if (!/^ssh-[a-f0-9-]+$/.test(record.id) || typeof record.name !== 'string' || typeof record.enabled !== 'boolean')
          throw new Error('SSH_CONFIG_RECORD_INVALID')
        return { ...validateTarget(record), id: record.id, name: record.name, enabled: record.enabled, localPort: Number.isInteger(record.localPort) && record.localPort > 1024 && record.localPort <= 65535 ? record.localPort : undefined }
      })
      for (const record of this.records) {
        if (record.enabled)
          queueMicrotask(() => { void this.connect(record.id) })
      }
    }
    catch (error) {
      if (error.code !== 'ENOENT')
        throw error
    }
  }

  async persist(records = this.records) {
    if (!this.storagePath)
      return
    const data = JSON.stringify({ format: 1, connections: records }, null, 2)
    const write = this.saving.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(this.storagePath), { recursive: true })
      const temp = `${this.storagePath}.${randomUUID()}.tmp`
      await fs.writeFile(temp, `${data}\n`, { mode: 0o600 })
      await fs.rename(temp, this.storagePath)
    })
    this.saving = write
    await write
  }

  record(id) {
    const record = this.records.find(item => item.id === id)
    if (!record)
      throw new Error('SSH_CONNECTION_NOT_FOUND')
    return record
  }

  current(id) {
    if (!this.runtime.has(id))
      this.runtime.set(id, { state: 'disconnected', logs: [], generation: 0 })
    return this.runtime.get(id)
  }

  async list() {
    await this.ready
    return this.records.map((record) => {
      const live = this.current(record.id)
      return { ...record, state: live.state, error: live.error, busy: live.busy, status: live.status, logs: live.logs, url: live.state === 'connected' ? live.proxy?.url : undefined }
    })
  }

  async save(input) {
    await this.ready
    return this.exclusive('$config', () => this.saveRecord(input))
  }

  async saveRecord(input) {
    const target = validateTarget(input)
    const name = String(input.name || '').trim()
    if (!name || name.length > 100)
      throw new Error('SSH_NAME_INVALID')
    const existing = input.id ? this.record(input.id) : undefined
    if (existing && this.current(existing.id).busy)
      throw new Error('SSH_OPERATION_BUSY')
    if (this.records.some(item => item.id !== existing?.id && item.host === target.host && item.user === target.user && item.port === target.port))
      throw new Error('SSH_CONNECTION_DUPLICATE')
    const changed = existing && (existing.host !== target.host || existing.user !== target.user || existing.port !== target.port)
    if (changed)
      await this.disconnect(existing.id)
    if (changed)
      this.current(existing.id).status = undefined
    const record = { ...existing, ...target, id: existing?.id || `ssh-${randomUUID()}`, name, enabled: changed ? false : existing?.enabled || false }
    const next = existing ? this.records.map(item => item.id === record.id ? record : item) : [...this.records, record]
    await this.persist(next)
    this.records = next
    return this.list()
  }

  async remove(id) {
    await this.ready
    await this.exclusive('$config', async () => {
      this.record(id)
      if (this.current(id).busy)
        throw new Error('SSH_OPERATION_BUSY')
      await this.disconnect(id)
      const next = this.records.filter(item => item.id !== id)
      await this.persist(next)
      this.records = next
      this.runtime.delete(id)
    })
    return this.list()
  }

  async exclusive(id, action) {
    if (this.locks.has(id))
      throw new Error('SSH_OPERATION_BUSY')
    const promise = Promise.resolve().then(action)
    this.locks.set(id, promise)
    try {
      return await promise
    }
    finally { this.locks.delete(id) }
  }

  log(id, text) {
    const live = this.current(id)
    live.logs = [...live.logs, String(text).slice(-4000)].slice(-60)
  }

  async operation(id, request) {
    await this.ready
    const record = this.record(id)
    if (this.disposed)
      throw new Error('SSH_MANAGER_DISPOSED')
    if (['status', 'versions', 'plugins', 'auth'].includes(request.action)) {
      const value = await this.transport.run(record, request)
      const current = this.records.find(item => item.id === id)
      if (current && current.host === record.host && current.user === record.user && current.port === record.port && value && !Array.isArray(value) && 'installed' in value)
        this.current(id).status = value
      return value
    }
    return this.exclusive(id, async () => {
      const live = this.current(id)
      const reconnect = live.state === 'connected' && !['status', 'versions', 'plugins', 'auth'].includes(request.action)
      if (reconnect)
        await this.disconnect(id)
      live.busy = request.action
      live.error = undefined
      live.logs = []
      try {
        const value = await this.transport.run(record, request, text => this.log(id, text))
        if (value && !Array.isArray(value) && 'installed' in value)
          live.status = value
        return value
      }
      catch (error) {
        live.error = error.message
        throw error
      }
      finally {
        live.busy = undefined
        if (reconnect && this.record(id).enabled && !this.disposed)
          setTimeout(() => { void this.connect(id) }, 0)
      }
    })
  }

  async enable(id, enabled) {
    await this.ready
    if (typeof enabled !== 'boolean')
      throw new Error('SSH_ENABLED_INVALID')
    await this.exclusive('$config', async () => {
      this.record(id)
      const next = this.records.map(record => record.id === id ? { ...record, enabled } : record)
      await this.persist(next)
      this.records = next
    })
    if (enabled)
      void this.connect(id)
    else
      await this.disconnect(id)
    return this.list()
  }

  async disconnect(id) {
    const live = this.current(id)
    live.generation++
    clearTimeout(live.retry)
    clearTimeout(live.health)
    live.retry = undefined
    const child = live.tunnel
    const proxy = live.proxy
    live.tunnel = undefined
    live.proxy = undefined
    live.state = 'disconnected'
    await proxy?.close()
    await this.transport.kill(child)
  }

  async connect(id) {
    if (this.disposed)
      return
    const record = this.record(id)
    const live = this.current(id)
    if (!record.enabled || live.state === 'connected' || live.state === 'connecting')
      return
    live.state = 'connecting'
    live.error = undefined
    const generation = ++live.generation
    function active(manager) {
      return !manager.disposed && record.enabled && generation === live.generation
    }
    try {
      const status = await this.operation(id, { action: 'status' })
      if (!active(this))
        return
      if (!status.installed)
        throw new Error('DSH_NOT_MANAGED: inspect the remote DSH, then install or adopt it')
      if (!status.running)
        await this.operation(id, { action: 'start' })
      if (!active(this))
        return
      const auth = await this.operation(id, { action: 'auth' })
      if (!active(this))
        return
      const tunnelPort = await unusedPort()
      if (!active(this))
        return
      const child = this.transport.launch(record, { local: tunnelPort, remote: status.port })
      live.tunnel = child
      child.stdin.end()
      let failed = false
      child.stderr.on('data', (chunk) => {
        this.log(id, chunk)
        live.error = String(chunk).slice(-4000)
      })
      child.on('error', (error) => {
        failed = true
        live.error = error.message
      })
      child.on('close', () => {
        failed = true
        if (active(this)) {
          live.state = 'error'
          live.error ||= 'SSH_TUNNEL_CLOSED'
          const proxy = live.proxy
          live.proxy = undefined
          void proxy?.close()
          this.scheduleRetry(id)
        }
      })
      const proxy = await createDshProxy({ port: record.localPort, tunnelPort, remotePort: status.port, cookie: auth.cookie })
      if (!active(this) || failed) {
        await proxy.close()
        return
      }
      live.proxy = proxy
      record.localPort = proxy.port
      await this.persist()
      for (let count = 0; count < 40; count++) {
        if (!active(this) || failed)
          break
        try {
          const healthy = await probeDsh(proxy.origin, {}, 1000)
          if (active(this) && !failed && healthy) {
            live.state = 'connected'
            live.error = undefined
            live.retryCount = 0
            this.watchHealth(id, generation)
            return
          }
        }
        catch { /* The SSH listener or DSH startup may still be pending. */ }
        await new Promise(resolve => setTimeout(resolve, 250))
      }
      throw new Error(live.error || 'SSH_TUNNEL_HEALTH_FAILED')
    }
    catch (error) {
      if (!active(this))
        return
      await this.disconnect(id)
      live.state = 'error'
      live.error = error.message
      this.scheduleRetry(id)
    }
  }

  scheduleRetry(id) {
    const live = this.current(id)
    clearTimeout(live.retry)
    if (this.disposed || !this.record(id).enabled || live.status?.installed === false)
      return
    live.retryCount = (live.retryCount || 0) + 1
    live.retry = setTimeout(() => {
      void this.connect(id)
    }, Math.min(60000, 5000 * live.retryCount))
    live.retry.unref?.()
  }

  watchHealth(id, generation) {
    const live = this.current(id)
    live.health = setTimeout(async () => {
      if (this.disposed || live.generation !== generation || live.state !== 'connected')
        return
      let healthy = false
      try {
        healthy = await probeDsh(live.proxy.origin, {}, 3000)
      }
      catch { /* A restarted DSH invalidates its browser cookie; reconnect exchanges a fresh one. */ }
      if (this.disposed || live.generation !== generation)
        return
      if (healthy) {
        this.watchHealth(id, generation)
      }
      else {
        await this.disconnect(id)
        live.state = 'error'
        live.error = 'SSH_DSH_HEALTH_FAILED'
        this.scheduleRetry(id)
      }
    }, 15000)
    live.health.unref?.()
  }

  async dispose() {
    this.disposed = true
    await Promise.all(this.records.map(record => this.disconnect(record.id)))
    await this.transport.dispose()
  }
}
