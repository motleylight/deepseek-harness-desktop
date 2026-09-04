// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"navigation":{"disableChildFrameNavigation":true}}}
import type { Root } from 'react-dom/client'
import type { ConnectionsConfig, DesktopConnectionHost } from '../plugins/dsh-tauri-connections/desktop/types'
import { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DshConnectionsProvider } from '../plugins/dsh-tauri-connections/desktop/context'
import { ConnectionEditor } from '../plugins/dsh-tauri-connections/desktop/editor'
import { DshConnectionPanel } from '../plugins/dsh-tauri-connections/desktop/panel'
import { DshWorkspaces } from '../plugins/dsh-tauri-connections/desktop/workspaces'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
let root: Root
let container: HTMLDivElement
let host: DesktopConnectionHost
const connections = [{ id: 'a', name: 'DSH A', url: 'http://127.0.0.1:3182' }, { id: 'b', name: 'DSH B', url: 'http://127.0.0.1:3183' }]
const config: ConnectionsConfig = { connections, managed_connection_name: 'Development', connected_connection_ids: ['a', 'b'], active_connection_id: 'managed-local' }

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  invoke.mockResolvedValue(config)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  host = { config, updateConfig: vi.fn(), translate: key => key, locale: 'en-US', copyText: vi.fn(), serviceUrl: 'http://127.0.0.1:3181', serviceRunning: true, serviceBusy: false, restart: vi.fn(), shutdown: vi.fn(), start: vi.fn() }
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

function button(label: string) {
  const found = [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === label)
  expect(found, `button ${label}`).toBeDefined()
  return found!
}
async function click(element: HTMLElement) {
  await act(async () => element.click())
}

describe('connection editor and settings', () => {
  it('renames a saved offline connection without probing it', async () => {
    const close = vi.fn()
    await act(async () => root.render(<DshConnectionsProvider host={host}><ConnectionEditor target={{ kind: 'rename', connection: connections[0] }} onClose={close} /></DshConnectionsProvider>))
    await click(button('Save'))
    expect(invoke).toHaveBeenCalledWith('update_dsh_connection', { id: 'a', name: 'DSH A', url: connections[0].url })
    expect(invoke).not.toHaveBeenCalledWith('probe_dsh_connection', expect.anything())
    expect(host.updateConfig).toHaveBeenCalledWith(config)
    expect(close).toHaveBeenCalledOnce()
  })

  it('preserves saved state when an edited URL fails its probe', async () => {
    invoke.mockRejectedValueOnce(new Error('unreachable'))
    const close = vi.fn()
    await act(async () => root.render(<DshConnectionsProvider host={host}><ConnectionEditor target={{ kind: 'edit', connection: connections[0] }} onClose={close} /></DshConnectionsProvider>))
    const inputs = document.querySelectorAll('input')
    await act(async () => {
      for (const [index, value] of ['DSH new', 'http://127.0.0.1:3999'].entries()) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(inputs[index], value)
        inputs[index].dispatchEvent(new Event('input', { bubbles: true }))
      }
    })
    await click(button('Save'))
    expect(invoke).toHaveBeenCalledWith('probe_dsh_connection', { url: 'http://127.0.0.1:3999' })
    expect(host.updateConfig).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alert"]')).not.toBeNull()
  })

  it('renders one shared connection list with managed process controls', async () => {
    await act(async () => root.render(<DshConnectionsProvider host={host}><DshConnectionPanel /></DshConnectionsProvider>))
    expect(container.textContent).toContain('Development')
    expect(container.textContent).toContain('DSH A')
    expect(container.textContent).toContain('DSH B')
    expect(container.querySelectorAll('[role="switch"]')).toHaveLength(2)
    await click(button('Restart'))
    expect(host.restart).toHaveBeenCalledOnce()
    const more = [...document.querySelectorAll('button')].find(item => item.getAttribute('aria-label')?.startsWith('DSH A '))!
    await click(more)
    expect(document.querySelector('[role="menu"]')?.textContent).toContain('Edit connection address')
    expect(document.querySelector('[role="menu"]')?.textContent).toContain('Delete connection')
  })
})

describe('parallel frames', () => {
  it('retains both frames on selection, replaces edited URLs, and disposes external frames with the plugin', async () => {
    const ref = createRef<HTMLIFrameElement>()
    const select = vi.fn()
    function render(selected: string, value = config) {
      root.render(<DshConnectionsProvider host={{ ...host, config: value }}><DshWorkspaces config={value} selectedConnectionId={selected} onSelectConnection={select} managedIframeRef={ref} managedIframeSrc="http://127.0.0.1:3181/?dsh-desktop-managed=1" managedIframeKey={0} managedHealthy managedIframeError={false} managedServiceUrl={host.serviceUrl} onManagedIframeLoad={() => {}} onManagedIframeError={() => {}} onManagedRetry={() => {}} /></DshConnectionsProvider>)
    }
    await act(async () => render('managed-local'))
    expect(container.querySelectorAll('iframe')).toHaveLength(1)
    function message(source: MessageEventSource | null, origin: string, type: string) {
      window.dispatchEvent(new MessageEvent('message', { source, origin, data: { source: 'dsh-desktop-workspace-tree', type } }))
    }
    await act(async () => message(window, 'http://127.0.0.1:3181', 'dsh://workspace-tree:ready'))
    expect(container.querySelectorAll('iframe')).toHaveLength(1)
    await act(async () => message(ref.current!.contentWindow, 'http://127.0.0.1:3181', 'dsh://workspace-tree:ready'))
    expect(container.querySelectorAll('iframe')).toHaveLength(3)
    const first = container.querySelector('iframe[title="DSH A"]')
    const second = container.querySelector('iframe[title="DSH B"]')
    await act(async () => render('a'))
    await act(async () => render('b'))
    expect(container.querySelector('iframe[title="DSH A"]')).toBe(first)
    expect(container.querySelector('iframe[title="DSH B"]')).toBe(second)
    await act(async () => render('b', { ...config, connections: [{ ...connections[0], url: 'http://127.0.0.1:3184' }, connections[1]] }))
    expect(container.querySelector('iframe[title="DSH A"]')).not.toBe(first)
    expect(container.querySelector('iframe[title="DSH B"]')).toBe(second)
    await act(async () => message(ref.current!.contentWindow, 'http://127.0.0.1:3181', 'dsh://workspace-tree:disposed'))
    expect(container.querySelectorAll('iframe')).toHaveLength(1)
    expect(select).toHaveBeenCalledWith('managed-local')
  })
})
