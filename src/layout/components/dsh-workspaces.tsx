/* eslint-disable react/dom-no-unsafe-iframe-sandbox */
import type { RefObject } from 'react'
import type { AppConfig, DshConnection } from '@/hooks/use-app-config'
import { CircleExclamation } from '@gravity-ui/icons'
import { invoke } from '@tauri-apps/api/core'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { If } from 'react-if-lite'
import { useEvent } from 'react-use'
import { cn } from 'tailwind-variants'
import { queryClient } from '@/config/client'
import { writeClipboardText } from '@/utils/clipboard'
import { getIframeOrigin } from '@/utils/iframe'
import { Loadable } from './loadable'

export const MANAGED_CONNECTION_ID = 'managed-local'

type ExternalWorkspaceStatus = 'checking' | 'ready' | 'error'

interface WorkspaceSession {
  id: string
  title: string
}

interface WorkspaceTree {
  workspaces: Array<{
    id: string
    title: string
    sessions: WorkspaceSession[]
  }>
}

interface WorkspaceTreeAction {
  source?: string
  type?: string
  action?: string
  connectionId?: string
  requestId?: string
  name?: string
  url?: string
  sessionId?: string
  sessionTitle?: string
}

interface DshWorkspaceMessage extends WorkspaceTreeAction {
  tree?: unknown
  error?: unknown
  sidebarWidth?: unknown
}

interface ExternalDshWorkspaceProps {
  connection: DshConnection
  selected: boolean
  sidebarWidth: number
  onFrameChange: (id: string, frame: HTMLIFrameElement | null) => void
  onReady: (id: string) => void
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

function timestampedExternalIframeUrl(baseUrl: string) {
  const url = new URL(baseUrl)
  url.searchParams.set('dsh-desktop-external', '1')
  url.searchParams.set('t', Date.now().toString())
  return url.toString()
}

function externalOrigin(url: string) {
  try {
    return new URL(url).origin
  }
  catch {
    return null
  }
}

function truncate(value: unknown, maximum: number) {
  return typeof value === 'string' ? value.slice(0, maximum) : ''
}

/** 仅保留工作区树渲染所需的受限字段，外部页返回的数据不作为可信配置。 */
function sanitizeWorkspaceTree(value: unknown): WorkspaceTree {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { workspaces?: unknown }).workspaces)) {
    return { workspaces: [] }
  }
  const workspaces = (value as { workspaces: unknown[] }).workspaces.slice(0, 100).flatMap((workspace) => {
    if (!workspace || typeof workspace !== 'object')
      return []
    const source = workspace as { id?: unknown, title?: unknown, sessions?: unknown }
    const id = truncate(source.id, 160)
    const title = truncate(source.title, 160)
    if (!id || !title)
      return []
    const sessions = Array.isArray(source.sessions)
      ? source.sessions.slice(0, 500).flatMap((session) => {
          if (!session || typeof session !== 'object')
            return []
          const item = session as { id?: unknown, title?: unknown }
          const sessionId = truncate(item.id, 160)
          const sessionTitle = truncate(item.title, 160)
          return sessionId && sessionTitle
            ? [{ id: sessionId, title: sessionTitle }]
            : []
        })
      : []
    return [{ id, title, sessions }]
  })
  return { workspaces }
}

