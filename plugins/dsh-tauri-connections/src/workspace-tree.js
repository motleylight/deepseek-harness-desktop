/** Mounts the connection groups in the existing DSH workspace tree; returns full teardown. */
import { isDesktopMessage } from './desktop-message.js'

export function mountWorkspaceTree() {
  if (window === window.top)
    return () => {}
  let disposed = false
  let hasState = false
  const listeners = []
  const timers = []
  const originalChildren = new Map()
  const collapsed = new Set()
  let lastWidth = -1
  let previousState = ''
  let parentOrigin = '*'
  function listen(target, type, callback, capture = false) {
    target.addEventListener(type, callback, capture)
    listeners.push(() => target.removeEventListener(type, callback, capture))
  }
  const BRIDGE_SOURCE = 'dsh-desktop-workspace-tree'
  const HOST_SOURCE = 'dsh-desktop'
  let managedHost = null
  let remoteHost = null
  let tree = null
  let menu = null
  let selectedAction = null
  let requestSequence = 0
  let state = {
    managed: { id: 'managed-local', name: '', url: '' },
    connections: [],
    selectedConnectionId: 'managed-local',
    trees: {},
    labels: {},
  }

  function create(tag, className, text) {
    const node = document.createElement(tag)
    if (className)
      node.className = className
    if (text !== undefined)
      node.textContent = text
    return node
  }

  function addStyles() {
    if (document.getElementById('dsh-desktop-workspace-tree-styles'))
      return
    const style = document.createElement('style')
    style.id = 'dsh-desktop-workspace-tree-styles'
    style.textContent = [
      '.dsh-desktop-connection-host{display:contents}',
      '.dsh-desktop-connection-row{display:flex;align-items:center;gap:6px;min-height:32px;padding:0 8px;border-radius:8px;color:var(--dsw-alias-label-primary);cursor:pointer;font-size:13px;line-height:20px;user-select:none}',
      '.dsh-desktop-connection-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsh-desktop-connection-row[data-selected="true"]{background:var(--dsw-alias-interactive-bg-selected)}',
      '.dsh-desktop-connection-row[data-depth="workspace"]{margin-left:18px;min-height:28px;font-size:12px}',
      '.dsh-desktop-connection-row[data-depth="session"]{margin-left:38px;min-height:28px;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-desktop-connection-row .dsh-desktop-connection-icon{display:inline-flex;width:16px;justify-content:center;color:var(--dsw-alias-label-secondary);font-size:14px}',
      '.dsh-desktop-connection-row .dsh-desktop-connection-title{overflow:hidden;flex:1;min-width:0;text-overflow:ellipsis;white-space:nowrap}',
      '.dsh-desktop-connection-row .dsh-desktop-connection-meta{overflow:hidden;max-width:92px;color:var(--dsw-alias-label-tertiary);font-size:11px;text-overflow:ellipsis;white-space:nowrap}',
      '[data-dsh-desktop-managed-child="true"]{margin-left:14px !important}',
      '.dsh-desktop-connection-host[data-collapsed="true"] ~ [data-dsh-desktop-managed-child="true"]{display:none !important}',
      '.dsh-desktop-connection-menu{position:fixed;z-index:2147483645;min-width:180px;padding:4px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-specific-sidebar-fill);box-shadow:0 12px 28px rgba(0,0,0,.18)}',
      '.dsh-desktop-connection-menu[hidden]{display:none}',
      '.dsh-desktop-connection-menu button{display:flex;width:100%;align-items:center;gap:8px;min-height:32px;padding:0 9px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;font-size:13px;text-align:left}',
      '.dsh-desktop-connection-menu button:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsh-desktop-connection-menu .dsh-desktop-danger{color:var(--dsw-alias-state-error-primary)}',
      '.dsh-desktop-connection-menu hr{height:1px;margin:4px;border:0;background:var(--dsw-alias-border-l2)}',
      '.dsh-desktop-connection-toast{position:fixed;z-index:2147483647;right:20px;bottom:20px;padding:8px 12px;border-radius:9px;background:var(--dsw-alias-label-primary);color:var(--dsw-specific-sidebar-fill);font-size:12px;line-height:18px}',
      '.dsh-desktop-connection-toast[hidden]{display:none}',
    ].join('')
    ;(document.head || document.documentElement).appendChild(style)
  }

  function post(message) {
    try {
      window.parent.postMessage(Object.assign({ source: BRIDGE_SOURCE }, message), parentOrigin)
    }
    catch { /* The parent frame may already be detached during teardown. */ }
  }

  function findTree() {
    return document.querySelector('[role="tree"]')
  }

  function refreshManagedChildren() {
    if (!tree || !managedHost || !remoteHost)
      return
    originalChildren.forEach((value, node) => {
      if (node.parentElement !== tree) {
        if (value === null)
          node.removeAttribute('data-dsh-desktop-managed-child')
        else node.setAttribute('data-dsh-desktop-managed-child', value)
        originalChildren.delete(node)
      }
    })
    const children = tree.children
    for (let index = 0; index < children.length; index++) {
      const child = children[index]
      if (child !== managedHost && child !== remoteHost) {
        if (!originalChildren.has(child))
          originalChildren.set(child, child.getAttribute('data-dsh-desktop-managed-child'))
        child.setAttribute('data-dsh-desktop-managed-child', 'true')
      }
    }
  }

  function addIcon(row, icon) {
    row.appendChild(create('span', 'dsh-desktop-connection-icon', icon))
  }

  function endpointRow(connection) {
    const row = create('div', 'dsh-desktop-connection-row')
    row.setAttribute('role', 'treeitem')
    row.setAttribute('tabindex', '0')
    row.setAttribute('aria-expanded', String(!collapsed.has(connection.id)))
    row.setAttribute('data-connection-id', connection.id)
    row.setAttribute('data-selected', String(state.selectedConnectionId === connection.id))
    addIcon(row, collapsed.has(connection.id) ? '›' : '⌄')
    row.firstChild.addEventListener('click', (event) => {
      event.stopPropagation()
      toggle(connection.id)
    })
    const title = create('span', 'dsh-desktop-connection-title', connection.name)
    row.appendChild(title)
    row.appendChild(create('span', 'dsh-desktop-connection-meta', connection.url))
    row.addEventListener('click', () => {
      post({ type: 'dsh://workspace-tree:action', action: 'select', connectionId: connection.id })
    })
    row.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        toggle(connection.id, event.key === 'ArrowLeft')
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        post({ type: 'dsh://workspace-tree:action', action: 'select', connectionId: connection.id })
      }
    })

    return row
  }

  function workspaceRow(connectionId, workspace) {
    const row = create('div', 'dsh-desktop-connection-row')
    row.setAttribute('role', 'treeitem')
    row.setAttribute('tabindex', '0')
    row.setAttribute('data-depth', 'workspace')
    addIcon(row, '⌄')
    row.appendChild(create('span', 'dsh-desktop-connection-title', workspace.title))
    row.addEventListener('click', () => {
      post({
        type: 'dsh://workspace-tree:action',
        action: 'select',
        connectionId,
      })
    })
    return row
  }

  function sessionRow(connectionId, session) {
    const row = create('div', 'dsh-desktop-connection-row')
    row.setAttribute('role', 'treeitem')
    row.setAttribute('tabindex', '0')
    row.setAttribute('data-depth', 'session')
    addIcon(row, '•')
    row.appendChild(create('span', 'dsh-desktop-connection-title', session.title))
    row.addEventListener('click', () => {
      post({
        type: 'dsh://workspace-tree:action',
        action: 'open-session',
        connectionId,
        sessionId: session.id,
        sessionTitle: session.title,
      })
    })
    return row
  }

  function toggle(id, closed = !collapsed.has(id)) {
    if (closed)
      collapsed.add(id)
    else collapsed.delete(id)
    render()
  }

  function render() {
    if (!managedHost || !remoteHost)
      return
    while (managedHost.firstChild) managedHost.removeChild(managedHost.firstChild)
    while (remoteHost.firstChild) remoteHost.removeChild(remoteHost.firstChild)
    managedHost.setAttribute('data-collapsed', String(collapsed.has(state.managed.id)))
    managedHost.appendChild(endpointRow(state.managed))

    for (let index = 0; index < state.connections.length; index++) {
      const connection = state.connections[index]
      remoteHost.appendChild(endpointRow(connection))
      if (collapsed.has(connection.id))
        continue
      const treeState = state.trees[connection.id]
      if (!treeState || !Array.isArray(treeState.workspaces))
        continue
      for (let workspaceIndex = 0; workspaceIndex < treeState.workspaces.length; workspaceIndex++) {
        const workspace = treeState.workspaces[workspaceIndex]
        remoteHost.appendChild(workspaceRow(connection.id, workspace))
        const sessions = Array.isArray(workspace.sessions) ? workspace.sessions : []
        for (let sessionIndex = 0; sessionIndex < sessions.length; sessionIndex++) {
          remoteHost.appendChild(sessionRow(connection.id, sessions[sessionIndex]))
        }
      }
    }
    refreshManagedChildren()
  }

  function localize(key) {
    return state.labels[key] || ''
  }

  function createMenu() {
    if (menu)
      return
    menu = create('div', 'dsh-desktop-connection-menu')
    menu.setAttribute('role', 'menu')
    menu.hidden = true
    document.body.appendChild(menu)
    listen(document, 'pointerdown', (event) => {
      if (menu && !menu.contains(event.target))
        closeMenu()
    })
  }

  function menuItem(label, action, danger) {
    const item = create('button', danger ? 'dsh-desktop-danger' : '', label)
    item.type = 'button'
    item.setAttribute('role', 'menuitem')
    item.addEventListener('click', () => {
      if (!selectedAction)
        return
      closeMenu()
      sendAction(['rename', 'edit', 'delete'].includes(action) ? `request-${action}` : action, selectedAction.connection)
    })
    return item
  }

  function openMenu(left, top, connection) {
    createMenu()
    selectedAction = { connection }
    while (menu.firstChild) menu.removeChild(menu.firstChild)
    menu.appendChild(menuItem(localize('rename'), 'rename'))
    menu.appendChild(menuItem(localize('copyAddress'), 'copy'))
    if (connection.id !== state.managed.id) {
      menu.appendChild(menuItem(localize('editAddress'), 'edit'))
      menu.appendChild(document.createElement('hr'))
      menu.appendChild(menuItem(localize('disconnect'), 'disconnect'))
      menu.appendChild(menuItem(localize('delete'), 'delete', true))
    }
    menu.style.left = `${String(Math.max(0, Math.min(left, lastWidth - 196)))}px`
    menu.style.top = `${String(Math.min(top, window.innerHeight - 180))}px`
    menu.hidden = false
  }

  function closeMenu() {
    if (menu)
      menu.hidden = true
  }

  function showToast(message) {
    let toast = document.getElementById('dsh-desktop-connection-toast')
    if (!toast) {
      toast = create('div', 'dsh-desktop-connection-toast')
      toast.id = 'dsh-desktop-connection-toast'
      document.body.appendChild(toast)
    }
    toast.textContent = message
    toast.hidden = false
    timers.push(window.setTimeout(() => {
      toast.hidden = true
    }, 2200))
  }

  function sendAction(action, connection, extra) {
    const requestId = String(++requestSequence)
    selectedAction = Object.assign({ action, connection, requestId }, extra || {})
    post(Object.assign({
      type: 'dsh://workspace-tree:action',
      action,
      connectionId: connection.id,
      requestId,
    }, extra || {}))
  }

  function reportLayout() {
    const overlay = document.querySelector('[data-shell-overlay]')
    const frame = overlay && overlay.parentElement
    const sidebar = frame && frame.firstElementChild
    if (!sidebar)
      return
    const width = Math.round(sidebar.getBoundingClientRect().width)
    if (width === lastWidth)
      return
    lastWidth = width
    post({ type: 'dsh://workspace-tree:layout', sidebarWidth: width })
  }

  function install() {
    if (disposed || !hasState)
      return false
    const nextTree = findTree()
    if (!nextTree)
      return false
    tree = nextTree
    addStyles()
    if (!managedHost || !managedHost.isConnected) {
      managedHost = create('div', 'dsh-desktop-connection-host')
      managedHost.id = 'dsh-desktop-managed-connection'
      tree.insertBefore(managedHost, tree.firstChild)
    }
    if (!remoteHost || !remoteHost.isConnected) {
      remoteHost = create('div', 'dsh-desktop-connection-host')
      remoteHost.id = 'dsh-desktop-external-connections'
      tree.appendChild(remoteHost)
    }
    refreshManagedChildren()
    render()
    reportLayout()
    return true
  }

  function handleResult(data) {
    if (!selectedAction || data.requestId !== selectedAction.requestId)
      return
    if (data.ok) {
      if (selectedAction.action === 'copy')
        showToast(data.message || localize('copied'))
      selectedAction = null
      return
    }
    showToast(data.message || localize('actionFailed'))
  }

  listen(window, 'message', (event) => {
    if (!isDesktopMessage(event))
      return
    parentOrigin = event.origin
    const data = event.data
    if (!data || typeof data !== 'object' || data.source !== HOST_SOURCE)
      return
    if (data.type === 'dsh://workspace-tree:state' && data.state) {
      const serialized = JSON.stringify(data.state)
      if (serialized === previousState)
        return
      previousState = serialized
      state = data.state
      hasState = true
      install()
    }
    else if (data.type === 'dsh://workspace-tree:ping') {
      post({ type: 'dsh://workspace-tree:ready' })
    }
    else if (data.type === 'dsh://workspace-tree:result') {
      handleResult(data)
    }
  })

  const observer = new MutationObserver(() => {
    const nextTree = findTree()
    if (!nextTree || nextTree !== tree || !managedHost || !managedHost.isConnected || !remoteHost || !remoteHost.isConnected) {
      install()
      return
    }
    refreshManagedChildren()
    reportLayout()
  })
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'data-details-collapsed'],
  })
  listen(window, 'resize', reportLayout)
  listen(window, 'contextmenu', (event) => {
    const row = event.target instanceof Element && event.target.closest('[data-connection-id]')
    if (!row || !tree || !tree.contains(row))
      return
    const id = row.getAttribute('data-connection-id')
    const connection = [state.managed].concat(state.connections).find(item => item.id === id)
    if (!connection)
      return
    event.preventDefault()
    event.stopPropagation()
    openMenu(event.clientX, event.clientY, connection)
  }, true)
  listen(window, 'keydown', (event) => {
    if (event.key === 'Escape') {
      closeMenu()
      return
    }
    if (!menu || menu.hidden)
      return
    const items = Array.from(menu.querySelectorAll('button'))
    const index = items.indexOf(document.activeElement)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
    }
  })
  function dispose() {
    if (disposed)
      return
    disposed = true
    observer.disconnect()
    listeners.forEach(stop => stop())
    timers.forEach(timer => window.clearTimeout(timer))
    originalChildren.forEach((value, child) => {
      if (value === null)
        child.removeAttribute('data-dsh-desktop-managed-child')
      else child.setAttribute('data-dsh-desktop-managed-child', value)
    })
    managedHost?.remove()
    remoteHost?.remove()
    menu?.remove()
    document.getElementById('dsh-desktop-workspace-tree-styles')?.remove()
    document.getElementById('dsh-desktop-connection-toast')?.remove()
    post({ type: 'dsh://workspace-tree:disposed' })
  }
  listen(window, 'pagehide', dispose)
  post({ type: 'dsh://workspace-tree:ready' })
  return dispose
}
