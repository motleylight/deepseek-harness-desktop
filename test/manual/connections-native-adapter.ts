import type { ConnectionsConfig } from '../../plugins/dsh-tauri-connections/desktop'
import { mockIPC } from '@tauri-apps/api/mocks'

// Manual browser harness: real DSH client modules, in-memory native configuration adapter.
let config: ConnectionsConfig = { connections: [{ id: 'external', name: '测试环境', url: 'http://127.0.0.1:3183' }, { id: 'current', name: '预发布环境', url: 'http://127.0.0.1:3186' }], connected_connection_ids: ['external', 'current'], managed_connection_name: '开发环境', active_connection_id: 'managed-local' }
mockIPC(async (command, payload) => {
  const args = payload as Record<string, unknown>
  if (command === 'get_dsh_theme')
    return 'light'
  if (command === 'dsh_ssh_request')
    return [{ id: 'ssh-test', name: 'Linux 验收连接', host: 'test.invalid', user: '', enabled: false, state: 'disconnected', logs: [] }]
  if (['get_dsh_plugins', 'refresh_plugin_updates', 'get_cores', 'get_profiles'].includes(command))
    return []
  if (command === 'read_service_logs')
    return ''
  if (command === 'get_launch_on_login')
    return false
  if (command === 'set_language' || command.startsWith('plugin:event|'))
    return 1
  if (command === 'get_runtime_info')
    return { app_version: 'UI regression', dsh_version: '0.1.1-rc.2', node_version: '24', platform: 'windows', arch: 'x64', service_url: 'http://127.0.0.1:3181', data_dir: 'isolated acceptance profile', log_path: 'test' }
  if (command === 'get_cli_link_status')
    return { enabled: false, shim_exists: false, path_registered: false, user_dsh_preserved: false, bin_dir: '', shim_path: '' }
  if (command === 'get_app_config')
    return { ...config, installed: true, port: 3181, zoom_factor: 1, close_action: 'exit' }
  if (command === 'probe_dsh_connection') {
    if (!/:318[36]/.test(String(args.url)))
      throw new Error('TEST_ENDPOINT_UNREACHABLE')
    return args.url
  }
  if (command === 'select_dsh_connection')
    config = { ...config, active_connection_id: String(args.id) }
  if (command === 'rename_managed_dsh_connection')
    config = { ...config, managed_connection_name: String(args.name) }
  if (command === 'update_dsh_connection')
    config = { ...config, connections: config.connections.map(item => item.id === args.id ? { ...item, name: String(args.name), url: String(args.url) } : item) }
  if (command === 'set_dsh_connection_connected')
    config = { ...config, connected_connection_ids: args.connected ? [...new Set([...config.connected_connection_ids, String(args.id)])] : config.connected_connection_ids.filter(id => id !== args.id) }
  if (command === 'remove_dsh_connection')
    config = { ...config, connections: config.connections.filter(item => item.id !== args.id), connected_connection_ids: config.connected_connection_ids.filter(id => id !== args.id) }
  if (command === 'add_dsh_connection') {
    const id = crypto.randomUUID()
    config = { ...config, connections: [...config.connections, { id, name: String(args.name), url: String(args.url) }], connected_connection_ids: [...config.connected_connection_ids, id] }
  }
  return config
})
