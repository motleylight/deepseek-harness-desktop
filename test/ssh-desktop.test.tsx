// @vitest-environment happy-dom
import type { Root } from 'react-dom/client'
import type { DesktopConnectionHost } from '../plugins/dsh-tauri-connections/desktop/types'
import type { SshRecord } from '../plugins/dsh-tauri-ssh/desktop/types'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DshConnectionPanel } from '../plugins/dsh-tauri-connections/desktop/panel'
import { SshConnectionsBridge, SshManagement, SshProvider } from '../plugins/dsh-tauri-ssh/desktop'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
let root: Root
let container: HTMLDivElement
let records: SshRecord[]
let host: DesktopConnectionHost
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  records = [{ id: 'ssh-a', name: 'Linux A', host: 'host-a', user: '', enabled: false, state: 'disconnected', logs: [] }]
  invoke.mockReset()
  invoke.mockImplementation(async (command: string, args: { method: string, params: Record<string, unknown> }) => {
    if (command !== 'dsh_ssh_request')
      throw new Error(`Unexpected native command: ${command}`)
    if (args.method === 'save')
      records = records.map(item => item.id === args.params.id ? { ...item, ...args.params } : item)
    return args.method === 'operation' ? { installed: false, running: false } : records
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  host = { locale: 'en-US', translate: key => key, config: { connections: [], connected_connection_ids: [], managed_connection_name: 'Development', active_connection_id: 'managed-local' }, updateConfig: vi.fn(), serviceUrl: 'http://127.0.0.1:3080', serviceRunning: true, serviceBusy: false, copyText: vi.fn(), start: vi.fn(), shutdown: vi.fn(), restart: vi.fn() }
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
async function render(kind?: 'core' | 'plugins') {
  await act(async () => root.render(<SshProvider locale="en-US"><SshConnectionsBridge host={host}>{kind ? <SshManagement kind={kind}><span>Local management</span></SshManagement> : <DshConnectionPanel />}</SshConnectionsBridge></SshProvider>))
}
async function click(label: string) {
  const element = [...document.querySelectorAll('button,[role="menuitem"]')].find(item => item.textContent?.trim() === label || item.getAttribute('aria-label') === label) as HTMLElement
  expect(element, label).toBeDefined()
  await act(async () => element.click())
}

it('merges SSH rows into the existing list without writing HTTP connection configuration', async () => {
  await render()
  expect(container.textContent).toContain('Linux A')
  expect(container.textContent).toContain('ssh://host-a')
  expect(host.updateConfig).not.toHaveBeenCalled()
  await act(async () => (container.querySelector('[role="switch"]') as HTMLElement).click())
  expect(invoke).toHaveBeenCalledWith('dsh_ssh_request', { method: 'enable', params: { id: 'ssh-a', enabled: true } })
})

it('edits an existing SSH connection using the shared menu without a reachability probe', async () => {
  await render()
  await click('Linux A Manage connections…')
  await click('Edit connection address')
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('SSH')
  await click('Save')
  expect(invoke).toHaveBeenCalledWith('dsh_ssh_request', expect.objectContaining({ method: 'save', params: expect.objectContaining({ id: 'ssh-a', name: 'Linux A', host: 'host-a' }) }))
  expect(host.updateConfig).not.toHaveBeenCalled()
})

it('provides only target fields, with no password or private-key form', async () => {
  await render()
  await click('Add SSH')
  expect(document.querySelectorAll('[role="dialog"] input')).toHaveLength(4)
  expect(document.querySelector('input[type="password"]')).toBeNull()
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('system OpenSSH')
})

it('selects remote core management without selecting a workspace or local core', async () => {
  await render('core')
  expect(container.textContent).toContain('Local management')
  const selector = container.querySelector('select')!
  await act(async () => {
    selector.value = 'ssh-a'
    selector.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(container.textContent).toContain('Linux A')
  expect(container.textContent).not.toContain('Local management')
  expect(invoke).toHaveBeenCalledWith('dsh_ssh_request', { method: 'operation', params: { id: 'ssh-a', request: { action: 'status' } } })
  expect(host.updateConfig).not.toHaveBeenCalled()
})

it('requires adoption confirmation for an existing data directory', async () => {
  records[0].status = { installed: false, running: false, existingData: true }
  await render()
  await click('Install and start DSH')
  const confirm = [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === 'Confirm')
  expect(confirm?.disabled).toBe(true)
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('~/.dsh')
  expect(invoke.mock.calls.some(([, args]) => args?.params?.request?.action === 'install')).toBe(false)
})
