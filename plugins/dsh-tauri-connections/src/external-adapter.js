import { isDesktopMessage } from './desktop-message.js'
import { mountExternalWorkspace } from './external-workspace.js'

/** A plugin-provided session opener supersedes the dormant DOM-only Desktop companion. */
export function installExternalAdapter(openById) {
  if (window === window.top || new URL(location.href).searchParams.get('dsh-desktop-external') !== '1')
    return () => {}
  if (window.__dshConnectionsAdapter && !openById)
    return () => {}
  window.__dshConnectionsAdapter?.()
  let stop = null
  function onMessage(event) {
    if (!isDesktopMessage(event) || event.data?.source !== 'dsh-desktop')
      return
    if (event.data.type === 'dsh://external-workspace:refresh' && !stop)
      stop = mountExternalWorkspace(openById, event.origin)
  }
  function dispose() {
    stop?.()
    window.removeEventListener('message', onMessage)
    window.removeEventListener('pagehide', dispose)
    if (window.__dshConnectionsAdapter === dispose)
      delete window.__dshConnectionsAdapter
  }
  window.__dshConnectionsAdapter = dispose
  window.addEventListener('message', onMessage)
  window.addEventListener('pagehide', dispose)
  return dispose
}
