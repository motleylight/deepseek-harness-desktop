export interface WorkspaceSession { id: string, title: string, updatedAt?: number }
export interface WorkspaceSnapshot { version?: string, workspaces: Array<{ id: string, title: string, path: string, sessions: WorkspaceSession[] }> }
export interface SearchResults { hasMore: boolean, warning?: string, items: Array<WorkspaceSession & { workspace: string, snippet: string }> }
export interface DirectoryListing { path: string, crumbs: Array<{ path: string, name: string }>, entries: Array<{ path: string, name: string }>, truncated: boolean }
export interface WorkspaceCommands {
  'snapshot': { args: Record<string, never>, result: WorkspaceSnapshot }
  'search': { args: { query: string }, result: SearchResults }
  'list-directory': { args: { path?: string }, result: DirectoryListing }
  'pick-directory': { args: Record<string, never>, result: { path: string | null } }
  'add-workspace': { args: { path: string }, result: { id: string } }
  'new-session': { args: { workspaceId: string }, result: { id: string } }
  'open-session': { args: { sessionId: string }, result: Record<string, never> }
}
export type WorkspaceRequest = <K extends keyof WorkspaceCommands>(connectionId: string, command: K, args: WorkspaceCommands[K]['args'], signal?: AbortSignal) => Promise<WorkspaceCommands[K]['result']>
interface Target { window: Window, origin: string, url: string }
interface Pending { id: string, target: Target, finish: (error?: Error, value?: unknown) => void }

/** Pins each request to a frame and URL. Reload, detach, cancel and timeout never retry a write. */
export function createWorkspaceClient(resolve: (id: string) => Target | undefined) {
  const pending = new Map<string, Pending>()
  function post(target: Target, message: unknown) {
    try {
      target.window.postMessage(message, target.origin)
      return true
    }
    catch {
      return false
    }
  }
  const request: WorkspaceRequest = function request(id, command, args, signal) {
    const target = resolve(id)
    if (command === 'pick-directory' && id !== 'managed-local')
      return Promise.reject(new Error('DSH_NATIVE_PICKER_LOCAL_ONLY'))
    if (!target || signal?.aborted)
      return Promise.reject(new Error('DSH_DISCONNECTED'))
    const requestId = crypto.randomUUID()
    return new Promise((accept, reject) => {
      function cancel() {
        finish(new Error('DSH_REQUEST_CANCELLED'))
      }
      const timer = setTimeout(() => finish(new Error('DSH_REQUEST_TIMEOUT')), command === 'pick-directory' ? 300000 : 15000)
      function finish(error?: Error, value?: unknown) {
        if (!pending.delete(requestId))
          return
        clearTimeout(timer)
        signal?.removeEventListener('abort', cancel)
        if (error) {
          post(target!, { source: 'dsh-desktop', type: 'dsh://workspace-client:cancel', requestId })
          reject(error)
        }
        else {
          // Responses are parsed by the consumer before rendering or selecting ids.
          accept(value as never)
        }
      }
      pending.set(requestId, { id, target, finish })
      signal?.addEventListener('abort', cancel, { once: true })
      if (!post(target, { source: 'dsh-desktop', type: 'dsh://workspace-client:request', requestId, command, args }))
        finish(new Error('DSH_DISCONNECTED'))
    })
  }
  function receive(event: MessageEvent) {
    const data = event.data
    if (data?.source !== 'dsh-desktop-workspace-client' || data.type !== 'dsh://workspace-client:result')
      return
    const entry = pending.get(data.requestId)
    if (!entry || event.source !== entry.target.window || event.origin !== entry.target.origin)
      return
    const current = resolve(entry.id)
    if (current?.window !== entry.target.window || current.url !== entry.target.url) {
      entry.finish(new Error('DSH_DISCONNECTED'))
      return
    }
    entry.finish(data.ok === true ? undefined : new Error(String(data.error || 'DSH_REQUEST_FAILED')), data.value)
  }
  function invalidate(id?: string) {
    pending.forEach((entry) => {
      if (!id || entry.id === id)
        entry.finish(new Error('DSH_DISCONNECTED'))
    })
  }
  return { request, receive, invalidate }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}
function text(value: unknown, length = 4096) {
  return typeof value === 'string' ? value.slice(0, length) : ''
}
function list(value: unknown) {
  return Array.isArray(value) ? value.slice(0, 500) : []
}
function session(value: unknown): WorkspaceSession {
  const item = record(value)
  return { id: text(item.id, 160), title: text(item.title, 300), updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : undefined }
}
/** Bounds data from an external page and never treats it as persisted Desktop configuration. */
export function parseSnapshot(value: unknown): WorkspaceSnapshot {
  const source = record(value)
  return {
    version: text(source.version, 160),
    workspaces: list(source.workspaces).map((value) => {
      const item = record(value)
      return { id: text(item.id, 160), title: text(item.title, 300), path: text(item.path), sessions: list(item.sessions).map(session).filter(item => item.id && item.title) }
    }).filter(item => item.id && item.title),
  }
}
export function parseSearch(value: unknown): SearchResults {
  const source = record(value)
  return { hasMore: source.hasMore === true, warning: text(source.warning, 500), items: list(source.items).map(value => ({ ...session(value), workspace: text(record(value).workspace, 300), snippet: text(record(value).snippet, 500) })).filter(item => item.id && item.title) }
}
export function parseDirectory(value: unknown): DirectoryListing {
  const source = record(value)
  function entries(value: unknown) {
    return list(value).map(value => ({ path: text(record(value).path), name: text(record(value).name, 300) })).filter(item => item.path && item.name)
  }
  if (!text(source.path))
    throw new Error('DSH_DIRECTORY_INVALID')
  return { path: text(source.path), crumbs: entries(source.crumbs), entries: entries(source.entries), truncated: source.truncated === true }
}