function ExternalDshWorkspace({
  connection,
  selected,
  sidebarWidth,
  onFrameChange,
  onReady,
}: ExternalDshWorkspaceProps) {
  const { t } = useTranslation()
  const frameChangeRef = useRef(onFrameChange)
  const [status, setStatus] = useState<ExternalWorkspaceStatus>('checking')
  const [error, setError] = useState('')
  const [iframeSrc, setIframeSrc] = useState('')
  const [probeVersion, setProbeVersion] = useState(0)

  frameChangeRef.current = onFrameChange

  function retry() {
    setStatus('checking')
    setError('')
    setProbeVersion(version => version + 1)
  }

  function handleLoad() {
    onReady(connection.id)
  }

  useEffect(() => {
    let disposed = false
    void invoke<string>('probe_dsh_connection', { url: connection.url })
      .then(() => {
        if (disposed)
          return
        setIframeSrc(timestampedExternalIframeUrl(connection.url))
        setStatus('ready')
      })
      .catch((reason) => {
        if (disposed)
          return
        const message = String(reason)
        setError(message)
        setStatus('error')
      })
    return () => {
      disposed = true
      frameChangeRef.current(connection.id, null)
    }
  }, [connection.id, connection.url, probeVersion])

  return (
    <div
      className={cn('absolute inset-y-0 right-0 z-10', { 'invisible pointer-events-none': !selected })}
      style={{ left: `${sidebarWidth}px` }}
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
          ref={(ref) => {
            frameChangeRef.current(connection.id, ref)
          }}
          className="block h-full w-full border-none bg-load-bg"
          src={iframeSrc}
          allow="accelerometer; ambient-light-sensor; autoplay; battery; camera; clipboard-read; clipboard-write; display-capture; document-domain; encrypted-media; fullscreen; gamepad; geolocation; gyroscope; hid; idle-detection; keyboard-map; magnetometer; microphone; midi; payment; picture-in-picture; publickey-credentials-get; screen-wake-lock; serial; speaker-selection; usb; web-share; xr-spatial-tracking"
          sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-modals allow-downloads allow-storage-access-by-user-activation"
          onLoad={handleLoad}
          title={connection.name}
        />
      </If>
    </div>
  )
}

