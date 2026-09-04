/* eslint-disable react/dom-no-unsafe-iframe-sandbox */
import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { AppConfig, DshConnection } from '@/hooks/use-app-config'
import { CircleCheck, CircleExclamation, Folder } from '@gravity-ui/icons'
import { Button, Description } from '@heroui/react'
import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { If } from 'react-if-lite'
import { cn } from 'tailwind-variants'
import { Loadable } from './loadable'

export const MANAGED_CONNECTION_ID = 'managed-local'

type ExternalWorkspaceStatus = 'checking' | 'ready' | 'error'

interface ExternalWorkspaceState {
  url: string
  status: ExternalWorkspaceStatus
}

interface ExternalDshWorkspaceProps {
  connection: DshConnection
  selected: boolean
  onStatusChange: Dispatch<SetStateAction<Record<string, ExternalWorkspaceState>>>
}

export interface DshWorkspacesProps {
  config: AppConfig | undefined
  selectedConnectionId: string
  onSelectConnection: (id: string) => void
  managedIframeRef: RefObject<HTMLIFrameElement | null>
  managedIframeSrc: string
  managedIframeKey: number
  managedHealthy: boolean
  managedIframeError: boolean
  managedServiceUrl: string
  onManagedIframeLoad: () => void
  onManagedIframeError: () => void
  onManagedRetry: () => void
}

function timestampedIframeUrl(baseUrl: string) {
  const url = new URL(baseUrl)
  url.searchParams.set('t', Date.now().toString())
  return url.toString()
}

function ExternalDshWorkspace({ connection, selected, onStatusChange }: ExternalDshWorkspaceProps) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<ExternalWorkspaceStatus>('checking')
  const [error, setError] = useState('')
  const [iframeSrc, setIframeSrc] = useState('')
  const [probeVersion, setProbeVersion] = useState(0)

  function retry() {
    setStatus('checking')
    setError('')
    onStatusChange(current => ({
      ...current,
      [connection.id]: { url: connection.url, status: 'checking' },
    }))
    setProbeVersion(version => version + 1)
  }

  useEffect(() => {
    let disposed = false
    void invoke<string>('probe_dsh_connection', { url: connection.url })
      .then(() => {
        if (disposed)
          return
        setIframeSrc(timestampedIframeUrl(connection.url))
        setStatus('ready')
        onStatusChange(current => ({
          ...current,
          [connection.id]: { url: connection.url, status: 'ready' },
        }))
      })
      .catch((reason) => {
        if (disposed)
          return
        const message = String(reason)
        setError(message)
        setStatus('error')
        onStatusChange(current => ({
          ...current,
          [connection.id]: { url: connection.url, status: 'error' },
        }))
      })
    return () => {
      disposed = true
    }
  }, [connection.id, connection.url, onStatusChange, probeVersion])

  return (
    <div
      className={cn('absolute inset-0', { 'invisible pointer-events-none': !selected })}
      aria-hidden={!selected}
    >
      <If cond={status === 'checking'}>
        <Loadable subtitle={t('connections.checking')} />
      </If>
      <If cond={status === 'error'}>
        <Loadable
          icon={CircleExclamation}
          title={connection.name}
          errorMsg={error || t('connections.unavailable')}
          onRetry={retry}
        />
      </If>
      <If cond={status === 'ready'}>
        <iframe
          className="block h-full w-full border-none bg-load-bg"
          src={iframeSrc}
          allow="accelerometer; ambient-light-sensor; autoplay; battery; camera; clipboard-read; clipboard-write; display-capture; document-domain; encrypted-media; fullscreen; gamepad; geolocation; gyroscope; hid; idle-detection; keyboard-map; magnetometer; microphone; midi; payment; picture-in-picture; publickey-credentials-get; screen-wake-lock; serial; speaker-selection; usb; web-share; xr-spatial-tracking"
          sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-modals allow-downloads allow-storage-access-by-user-activation"
          title={connection.name}
        />
      </If>
    </div>
  )
}

interface WorkspaceTreeItemProps {
  id: string
  name: string
  url: string
  selected: boolean
  status: ExternalWorkspaceStatus | 'managed'
  onPress: (id: string) => void
}

