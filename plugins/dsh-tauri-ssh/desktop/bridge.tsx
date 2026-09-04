import type { DesktopConnectionHost, DshConnection } from 'dsh-tauri-connections/desktop'
import type { PropsWithChildren } from 'react'
import { Button } from '@heroui/react'
import { DshConnectionsProvider } from 'dsh-tauri-connections/desktop'
import { If } from 'react-if-lite'
import { useSsh } from './context'
import { SshActions } from './operations'

export function SshConnectionsBridge({ host, children }: PropsWithChildren<{ host: DesktopConnectionHost }>) {
  const ssh = useSsh()
  const rows: DshConnection[] = ssh.records.map(record => ({ id: record.id, name: record.name, transport: 'ssh', enabled: record.enabled, url: record.url || 'about:blank', displayUrl: `ssh://${record.user ? `${record.user}@` : ''}${record.host}${record.port ? `:${record.port}` : ''}` }))
  const config = host.config
    ? {
        ...host.config,
        connections: [...host.config.connections, ...rows],
        connected_connection_ids: [...host.config.connected_connection_ids, ...ssh.records.filter(record => record.enabled && record.state === 'connected').map(record => record.id)],
      }
    : undefined
  async function mutate(command: string, args: Record<string, unknown>) {
    const record = ssh.records.find(item => item.id === args.id)
    if (!record)
      throw new Error('SSH_CONNECTION_NOT_FOUND')
    if (command === 'select_dsh_connection')
      return
    if (command === 'remove_dsh_connection')
      await ssh.request('remove', { id: record.id })
    else if (command === 'set_dsh_connection_connected')
      await ssh.request('enable', { id: record.id, enabled: args.connected })
    else
      throw new Error('SSH_CONNECTION_ACTION_INVALID')
  }
  return (
    <DshConnectionsProvider host={{ ...host, config, extension: {
      mutate,
      edit: (connection, renameOnly) => ssh.edit(ssh.records.find(item => item.id === connection.id), renameOnly),
      addAction: (
        <div>
          <Button size="sm" variant="tertiary" onPress={() => ssh.edit()} isDisabled={Boolean(ssh.error)}>{ssh.t('ssh.add')}</Button>
          <If cond={Boolean(ssh.error)}>
            <p role="alert" className="max-w-xs break-words text-xs text-danger">
              {ssh.t('ssh.unavailable')}
              {' '}
              {ssh.error}
            </p>
          </If>
        </div>
      ),
      renderActions: (connection) => {
        const record = ssh.records.find(item => item.id === connection.id)
        return record ? <SshActions record={record} /> : null
      },
    } }}
    >
      {children}
    </DshConnectionsProvider>
  )
}
