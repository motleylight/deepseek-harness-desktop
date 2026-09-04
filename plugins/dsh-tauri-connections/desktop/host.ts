import type { ConnectionEditorTarget } from './editor'
import type { ConnectionStatus, DesktopConnectionHost, DshConnection } from './types'
import { createContext, use } from 'react'

export interface ConnectionRuntime extends DesktopConnectionHost {
  editConnection: (target: ConnectionEditorTarget) => void
  deleteConnection: (connection: DshConnection) => void
  available: boolean
  setAvailable: (value: boolean) => void
  statuses: Record<string, ConnectionStatus>
  setStatus: (id: string, status: ConnectionStatus | null) => void
  t: (key: string, values?: Record<string, unknown>) => string
}

export const Context = createContext<ConnectionRuntime | null>(null)

/** Reads Desktop capabilities explicitly supplied to the plugin's desktop entry. */
export function useConnectionHost() {
  const value = use(Context)
  if (!value)
    throw new Error('DSH_CONNECTIONS_HOST_MISSING')
  return value
}
