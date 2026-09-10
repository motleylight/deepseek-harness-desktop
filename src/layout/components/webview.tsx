import { DshWorkspaces, MANAGED_CONNECTION_ID, useDshConnectionSelection } from 'dsh-tauri-connections/desktop'
import { useRef } from 'react'
import { If } from 'react-if-lite'
import { useStore } from 'valtio-define'
import { PluginRecovery } from '@/components/plugin-recovery'
import { useAppConfig } from '@/hooks/use-app-config'
import { useDesktopZoom } from '@/hooks/use-desktop-zoom'
import { useIframeInvoke } from '@/hooks/use-iframe-invoke'
import { useIframeShim } from '@/hooks/use-iframe-shim'
import { store } from '@/store'
import { Navbar } from './navbar'
import { PreinstallSetup } from './preinstall-setup'
import { Setup } from './setup'

/**
 * 主区域视图：壳层导航栏（Navbar）常驻顶部，
 * 安装/错误态渲染 Setup，就绪态渲染 iframe
 * （挂载后加载职责交给 dsh 应用内官方 boot 页，避免两套 loading 叠加）。
 * 状态与方法全部来自 harness store，不再接收 props。
 */
export function Webview() {
  const {
    status,
    serviceHealthy,
    iframeError,
    iframeKey,
    iframeSrc,
    serviceUrl,
    recovery,
  } = useStore(store.harness)

  const iframeRef = useRef<HTMLIFrameElement>(null)
  const { data: config } = useAppConfig()
  const { selectedConnectionId, selectConnection } = useDshConnectionSelection()

  useDesktopZoom(iframeRef)
  useIframeShim(iframeRef, true)
  useIframeInvoke(iframeRef)

  if (status === 'error') {
    return (
      <main className="relative flex min-h-0 flex-1 flex-col bg-canvas">
        <Navbar />
        <div className="min-h-0 flex-1">
          {/* 能定位到问题插件时展示全屏恢复页（卸除此插件并继续检测）；否则普通错误页 */}
          <If cond={recovery.required} else={<Setup />}>
            <PluginRecovery fullScreen />
          </If>
        </div>
      </main>
    )
  }

  // 预装插件引导：独立于安装/加载界面，渲染推荐插件列表与安装控制台
  if (status === 'preinstall') {
    return (
      <main className="relative flex min-h-0 w-full flex-col bg-canvas">
        <Navbar />
        <div className="min-h-0 flex-1">
          <PreinstallSetup />
        </div>
      </main>
    )
  }

  if (status !== 'ready') {
    return (
      <main className="relative flex min-h-0 w-full flex-col bg-canvas">
        <Navbar />
        <div className="min-h-0 flex-1">
          <Setup />
        </div>
      </main>
    )
  }

  return (
    <main className="relative flex min-h-0 flex-1 flex-col bg-canvas">
      <Navbar iframeRef={selectedConnectionId === MANAGED_CONNECTION_ID ? iframeRef : undefined} />
      <DshWorkspaces
        config={config}
        selectedConnectionId={selectedConnectionId}
        onSelectConnection={selectConnection}
        managedIframeRef={iframeRef}
        managedIframeSrc={iframeSrc}
        managedIframeKey={iframeKey}
        managedHealthy={serviceHealthy}
        managedIframeError={iframeError}
        managedServiceUrl={serviceUrl}
        onManagedIframeLoad={store.harness.markIframeLoaded}
        onManagedIframeError={store.harness.markIframeError}
        onManagedRetry={store.harness.refreshIframe}
      />
    </main>
  )
}
