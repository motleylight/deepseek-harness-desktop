// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createWorkspaceClient, parseSnapshot } from '../plugins/dsh-tauri-connections/desktop/workspace-client'
import { mountWorkspaceCommands } from '../plugins/dsh-tauri-connections/src/workspace-commands.js'

const parent = { postMessage: vi.fn() }
let stop: (() => void) | undefined
function clientContext() {
  return {
    workspaces: {
      list: { getSnapshot: () => ({ phase: 'ready', archivedSessionIds: [], items: [{ workspaceId: 'same-workspace', title: 'Same name', path: '/remote/project', sessionIds: ['same-session'] }] }) },
      connectWorkspace: vi.fn(async () => 'created'),
      create: vi.fn(async () => ({ workspaceId: 'new-workspace' })),
      listDirectory: vi.fn(async () => ({ path: '/remote', crumbs: [], entries: [] })),
      pickDirectory: vi.fn(async () => '/local'),
    },
    sessions: {
      list: { getSnapshot: () => ({ phase: 'ready', ids: ['same-session'], byId: { 'same-session': { displayTitle: 'Same title', updatedAt: 7 } } }) },
      open: vi.fn(),
      search: vi.fn(async () => ({ ok: true, value: { items: [{ sessionId: 'same-session', snippet: 'matching content' }], hasMore: false } })),
    },
    connection: { hostDescription: { getSnapshot: () => ({ version: 'remote-version' }) } },
  }
}
function send(command: string, args = {}, origin = 'http://tauri.localhost', source = parent) {
  const requestId = crypto.randomUUID()
  window.dispatchEvent(new MessageEvent('message', { source: source as unknown as Window, origin, data: { source: 'dsh-desktop', type: 'dsh://workspace-client:request', requestId, command, args } }))
  return requestId
}
beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'parent', { configurable: true, value: parent })
  window.location.href = 'http://127.0.0.1:3182/?dsh-desktop-external=1'
})
afterEach(() => {
  stop?.()
})

it('creates and opens a session on the requested workspace and reports this DSH version', async () => {
  const ctx = clientContext()
  stop = mountWorkspaceCommands(ctx)
  send('new-session', { workspaceId: 'same-workspace' })
  await vi.waitFor(() => expect(ctx.sessions.open).toHaveBeenCalledWith('created'))
  expect(ctx.workspaces.connectWorkspace).toHaveBeenCalledExactlyOnceWith('same-workspace')
  send('snapshot')
  await vi.waitFor(() => expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ value: expect.objectContaining({ version: 'remote-version' }) }), 'http://tauri.localhost'))
  send('new-session', { workspaceId: 'not-on-this-DSH' })
  await vi.waitFor(() => expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: expect.stringContaining('WORKSPACE_NOT_FOUND') }), 'http://tauri.localhost'))
  expect(ctx.workspaces.connectWorkspace).toHaveBeenCalledOnce()
})

it('browses and creates only through the target DSH, and never opens its native picker externally', async () => {
  const ctx = clientContext()
  stop = mountWorkspaceCommands(ctx)
  send('list-directory', { path: '/remote' })
  send('add-workspace', { path: '/remote/new' })
  send('pick-directory')
  await vi.waitFor(() => expect(ctx.workspaces.create).toHaveBeenCalledWith({ path: '/remote/new' }))
  expect(ctx.workspaces.listDirectory).toHaveBeenCalledWith('/remote', expect.any(AbortSignal))
  expect(ctx.workspaces.pickDirectory).not.toHaveBeenCalled()
  await vi.waitFor(() => expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: expect.stringContaining('WORKSPACE_COMMAND_INVALID') }), 'http://tauri.localhost'))
})

it('searches titles and contents and cancels reads on teardown', async () => {
  const ctx = clientContext()
  stop = mountWorkspaceCommands(ctx)
  send('search', { query: 'matching' })
  await vi.waitFor(() => expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ value: { hasMore: false, items: [{ id: 'same-session', title: 'Same title', updatedAt: 7, workspace: 'Same name', snippet: 'matching content' }] } }), 'http://tauri.localhost'))
  const signal = ctx.sessions.search.mock.calls[0][1] as AbortSignal
  expect(signal.aborted).toBe(false)
  ctx.sessions.search.mockImplementation(() => new Promise(() => {}))
  send('search', { query: 'later' })
  const pendingSignal = ctx.sessions.search.mock.calls[1][1] as AbortSignal
  stop()
  expect(pendingSignal.aborted).toBe(true)
})

