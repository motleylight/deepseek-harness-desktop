/** Unprivileged companion for an external frame; all RPC requests stay on its origin. */
export function mountExternalWorkspace(openById, parentOrigin) {
  let disposed = false
  let inFlight = false
  const abort = new AbortController()
  const originalStyles = new Map()
  const HOST_SOURCE = 'dsh-desktop'
  const BRIDGE_SOURCE = 'dsh-desktop-external-workspace'
  let observation = null

  function post(message) {
    if (disposed)
      return
    try {
      window.parent.postMessage(Object.assign({ source: BRIDGE_SOURCE }, message), parentOrigin)
    }
    catch { /* The parent frame may already be detached during teardown. */ }
  }

  function apiUrl(endpoint) {
    const url = new URL(location.href)
    url.search = ''
    url.hash = ''
    const prefix = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`
    url.pathname = `${prefix}api/${endpoint}`
    return url.toString()
  }

  function requestId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID()
    }
    return `${String(Date.now())}-${String(Math.random()).slice(2)}`
  }

  async function rpc(endpoint) {
    const id = requestId()
    const response = await fetch(apiUrl(endpoint), {
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: id,
        method: endpoint,
        payload: { args: {} },
      }),
    })
    if (!response.ok)
      throw new Error(`HTTP ${String(response.status)}`)
    const payload = await response.json()
    if (!payload || payload.rpcId !== id || !payload.result || payload.result.ok !== true) {
      throw new Error(`DSH API rejected ${endpoint}`)
    }
    return payload.result.value
  }

  function titleOf(session) {
    const title = session
      && session.projections
      && session.projections.values
      && session.projections.values.title
    if (typeof title === 'string' && title.trim())
      return title.trim()
    if (session && typeof session.cwd === 'string' && session.cwd) {
      const parts = session.cwd.split(/[\\/]/)
      return parts[parts.length - 1] || session.sessionId
    }
    return String((session && session.sessionId) || '')
  }

  async function sendTree() {
    if (disposed || inFlight)
      return
    inFlight = true
    try {
      const values = await Promise.all([rpc('workspace.list'), rpc('session.list')])
      const workspaceList = values[0]
      const sessionList = values[1]
      const sessions = Array.isArray(sessionList.items) ? sessionList.items : []
      const sessionMap = new Map(sessions.map((session) => {
        return [String(session.sessionId), {
          id: String(session.sessionId),
          title: titleOf(session),
        }]
      }))
      const workspaces = Array.isArray(workspaceList.items) ? workspaceList.items : []
      if (disposed)
        return
      post({
        type: 'dsh://external-workspace:tree',
        tree: {
          workspaces: workspaces.slice(0, 100).map((workspace) => {
            const ids = Array.isArray(workspace.sessionIds) ? workspace.sessionIds : []
            return {
              id: String(workspace.workspaceId),
              title: String(workspace.title || workspace.path || workspace.workspaceId),
              sessions: ids.slice(0, 500).map((id) => {
                return sessionMap.get(String(id))
              }).filter(Boolean),
            }
          }),
        },
      })
    }
    catch (error) {
      post({
        type: 'dsh://external-workspace:tree',
        tree: { workspaces: [] },
        error: String(error),
      })
    }
    finally { inFlight = false }
  }

  function hideSidebar() {
    const overlay = document.querySelector('[data-shell-overlay]')
    const frame = overlay && overlay.parentElement
    const sidebar = frame && frame.firstElementChild
    if (!frame || !sidebar)
      return false
    if (!originalStyles.has(sidebar))
      originalStyles.set(sidebar, sidebar.getAttribute('style'))
    if (!originalStyles.has(frame))
      originalStyles.set(frame, frame.getAttribute('style'))
    if (sidebar.style.visibility !== 'hidden')
      sidebar.style.setProperty('visibility', 'hidden', 'important')
    const columns = frame.style.gridTemplateColumns || getComputedStyle(frame).gridTemplateColumns
    const withoutSidebar = columns && columns !== 'none' ? columns.replace(/^\S+/, '0px') : '0px minmax(0, 1fr) 0px'
    if (frame.style.gridTemplateColumns !== withoutSidebar)
      frame.style.setProperty('grid-template-columns', withoutSidebar, 'important')
    return true
  }

  function findSessionRow(sessionId, title) {
    const rows = document.querySelectorAll('[role="treeitem"]')
    for (let index = 0; index < rows.length; index++) {
      if (sessionId && (
        rows[index].getAttribute('data-session-id') === sessionId
        || rows[index].getAttribute('data-session') === sessionId
        || rows[index].getAttribute('data-id') === sessionId
      )) {
        return rows[index]
      }
    }
    const matches = Array.from(rows).filter((row) => {
      const label = row.querySelector('[class*="title"]')
      return (label?.textContent || row.textContent || '').trim() === title
    })
    return matches.length === 1 ? matches[0] : null
  }

  function openSession(sessionId, title) {
    if (openById && sessionId) {
      openById(sessionId)
      return
    }
    const row = findSessionRow(sessionId, title)
    if (row)
      row.click()
    else
      post({ type: 'dsh://external-workspace:open-failed' })
  }

  function onMessage(event) {
    if (event.source !== window.parent || event.origin !== parentOrigin)
      return
    const data = event.data
    if (!data || typeof data !== 'object' || data.source !== HOST_SOURCE)
      return
    if (data.type === 'dsh://external-workspace:refresh') {
      void sendTree()
    }
    else if (data.type === 'dsh://external-workspace:open-session' && typeof data.sessionTitle === 'string') {
      openSession(typeof data.sessionId === 'string' ? data.sessionId : '', data.sessionTitle)
    }
  }
  window.addEventListener('message', onMessage)

  observation = new MutationObserver(() => {
    hideSidebar()
  })
  observation.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] })
  function dispose() {
    if (disposed)
      return
    disposed = true
    abort.abort()
    observation.disconnect()
    window.removeEventListener('message', onMessage)
    window.removeEventListener('pagehide', dispose)
    originalStyles.forEach((value, node) => {
      if (value === null)
        node.removeAttribute('style')
      else node.setAttribute('style', value)
    })
  }
  window.addEventListener('pagehide', dispose)
  hideSidebar()
  void sendTree()
  return dispose
}
