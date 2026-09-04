import type { PropsWithChildren } from 'react'
import { OverlaysProvider } from '@overlastic/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/config/client'
import { DesktopConnectionsProvider } from './dsh-connections-provider'
import { ToastProvider } from './toast-provider'

/** Application state shared by the workspace and imperative settings dialogs. */
export function AppProviders({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <DesktopConnectionsProvider>
          <OverlaysProvider>{children}</OverlaysProvider>
        </DesktopConnectionsProvider>
      </ToastProvider>
    </QueryClientProvider>
  )
}
