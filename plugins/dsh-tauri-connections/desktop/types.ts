/** Saved endpoint. Desktop never owns an external DSH process. */
export interface DshConnection {
  id: string
  name: string
  url: string
}

/** Persisted connection fields shared with Desktop's configuration store. */
export interface ConnectionsConfig {
  connections: DshConnection[]
  managed_connection_name: string | null
  connected_connection_ids: string[]
  active_connection_id: string
}

export interface ConnectionStatus {
  state: 'checking' | 'connected' | 'error'
  message?: string
  workspaces?: number
  sessions?: number
}

export interface DesktopConnectionHost {
  config: ConnectionsConfig | undefined
  updateConfig: (config: ConnectionsConfig) => void
  translate: (key: string, values?: Record<string, unknown>) => string
  locale: string
  copyText: (text: string) => Promise<void>
  serviceUrl: string
  serviceRunning: boolean
  serviceBusy: boolean
  restart: () => void
  shutdown: () => void
  start: () => void
}