/** 并列挂载本地与已连接外部 DSH；工作区树由本地 DSH 的现有侧栏承载。 */
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
  const externalFramesRef = useRef<Record<string, HTMLIFrameElement | null>>({})
  const [externalTrees, setExternalTrees] = useState<Record<string, WorkspaceTree>>({})
  const [sidebarWidth, setSidebarWidth] = useState(280)
  const connectedConnections = config?.connections.filter(connection => (
    config.connected_connection_ids.includes(connection.id)
  )) ?? []
  const managedName = config?.managed_connection_name || t('connections.managed_label')

  function setExternalFrame(id: string, frame: HTMLIFrameElement | null) {
    externalFramesRef.current[id] = frame
  }

  function refreshExternalWorkspace(id: string) {
    const connection = connectedConnections.find(item => item.id === id)
    const frame = externalFramesRef.current[id]
    const origin = connection && externalOrigin(connection.url)
    if (!connection || !frame?.contentWindow || !origin)
      return
    frame.contentWindow.postMessage(
      { source: 'dsh-desktop', type: 'dsh://external-workspace:refresh' },
      origin,
    )
  }

  function sendWorkspaceTreeState() {
    const origin = getIframeOrigin(managedIframeRef)
    if (!origin || !managedIframeRef.current?.contentWindow)
      return
    managedIframeRef.current.contentWindow.postMessage({
      source: 'dsh-desktop',
      type: 'dsh://workspace-tree:state',
      state: {
        managed: { id: MANAGED_CONNECTION_ID, name: managedName, url: managedServiceUrl },
        connections: connectedConnections.map(connection => ({
          id: connection.id,
          name: connection.name,
          url: connection.url,
        })),
        selectedConnectionId,
        trees: externalTrees,
        labels: {
          rename: t('connections.rename'),
          copyAddress: t('connections.copy_address'),
          editAddress: t('connections.edit_address'),
          disconnect: t('connections.disconnect'),
          delete: t('connections.delete'),
          renameTitle: t('connections.rename_title'),
          editAddressTitle: t('connections.edit_address_title'),
          editAddressDescription: t('connections.edit_address_description'),
          deleteTitle: t('connections.delete_title'),
          deleteDescription: t('connections.delete_description'),
          renameDescription: t('connections.rename_description'),
          nameLabel: t('connections.name'),
          addressLabel: t('connections.address_label'),
          cancel: t('buttons.cancel'),
          save: t('connections.save'),
          copied: t('connections.copied'),
          actionFailed: t('connections.action_failed'),
        },
      },
    }, origin)
  }

  function sendActionResult(requestId: string | undefined, ok: boolean, message?: string) {
    if (!requestId)
      return
    const origin = getIframeOrigin(managedIframeRef)
    if (!origin || !managedIframeRef.current?.contentWindow)
      return
    managedIframeRef.current.contentWindow.postMessage({
      source: 'dsh-desktop',
      type: 'dsh://workspace-tree:result',
      requestId,
      ok,
      message,
    }, origin)
  }

  async function handleWorkspaceTreeAction(message: WorkspaceTreeAction) {
    const action = message.action
    const connectionId = message.connectionId
    if (!action || !connectionId)
      return
    const connection = config?.connections.find(item => item.id === connectionId)
    try {
      if (action === 'select') {
        onSelectConnection(connectionId)
      }
      else if (action === 'open-session' && connection && typeof message.sessionTitle === 'string') {
        onSelectConnection(connectionId)
        const frame = externalFramesRef.current[connection.id]
        const origin = externalOrigin(connection.url)
        if (!origin || !frame?.contentWindow)
          throw new Error('CONNECTION_URL_INVALID')
        frame.contentWindow.postMessage({
          source: 'dsh-desktop',
          type: 'dsh://external-workspace:open-session',
          sessionId: message.sessionId,
          sessionTitle: message.sessionTitle,
        }, origin)
      }
      else if (action === 'rename' && typeof message.name === 'string') {
        const updatedConfig = connectionId === MANAGED_CONNECTION_ID
          ? await invoke<AppConfig>('rename_managed_dsh_connection', { name: message.name })
          : connection
            ? await invoke<AppConfig>('update_dsh_connection', { id: connection.id, name: message.name, url: connection.url })
            : null
        if (!updatedConfig)
          throw new Error('CONNECTION_NOT_FOUND')
        queryClient.setQueryData(['config'], updatedConfig)
      }
      else if (action === 'copy') {
        const url = connectionId === MANAGED_CONNECTION_ID ? managedServiceUrl : connection?.url
        if (!url)
          throw new Error('CONNECTION_NOT_FOUND')
        await writeClipboardText(url)
      }
      else if (action === 'edit' && connection && typeof message.url === 'string') {
        await invoke('probe_dsh_connection', { url: message.url })
        const updatedConfig = await invoke<AppConfig>('update_dsh_connection', {
          id: connection.id,
          name: connection.name,
          url: message.url,
        })
        queryClient.setQueryData(['config'], updatedConfig)
      }
      else if (action === 'disconnect' && connection) {
        const updatedConfig = await invoke<AppConfig>('set_dsh_connection_connected', {
          id: connection.id,
          connected: false,
        })
        queryClient.setQueryData(['config'], updatedConfig)
      }
      else if (action === 'delete' && connection) {
        const updatedConfig = await invoke<AppConfig>('remove_dsh_connection', { id: connection.id })
        queryClient.setQueryData(['config'], updatedConfig)
      }
      else {
        throw new Error('CONNECTION_ACTION_INVALID')
      }
      sendActionResult(message.requestId, true, action === 'copy' ? t('connections.copied') : undefined)
    }
    catch (error) {
      console.error('[DshWorkspaces] connection action failed:', error)
      sendActionResult(message.requestId, false, t('connections.action_failed'))
    }
  }

  function handleMessage(event: MessageEvent<DshWorkspaceMessage>) {
    const data = event.data
    if (!data || typeof data !== 'object')
      return
    if (data.source === 'dsh-desktop-workspace-tree') {
      if (event.source !== managedIframeRef.current?.contentWindow || event.origin !== getIframeOrigin(managedIframeRef))
        return
      if (data.type === 'dsh://workspace-tree:layout' && typeof data.sidebarWidth === 'number') {
        setSidebarWidth(Math.min(480, Math.max(180, Math.round(data.sidebarWidth))))
      }
      else if (data.type === 'dsh://workspace-tree:action') {
        void handleWorkspaceTreeAction(data)
      }
      return
    }
    if (data.source !== 'dsh-desktop-external-workspace' || data.type !== 'dsh://external-workspace:tree')
      return
    const connection = connectedConnections.find(item => (
      externalFramesRef.current[item.id]?.contentWindow === event.source
    ))
    if (!connection || event.origin !== externalOrigin(connection.url))
      return
    setExternalTrees(current => ({ ...current, [connection.id]: sanitizeWorkspaceTree(data.tree) }))
  }

  useEvent('message', handleMessage)

  useEffect(() => {
    const origin = getIframeOrigin(managedIframeRef)
    if (!origin || !managedIframeRef.current?.contentWindow)
      return
    const connections = (config?.connections ?? []).filter(connection => (
      config?.connected_connection_ids.includes(connection.id)
    ))
    managedIframeRef.current.contentWindow.postMessage({
      source: 'dsh-desktop',
      type: 'dsh://workspace-tree:state',
      state: {
        managed: { id: MANAGED_CONNECTION_ID, name: managedName, url: managedServiceUrl },
        connections: connections.map(connection => ({
          id: connection.id,
          name: connection.name,
          url: connection.url,
        })),
        selectedConnectionId,
        trees: externalTrees,
        labels: {
          rename: t('connections.rename'),
          copyAddress: t('connections.copy_address'),
          editAddress: t('connections.edit_address'),
          disconnect: t('connections.disconnect'),
          delete: t('connections.delete'),
          renameTitle: t('connections.rename_title'),
          editAddressTitle: t('connections.edit_address_title'),
          editAddressDescription: t('connections.edit_address_description'),
          deleteTitle: t('connections.delete_title'),
          deleteDescription: t('connections.delete_description'),
          renameDescription: t('connections.rename_description'),
          nameLabel: t('connections.name'),
          addressLabel: t('connections.address_label'),
          cancel: t('buttons.cancel'),
          save: t('connections.save'),
          copied: t('connections.copied'),
          actionFailed: t('connections.action_failed'),
        },
      },
    }, origin)
  }, [config, externalTrees, managedIframeRef, managedName, managedServiceUrl, selectedConnectionId, t])

  useEffect(() => {
    const connections = (config?.connections ?? []).filter(connection => (
      config?.connected_connection_ids.includes(connection.id)
    ))
    const timer = window.setInterval(() => {
      connections.forEach((connection) => {
        const frame = externalFramesRef.current[connection.id]
        const origin = externalOrigin(connection.url)
        if (!frame?.contentWindow || !origin)
          return
        frame.contentWindow.postMessage(
          { source: 'dsh-desktop', type: 'dsh://external-workspace:refresh' },
          origin,
        )
      })
    }, 5000)
    return () => window.clearInterval(timer)
  }, [config])

  function handleManagedIframeLoad() {
    onManagedIframeLoad()
    window.setTimeout(sendWorkspaceTreeState, 0)
  }

  return (
    <div className="relative min-h-0 flex-1">
      <If cond={managedHealthy} else={<Loadable subtitle={t('connections.managed_connecting')} />}>
        <iframe
          key={managedIframeKey}
          ref={managedIframeRef}
          className="block h-full w-full border-none bg-load-bg"
          src={managedIframeSrc}
          allow="accelerometer; ambient-light-sensor; autoplay; battery; camera; clipboard-read; clipboard-write; display-capture; document-domain; encrypted-media; fullscreen; gamepad; geolocation; gyroscope; hid; idle-detection; keyboard-map; magnetometer; microphone; midi; payment; picture-in-picture; publickey-credentials-get; screen-wake-lock; serial; speaker-selection; usb; web-share; xr-spatial-tracking"
          sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-modals allow-downloads allow-storage-access-by-user-activation"
          onLoad={handleManagedIframeLoad}
          onError={onManagedIframeError}
          title={managedName}
        />
      </If>

      <If cond={managedHealthy && managedIframeError}>
        <div className="absolute inset-0 z-20">
          <Loadable
            icon={CircleExclamation}
            title={managedName}
            errorMsg={t('ui.ensure_running', { url: managedServiceUrl })}
            onRetry={onManagedRetry}
          />
        </div>
      </If>

      {connectedConnections.map(connection => (
        <ExternalDshWorkspace
          key={`${connection.id}:${connection.url}`}
          connection={connection}
          selected={selectedConnectionId === connection.id}
          sidebarWidth={sidebarWidth}
          onFrameChange={setExternalFrame}
          onReady={refreshExternalWorkspace}
        />
      ))}
    </div>
  )
}
