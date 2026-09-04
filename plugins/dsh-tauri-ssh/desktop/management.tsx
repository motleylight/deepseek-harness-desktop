import type { PropsWithChildren } from 'react'
import type { RemotePlugin, SshRecord } from './types'
import { Button, Description, Input } from '@heroui/react'
import { useEffect, useRef, useState } from 'react'
import { If } from 'react-if-lite'
import { useSsh } from './context'
import { RemoteAction, SshActions } from './operations'

export function SshManagement({ kind, children }: PropsWithChildren<{ kind: 'core' | 'plugins' }>) {
  const { records, managementId, setManagementId, t } = useSsh()
  const record = records.find(item => item.id === managementId)
  return (
    <div className="space-y-4">
      <If cond={records.length > 0}>
        <label className="flex items-center gap-3 text-sm text-ink">
          <span>{t('ssh.target')}</span>
          <select className="min-w-0 flex-1 rounded-md border border-line bg-canvas p-2" value={managementId} onChange={event => setManagementId(event.target.value)}>
            <option value="managed-local">{t('ssh.local')}</option>
            {records.map(item => (
              <option key={item.id} value={item.id}>
                {item.name}
                {' '}
                ·
                {' '}
                {item.host}
              </option>
            ))}
          </select>
        </label>
      </If>
      <If cond={Boolean(record)} else={children}>
        <RemoteManagement key={`${managementId}:${kind}`} record={record!} kind={kind} />
      </If>
    </div>
  )
}

function RemoteManagement({ record, kind }: { record: SshRecord, kind: 'core' | 'plugins' }) {
  const { request, t } = useSsh()
  const requestRef = useRef(request)
  requestRef.current = request
  const [versions, setVersions] = useState<string[]>([])
  const [version, setVersion] = useState('')
  const [plugins, setPlugins] = useState<RemotePlugin[]>([])
  const [spec, setSpec] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  async function refresh() {
    setLoading(true)
    setError('')
    try {
      if (kind === 'plugins') {
        setPlugins(await request<RemotePlugin[]>('operation', { id: record.id, request: { action: 'plugins' } }))
      }
      else {
        const result = await request<{ versions: string[], latest: string }>('operation', { id: record.id, request: { action: 'versions' } })
        setVersions(result.versions)
        setVersion(result.latest)
      }
    }
    catch (reason) { setError(String(reason)) }
    finally { setLoading(false) }
  }
  useEffect(() => {
    let disposed = false
    void requestRef.current('operation', { id: record.id, request: { action: 'status' } }).catch((reason) => {
      if (!disposed)
        setError(String(reason))
    })
    return () => {
      disposed = true
    }
  }, [record.id])
  return (
    <section className="space-y-4">
      <h3 className="text-sm font-medium">
        {t(kind === 'core' ? 'ssh.core' : 'ssh.plugins')}
        {' '}
        ·
        {' '}
        {record.name}
      </h3>
      <SshActions record={record} />
      <If cond={Boolean(record.status?.installed)}>
        <div className="space-y-1 break-all text-xs text-muted">
          <div>
            {t('ssh.current')}
            ：
            {record.status?.version}
          </div>
          <div>
            {t('ssh.path')}
            ：
            {record.status?.root}
          </div>
          <div>
            {t('ssh.data')}
            ：
            {record.status?.data}
          </div>
        </div>
        <Button size="sm" variant="tertiary" onPress={refresh} isPending={loading} isDisabled={Boolean(record.busy)}>{t(kind === 'core' ? 'ssh.fetch_versions' : 'ssh.refresh')}</Button>
        <If cond={kind === 'core'}>
          <label className="block space-y-1 text-sm">
            <span>{t('ssh.version')}</span>
            <Input value={version} onChange={event => setVersion(event.target.value)} list="ssh-core-versions" disabled={Boolean(record.busy)} />
          </label>
          <datalist id="ssh-core-versions">{versions.map(item => <option key={item} value={item} />)}</datalist>
          <If cond={Boolean(version)}><RemoteAction record={record} action="upgrade" label={t('ssh.upgrade')} params={{ version }} /></If>
          <If cond={Boolean(record.status?.recovery)}>
            <Description>
              {record.status?.recovery?.at}
              {' '}
              ·
              {' '}
              {record.status?.recovery?.version}
            </Description>
            <RemoteAction record={record} action="restore" label={t('ssh.restore')} />
          </If>
        </If>
        <If cond={kind === 'plugins'}>
          <label className="block space-y-1 text-sm">
            <span>{t('ssh.plugin_spec')}</span>
            <Input value={spec} onChange={event => setSpec(event.target.value)} disabled={Boolean(record.busy)} />
          </label>
          <If cond={Boolean(spec.trim())}><RemoteAction record={record} action="plugin-add" label={t('ssh.plugin_add')} params={{ spec }} onDone={() => { void refresh() }} /></If>
          {plugins.map(plugin => (
            <div key={plugin.id} className="space-y-2 rounded-md border border-line p-3">
              <div className="break-all text-sm">
                {plugin.id}
                {' '}
                ·
                {' '}
                {plugin.version}
              </div>
              <Description>{plugin.description}</Description>
              <If
                cond={plugin.protected}
                else={(
                  <div className="flex flex-wrap gap-2">
                    {['update', plugin.enabled ? 'disable' : 'enable', 'remove'].map(action => <RemoteAction key={action} record={record} action={`plugin-${action}`} label={t(`ssh.plugin_${action}`)} params={{ id: plugin.id }} onDone={() => { void refresh() }} />)}
                  </div>
                )}
              >
                <Description>{t('ssh.protected')}</Description>
              </If>
            </div>
          ))}
        </If>
      </If>
      <If cond={Boolean(error)}><p role="alert" className="break-words text-sm text-danger">{error}</p></If>
    </section>
  )
}
