import { isDesktopMessage } from './desktop-message.js'

/** Commands run in the selected DSH's own client; no cross-origin API or filesystem access. */
export function mountWorkspaceCommands(ctx) {
  const pending = new Map()
  let disposed = false
  function snapshot() {
    const workspaces = ctx.workspaces.list.getSnapshot()
    const sessions = ctx.sessions.list.getSnapshot()
    if (workspaces.phase !== 'ready' || sessions.phase !== 'ready')
      throw new Error('DSH_NOT_READY')
    if (workspaces.error)
      throw new Error(workspaces.error.message)
    const archived = new Set(workspaces.archivedSessionIds)
    return {
      version: ctx.connection.hostDescription?.getSnapshot()?.version,
      workspaces: workspaces.items.map(workspace => ({
        id: workspace.workspaceId,
        title: workspace.title || workspace.path,
        path: workspace.path,
        sessions: workspace.sessionIds.filter(id => sessions.byId[id] && !archived.has(id)).map(id => ({
          id,
          title: sessions.byId[id].displayTitle,
          updatedAt: sessions.byId[id].updatedAt,
        })),
      })),
    }
  }
  async function run(command, args, signal) {
    // Alpha separates UI navigation from the Workspace Controller; rc.2 combines them.
    const navigation = (typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined) ?? ctx.workspaces
    if (command === 'snapshot')
      return snapshot()
    if (command === 'search' && typeof args.query === 'string') {
      const tree = snapshot()
      let contentResult = { items: [], hasMore: false }
      let warning
      try {
        const result = await ctx.sessions.search(args.query.slice(0, 1000), signal)
        if (result.ok)
          contentResult = result.value
        else warning = result.error.message
      }
      catch (error) { warning = String(error) }
      const content = new Map(contentResult.items.map(item => [item.sessionId, item.snippet]))
      const query = args.query.toLocaleLowerCase()
      return {
        hasMore: contentResult.hasMore,
        warning,
        items: tree.workspaces.flatMap(workspace => workspace.sessions.filter(session => content.has(session.id) || session.title.toLocaleLowerCase().includes(query)).map(session => ({
          ...session,
          workspace: workspace.title,
          snippet: content.get(session.id) || '',
        }))),
      }
    }
    if (command === 'list-directory' && (args.path === undefined || typeof args.path === 'string'))
      return navigation.listDirectory(args.path, signal)
    if (command === 'pick-directory' && new URL(location.href).searchParams.get('dsh-desktop-managed') === '1')
      return { path: await navigation.pickDirectory() }
    if (command === 'add-workspace' && typeof args.path === 'string' && args.path.trim()) {
      const workspace = await ctx.workspaces.create({ path: args.path.trim() })
      return { id: workspace.workspaceId }
    }
    if (command === 'new-session' && typeof args.workspaceId === 'string') {
      if (!snapshot().workspaces.some(workspace => workspace.id === args.workspaceId))
        throw new Error('WORKSPACE_NOT_FOUND')
      const id = await navigation.connectWorkspace(args.workspaceId)
      ctx.sessions.open(id)
      return { id }
    }
    if (command === 'open-session' && typeof args.sessionId === 'string') {
      if (!snapshot().workspaces.some(workspace => workspace.sessions.some(session => session.id === args.sessionId)))
        throw new Error('SESSION_NOT_FOUND')
      ctx.sessions.open(args.sessionId)
      return {}
    }
    throw new Error('WORKSPACE_COMMAND_INVALID')
  }
  async function onMessage(event) {
    if (!isDesktopMessage(event) || event.data?.source !== 'dsh-desktop')
      return
    const { type, requestId, command, args } = event.data
    if (typeof requestId !== 'string' || requestId.length > 160)
      return
    if (type === 'dsh://workspace-client:cancel') {
      pending.get(requestId)?.abort()
      return
    }
    if (type !== 'dsh://workspace-client:request' || pending.has(requestId) || !args || typeof args !== 'object')
      return
    const abort = new AbortController()
    pending.set(requestId, abort)
    try {
      const value = await run(command, args, abort.signal)
      if (!disposed && !abort.signal.aborted)
        window.parent.postMessage({ source: 'dsh-desktop-workspace-client', type: 'dsh://workspace-client:result', requestId, ok: true, value }, event.origin)
    }
    catch (error) {
      if (!disposed && !abort.signal.aborted)
        window.parent.postMessage({ source: 'dsh-desktop-workspace-client', type: 'dsh://workspace-client:result', requestId, ok: false, error: String(error) }, event.origin)
    }
    finally { pending.delete(requestId) }
  }
  function dispose() {
    disposed = true
    pending.forEach(abort => abort.abort())
    pending.clear()
    window.removeEventListener('message', onMessage)
    window.removeEventListener('pagehide', dispose)
  }
  window.addEventListener('message', onMessage)
  window.addEventListener('pagehide', dispose)
  return dispose
}
