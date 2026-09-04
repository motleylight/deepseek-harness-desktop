// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installExternalClientEntry } from '../plugins/dsh-tauri-connections/src/external-client-entry.js'

let dispose: (() => void) | undefined
const page = window as unknown as Record<string, unknown>

beforeEach(() => {
  Object.defineProperty(window, 'top', { configurable: true, value: {} })
  window.location.href = 'http://127.0.0.1:3182/?dsh-desktop-external=1'
  delete page.__ModuleLoader__
})
afterEach(() => {
  dispose?.()
  dispose = undefined
  delete page.__ModuleLoader__
})

function facade(installed = false) {
  const system = { manifest: { plugins: installed ? [{ id: 'dsh-tauri-connections' }] : [] } }
  const create = vi.fn(() => system)
  return { mode: 'queue', load: vi.fn(), create, system }
}

it('adds a bundled Cordis entry before boot without a server package or bundle request', () => {
  dispose = installExternalClientEntry()
  const loader = facade()
  const original = loader.create
  page.__ModuleLoader__ = loader
  expect(loader.create()).toBe(loader.system)
  expect(loader.create).toBe(original)
  expect(loader.system.manifest.plugins).toEqual([expect.objectContaining({ id: 'dsh-tauri-connections-companion' })])
  const registration = loader.load.mock.calls[0][0]
  const plugin = registration.factory()
  expect(plugin.inject).toEqual(['sessions'])
  const effect = vi.fn()
  plugin.apply({ effect })
  expect(effect).toHaveBeenCalledOnce()
  expect(Object.getOwnPropertyDescriptor(window, '__ModuleLoader__')?.value).toBe(loader)
})

it('uses an existing queue facade and leaves an installed plugin as the only owner', () => {
  const loader = facade(true)
  page.__ModuleLoader__ = loader
  dispose = installExternalClientEntry()
  loader.create()
  expect(loader.load).not.toHaveBeenCalled()
  expect(loader.system.manifest.plugins).toHaveLength(1)
})

it('does not intercept an already booted page', () => {
  const loader = facade()
  loader.mode = 'live'
  page.__ModuleLoader__ = loader
  const original = loader.create
  dispose = installExternalClientEntry()
  expect(loader.create).toBe(original)
  dispose()
  expect(page.__ModuleLoader__).toBe(loader)
})

it('uses current controller contributions when the remote has no legacy client runtime', () => {
  const loader = facade()
  loader.system.manifest.plugins.push({ id: '@deepseek-ai/dsh-api-workspace-controller' })
  page.__ModuleLoader__ = loader
  dispose = installExternalClientEntry()
  loader.create()
  expect(loader.system.manifest.plugins.at(-1)).toMatchObject({ inject: ['@deepseek-ai/dsh-api-session-controller', '@deepseek-ai/dsh-api-workspace-controller'] })
  expect(loader.load.mock.calls[0][0].factory().inject).toEqual(['sessions', 'workspaces'])
})

it('restores the original facade on page teardown before boot', () => {
  dispose = installExternalClientEntry()
  const loader = facade()
  const original = loader.create
  page.__ModuleLoader__ = loader
  window.dispatchEvent(new Event('pagehide'))
  expect(loader.create).toBe(original)
  expect(page.__ModuleLoader__).toBe(loader)
  expect(loader.load).not.toHaveBeenCalled()
})

it('removes an unassigned interception on disposal and ignores ordinary pages', () => {
  dispose = installExternalClientEntry()
  dispose()
  expect(Object.hasOwn(window, '__ModuleLoader__')).toBe(false)
  window.location.href = 'http://127.0.0.1:3182/'
  dispose = installExternalClientEntry()
  expect(Object.hasOwn(window, '__ModuleLoader__')).toBe(false)
})
