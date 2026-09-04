/* eslint-disable react-refresh/only-export-components -- Standalone manual acceptance entry. */
import { useOverlay } from '@overlastic/react'
import { useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { DshWorkspaces, useDshConnectionSelection } from '../../plugins/dsh-tauri-connections/desktop'
import { AppProviders } from '../../src/components/app-providers'
import { ConfigDialog } from '../../src/components/config-dialog'
import { useAppConfig } from '../../src/hooks/use-app-config'
import { useDshTheme } from '../../src/hooks/use-dsh-theme'
import { store } from '../../src/store'
import '../../src/style/main.css'

function Workspaces() {
  const { data: config } = useAppConfig()
  const ref = useRef<HTMLIFrameElement>(null)
  const { selectedConnectionId, selectConnection } = useDshConnectionSelection()
  return <DshWorkspaces config={config} selectedConnectionId={selectedConnectionId} onSelectConnection={selectConnection} managedIframeRef={ref} managedIframeSrc="http://127.0.0.1:3181/?dsh-desktop-managed=1" managedIframeKey={0} managedHealthy managedIframeError={false} managedServiceUrl="http://127.0.0.1:3181" onManagedIframeLoad={() => {}} onManagedIframeError={() => {}} onManagedRetry={() => {}} />
}
function App() {
  useDshTheme()
  const openSettings = useOverlay(ConfigDialog)
  return (
    <main className="flex h-screen flex-col bg-canvas">
      <div className="flex h-10 shrink-0 items-center justify-between px-4 text-sm">
        <span>实际 DSH 插件验收 · 原生配置使用测试适配器</span>
        <button onClick={() => { void openSettings().catch(() => {}) }}>配置 · 应用</button>
      </div>
      <Workspaces />
    </main>
  )
}
store.harness.serviceUrl = 'http://127.0.0.1:3181'
store.harness.serviceRunning = true
store.setting.language = 'zh-CN'
void import('../../src/i18n').then(() => {
  createRoot(document.getElementById('root')!).render(<AppProviders><App /></AppProviders>)
})
