import type { ReactNode } from 'react'
import type { DshConnection } from './types'
import { ArrowRotateRight, Ellipsis, Play, Plus, Power } from '@gravity-ui/icons'
import { Button, Chip, Description, Dropdown, Label, Spinner, Switch } from '@heroui/react'
import { useState } from 'react'
import { If } from 'react-if-lite'
import { useConnectionHost } from './host'

/** One connection list owns both the state display and management actions in Application. */
export function DshConnectionPanel({ managedDetails }: { managedDetails?: ReactNode }) {
  const host = useConnectionHost()
  const { config, t, statuses, available, mutateConnection } = host
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
      await mutateConnection('set_dsh_connection_connected', { id: connection.id, connected })
    }
    catch (reason) {
      console.error('[dsh-tauri-connections] connection selection failed:', reason)
      setError(t('connections.selection_failed'))
    }
    finally { setBusy(null) }
  }

  async function copy(connection: DshConnection) {
    try {
      await host.copyText(connection.displayUrl || connection.url)
      setNotice(t('connections.copied'))
    }
    catch { setError(t('connections.action_failed')) }
  }

  return (
    <section className="space-y-3" aria-label={t('connections.title')}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink">{t('connections.title')}</span>
        <div className="flex gap-2">
          {host.extension?.addAction}
          <Button size="sm" variant="tertiary" onPress={() => setEditor({ kind: 'add' })} isDisabled={busy !== null}>
            <Plus />
            {t('connections.add')}
          </Button>
        </div>
      </div>
      <Description>{t('connections.description')}</Description>
      {rows.map((connection) => {
        const isManaged = connection.id === 'managed-local'
        const connected = isManaged || (connection.transport === 'ssh' ? Boolean(connection.enabled) : Boolean(config?.connected_connection_ids.includes(connection.id)))
        const status = statuses[connection.id]
        const stateKey = isManaged
          ? (host.serviceRunning ? 'connections.running' : 'connections.stopped')
          : !connected ? 'connections.disconnected' : status?.state === 'connected' ? 'connections.connected' : status?.state === 'error' ? 'connections.unavailable' : 'connections.checking'
        const color = isManaged ? (host.serviceRunning ? 'success' : 'default') : connected && status?.state === 'connected' ? 'success' : status?.state === 'error' ? 'danger' : 'default'
        return (
          <section key={connection.id} aria-label={connection.name} className="space-y-2 rounded-md border border-line p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Label>{connection.name}</Label>
                  <Chip size="sm" variant="soft" color={color}>{t(stateKey)}</Chip>
                </div>
                <div className="mt-1 break-all font-mono text-xs text-muted">{connection.displayUrl || connection.url}</div>
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
              <div className="flex items-center gap-2">
                <If
                  cond={host.serviceRunning}
                  else={(
                    <Button size="sm" variant="tertiary" className="flex-1 rounded-md" onPress={host.start} isDisabled={host.serviceBusy}>
                      <Play className="size-3.5" />
                      {t('connections.start')}
                    </Button>
                  )}
                >
                  <Button size="sm" variant="tertiary" className="flex-1 rounded-md" onPress={host.restart} isDisabled={host.serviceBusy}>
                    <If cond={host.serviceAction === 'restart'} then={<Spinner size="sm" color="current" />} else={<ArrowRotateRight className="size-3.5" />} />
                    {t('connections.restart')}
                  </Button>
                  <Button size="sm" variant="danger" className="flex-1 rounded-md" onPress={host.shutdown} isDisabled={host.serviceBusy}>
                    <If cond={host.serviceAction === 'shutdown'} then={<Spinner size="sm" color="current" />} else={<Power className="size-3.5" />} />
                    {t('connections.stop')}
                  </Button>
                </If>
              </div>
              {managedDetails}
            </If>
            <If cond={!isManaged}>
              <dl className="space-y-1 text-xs">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">{t(connection.transport === 'ssh' ? 'connections.dsh_version' : 'connections.reported_version')}</dt>
                  <dd className="font-mono">{connection.version || (connected ? status?.version : undefined) || t('connections.not_reported')}</dd>
                </div>
                <If cond={Boolean(connection.dataDirectory)}>
                  <div className="flex justify-between gap-3">
                    <dt className="shrink-0 text-muted">{t('connections.data_directory')}</dt>
                    <dd className="break-all font-mono">{connection.dataDirectory}</dd>
                  </div>
                </If>
              </dl>
              <Description>{t(connection.transport === 'ssh' ? 'connections.ssh_info_source' : 'connections.http_info_source')}</Description>
              {host.extension?.renderActions?.(connection)}
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
          </section>
        )
      })}
      <If cond={!available && host.serviceRunning}><Description>{t('connections.plugin_inactive')}</Description></If>
      <Description>{t('connections.external_notice')}</Description>
      <If cond={Boolean(notice)}><p role="status" className="text-xs text-muted">{notice}</p></If>
      <If cond={Boolean(error)}><p role="alert" className="text-sm text-danger">{error}</p></If>
    </section>
  )
}
