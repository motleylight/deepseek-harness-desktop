import type { ConnectionsConfig, DshConnection } from './types'
import { Ellipsis, Plus } from '@gravity-ui/icons'
import { Button, Chip, Description, Dropdown, Label, Switch } from '@heroui/react'
import { invoke } from '@tauri-apps/api/core'
import { useState } from 'react'
import { If } from 'react-if-lite'
import { useConnectionHost } from './host'

/** One connection list owns both the state display and management actions in Application. */
export function DshConnectionPanel() {
  const host = useConnectionHost()
  const { config, t, statuses, available, updateConfig } = host
  const { editConnection: setEditor, deleteConnection: setDeleting } = host
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const managed: DshConnection = { id: 'managed-local', name: config?.managed_connection_name || t('connections.managed_label'), url: host.serviceUrl }
  const rows = [managed, ...(config?.connections ?? [])]

  async function toggle(connection: DshConnection, connected: boolean) {
    if (busy)
      return
    setBusy(connection.id)
    setError('')
    try {
      updateConfig(await invoke<ConnectionsConfig>('set_dsh_connection_connected', { id: connection.id, connected }))
    }
    catch (reason) {
      console.error('[dsh-tauri-connections] connection selection failed:', reason)
      setError(t('connections.selection_failed'))
    }
    finally { setBusy(null) }
  }

  async function copy(connection: DshConnection) {
    try {
      await host.copyText(connection.url)
      setNotice(t('connections.copied'))
    }
    catch { setError(t('connections.action_failed')) }
  }

  return (
    <section className="space-y-3" aria-label={t('connections.title')}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink">{t('connections.title')}</span>
        <Button size="sm" variant="tertiary" onPress={() => setEditor({ kind: 'add' })} isDisabled={busy !== null}>
          <Plus />
          {t('connections.add')}
        </Button>
      </div>
      <Description>{t('connections.description')}</Description>
      {rows.map((connection) => {
        const isManaged = connection.id === 'managed-local'
        const connected = isManaged || Boolean(config?.connected_connection_ids.includes(connection.id))
        const status = statuses[connection.id]
        const stateKey = isManaged
          ? (host.serviceRunning ? 'connections.running' : 'connections.stopped')
          : !connected ? 'connections.disconnected' : status?.state === 'connected' ? 'connections.connected' : status?.state === 'error' ? 'connections.unavailable' : 'connections.checking'
        const color = isManaged ? (host.serviceRunning ? 'success' : 'default') : connected && status?.state === 'connected' ? 'success' : status?.state === 'error' ? 'danger' : 'default'
        return (
          <div key={connection.id} className="space-y-2 rounded-md border border-line p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Label>{connection.name}</Label>
                  <Chip size="sm" variant="soft" color={color}>{t(stateKey)}</Chip>
                </div>
                <div className="mt-1 break-all font-mono text-xs text-muted">{connection.url}</div>
              </div>
              <Dropdown>
                <Button isIconOnly size="sm" variant="ghost" aria-label={`${connection.name} ${t('connections.manage')}`} isDisabled={busy !== null}><Ellipsis /></Button>
                <Dropdown.Popover className="rounded-md">
                  <Dropdown.Menu>
                    <Dropdown.Item id="rename" textValue={t('connections.rename')} onAction={() => setEditor({ kind: 'rename', connection })}><Label>{t('connections.rename')}</Label></Dropdown.Item>
                    <Dropdown.Item id="copy" textValue={t('connections.copy_address')} onAction={() => { void copy(connection) }}><Label>{t('connections.copy_address')}</Label></Dropdown.Item>
                    {['edit', 'delete'].filter(() => !isManaged).map(action => (
                      <Dropdown.Item key={action} id={action} textValue={t(action === 'edit' ? 'connections.edit_address' : 'connections.delete')} onAction={() => action === 'edit' ? setEditor({ kind: 'edit', connection }) : setDeleting(connection)}>
                        <Label className={action === 'delete' ? 'text-danger' : ''}>{t(action === 'edit' ? 'connections.edit_address' : 'connections.delete')}</Label>
                      </Dropdown.Item>
                    ))}
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown>
            </div>
            <If cond={isManaged}>
              <Description>{t('connections.managed')}</Description>
              <div className="flex flex-wrap gap-2">
                <If cond={host.serviceRunning} else={<Button size="sm" variant="tertiary" onPress={host.start} isDisabled={host.serviceBusy}>{t('connections.start')}</Button>}>
                  <Button size="sm" variant="tertiary" onPress={host.restart} isDisabled={host.serviceBusy}>{t('connections.restart')}</Button>
                  <Button size="sm" variant="danger" onPress={host.shutdown} isDisabled={host.serviceBusy}>{t('connections.stop')}</Button>
                </If>
              </div>
            </If>
            <If cond={!isManaged}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Description>
                  {status?.state === 'connected' && connected
                    ? `${status.workspaces ?? 0} ${t('connections.workspaces_count')} · ${status.sessions ?? 0} ${t('connections.sessions_count')}`
                    : t('connections.no_native_access')}
                </Description>
                <Switch isSelected={connected} isDisabled={busy !== null} onChange={(value) => { void toggle(connection, value) }} aria-label={`${connection.name} ${t('connections.show')}`}>
                  <Switch.Content>
                    <Switch.Control><Switch.Thumb /></Switch.Control>
                    <Label>{t('connections.show')}</Label>
                  </Switch.Content>
                </Switch>
              </div>
              <If cond={connected && status?.state === 'error'}><Description className="break-words text-danger">{status?.message}</Description></If>
            </If>
          </div>
        )
      })}
      <If cond={!available && host.serviceRunning}><Description>{t('connections.plugin_inactive')}</Description></If>
      <Description>{t('connections.external_notice')}</Description>
      <If cond={Boolean(notice)}><p role="status" className="text-xs text-muted">{notice}</p></If>
      <If cond={Boolean(error)}><p role="alert" className="text-sm text-danger">{error}</p></If>
    </section>
  )
}
