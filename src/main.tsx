import { OverlaysProvider } from '@overlastic/react'
import { QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { DesktopConnectionsProvider } from './components/dsh-connections-provider'
import { ToastProvider } from './components/toast-provider'
import { queryClient } from './config/client'
import { App } from './layout'
import '@/utils/logger'
import './style/main.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <OverlaysProvider>
          <DesktopConnectionsProvider><App /></DesktopConnectionsProvider>
        </OverlaysProvider>
      </ToastProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
