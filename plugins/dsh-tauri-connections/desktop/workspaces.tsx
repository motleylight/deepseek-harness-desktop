/* eslint-disable react/dom-no-unsafe-iframe-sandbox */
import type { RefObject } from 'react'
import type { ConnectionsConfig, DshConnection } from './types'
import type { WorkspaceAction } from './workspace-actions'
import type { WorkspaceSnapshot } from './workspace-client'
import type { WorkspaceItemAction } from './workspace-item-dialog'
import { CircleExclamation } from '@gravity-ui/icons'
import { Button } from '@heroui/react'
import { invoke } from '@tauri-apps/api/core'
import { useEffect, useRef, useState } from 'react'
import { If } from 'react-if-lite'
import { useEvent } from 'react-use'
import { cn } from 'tailwind-variants'
import { useConnectionHost } from './host'
import { ConnectionLoading as Loadable } from './loading'
import { WorkspaceActions } from './workspace-actions'
import { createWorkspaceClient, parseSnapshot } from './workspace-client'
import { WorkspaceItemDialog } from './workspace-item-dialog'

export const MANAGED_CONNECTION_ID = 'managed-local'

function getIframeOrigin(ref: RefObject<HTMLIFrameElement | null>) {
  const src = ref.current?.src
  return src ? externalOrigin(src) : null
}

type ExternalWorkspaceStatus = 'checking' | 'ready' | 'error'

type WorkspaceTree = WorkspaceSnapshot

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
  workspaceId?: string
  workspaceTitle?: string
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
  config: ConnectionsConfig | undefined
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

/** 仅保留工作区树渲染所需的受限字段，外部页返回的数据不作为可信配置。 */
function sanitizeWorkspaceTree(value: unknown): WorkspaceTree {
  return parseSnapshot(value)
}

