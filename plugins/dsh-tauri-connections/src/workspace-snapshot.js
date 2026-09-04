/** Read the public workspace/session stores without deriving identity from rendered titles. */
export function readWorkspaceSnapshot(ctx) {
  const workspaces = ctx.workspaces.list.getSnapshot()
  const sessions = ctx.sessions.list.getSnapshot()
  if (workspaces.phase !== 'ready' || sessions.phase !== 'ready')
    throw new Error('DSH_NOT_READY')
  if (workspaces.error)
    throw new Error(workspaces.error.message)
  const archived = new Set(workspaces.archivedSessionIds)
  const assigned = new Set(workspaces.items.flatMap(workspace => workspace.sessionIds))
  function rows(ids) {
    return ids.filter(id => sessions.byId[id] && !archived.has(id)).map(id => ({
      id,
      title: sessions.byId[id].displayTitle,
      updatedAt: sessions.byId[id].updatedAt,
      running: sessions.byId[id].running === true,
      completed: sessions.byId[id].completed === true,
      blank: sessions.byId[id].blank === true,
      subagent: sessions.byId[id].origin === 'subagent',
    }))
  }
  return {
    version: ctx.connection.hostDescription?.getSnapshot()?.version,
    currentSessionId: sessions.current,
    unassigned: rows(sessions.ids.filter(id => !assigned.has(id))),
    workspaces: workspaces.items.map(workspace => ({
      id: workspace.workspaceId,
      title: workspace.title || workspace.path,
      path: workspace.path,
      sessions: rows(workspace.sessionIds),
    })),
  }
}
