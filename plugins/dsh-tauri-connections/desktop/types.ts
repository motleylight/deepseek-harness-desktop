/** Saved endpoint. Desktop never owns an external DSH process. */
export interface DshConnection {
  id: string
  name: string
  url: string
  displayUrl?: string
  transport?: 'ssh'
  enabled?: boolean
  version?: string
  dataDirectory?: string
}

export interface ConnectionExtension {
  mutate: (command: string, args: Record<string, unknown>) => Promise<void>
  edit: (connection: DshConnection, renameOnly: boolean) => void
  addAction?: import('react').ReactNode
  renderActions?: (connection: DshConnection) => import('react').ReactNode
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
  version?: string
}

export interface DesktopConnectionHost {
  extension?: ConnectionExtension
  config: ConnectionsConfig | undefined
  updateConfig: (config: ConnectionsConfig) => void
  translate: (key: string, values?: Record<string, unknown>) => string
  locale: string
  copyText: (text: string) => Promise<void>
  serviceUrl: string
  serviceRunning: boolean
  serviceBusy: boolean
  serviceAction?: string | null
  restart: () => void
  shutdown: () => void
  start: () => void
}