function ExternalDshWorkspace({
  connection,
  selected,
  sidebarWidth,
  onFrameChange,
  onReady,
}: ExternalDshWorkspaceProps) {
  const { t, setStatus: updateStatus, statuses } = useConnectionHost()
  const statusChangeRef = useRef(updateStatus)
  statusChangeRef.current = updateStatus
  const frameChangeRef = useRef(onFrameChange)
  const [status, setStatus] = useState<ExternalWorkspaceStatus>('checking')
  const [error, setError] = useState('')
  const [iframeSrc, setIframeSrc] = useState('')
  const [probeVersion, setProbeVersion] = useState(0)
  const [frameRef] = useState(() => function setFrame(ref: HTMLIFrameElement | null) {
    frameChangeRef.current(connection.id, ref)
  })

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
    statusChangeRef.current(connection.id, { state: 'checking' })
    const probe = connection.transport === 'ssh' ? Promise.resolve(connection.url) : invoke<string>('probe_dsh_connection', { url: connection.url })
    void probe
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
        statusChangeRef.current(connection.id, { state: 'error', message })
      })
    return () => {
      disposed = true
      frameChangeRef.current(connection.id, null)
      statusChangeRef.current(connection.id, null)
    }
  }, [connection.id, connection.url, connection.transport, probeVersion])

  return (
    <div
      className={cn('absolute inset-y-0 right-0 z-10', { 'invisible pointer-events-none': !selected })}
      style={{ left: `${sidebarWidth}px` }}
      aria-hidden={!selected}
    >
      <If cond={status === 'ready' && statuses[connection.id]?.state === 'error'}>
        <div role="alert" className="absolute inset-x-0 top-0 z-20 flex items-center gap-2 bg-canvas p-3 text-sm text-danger">
          <span className="flex-1">{statuses[connection.id]?.message}</span>
          <Button size="sm" onPress={retry}>{t('connections.retry')}</Button>
        </div>
      </If>
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
          ref={frameRef}
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
  config: suppliedConfig,
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
  const { config: hostConfig, t, mutateConnection, copyText, available, setAvailable, setStatus, editConnection, deleteConnection } = useConnectionHost()
  const config = hostConfig ?? suppliedConfig
  const externalFramesRef = useRef<Record<string, HTMLIFrameElement | null>>({})
  const lastResponseRef = useRef<Record<string, number>>({})
  const selectionSequence = useRef(0)
  const [externalTrees, setExternalTrees] = useState<Record<string, WorkspaceTree>>({})
  const [sidebarWidth, setSidebarWidth] = useState(280)
  const [toolbarAction, setToolbarAction] = useState<WorkspaceAction | null>(null)
  const [toolbarConnectionId, setToolbarConnectionId] = useState(MANAGED_CONNECTION_ID)
  const [toolbarError, setToolbarError] = useState('')
  const [itemAction, setItemAction] = useState<WorkspaceItemAction | null>(null)
  const connectedConnections = config?.connections.filter(connection => (
    config.connected_connection_ids.includes(connection.id)
  )) ?? []
  const managedName = config?.managed_connection_name || t('connections.managed_label')
  const targetsRef = useRef(connectedConnections)
  targetsRef.current = connectedConnections
  const [workspaceClient] = useState(() => createWorkspaceClient((id) => {
    const frame = id === MANAGED_CONNECTION_ID ? managedIframeRef.current : externalFramesRef.current[id]
    if (id !== MANAGED_CONNECTION_ID && !targetsRef.current.some(item => item.id === id))
      return
    if (!frame?.contentWindow)
      return
    const origin = externalOrigin(frame.src)
    if (origin)
      return { window: frame.contentWindow, url: frame.src, origin }
  }))
  const refreshStateRef = useRef({ connectedConnections, setStatus, t })
  refreshStateRef.current = { connectedConnections, setStatus, t }

  function setExternalFrame(id: string, frame: HTMLIFrameElement | null) {
    if (!frame || externalFramesRef.current[id] !== frame)
      workspaceClient.invalidate(id)
    if (frame && externalFramesRef.current[id] !== frame)
      lastResponseRef.current[id] = Date.now()
    if (!frame)
      delete lastResponseRef.current[id]
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

  function handleExternalLoad(id: string) {
    workspaceClient.invalidate(id)
    refreshExternalWorkspace(id)
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
          url: connection.displayUrl || connection.url,
        })),
        selectedConnectionId,
        trees: externalTrees,
        labels: {
          toolbar: {
            'new-session': t('workspace.new_session_scope', { name: selectedConnectionId === MANAGED_CONNECTION_ID ? managedName : connectedConnections.find(item => item.id === selectedConnectionId)?.name || '' }),
            'add-workspace': t('workspace.add_workspace_scope', { name: selectedConnectionId === MANAGED_CONNECTION_ID ? managedName : connectedConnections.find(item => item.id === selectedConnectionId)?.name || '' }),
            'search': t('workspace.search'),
            'view': t('workspace.view_scope'),
          },
          rename: t('connections.rename'),
          newSession: t('workspace.new-session'),
          newWorkspace: t('workspace.new_workspace'),
          running: t('workspace.running'),
          completed: t('workspace.completed'),
          renameWorkspace: t('workspace.rename-workspace'),
          deleteWorkspace: t('workspace.delete-workspace'),
          renameSession: t('workspace.rename-session'),
          forkSession: t('workspace.fork-session'),
          archiveSession: t('workspace.archive-session'),
          sessionActions: t('workspace.session_actions'),
          copyPath: t('workspace.copy_path'),
          copySessionId: t('workspace.copy_session_id'),
          openPath: t('workspace.open_path'),
          archiveWorkspace: t('workspace.archive-workspace'),
          refresh: t('workspace.refresh'),
          connectionBadge: t('workspace.connection_badge'),
          workspaceBadge: t('workspace.workspace_badge'),
          ungrouped: t('workspace.ungrouped'),
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
        selectionSequence.current++
        onSelectConnection(connectionId)
      }
      else if (action === 'open-session' && (connection || connectionId === MANAGED_CONNECTION_ID) && typeof message.sessionTitle === 'string') {
        const sequence = ++selectionSequence.current
        await workspaceClient.request(connectionId, 'open-session', { sessionId: message.sessionId || '' })
        if (selectionSequence.current === sequence)
          onSelectConnection(connectionId)
      }
      else if (action === 'new-session' && (connection || connectionId === MANAGED_CONNECTION_ID) && typeof message.workspaceId === 'string') {
        const sequence = ++selectionSequence.current
        await workspaceClient.request(connectionId, 'new-session', { workspaceId: message.workspaceId })
        if (selectionSequence.current === sequence)
          onSelectConnection(connectionId)
      }
      else if (action === 'add-workspace' && (connection || connectionId === MANAGED_CONNECTION_ID)) {
        setToolbarConnectionId(connectionId)
        setToolbarAction('add-workspace')
      }
      else if (['rename-workspace', 'delete-workspace', 'rename-session', 'archive-workspace'].includes(action) && (connection || connectionId === MANAGED_CONNECTION_ID)) {
        const target = connection || { id: MANAGED_CONNECTION_ID, name: managedName, url: managedServiceUrl }
        const id = action === 'rename-session' ? message.sessionId : message.workspaceId
        const title = action === 'rename-session' ? message.sessionTitle : message.workspaceTitle
        if (typeof id !== 'string' || typeof title !== 'string')
          throw new Error('WORKSPACE_ACTION_INVALID')
        setItemAction({ command: action as WorkspaceItemAction['command'], connection: target, id, title })
      }
      else if ((action === 'copy-path' || action === 'open-item-path') && (connection || connectionId === MANAGED_CONNECTION_ID)) {
        const { path } = await workspaceClient.request(connectionId, action === 'copy-path' ? 'item-path' : 'open-item-path', { workspaceId: message.workspaceId, sessionId: message.sessionId })
        if (action === 'copy-path')
          await copyText(path)
      }
      else if (action === 'copy-session-id' && typeof message.sessionId === 'string' && (connection || connectionId === MANAGED_CONNECTION_ID)) {
        await copyText(message.sessionId)
      }
      else if (action === 'refresh' && (connection || connectionId === MANAGED_CONNECTION_ID)) {
        const frame = connectionId === MANAGED_CONNECTION_ID ? managedIframeRef.current : externalFramesRef.current[connectionId]
        if (frame) {
          workspaceClient.invalidate(connectionId)
          frame.setAttribute('src', frame.src)
        }
      }
      else if ((action === 'fork-session' || action === 'archive-session') && (connection || connectionId === MANAGED_CONNECTION_ID) && typeof message.sessionId === 'string') {
        const sequence = ++selectionSequence.current
        await workspaceClient.request(connectionId, action, { sessionId: message.sessionId })
        if (action === 'fork-session' && sequence === selectionSequence.current)
          onSelectConnection(connectionId)
      }
      else if (action === 'request-rename' || action === 'request-edit' || action === 'request-delete') {
        const target = connectionId === MANAGED_CONNECTION_ID ? { id: connectionId, name: managedName, url: managedServiceUrl } : connection
        if (!target || (connectionId === MANAGED_CONNECTION_ID && action !== 'request-rename'))
          throw new Error('CONNECTION_ACTION_INVALID')
        if (action === 'request-delete')
          deleteConnection(target)
        else
          editConnection({ kind: action === 'request-rename' ? 'rename' : 'edit', connection: target })
      }
      else if (action === 'copy') {
        const url = connectionId === MANAGED_CONNECTION_ID ? managedServiceUrl : connection?.displayUrl || connection?.url
        if (!url)
          throw new Error('CONNECTION_NOT_FOUND')
        await copyText(url)
      }
      else if (action === 'disconnect' && connection) {
        await mutateConnection('set_dsh_connection_connected', {
          id: connection.id,
          connected: false,
        })
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
    workspaceClient.receive(event)
    const data = event.data
    if (!data || typeof data !== 'object')
      return
    if (data.source === 'dsh-desktop-workspace-tree') {
      if (event.source !== managedIframeRef.current?.contentWindow || event.origin !== getIframeOrigin(managedIframeRef))
        return
      if (data.type === 'dsh://workspace-tree:ready') {
        setAvailable(true)
        sendWorkspaceTreeState()
      }
      else if (data.type === 'dsh://workspace-tree:disposed') {
        setAvailable(false)
        onSelectConnection(MANAGED_CONNECTION_ID)
      }
      else if (data.type === 'dsh://workspace-tree:layout' && typeof data.sidebarWidth === 'number') {
        setSidebarWidth(Math.min(window.innerWidth, Math.max(0, Math.round(data.sidebarWidth))))
      }
      else if (data.type === 'dsh://workspace-tree:action') {
        void handleWorkspaceTreeAction(data)
      }
      else if (data.type === 'dsh://workspace-tree:toolbar') {
        if (data.action === 'new-session') {
          selectionSequence.current++
          const name = selectedConnectionId === MANAGED_CONNECTION_ID ? managedName : connectedConnections.find(item => item.id === selectedConnectionId)?.name || ''
          setToolbarError('')
          void workspaceClient.request(selectedConnectionId, 'start-session', {}).catch(() => {
            setToolbarError(t('workspace.start_failed', { name }))
          })
        }
        else if (data.action === 'add-workspace' || data.action === 'search') {
          setToolbarConnectionId(selectedConnectionId)
          setToolbarAction(data.action)
        }
      }
      return
    }
    if (data.source !== 'dsh-desktop-external-workspace')
      return
    const connection = connectedConnections.find(item => (
      externalFramesRef.current[item.id]?.contentWindow === event.source
    ))
    if (!connection || event.origin !== externalOrigin(connection.url))
      return
    if (data.type === 'dsh://external-workspace:open-failed') {
      setStatus(connection.id, { state: 'error', message: t('connections.open_failed') })
      return
    }
    if (data.type !== 'dsh://external-workspace:tree')
      return
    lastResponseRef.current[connection.id] = Date.now()
    const snapshot = sanitizeWorkspaceTree(data.tree)
    setExternalTrees(current => ({ ...current, [connection.id]: snapshot }))
    setStatus(connection.id, data.error
      ? { state: 'error', message: String(data.error) }
      : { state: 'connected', version: snapshot.version, workspaces: snapshot.workspaces.length, sessions: snapshot.workspaces.reduce((sum, workspace) => sum + workspace.sessions.length, 0) })
  }

  useEvent('message', handleMessage)
  useEffect(() => () => workspaceClient.invalidate(), [workspaceClient])
  useEffect(() => () => workspaceClient.invalidate(MANAGED_CONNECTION_ID), [workspaceClient, managedIframeKey, managedIframeSrc, managedHealthy])

  useEffect(() => {
    sendWorkspaceTreeState()
  })

  useEffect(() => {
    setAvailable(false)
    const timer = window.setInterval(() => {
      const origin = getIframeOrigin(managedIframeRef)
      managedIframeRef.current?.contentWindow?.postMessage({ source: 'dsh-desktop', type: 'dsh://workspace-tree:ping' }, origin || '*')
    }, 2000)
    return () => {
      window.clearInterval(timer)
      setAvailable(false)
    }
  }, [managedIframeKey, managedIframeSrc, managedIframeRef, setAvailable])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const { connectedConnections, setStatus, t } = refreshStateRef.current
      connectedConnections.forEach((connection) => {
        const frame = externalFramesRef.current[connection.id]
        const origin = externalOrigin(connection.url)
        if (!frame?.contentWindow || !origin)
          return
        if (Date.now() - (lastResponseRef.current[connection.id] ?? Date.now()) > 30000)
          setStatus(connection.id, { state: 'error', message: t('connections.loading_timeout') })
        frame.contentWindow.postMessage(
          { source: 'dsh-desktop', type: 'dsh://external-workspace:refresh' },
          origin,
        )
      })
    }, 5000)
    return () => window.clearInterval(timer)
  }, [])

  function handleManagedIframeLoad() {
    workspaceClient.invalidate(MANAGED_CONNECTION_ID)
    onManagedIframeLoad()
    sendWorkspaceTreeState()
  }

  return (
    <div className="relative min-h-0 flex-1">
      <If cond={itemAction !== null}>
        <WorkspaceItemDialog action={itemAction!} available={itemAction?.connection.id === MANAGED_CONNECTION_ID ? itemAction.connection.url === managedServiceUrl && managedHealthy : connectedConnections.some(connection => connection.id === itemAction?.connection.id && connection.url === itemAction?.connection.url)} request={workspaceClient.request} onClose={() => setItemAction(null)} />
      </If>
      <If cond={Boolean(toolbarError)}>
        <div role="alert" className="absolute inset-x-0 top-0 z-20 flex items-center gap-2 bg-canvas p-3 text-sm text-danger">
          <span className="flex-1">{toolbarError}</span>
          <Button size="sm" variant="ghost" onPress={() => setToolbarError('')}>{t('workspace.dismiss')}</Button>
        </div>
      </If>
      <If cond={toolbarAction !== null}>
        <WorkspaceActions key={`${toolbarAction}:${toolbarConnectionId}`} action={toolbarAction!} connections={[{ id: MANAGED_CONNECTION_ID, name: managedName, url: managedServiceUrl }, ...connectedConnections].filter(connection => toolbarAction === 'search' || connection.id === toolbarConnectionId)} request={workspaceClient.request} onSelect={onSelectConnection} onClose={() => setToolbarAction(null)} />
      </If>
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

      {(available ? connectedConnections : []).map(connection => (
        <ExternalDshWorkspace
          key={`${connection.id}:${connection.url}`}
          connection={connection}
          selected={selectedConnectionId === connection.id}
          sidebarWidth={sidebarWidth}
          onFrameChange={setExternalFrame}
          onReady={handleExternalLoad}
        />
      ))}
    </div>
  )
}
