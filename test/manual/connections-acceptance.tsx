/* eslint-disable react-refresh/only-export-components -- Standalone manual acceptance entry. */
import type { ConnectionsConfig } from '../../plugins/dsh-tauri-connections/desktop'
import { mockIPC } from '@tauri-apps/api/mocks'
import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DshConnectionPanel, DshConnectionsProvider, DshWorkspaces, useDshConnectionSelection } from '../../plugins/dsh-tauri-connections/desktop'
import '../../src/style/main.css'

// Manual browser harness: real DSH client modules, in-memory native configuration adapter.
let config: ConnectionsConfig = { connections: [{ id: 'external', name: '测试环境', url: 'http://127.0.0.1:3183' }], connected_connection_ids: ['external'], managed_connection_name: '开发环境', active_connection_id: 'managed-local' }
mockIPC(async (command, payload) => {
  const args = payload as Record<string, unknown>
  if (command === 'probe_dsh_connection') {
    if (!String(args.url).includes(':3183'))
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

function Workspaces({ config }: { config: ConnectionsConfig }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const { selectedConnectionId, selectConnection } = useDshConnectionSelection()
  return <DshWorkspaces config={config} selectedConnectionId={selectedConnectionId} onSelectConnection={selectConnection} managedIframeRef={ref} managedIframeSrc="http://127.0.0.1:3181/?dsh-desktop-managed=1" managedIframeKey={0} managedHealthy managedIframeError={false} managedServiceUrl="http://127.0.0.1:3181" onManagedIframeLoad={() => {}} onManagedIframeError={() => {}} onManagedRetry={() => {}} />
}
function App() {
  const [value, setValue] = useState(config)
  const [settings, setSettings] = useState(false)
  return (
    <DshConnectionsProvider host={{ config: value, updateConfig: setValue, translate: key => key === 'buttons.cancel' ? '取消' : key, locale: 'zh-CN', copyText: text => navigator.clipboard.writeText(text), serviceUrl: 'http://127.0.0.1:3181', serviceRunning: true, serviceBusy: false, start() {}, shutdown() {}, restart() {} }}>
      <main className="flex h-screen flex-col bg-canvas">
        <div className="flex h-10 shrink-0 items-center justify-between px-4 text-sm">
          <span>实际 DSH 插件验收 · 原生配置使用测试适配器</span>
          <button onClick={() => setSettings(!settings)}>配置 · 应用</button>
        </div>
        <Workspaces config={value} />
        {settings && <div className="absolute right-4 top-12 z-50 max-h-[85vh] w-[500px] overflow-auto rounded-xl border border-line bg-canvas p-5 shadow-xl"><DshConnectionPanel /></div>}
      </main>
    </DshConnectionsProvider>
  )
}
createRoot(document.getElementById('root')!).render(<App />)
