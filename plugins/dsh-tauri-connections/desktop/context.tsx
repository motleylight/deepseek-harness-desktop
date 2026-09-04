import type { PropsWithChildren } from 'react'
import type { ConnectionEditorTarget } from './editor'
import type { ConnectionStatus, DesktopConnectionHost, DshConnection } from './types'
import { useState } from 'react'
import { If } from 'react-if-lite'
import en from '../locales/en-US.json'
import zh from '../locales/zh-CN.json'
import { ConnectionDeleteDialog } from './delete-dialog'
import { ConnectionEditor } from './editor'

import { Context } from './host'

/** Shares live endpoint state between the embedded workspaces and Application settings. */
export function DshConnectionsProvider({ host, children }: PropsWithChildren<{ host: DesktopConnectionHost }>) {
  const [editor, setEditor] = useState<ConnectionEditorTarget | null>(null)
  const [deleting, setDeleting] = useState<DshConnection | null>(null)
  const [available, setAvailable] = useState(false)
  const [statuses, setStatuses] = useState<Record<string, ConnectionStatus>>({})
  function setStatus(id: string, status: ConnectionStatus | null) {
    setStatuses((current) => {
      const next = { ...current }
      if (status)
        next[id] = status
      else
        delete next[id]
      return next
    })
  }
  function t(key: string, values?: Record<string, unknown>) {
    const messages: Record<string, string> = host.locale.startsWith('zh') ? zh : en
    return messages[key] ?? host.translate(key, values)
  }
  return (
    <Context value={{ ...host, available, setAvailable, statuses, setStatus, t, editConnection: setEditor, deleteConnection: setDeleting }}>
      {children}
      <If cond={editor !== null}><ConnectionEditor key={editor?.kind === 'add' ? 'add' : editor?.connection.id} target={editor!} onClose={() => setEditor(null)} /></If>
      <If cond={deleting !== null}><ConnectionDeleteDialog connection={deleting!} onClose={() => setDeleting(null)} /></If>
    </Context>
  )
}
