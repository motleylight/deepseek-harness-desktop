// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply as applyPlugin } from '../plugins/dsh-tauri-connections/src/client.js'
import { mountExternalWorkspace } from '../plugins/dsh-tauri-connections/src/external-workspace.js'

const host = { postMessage: vi.fn() }
let dispose: (() => void) | undefined
const pendingStore = { getSnapshot: () => ({ phase: 'pending' }), subscribe: () => () => {} }
const baseContext = { sessions: { list: pendingStore }, workspaces: { list: pendingStore }, connection: { hostDescription: pendingStore } }
function apply(ctx: Parameters<typeof applyPlugin>[0]) {
  applyPlugin({ ...baseContext, ...ctx })
}

function send(data: unknown, source: unknown = host) {
  window.dispatchEvent(new MessageEvent('message', { source: source as Window, origin: 'http://tauri.localhost', data }))
}

function state(name = 'Development') {
  return { source: 'dsh-desktop', type: 'dsh://workspace-tree:state', state: {
    managed: { id: 'managed-local', name, url: 'http://127.0.0.1:3081' },
    connections: [{ id: 'external-1', name: 'Another DSH', url: 'http://127.0.0.1:3082' }],
    selectedConnectionId: 'managed-local',
    trees: { 'external-1': { workspaces: [{ id: 'same-id', title: 'Remote workspace', sessions: [{ id: 'same-session-id', title: 'Remote session' }] }] } },
    labels: { newSession: 'New session', newWorkspace: 'New workspace', connectionBadge: 'Connection: {name}', workspaceBadge: 'Workspace: {name}', rename: 'Rename', copyAddress: 'Copy address', editAddress: 'Edit address', disconnect: 'Disconnect', delete: 'Delete', cancel: 'Cancel' },
  } }
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'parent', { configurable: true, value: host })
  Object.defineProperty(window, 'top', { configurable: true, value: host })
  window.location.href = 'http://127.0.0.1:3081/?dsh-desktop-managed=1'
  document.body.innerHTML = '<div><aside style="display:block"><div role="tree"><div id="local-workspace" role="treeitem">Local workspace</div></div></aside><div data-shell-overlay></div></div>'
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  vi.unstubAllGlobals()
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})

