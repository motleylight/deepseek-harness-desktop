import { installExternalAdapter } from './external-adapter.js'
import { mountWorkspaceCommands } from './workspace-commands.js'
import { mountWorkspaceTree } from './workspace-tree.js'

export const name = 'dsh-tauri-connections'
export const inject = ['sessions', 'workspaces', 'connection']

/** Cordis owns the tree, event listeners and teardown, including hot plugin reloads. */
export function apply(ctx) {
  if (typeof window === 'undefined' || window === window.top)
    return
  const query = new URL(window.location.href).searchParams
  if (query.get('dsh-desktop-managed') !== '1' && query.get('dsh-desktop-external') !== '1')
    return
  ctx.effect(() => {
    const stopCommands = mountWorkspaceCommands(ctx)
    const stopView = query.get('dsh-desktop-managed') === '1'
      ? mountWorkspaceTree()
      : installExternalAdapter(id => ctx.sessions.open(id), { sessions: ctx.sessions.list, workspaces: ctx.workspaces.list, host: ctx.connection.hostDescription })
    return () => {
      stopCommands()
      stopView()
    }
  })
}
