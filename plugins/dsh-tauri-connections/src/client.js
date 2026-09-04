import { installExternalAdapter } from './external-adapter.js'
import { mountWorkspaceTree } from './workspace-tree.js'

export const name = 'dsh-tauri-connections'
export const inject = ['sessions']

/** Cordis owns the tree, event listeners and teardown, including hot plugin reloads. */
export function apply(ctx) {
  if (typeof window === 'undefined' || window === window.top)
    return
  const query = new URL(window.location.href).searchParams
  if (query.get('dsh-desktop-managed') === '1')
    ctx.effect(() => mountWorkspaceTree())
  else if (query.get('dsh-desktop-external') === '1')
    ctx.effect(() => installExternalAdapter(id => ctx.sessions.open(id)))
}