describe('connection plugin lifecycle and workspace routing', () => {
  it('selects the local connection from a native session click without replacing its original handler', () => {
    const nativeClick = vi.fn()
    document.getElementById('local-workspace')!.addEventListener('click', nativeClick)
    apply({ effect(start: () => () => void) {
      dispose = start()
    } })
    const message = state()
    message.state.selectedConnectionId = 'external-1'
    send(message)
    document.getElementById('local-workspace')!.click()
    expect(host.postMessage).toHaveBeenCalledWith(expect.objectContaining({ action: 'select', connectionId: 'managed-local' }), 'http://tauri.localhost')
    expect(nativeClick).toHaveBeenCalledOnce()
  })

  it('preserves native toolbar buttons, routes creation and search, and shares native view choices with external rows', async () => {
    vi.useFakeTimers()
    const buttons = ['新建会话', '搜索会话', '视图选项', '添加工作区'].map((label) => {
      const button = document.createElement('button')
      button.setAttribute('aria-label', label)
      document.body.prepend(button)
      return button
    })
    const native = buttons.map(() => vi.fn())
    buttons.forEach((button, index) => button.addEventListener('click', native[index]))
    apply({ effect(start: () => () => void) {
      dispose = start()
    } })
    const message = state()
    Object.assign(message.state.labels, { toolbar: { 'new-session': 'New session · Development', 'search': 'All search', 'add-workspace': 'Add workspace · Development', 'view': 'All view' } })
    send(message)
    await vi.advanceTimersByTimeAsync(220)
    buttons.forEach(button => button.click())
    expect(native[0]).toHaveBeenCalledOnce()
    expect(native[1]).not.toHaveBeenCalled()
    expect(native[2]).toHaveBeenCalledOnce()
    expect(native[3]).not.toHaveBeenCalled()
    expect(host.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'dsh://workspace-tree:toolbar', action: 'new-session' }), 'http://tauri.localhost')
    message.state.selectedConnectionId = 'external-1'
    send(message)
    buttons[0].click()
    expect(native[0]).toHaveBeenCalledOnce()
    expect(host.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'dsh://workspace-tree:toolbar', action: 'new-session' }), 'http://tauri.localhost')
    localStorage.setItem('dsh.workspace.view.v5', JSON.stringify({ groupBy: 'flat', orderBy: 'updated' }))
    await vi.advanceTimersByTimeAsync(220)
    expect(document.querySelector('[data-depth="workspace"]')).toBeNull()
    expect(document.querySelector('[data-depth="session"]')).not.toBeNull()
    expect(document.getElementById('local-workspace')).not.toBeNull()
    dispose?.()
    expect(buttons[0].getAttribute('aria-label')).toBe('新建会话')
    localStorage.clear()
    vi.useRealTimers()
  })
  it('keeps asynchronously inserted local rows between the local header and remote groups without replacing native nodes', async () => {
    apply({ effect(start: () => () => void) {
      dispose = start()
    } })
    send(state())
    const tree = document.querySelector('[role="tree"]')!
    const late = document.createElement('div')
    late.textContent = 'Late local workspace and sessions'
    const click = vi.fn()
    late.addEventListener('click', click)
    tree.appendChild(late)
    await vi.waitFor(() => expect(tree.lastElementChild?.id).toBe('dsh-desktop-external-connections'))
    expect(tree.firstElementChild?.id).toBe('dsh-desktop-managed-connection')
    expect(late.nextElementSibling?.id).toBe('dsh-desktop-external-connections')
    late.click()
    expect(click).toHaveBeenCalledOnce()
    tree.removeChild(late)
    await vi.waitFor(() => expect(late.hasAttribute('data-dsh-desktop-managed-child')).toBe(false))
    tree.prepend(late)
    await vi.waitFor(() => expect(tree.firstElementChild?.id).toBe('dsh-desktop-managed-connection'))
    expect(late.parentElement).toBe(tree)
  })

  it('keeps row creation scoped to its own connection and workspace rather than the selected toolbar target', async () => {
    apply({ effect(start: () => () => void) {
      dispose = start()
    } })
    const message = state()
    Object.assign(message.state.labels, { toolbar: { 'new-session': 'New session · Development', 'add-workspace': 'Add workspace · Development' } })
    send(message)
    await new Promise(resolve => setTimeout(resolve, 220))
    const workspace = document.querySelector('[data-depth="workspace"]')!
    ;(workspace.querySelector('button') as HTMLButtonElement).click()
    expect(host.postMessage).toHaveBeenCalledWith(expect.objectContaining({ action: 'new-session', connectionId: 'external-1', workspaceId: 'same-id' }), 'http://tauri.localhost')
    expect(host.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'dsh://workspace-tree:toolbar', action: 'new-session' }), 'http://tauri.localhost')
    const connection = document.querySelector('[data-connection-id="external-1"]')!
    ;(connection.querySelector('button') as HTMLButtonElement).click()
    expect(host.postMessage).toHaveBeenCalledWith(expect.objectContaining({ action: 'add-workspace', connectionId: 'external-1' }), 'http://tauri.localhost')
  })

  it('merges every connection in flat view, labels row ownership, and preserves row menus', async () => {
    const managed = { phase: 'ready', items: [{ workspaceId: 'same-id', title: 'Local workspace', path: '/local', sessionIds: ['same-session-id'] }], archivedSessionIds: [] }
    const sessions = { phase: 'ready', ids: ['same-session-id'], current: 'same-session-id', byId: { 'same-session-id': { displayTitle: 'Local session', updatedAt: 3, running: true } } }
    const source = (snapshot: unknown) => ({ getSnapshot: () => snapshot, subscribe: () => () => {} })
    apply({ sessions: { list: source(sessions) }, workspaces: { list: source(managed) }, effect(start: () => () => void) {
      dispose = start()
    } })
    const message = state()
    Object.assign(message.state.labels, { renameSession: 'Rename session', forkSession: 'Fork session', archiveSession: 'Archive session', running: 'Running', completed: 'Completed' })
    send(message)
    localStorage.setItem('dsh.workspace.view.v5', JSON.stringify({ groupBy: 'flat', orderBy: 'updated' }))
    await vi.waitFor(() => expect(document.querySelector('[data-connection-id]')).toBeNull())
    const rows = document.querySelectorAll('[data-session-key]')
    expect(rows).toHaveLength(2)
    expect(rows[0].getAttribute('data-session-key')).toBe('["managed-local","same-session-id"]')
    expect(rows[0].querySelector('[data-status="running"]')).not.toBeNull()
    expect(rows[0].querySelectorAll('.dsh-desktop-badge')).toHaveLength(2)
    const badges = rows[1].querySelectorAll('.dsh-desktop-badge')
    ;(badges[1] as HTMLElement).click()
    ;(document.querySelector('[role="menuitem"]') as HTMLElement).click()
    expect(host.postMessage).toHaveBeenCalledWith(expect.objectContaining({ action: 'new-session', connectionId: 'external-1', workspaceId: 'same-id' }), 'http://tauri.localhost')
    rows[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    expect(document.querySelector('[role="menu"]')?.textContent).toBe('Rename sessionFork sessionArchive session')
    localStorage.setItem('dsh.workspace.view.v5', JSON.stringify({ groupBy: 'workspace' }))
    await vi.waitFor(() => expect(document.querySelector('[data-connection-id]')).not.toBeNull())
    expect(document.querySelector('[role="tree"]')?.getAttribute('data-dsh-desktop-flat')).toBe('false')
    localStorage.clear()
  })

  it('uses folder disclosures and native-size rows, preserves keyboard focus, and scopes workspace expansion to its connection', () => {
    apply({ effect(start: () => () => void) {
      dispose = start()
    } })
    const message = state()
    message.state.connections.push({ id: 'external-2', name: 'Third DSH', url: 'http://127.0.0.1:3083' })
    Object.assign(message.state.trees, { 'external-2': message.state.trees['external-1'] })
    send(message)
    const connection = document.querySelector('[data-connection-id="managed-local"]')!
    expect(connection.textContent).toBe('Development')
    expect(connection.getAttribute('title')).toContain('http://127.0.0.1:3081')
    expect(connection.querySelectorAll('svg')).toHaveLength(3)
    const styles = document.getElementById('dsh-desktop-workspace-tree-styles')!.textContent
    expect(styles).toContain('font-size:14px;line-height:20px')
    expect(styles).toContain('height:32px;gap:0')
    const workspace = document.querySelector('[data-depth="workspace"]') as HTMLElement
    workspace.focus()
    workspace.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    expect(document.querySelectorAll('[data-depth="session"]')).toHaveLength(1)
    expect(document.activeElement?.getAttribute('data-workspace-key')).toBe(workspace.getAttribute('data-workspace-key'))
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(document.querySelectorAll('[data-depth="session"]')).toHaveLength(2)
    const session = document.querySelector('[data-depth="session"]') as HTMLElement
    expect(session.textContent).toBe('Remote session')
    session.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(host.postMessage).toHaveBeenCalledWith(expect.objectContaining({ action: 'open-session', connectionId: 'external-1', sessionId: 'same-session-id' }), 'http://tauri.localhost')
  })

  it('mounts through Cordis, preserves official nodes and restores them on unload', () => {
    const local = document.getElementById('local-workspace')
    apply({ effect(start: () => () => void) {
      dispose = start()
    } })
    expect(host.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'dsh://workspace-tree:ready' }), '*')
    send(state())
    expect(document.querySelector('[role="tree"]')?.textContent).toContain('Development')
    expect(document.getElementById('local-workspace')).toBe(local)
    expect(local?.getAttribute('data-dsh-desktop-managed-child')).toBe('true')
    const managedRow = document.querySelector('[data-connection-id="managed-local"]')
    send(state())
    expect(document.querySelector('[data-connection-id="managed-local"]')).toBe(managedRow)
    const remoteSession = [...document.querySelectorAll('[data-depth="session"]')][0] as HTMLElement
    remoteSession.click()
    expect(host.postMessage).toHaveBeenCalledWith(expect.objectContaining({ action: 'open-session', connectionId: 'external-1', sessionId: 'same-session-id' }), 'http://tauri.localhost')
    dispose?.()
    expect(document.querySelector('[data-connection-id]')).toBeNull()
    expect(local?.hasAttribute('data-dsh-desktop-managed-child')).toBe(false)
    expect(document.getElementById('dsh-desktop-workspace-tree-styles')).toBeNull()
    send(state('Must not return'))
    expect(document.body.textContent).not.toContain('Must not return')
    apply({ effect(start: () => () => void) {
      dispose = start()
    } })
    send(state('Reloaded'))
    expect(document.querySelectorAll('[data-connection-id="managed-local"]')).toHaveLength(1)
    expect(document.body.textContent).toContain('Reloaded')
  })

  it('rejects messages from other frames and handles connection menus before session menus', () => {
    apply({ effect(start: () => () => void) {
      dispose = start()
    } })
    send(state('Foreign'), {})
    expect(document.querySelector('[data-connection-id]')).toBeNull()
    send(state('<img src=x onerror=alert(1)>'))
    expect(document.querySelector('img')).toBeNull()
    const otherMenu = vi.fn()
    document.addEventListener('contextmenu', otherMenu, true)
    const row = document.querySelector('[data-connection-id="external-1"]') as HTMLElement
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }))
    expect(otherMenu).not.toHaveBeenCalled()
    expect(document.querySelector('[role="menu"]')?.textContent).toContain('Edit address')
    document.removeEventListener('contextmenu', otherMenu, true)
    dispose?.()
    expect(document.querySelector('[role="menu"]')).toBeNull()
  })

  it('does not modify normal browser visits', () => {
    window.location.href = 'http://127.0.0.1:3081/'
    const effect = vi.fn()
    apply({ effect })
    expect(effect).not.toHaveBeenCalled()
  })

  it('loads the packaged client through the real DSH module-loader entry', () => {
    const load = vi.fn(({ factory }: { factory: () => { apply: typeof apply } }) => {
      const plugin = factory()
      plugin.apply({ ...baseContext, effect(start: () => () => void) {
        dispose = start()
      } })
    })
    Object.assign(window, { __ModuleLoader__: { load } })
    const client = readFileSync(resolve(process.cwd(), 'plugins/dsh-tauri-connections/dist/client.cjs'), 'utf8')
    // eslint-disable-next-line no-eval -- Executes the built DSH module-loader entry.
    window.eval(client)
    send(state('Packaged plugin'))
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ id: 'dsh-tauri-connections' }))
    expect(document.body.textContent).toContain('Packaged plugin')
  })
})