it('rejects untrusted origins, sibling frames, and post-disposal commands without writes', async () => {
  const ctx = clientContext()
  stop = mountWorkspaceCommands(ctx)
  send('add-workspace', { path: '/wrong' }, 'https://untrusted.example')
  send('add-workspace', { path: '/wrong' }, 'http://tauri.localhost', { postMessage: vi.fn() })
  stop()
  send('add-workspace', { path: '/wrong' })
  expect(ctx.workspaces.create).not.toHaveBeenCalled()
  expect(parent.postMessage).not.toHaveBeenCalled()
})

it('retains title matches and marks partial results when the content index is unavailable', async () => {
  const ctx = clientContext()
  ctx.sessions.search.mockRejectedValueOnce(new Error('CONTENT_INDEX_DISABLED'))
  stop = mountWorkspaceCommands(ctx)
  send('search', { query: 'Same' })
  await vi.waitFor(() => expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ ok: true, value: expect.objectContaining({ warning: 'Error: CONTENT_INDEX_DISABLED', items: [expect.objectContaining({ id: 'same-session', title: 'Same title' })] }) }), 'http://tauri.localhost'))
})

it('pins same-id requests to their frame, rejects stale URLs and never falls back to local', async () => {
  const a = { postMessage: vi.fn() } as unknown as Window
  const b = { postMessage: vi.fn() } as unknown as Window
  const targets = { a: { window: a, origin: 'http://127.0.0.1:1', url: 'http://127.0.0.1:1/?t=1' }, b: { window: b, origin: 'http://127.0.0.1:2', url: 'http://127.0.0.1:2/?t=1' } }
  const broker = createWorkspaceClient(id => targets[id as 'a' | 'b'])
  stop = () => broker.invalidate()
  const first = broker.request('a', 'new-session', { workspaceId: 'same-id' })
  const firstResult = expect(first).rejects.toThrow('DSH_DISCONNECTED')
  const second = broker.request('b', 'new-session', { workspaceId: 'same-id' })
  const requestA = vi.mocked(a.postMessage).mock.calls[0][0]
  const requestB = vi.mocked(b.postMessage).mock.calls[0][0]
  broker.receive(new MessageEvent('message', { source: a, origin: targets.a.origin, data: { source: 'dsh-desktop-workspace-client', type: 'dsh://workspace-client:result', requestId: requestB.requestId, ok: true, value: { id: 'wrong' } } }))
  broker.receive(new MessageEvent('message', { source: b, origin: targets.b.origin, data: { source: 'dsh-desktop-workspace-client', type: 'dsh://workspace-client:result', requestId: requestB.requestId, ok: true, value: { id: 'correct-b' } } }))
  await expect(second).resolves.toEqual({ id: 'correct-b' })
  targets.a = { ...targets.a, url: 'http://127.0.0.1:1/?t=2' }
  broker.receive(new MessageEvent('message', { source: a, origin: targets.a.origin, data: { source: 'dsh-desktop-workspace-client', type: 'dsh://workspace-client:result', requestId: requestA.requestId, ok: true, value: { id: 'stale' } } }))
  await firstResult
  await expect(broker.request('missing', 'add-workspace', { path: '/a' })).rejects.toThrow('DSH_DISCONNECTED')
  expect(vi.mocked(b.postMessage)).toHaveBeenCalledOnce()
})

it('bounds external projection fields and does not substitute a local version', () => {
  expect(parseSnapshot({ version: 7, workspaces: [{ id: 'w', title: 'W', path: '/a', sessions: [{ id: 's', title: '<script>', updatedAt: 9 }] }] })).toEqual({ version: '', workspaces: [{ id: 'w', title: 'W', path: '/a', sessions: [{ id: 's', title: '<script>', updatedAt: 9 }] }] })
})

it('uses Alpha UI navigation with its separate workspace controller and no service version', async () => {
  const legacy = clientContext()
  const navigation = { connectWorkspace: vi.fn(async () => 'alpha-created'), listDirectory: vi.fn(async () => ({ path: '/linux' })) }
  const ctx = { ...legacy, connection: { generation: { getSnapshot: () => ({ host: { home: '/linux' } }) } }, workspaces: { list: legacy.workspaces.list, create: legacy.workspaces.create }, get: (name: string) => name === 'uiWorkspace' ? navigation : undefined }
  stop = mountWorkspaceCommands(ctx)
  send('new-session', { workspaceId: 'same-workspace' })
  await vi.waitFor(() => expect(legacy.sessions.open).toHaveBeenCalledWith('alpha-created'))
  send('list-directory', { path: '/linux' })
  expect(navigation.listDirectory).toHaveBeenCalledWith('/linux', expect.any(AbortSignal))
  send('snapshot')
  await vi.waitFor(() => expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ value: expect.objectContaining({ version: undefined }) }), 'http://tauri.localhost'))
})
