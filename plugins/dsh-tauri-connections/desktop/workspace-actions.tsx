import type { DshConnection } from './types'
import type { DirectoryListing, SearchResults, WorkspaceRequest, WorkspaceSnapshot } from './workspace-client'
import { Folder } from '@gravity-ui/icons'
import { Button, Input, ListBox, Modal, Select, Spinner } from '@heroui/react'
import { useEffect, useRef, useState } from 'react'
import { If } from 'react-if-lite'
import { useConnectionHost } from './host'
import { parseDirectory, parseSearch, parseSnapshot } from './workspace-client'

export type WorkspaceAction = 'new-session' | 'add-workspace' | 'search'
interface Props {
  action: WorkspaceAction
  connections: DshConnection[]
  request: WorkspaceRequest
  onSelect: (id: string) => void
  onClose: () => void
}

/** Creation requires an explicit endpoint; search fans out only to the connected endpoints. */
export function WorkspaceActions({ action, connections, request, onSelect, onClose }: Props) {
  const { t } = useConnectionHost()
  const [connectionId, setConnectionId] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>()
  const [path, setPath] = useState('')
  const [directory, setDirectory] = useState<DirectoryListing>()
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const browseAbort = useRef<AbortController | null>(null)
  const connection = connections.find(item => item.id === connectionId)
  const url = connection?.url
  useEffect(() => {
    const abort = new AbortController()
    setSnapshot(undefined)
    setWorkspaceId('')
    setDirectory(undefined)
    setPath('')
    setError('')
    setLoading(Boolean(connectionId && url && action === 'new-session'))
    if (connectionId && url && action === 'new-session') {
      void request(connectionId, 'snapshot', {}, abort.signal).then((value) => {
        if (!abort.signal.aborted)
          setSnapshot(parseSnapshot(value))
      }).catch((error) => {
        if (!abort.signal.aborted)
          setError(String(error))
      }).finally(() => {
        if (!abort.signal.aborted)
          setLoading(false)
      })
    }
    return () => {
      abort.abort()
      browseAbort.current?.abort()
    }
  }, [connectionId, url, action, request])

  async function browse(nextPath?: string) {
    if (!connection)
      return
    browseAbort.current?.abort()
    const abort = new AbortController()
    browseAbort.current = abort
    setLoading(true)
    setError('')
    try {
      if (connection.id === 'managed-local') {
        const value = await request(connection.id, 'pick-directory', {}, abort.signal)
        if (!abort.signal.aborted && typeof value?.path === 'string')
          setPath(value.path)
        return
      }
      const listing = parseDirectory(await request(connection.id, 'list-directory', { path: nextPath || undefined }, abort.signal))
      if (!abort.signal.aborted) {
        setDirectory(listing)
        setPath(listing.path)
      }
    }
    catch (error) {
      if (!abort.signal.aborted)
        setError(`${t('workspace.browse_failed')} ${String(error)}`)
    }
    finally {
      if (!abort.signal.aborted)
        setLoading(false)
    }
  }

  async function submit() {
    if (!connection || busy || action === 'search')
      return
    setBusy(true)
    setError('')
    try {
      if (action === 'new-session') {
        await request(connection.id, action, { workspaceId })
        onSelect(connection.id)
      }
      else {
        await request(connection.id, action, { path })
      }
      onClose()
    }
    catch (error) { setError(`${t('workspace.write_failed')} ${String(error)}`) }
    finally { setBusy(false) }
  }

  return (
    <Modal
      isOpen
      onOpenChange={() => {
        if (!busy)
          onClose()
      }}
    >
      <Modal.Backdrop>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger isDisabled={busy} />
            <Modal.Header><Modal.Heading>{t(`workspace.${action}`)}</Modal.Heading></Modal.Header>
            <Modal.Body className="space-y-4">
              <If
                cond={action === 'search'}
                else={(
                  <>
                    <Select aria-label={t('workspace.target')} placeholder={t('workspace.choose_connection')} selectedKey={connectionId || null} onSelectionChange={key => setConnectionId(String(key))} isDisabled={busy}>
                      <span className="mb-1 text-xs text-muted">{t('workspace.target')}</span>
                      <Select.Trigger>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {connections.map(item => (
                            <ListBox.Item key={item.id} id={item.id} textValue={item.name}>
                              <div className="flex flex-col">
                                <span>{item.name}</span>
                                <span className="text-xs text-muted">{item.displayUrl || item.url}</span>
                              </div>
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                    <If cond={Boolean(connection)}>
                      <p className="break-all text-xs text-muted">
                        {connection?.name}
                        <span className="mx-2">·</span>
                        {connection?.displayUrl || connection?.url}
                      </p>
                      <If
                        cond={action === 'new-session'}
                        else={(
                          <div className="space-y-3">
                            <p className="text-xs text-muted">{t('workspace.path_hint')}</p>
                            <div className="flex gap-2">
                              <Input aria-label={t('workspace.path')} value={path} onChange={event => setPath(event.target.value)} disabled={busy || loading} placeholder={t('workspace.path')} />
                              <Button variant="tertiary" onPress={() => browse(path)} isDisabled={busy || loading}>{t('workspace.browse')}</Button>
                            </div>
                            <If cond={Boolean(directory)}>
                              <div className="rounded-lg border border-line/50">
                                <div className="flex flex-wrap gap-1 border-b border-line/30 p-2">{directory?.crumbs.map(crumb => <Button key={crumb.path} size="sm" variant="ghost" onPress={() => browse(crumb.path)} isDisabled={busy || loading}>{crumb.name}</Button>)}</div>
                                <div className="max-h-48 overflow-auto p-1">
                                  {directory?.entries.map(entry => (
                                    <Button key={entry.path} className="w-full justify-start rounded-md" variant="ghost" size="sm" onPress={() => browse(entry.path)} isDisabled={busy || loading}>
                                      <Folder className="size-4 shrink-0 text-muted" />
                                      <span className="truncate">{entry.name}</span>
                                    </Button>
                                  ))}
                                </div>
                              </div>
                              <If cond={directory?.truncated === true}><p className="text-xs text-muted">{t('workspace.more_directories')}</p></If>
                            </If>
                          </div>
                        )}
                      >
                        <Select aria-label={t('workspace.workspace')} placeholder={t('workspace.choose_workspace')} selectedKey={workspaceId || null} onSelectionChange={key => setWorkspaceId(String(key))} isDisabled={busy || loading}>
                          <Select.Trigger>
                            <Select.Value />
                            <Select.Indicator />
                          </Select.Trigger>
                          <Select.Popover>
                            <ListBox>
                              {snapshot?.workspaces.map(item => (
                                <ListBox.Item key={item.id} id={item.id} textValue={item.title}>
                                  <div className="flex flex-col">
                                    <span>{item.title}</span>
                                    <span className="text-xs text-muted">{item.path}</span>
                                  </div>
                                </ListBox.Item>
                              ))}
                            </ListBox>
                          </Select.Popover>
                        </Select>
                        <If cond={snapshot?.workspaces.length === 0}><p className="text-sm text-muted">{t('workspace.no_workspaces')}</p></If>
                      </If>
                    </If>
                    <If cond={loading}><Spinner size="sm" /></If>
                  </>
                )}
              >
                <WorkspaceSearch connections={connections} request={request} onSelect={onSelect} onClose={onClose} />
              </If>
              <If cond={Boolean(error)}>
                <p role="alert" className="break-words text-sm text-danger">
                  {t('workspace.failed')}
                  {' '}
                  {error}
                </p>
              </If>
            </Modal.Body>
            <If cond={action !== 'search'}>
              <Modal.Footer>
                <Button variant="tertiary" onPress={onClose} isDisabled={busy}>{t('buttons.cancel')}</Button>
                <Button onPress={submit} isPending={busy} isDisabled={!connection || loading || (action === 'new-session' ? !workspaceId : !path.trim())}>{t(`workspace.${action}`)}</Button>
              </Modal.Footer>
            </If>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}

interface SearchGroup { result?: SearchResults, error?: string }
function WorkspaceSearch({ connections, request, onSelect, onClose }: Omit<Props, 'action'>) {
  const { t } = useConnectionHost()
  const [query, setQuery] = useState('')
  const [groups, setGroups] = useState<Record<string, SearchGroup>>({})
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState('')
  const openAbortRef = useRef<AbortController | null>(null)
  useEffect(() => () => openAbortRef.current?.abort(), [])
  const endpoints = JSON.stringify(connections.map(item => ({ id: item.id, url: item.url })))
  useEffect(() => {
    const abort = new AbortController()
    setGroups({})
    if (!query.trim())
      return
    const timer = setTimeout(() => {
      const targets: Array<{ id: string, url: string }> = JSON.parse(endpoints)
      targets.forEach((connection) => {
        void request(connection.id, 'search', { query: query.trim() }, abort.signal).then((value) => {
          if (!abort.signal.aborted)
            setGroups(current => ({ ...current, [connection.id]: { result: parseSearch(value) } }))
        }).catch((error) => {
          if (!abort.signal.aborted)
            setGroups(current => ({ ...current, [connection.id]: { error: String(error) } }))
        })
      })
    }, 250)
    return () => {
      clearTimeout(timer)
      abort.abort()
    }
  }, [query, endpoints, request])
  async function open(connectionId: string, sessionId: string) {
    if (opening)
      return
    setOpening(true)
    setOpenError('')
    const abort = new AbortController()
    openAbortRef.current = abort
    try {
      await request(connectionId, 'open-session', { sessionId }, abort.signal)
      if (abort.signal.aborted)
        return
      onSelect(connectionId)
      onClose()
    }
    catch (error) {
      if (!abort.signal.aborted)
        setOpenError(String(error))
    }
    finally {
      if (!abort.signal.aborted)
        setOpening(false)
    }
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">{t('workspace.search_scope')}</p>
      <Input className="w-full" autoFocus aria-label={t('workspace.search')} placeholder={t('workspace.search_placeholder')} value={query} onChange={event => setQuery(event.target.value)} />
      <If cond={Boolean(openError)}><p role="alert" className="text-sm text-danger">{openError}</p></If>
      <div className="max-h-[50vh] space-y-4 overflow-auto">
        <If cond={Boolean(query.trim())}>
          {connections.map(connection => (
            <section key={connection.id} aria-label={connection.name} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3 px-1">
                <h3 className="text-sm font-medium">{connection.name}</h3>
                <span className="truncate text-xs text-muted">{connection.displayUrl || connection.url}</span>
              </div>
              <If cond={!groups[connection.id]}><p className="px-1 text-xs text-muted">{t('connections.checking')}</p></If>
              <If cond={Boolean(groups[connection.id]?.error)}>
                <p role="alert" className="px-1 text-xs text-danger">
                  {t('workspace.failed')}
                  {' '}
                  {groups[connection.id]?.error}
                </p>
              </If>
              <If cond={Boolean(groups[connection.id]?.result?.warning)}>
                <details className="px-1 text-xs text-muted">
                  <summary className="cursor-pointer">{t('workspace.title_only')}</summary>
                  <p className="mt-1 break-words">{groups[connection.id]?.result?.warning}</p>
                </details>
              </If>
              <If cond={groups[connection.id]?.result?.items.length === 0}><p className="px-1 text-xs text-muted">{t('workspace.no_results')}</p></If>
              {groups[connection.id]?.result?.items.map(item => (
                <Button key={item.id} variant="ghost" className="h-auto w-full justify-start rounded-lg px-3 py-2 text-left" isDisabled={opening} onPress={() => open(connection.id, item.id)}>
                  <div className="min-w-0">
                    <div className="truncate text-sm">{item.title}</div>
                    <div className="truncate text-xs text-muted">{item.workspace}</div>
                    <If cond={Boolean(item.snippet)}><div className="line-clamp-2 text-xs text-muted">{item.snippet}</div></If>
                  </div>
                </Button>
              ))}
              <If cond={groups[connection.id]?.result?.hasMore === true}><p className="px-1 text-xs text-muted">{t('workspace.more_results')}</p></If>
            </section>
          ))}
        </If>
      </div>
    </div>
  )
}
