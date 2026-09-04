import { useState } from 'react'
import { useConnectionHost } from './host'
import { MANAGED_CONNECTION_ID } from './workspaces'

/** Keeps view selection separate from the set of mounted connections. */
export function useDshConnectionSelection() {
  const { config, mutateConnection } = useConnectionHost()
  const [requested, setRequested] = useState<string>()
  function connected(id: string | undefined) {
    return id === MANAGED_CONNECTION_ID || Boolean(id && config?.connected_connection_ids.includes(id))
  }
  const saved = config?.active_connection_id
  const selectedConnectionId = requested && connected(requested) ? requested : saved && connected(saved) ? saved : MANAGED_CONNECTION_ID
  function selectConnection(id: string) {
    if (!connected(id))
      return
    setRequested(id)
    void mutateConnection('select_dsh_connection', { id }).catch((error) => {
      console.error('[dsh-tauri-connections] selection failed:', error)
    })
  }
  return { selectedConnectionId, selectConnection }
}
