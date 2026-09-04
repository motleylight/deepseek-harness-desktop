export interface RemoteStatus {
  installed: boolean
  running: boolean
  version?: string
  data?: string
  root?: string
  port?: number
  runtimeMissing?: boolean
  existingData?: boolean
  existingBin?: string
  foreignPids?: number[]
  recovery?: { version: string, at: string, backup: string }
  failure?: string
}
export interface SshRecord {
  id: string
  name: string
  host: string
  user: string
  port?: number
  enabled: boolean
  state: 'disconnected' | 'connecting' | 'connected' | 'error'
  url?: string
  busy?: string
  error?: string
  logs: string[]
  status?: RemoteStatus
}
export interface RemotePlugin { id: string, version: string, description: string, enabled: boolean, disabled: boolean, protected: boolean }