function WorkspaceTreeItem({ id, name, url, selected, status, onPress }: WorkspaceTreeItemProps) {
  const { t } = useTranslation()
  function handlePress() {
    onPress(id)
  }

  return (
    <Button
      className={cn('h-auto w-full justify-start rounded-md px-2 py-1.5 text-left', {
        'bg-accent/12 text-accent': selected,
      })}
      variant="ghost"
      onPress={handlePress}
    >
      <Folder className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{name}</span>
        <span className="block truncate font-mono text-[10px] text-muted">{url}</span>
      </span>
      <If cond={status === 'managed'}>
        <CircleCheck className="size-3 shrink-0 text-success" aria-label={t('connections.connected')} />
      </If>
      <If cond={status === 'checking'}>
        <span className="size-2 shrink-0 rounded-full bg-warning" aria-label={t('connections.checking')} />
      </If>
      <If cond={status === 'ready'}>
        <CircleCheck className="size-3 shrink-0 text-success" aria-label={t('connections.connected')} />
      </If>
      <If cond={status === 'error'}>
        <CircleExclamation className="size-3 shrink-0 text-danger" aria-label={t('connections.unavailable')} />
      </If>
    </Button>
  )
}

/** 并列保持本地与选中外部 DSH iframe；工作区树只决定可见项，不负责服务生命周期。 */
export function DshWorkspaces({
  config,
  selectedConnectionId,
  onSelectConnection,
  managedIframeRef,
  managedIframeSrc,
  managedIframeKey,
  managedHealthy,
  managedIframeError,
  managedServiceUrl,
  onManagedIframeLoad,
  onManagedIframeError,
  onManagedRetry,
}: DshWorkspacesProps) {
  const { t } = useTranslation()
  const [externalStatuses, setExternalStatuses] = useState<Record<string, ExternalWorkspaceState>>({})
  const connectedConnections = config?.connections.filter(connection => (
    config.connected_connection_ids.includes(connection.id)
  )) ?? []

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-52 shrink-0 flex-col border-r border-line bg-panel p-2">
        <span className="px-2 pb-2 text-[10px] font-semibold tracking-wider text-muted uppercase">
          {t('connections.workspace_root')}
        </span>
        <div className="space-y-1">
          <WorkspaceTreeItem
            id={MANAGED_CONNECTION_ID}
            name={t('connections.managed_label')}
            url={managedServiceUrl}
            selected={selectedConnectionId === MANAGED_CONNECTION_ID}
            status="managed"
            onPress={onSelectConnection}
          />
          <If cond={connectedConnections.length > 0}>
            <div className="mx-2 border-t border-line/70" />
          </If>
          {connectedConnections.map(connection => (
            <WorkspaceTreeItem
              key={connection.id}
              id={connection.id}
              name={connection.name}
              url={connection.url}
              selected={selectedConnectionId === connection.id}
              status={externalStatuses[connection.id]?.url === connection.url
                ? externalStatuses[connection.id].status
                : 'checking'}
              onPress={onSelectConnection}
            />
          ))}
        </div>
        <If cond={connectedConnections.length === 0}>
          <Description className="px-2 pt-3 text-[11px]">
            {t('connections.workspace_empty')}
          </Description>
        </If>
      </aside>

      <div className="relative min-h-0 flex-1">
        <div
          className={cn('absolute inset-0', {
            'invisible pointer-events-none': selectedConnectionId !== MANAGED_CONNECTION_ID,
          })}
          aria-hidden={selectedConnectionId !== MANAGED_CONNECTION_ID}
        >
          <If cond={managedHealthy} else={<Loadable subtitle={t('connections.managed_connecting')} />}>
            <iframe
              key={managedIframeKey}
              ref={managedIframeRef}
              className="block h-full w-full border-none bg-load-bg"
              src={managedIframeSrc}
              allow="accelerometer; ambient-light-sensor; autoplay; battery; camera; clipboard-read; clipboard-write; display-capture; document-domain; encrypted-media; fullscreen; gamepad; geolocation; gyroscope; hid; idle-detection; keyboard-map; magnetometer; microphone; midi; payment; picture-in-picture; publickey-credentials-get; screen-wake-lock; serial; speaker-selection; usb; web-share; xr-spatial-tracking"
              sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-modals allow-downloads allow-storage-access-by-user-activation"
              onLoad={onManagedIframeLoad}
              onError={onManagedIframeError}
              title={t('connections.managed_label')}
            />
          </If>

          <If cond={managedHealthy && managedIframeError}>
            <div className="absolute inset-0 z-[1]">
              <Loadable
                icon={CircleExclamation}
                title={t('connections.managed_label')}
                errorMsg={t('ui.ensure_running', { url: managedServiceUrl })}
                onRetry={onManagedRetry}
              />
            </div>
          </If>
        </div>

        {connectedConnections.map(connection => (
          <ExternalDshWorkspace
            key={`${connection.id}:${connection.url}`}
            connection={connection}
            selected={selectedConnectionId === connection.id}
            onStatusChange={setExternalStatuses}
          />
        ))}
      </div>
    </div>
  )
}
