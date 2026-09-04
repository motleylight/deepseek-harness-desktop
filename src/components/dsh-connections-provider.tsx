import type { PropsWithChildren } from 'react'
import { SshConnectionsBridge, SshProvider } from 'dsh-tauri-ssh/desktop'
import { useTranslation } from 'react-i18next'
import { useStore } from 'valtio-define'
import { queryClient } from '@/config/client'
import { useAppConfig } from '@/hooks/use-app-config'
import { store } from '@/store'
import { writeClipboardText } from '@/utils/clipboard'

/** 向 DSH 插件的 Desktop 入口提供应用配置和本机进程能力。 */
export function DesktopConnectionsProvider({ children }: PropsWithChildren) {
  const { i18n } = useTranslation()
  return <SshProvider locale={i18n.language}><ConnectionsHost>{children}</ConnectionsHost></SshProvider>
}

function ConnectionsHost({ children }: PropsWithChildren) {
  const { data: config } = useAppConfig()
  const { t, i18n } = useTranslation()
  const { serviceUrl, serviceRunning, busyAction } = useStore(store.harness)
  return (
    <SshConnectionsBridge host={{
      config,
      updateConfig: value => queryClient.setQueryData(['config'], value),
      translate: (key, values) => t(key, values),
      locale: i18n.language,
      copyText: writeClipboardText,
      serviceUrl,
      serviceRunning,
      serviceBusy: busyAction !== null,
      restart: () => { void store.harness.restart() },
      shutdown: () => { void store.harness.shutdown() },
      start: () => { void store.harness.start() },
    }}
    >
      {children}
    </SshConnectionsBridge>
  )
}
