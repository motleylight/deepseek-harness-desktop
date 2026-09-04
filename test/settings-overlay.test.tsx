// @vitest-environment happy-dom
import type { Root } from 'react-dom/client'
import { useOverlay } from '@overlastic/react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AppProviders } from '../src/components/app-providers'
import { ConfigDialog } from '../src/components/config-dialog'
import { queryClient } from '../src/config/client'
import '../src/i18n'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn(async (command: string) => {
  if (command === 'get_app_config')
    return { port: 3181, zoom_factor: 1, connections: [], connected_connection_ids: [], managed_connection_name: 'Local regression DSH' }
  if (command === 'dsh_ssh_request')
    return [{ id: 'ssh-test', name: 'Linux regression DSH', host: 'test.invalid', user: '', enabled: false, state: 'disconnected', logs: [] }]
  if (['get_dsh_plugins', 'refresh_plugin_updates', 'get_cores', 'get_profiles'].includes(command))
    return []
  if (command === 'read_service_logs')
    return ''
  if (command === 'get_runtime_info')
    return { app_version: 'test', dsh_version: 'test', node_version: 'test', platform: 'windows', arch: 'x64', service_url: 'http://127.0.0.1:3181', data_dir: 'test', log_path: 'test' }
  if (command === 'get_cli_link_status')
    return { enabled: false, shim_exists: false, path_registered: false, user_dsh_preserved: false, bin_dir: '', shim_path: '' }
  return false
}) }))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }))
let root: Root
let container: HTMLDivElement

function SettingsEntry() {
  const open = useOverlay(ConfigDialog)
  function handleOpen() {
    void open().catch(() => {})
  }
  return <button onClick={handleOpen}>Open settings</button>
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  queryClient.clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  queryClient.clear()
  container.remove()
})

async function click(label: string) {
  const button = [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === label || item.getAttribute('aria-label') === label)
  expect(button, label).toBeDefined()
  await act(async () => button!.click())
}

it('opens the real settings overlay with connection and SSH state, closes and reopens without losing the application', async () => {
  await act(async () => root.render(<AppProviders><SettingsEntry /></AppProviders>))
  for (let index = 0; index < 2; index++) {
    await click('Open settings')
    await act(async () => new Promise(resolve => setTimeout(resolve, 30)))
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Local regression DSH')
    await click('Plugins')
    expect(document.querySelector('[role="dialog"] select')).not.toBeNull()
    await click('DSH')
    expect(document.querySelector('[role="dialog"] select')).not.toBeNull()
    await click('Close')
    await act(async () => new Promise(resolve => setTimeout(resolve, 350)))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(container.textContent).toContain('Open settings')
  }
})
