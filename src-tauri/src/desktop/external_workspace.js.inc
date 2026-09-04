(function () {
  if (window.__dsh_desktop_external_workspace__) return
  window.__dsh_desktop_external_workspace__ = true
  if (window === window.top) return
  if (new URL(location.href).searchParams.get('dsh-desktop-external') !== '1') return

  var HOST_SOURCE = 'dsh-desktop'
  var BRIDGE_SOURCE = 'dsh-desktop-external-workspace'
  var observation = null

  function post(message) {
    try {
      window.parent.postMessage(Object.assign({ source: BRIDGE_SOURCE }, message), '*')
    }
    catch (_) {}
  }

  function apiUrl(endpoint) {
    var url = new URL(location.href)
    url.search = ''
    url.hash = ''
    var prefix = url.pathname.endsWith('/') ? url.pathname : url.pathname + '/'
    url.pathname = prefix + 'api/' + endpoint
    return url.toString()
  }

  function requestId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID()
    }
    return String(Date.now()) + '-' + String(Math.random()).slice(2)
  }

  async function rpc(endpoint) {
    var id = requestId()
    var response = await fetch(apiUrl(endpoint), {
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
    if (!response.ok) throw new Error('HTTP ' + String(response.status))
    var payload = await response.json()
    if (!payload || payload.rpcId !== id || !payload.result || payload.result.ok !== true) {
      throw new Error('DSH API rejected ' + endpoint)
    }
    return payload.result.value
  }

  function titleOf(session) {
    var title = session
      && session.projections
      && session.projections.values
      && session.projections.values.title
    if (typeof title === 'string' && title.trim()) return title.trim()
    if (session && typeof session.cwd === 'string' && session.cwd) {
      var parts = session.cwd.split(/[\\\\/]/)
      return parts[parts.length - 1] || session.sessionId
    }
    return String(session && session.sessionId || '')
  }

  async function sendTree() {
    try {
      var values = await Promise.all([rpc('workspace.list'), rpc('session.list')])
      var workspaceList = values[0]
      var sessionList = values[1]
      var sessions = Array.isArray(sessionList.items) ? sessionList.items : []
      var sessionMap = new Map(sessions.map(function (session) {
        return [String(session.sessionId), {
          id: String(session.sessionId),
          title: titleOf(session),
        }]
      }))
      var workspaces = Array.isArray(workspaceList.items) ? workspaceList.items : []
      post({
        type: 'dsh://external-workspace:tree',
        tree: {
          workspaces: workspaces.slice(0, 100).map(function (workspace) {
            var ids = Array.isArray(workspace.sessionIds) ? workspace.sessionIds : []
            return {
              id: String(workspace.workspaceId),
              title: String(workspace.title || workspace.path || workspace.workspaceId),
              sessions: ids.slice(0, 500).map(function (id) {
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
  }

  function hideSidebar() {
    var overlay = document.querySelector('[data-shell-overlay]')
    var frame = overlay && overlay.parentElement
    var sidebar = frame && frame.firstElementChild
    if (!frame || !sidebar) return false
    sidebar.style.setProperty('display', 'none', 'important')
    frame.style.setProperty('grid-template-columns', '0 minmax(0, 1fr) 0', 'important')
    return true
  }

  function findSessionRow(sessionId, title) {
    var rows = document.querySelectorAll('[role="treeitem"]')
    for (var index = 0; index < rows.length; index++) {
      if (sessionId && (
        rows[index].getAttribute('data-session-id') === sessionId
        || rows[index].getAttribute('data-session') === sessionId
        || rows[index].getAttribute('data-id') === sessionId
      )) return rows[index]
    }
    for (var index = 0; index < rows.length; index++) {
      var text = (rows[index].textContent || '').trim()
      if (text === title || text.indexOf(title) === 0) return rows[index]
    }
    return null
  }

  function openSession(sessionId, title) {
    var row = findSessionRow(sessionId, title)
    if (row) row.click()
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return
    var data = event.data
    if (!data || typeof data !== 'object' || data.source !== HOST_SOURCE) return
    if (data.type === 'dsh://external-workspace:refresh') {
      void sendTree()
    } else if (data.type === 'dsh://external-workspace:open-session' && typeof data.sessionTitle === 'string') {
      openSession(typeof data.sessionId === 'string' ? data.sessionId : '', data.sessionTitle)
    }
  })

  observation = new MutationObserver(function () {
    hideSidebar()
  })
  observation.observe(document.documentElement, { childList: true, subtree: true })
  window.addEventListener('pagehide', function () {
    observation.disconnect()
  })
  hideSidebar()
  void sendTree()
})()
