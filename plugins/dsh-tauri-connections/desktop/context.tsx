import type { PropsWithChildren } from 'react'
import type { ConnectionEditorTarget } from './editor'
import type { ConnectionsConfig, ConnectionStatus, DesktopConnectionHost, DshConnection } from './types'
import { invoke } from '@tauri-apps/api/core'
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
  function editConnection(target: ConnectionEditorTarget) {
    if (target.kind !== 'add' && target.connection.transport === 'ssh' && host.extension)
      host.extension.edit(target.connection, target.kind === 'rename')
    else
      setEditor(target)
  }
  async function mutateConnection(command: string, args: Record<string, unknown>) {
    const connection = host.config?.connections.find(item => item.id === args.id)
    if (connection?.transport === 'ssh' && host.extension)
      await host.extension.mutate(command, args)
    else
      host.updateConfig(await invoke<ConnectionsConfig>(command, args))
  }
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
    const message = messages[key]
    return message === undefined ? host.translate(key, values) : message.replace(/\{(\w+)\}/g, (token, name) => values?.[name] === undefined ? token : String(values[name]))
  }
  return (
    <Context value={{ ...host, available, setAvailable, statuses, setStatus, t, editConnection, mutateConnection, deleteConnection: setDeleting }}>
      {children}
      <If cond={editor !== null}><ConnectionEditor key={editor?.kind === 'add' ? 'add' : editor?.connection.id} target={editor!} onClose={() => setEditor(null)} /></If>
      <If cond={deleting !== null}><ConnectionDeleteDialog connection={deleting!} onClose={() => setDeleting(null)} /></If>
    </Context>
  )
}
