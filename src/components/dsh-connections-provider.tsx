import type { PropsWithChildren } from 'react'
import { DshConnectionsProvider } from 'dsh-tauri-connections/desktop'
import { useTranslation } from 'react-i18next'
import { useStore } from 'valtio-define'
import { queryClient } from '@/config/client'
import { useAppConfig } from '@/hooks/use-app-config'
import { store } from '@/store'
import { writeClipboardText } from '@/utils/clipboard'

/** 向 DSH 插件的 Desktop 入口提供应用配置和本机进程能力。 */
export function DesktopConnectionsProvider({ children }: PropsWithChildren) {
  const { data: config } = useAppConfig()
  const { t, i18n } = useTranslation()
  const { serviceUrl, serviceRunning, busyAction } = useStore(store.harness)
  return (
    <DshConnectionsProvider host={{
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
    </DshConnectionsProvider>
  )
}