describe('external DSH companion', () => {
  it('projects current DSH stores, excludes archived sessions and disposes subscriptions', () => {
    const sessions = { phase: 'ready', ids: ['live', 'archived'], byId: { live: { displayTitle: 'Live title' }, archived: { displayTitle: 'Archived title' } } }
    const workspaces = { phase: 'pending', items: [{ workspaceId: 'w', title: 'Linux', sessionIds: ['live', 'archived'] }], archivedSessionIds: ['archived'] }
    const subscriptions: Array<() => void> = []
    const stops = [vi.fn(), vi.fn()]
    const stores = {
      sessions: { getSnapshot: () => sessions, subscribe: (listener: () => void) => {
        subscriptions.push(listener)
        return stops[0]
      } },
      workspaces: { getSnapshot: () => workspaces, subscribe: (listener: () => void) => {
        subscriptions.push(listener)
        return stops[1]
      } },
    }
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const open = vi.fn()
    dispose = mountExternalWorkspace(open, 'http://tauri.localhost', stores)
    expect(host.postMessage).not.toHaveBeenCalled()
    workspaces.phase = 'ready'
    subscriptions[0]()
    expect(host.postMessage).toHaveBeenCalledWith(expect.objectContaining({ tree: expect.objectContaining({ workspaces: [expect.objectContaining({ id: 'w', title: 'Linux', sessions: [expect.objectContaining({ id: 'live', title: 'Live title' })] })] }) }), 'http://tauri.localhost')
    expect(fetch).not.toHaveBeenCalled()
    send({ source: 'dsh-desktop', type: 'dsh://external-workspace:open-session', sessionId: 'live', sessionTitle: 'Live title' })
    expect(open).toHaveBeenCalledWith('live')
    dispose()
    stops.forEach(stop => expect(stop).toHaveBeenCalledOnce())
  })

  it('does not expose workspace data to an arbitrary embedding website', () => {
    window.location.href = 'http://127.0.0.1:3182/?dsh-desktop-external=1'
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    apply({ sessions: { open: vi.fn(), list: pendingStore }, workspaces: { list: pendingStore }, connection: { hostDescription: pendingStore }, effect(start: () => () => void) {
      dispose = start()
    } })
    window.dispatchEvent(new MessageEvent('message', { source: host as unknown as Window, origin: 'https://untrusted.example', data: { source: 'dsh-desktop', type: 'dsh://external-workspace:refresh' } }))
    expect(fetch).not.toHaveBeenCalled()
    expect(host.postMessage).not.toHaveBeenCalled()
  })

  it('opens an exact session ID through the installed client plugin and removes the opener on unload', () => {
    window.location.href = 'http://127.0.0.1:3182/?dsh-desktop-external=1'
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const open = vi.fn()
    apply({ sessions: { open, list: pendingStore }, workspaces: { list: pendingStore }, connection: { hostDescription: pendingStore }, effect(start: () => () => void) {
      dispose = start()
    } })
    send({ source: 'dsh-desktop', type: 'dsh://external-workspace:refresh' })
    send({ source: 'dsh-desktop', type: 'dsh://external-workspace:open-session', sessionId: 'exact-session-id', sessionTitle: 'Duplicate title' })
    expect(open).toHaveBeenCalledExactlyOnceWith('exact-session-id')
    dispose?.()
    send({ source: 'dsh-desktop', type: 'dsh://external-workspace:open-session', sessionId: 'late-id', sessionTitle: 'Duplicate title' })
    expect(open).toHaveBeenCalledOnce()
  })

  it('matches the title label without timestamps, and refuses ambiguous titles', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    document.body.innerHTML = '<div role="treeitem"><span class="row_title">Same title</span><span>Yesterday</span></div>'
    const click = vi.fn()
    document.querySelector('[role="treeitem"]')!.addEventListener('click', click)
    dispose = mountExternalWorkspace(undefined, 'http://tauri.localhost')
    const action = { source: 'dsh-desktop', type: 'dsh://external-workspace:open-session', sessionId: 's', sessionTitle: 'Same title' }
    send(action)
    expect(click).toHaveBeenCalledOnce()
    document.body.appendChild(document.body.firstElementChild!.cloneNode(true))
    send(action)
    expect(click).toHaveBeenCalledOnce()
    expect(host.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'dsh://external-workspace:open-failed' }), 'http://tauri.localhost')
  })

  it('uses the external origin, restores layout and stops requests on unload', async () => {
    window.location.href = 'http://127.0.0.1:3082/?dsh-desktop-external=1'
    const fetchMock = vi.fn(async (url: string, options: RequestInit) => {
      const request = JSON.parse(String(options.body))
      const items = url.endsWith('workspace.list')
        ? [{ workspaceId: 'w', title: 'Remote', sessionIds: ['s'] }]
        : [{ sessionId: 's', projections: { values: { title: 'Remote chat' } } }]
      return { ok: true, json: async () => ({ rpcId: request.rpcId, result: { ok: true, value: { items } } }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    dispose = mountExternalWorkspace(undefined, 'http://tauri.localhost')
    await vi.waitFor(() => expect(host.postMessage).toHaveBeenCalledWith(expect.objectContaining({ tree: expect.objectContaining({ workspaces: [expect.objectContaining({ id: 'w', title: 'Remote', sessions: [expect.objectContaining({ id: 's', title: 'Remote chat' })] })] }) }), 'http://tauri.localhost'))
    expect(fetchMock.mock.calls.every(([url]) => url.startsWith('http://127.0.0.1:3082/api/'))).toBe(true)
    expect(document.querySelector('aside')?.style.visibility).toBe('hidden')
    const signal = fetchMock.mock.calls[0][1].signal
    dispose()
    expect(signal?.aborted).toBe(true)
    expect(document.querySelector('aside')?.getAttribute('style')).toBe('display:block')
    const count = fetchMock.mock.calls.length
    send({ source: 'dsh-desktop', type: 'dsh://external-workspace:refresh' })
    expect(fetchMock).toHaveBeenCalledTimes(count)
  })

  it('does not publish a late response after disposal', async () => {
    let release: () => void = () => {}
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
      await pending
      return { ok: true, json: async () => ({ rpcId: JSON.parse(String(options.body)).rpcId, result: { ok: true, value: { items: [] } } }) }
    }))
    dispose = mountExternalWorkspace(undefined, 'http://tauri.localhost')
    dispose()
    release()
    await pending
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(host.postMessage).not.toHaveBeenCalled()
  })
})
