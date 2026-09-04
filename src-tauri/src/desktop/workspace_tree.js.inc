(function () {
  if (window.__dsh_desktop_workspace_tree__) return
  window.__dsh_desktop_workspace_tree__ = true
  if (window === window.top) return

  var BRIDGE_SOURCE = 'dsh-desktop-workspace-tree'
  var HOST_SOURCE = 'dsh-desktop'
  var managedHost = null
  var remoteHost = null
  var tree = null
  var dialog = null
  var menu = null
  var selectedAction = null
  var requestSequence = 0
  var resizeObserver = null
  var state = {
    managed: { id: 'managed-local', name: '', url: '' },
    connections: [],
    selectedConnectionId: 'managed-local',
    trees: {},
    labels: {},
  }

  function create(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }

  function addStyles() {
    if (document.getElementById('dsh-desktop-workspace-tree-styles')) return
    var style = document.createElement('style')
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
      '.dsh-desktop-connection-menu{position:fixed;z-index:2147483645;min-width:180px;padding:4px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-specific-sidebar-fill);box-shadow:0 12px 28px rgba(0,0,0,.18)}',
      '.dsh-desktop-connection-menu[hidden]{display:none}',
      '.dsh-desktop-connection-menu button{display:flex;width:100%;align-items:center;gap:8px;min-height:32px;padding:0 9px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;font-size:13px;text-align:left}',
      '.dsh-desktop-connection-menu button:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsh-desktop-connection-menu .dsh-desktop-danger{color:var(--dsw-alias-state-error-primary)}',
      '.dsh-desktop-connection-menu hr{height:1px;margin:4px;border:0;background:var(--dsw-alias-border-l2)}',
      '.dsh-desktop-connection-dialog{position:fixed;z-index:2147483646;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.42)}',
      '.dsh-desktop-connection-dialog[hidden]{display:none}',
      '.dsh-desktop-connection-dialog-card{width:min(420px,calc(100vw - 32px));padding:24px;border:1px solid var(--dsw-alias-border-l2);border-radius:18px;background:var(--dsw-specific-sidebar-fill);box-shadow:0 20px 48px rgba(0,0,0,.26)}',
      '.dsh-desktop-connection-dialog-card h2{margin:0;color:var(--dsw-alias-label-primary);font-size:18px;line-height:26px}',
      '.dsh-desktop-connection-dialog-card p{margin:8px 0 18px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}',
      '.dsh-desktop-connection-dialog-card label{display:block;margin:12px 0 6px;color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.dsh-desktop-connection-dialog-card input{box-sizing:border-box;width:100%;height:42px;padding:7px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:21px;outline:none;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px}',
      '.dsh-desktop-connection-dialog-card input:focus{border-color:var(--dsw-alias-state-business-primary)}',
      '.dsh-desktop-connection-dialog-error{min-height:18px;margin-top:8px;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}',
      '.dsh-desktop-connection-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}',
      '.dsh-desktop-connection-dialog-actions button{min-height:34px;padding:0 13px;border:0;border-radius:17px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;font-size:13px}',
      '.dsh-desktop-connection-dialog-actions .dsh-desktop-primary{background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-on-primary)}',
      '.dsh-desktop-connection-dialog-actions .dsh-desktop-danger{background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-on-primary)}',
      '.dsh-desktop-connection-toast{position:fixed;z-index:2147483647;right:20px;bottom:20px;padding:8px 12px;border-radius:9px;background:var(--dsw-alias-label-primary);color:var(--dsw-specific-sidebar-fill);font-size:12px;line-height:18px}',
      '.dsh-desktop-connection-toast[hidden]{display:none}',
    ].join('')
    ;(document.head || document.documentElement).appendChild(style)
  }

  function post(message) {
    try {
      window.parent.postMessage(Object.assign({ source: BRIDGE_SOURCE }, message), '*')
    }
    catch (_) {}
  }

  function findTree() {
    return document.querySelector('[role="tree"]')
  }

  function refreshManagedChildren() {
    if (!tree || !managedHost || !remoteHost) return
    var children = tree.children
    for (var index = 0; index < children.length; index++) {
      var child = children[index]
      if (child !== managedHost && child !== remoteHost) {
        child.setAttribute('data-dsh-desktop-managed-child', 'true')
      }
    }
  }

  function addIcon(row, icon) {
    row.appendChild(create('span', 'dsh-desktop-connection-icon', icon))
  }

  function endpointRow(connection) {
    var row = create('div', 'dsh-desktop-connection-row')
    row.setAttribute('role', 'treeitem')
    row.setAttribute('tabindex', '0')
    row.setAttribute('aria-expanded', 'true')
    row.setAttribute('data-connection-id', connection.id)
    row.setAttribute('data-selected', String(state.selectedConnectionId === connection.id))
    addIcon(row, '⌄')
    var title = create('span', 'dsh-desktop-connection-title', connection.name)
    row.appendChild(title)
    row.appendChild(create('span', 'dsh-desktop-connection-meta', connection.url))
    row.addEventListener('click', function () {
      post({ type: 'dsh://workspace-tree:action', action: 'select', connectionId: connection.id })
    })
    row.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        post({ type: 'dsh://workspace-tree:action', action: 'select', connectionId: connection.id })
      }
    })
    row.addEventListener('contextmenu', function (event) {
      event.preventDefault()
      openMenu(event.clientX, event.clientY, connection)
    })
    return row
  }

  function workspaceRow(connectionId, workspace) {
    var row = create('div', 'dsh-desktop-connection-row')
    row.setAttribute('role', 'treeitem')
    row.setAttribute('tabindex', '0')
    row.setAttribute('data-depth', 'workspace')
    addIcon(row, '⌄')
    row.appendChild(create('span', 'dsh-desktop-connection-title', workspace.title))
    row.addEventListener('click', function () {
      post({
        type: 'dsh://workspace-tree:action',
        action: 'select',
        connectionId: connectionId,
      })
    })
    return row
  }

  function sessionRow(connectionId, session) {
    var row = create('div', 'dsh-desktop-connection-row')
    row.setAttribute('role', 'treeitem')
    row.setAttribute('tabindex', '0')
    row.setAttribute('data-depth', 'session')
    addIcon(row, '•')
    row.appendChild(create('span', 'dsh-desktop-connection-title', session.title))
    row.addEventListener('click', function () {
      post({
        type: 'dsh://workspace-tree:action',
        action: 'open-session',
        connectionId: connectionId,
        sessionId: session.id,
        sessionTitle: session.title,
      })
    })
    return row
  }

  function render() {
    if (!managedHost || !remoteHost) return
    while (managedHost.firstChild) managedHost.removeChild(managedHost.firstChild)
    while (remoteHost.firstChild) remoteHost.removeChild(remoteHost.firstChild)
    managedHost.appendChild(endpointRow(state.managed))

    for (var index = 0; index < state.connections.length; index++) {
      var connection = state.connections[index]
      remoteHost.appendChild(endpointRow(connection))
      var treeState = state.trees[connection.id]
      if (!treeState || !Array.isArray(treeState.workspaces)) continue
      for (var workspaceIndex = 0; workspaceIndex < treeState.workspaces.length; workspaceIndex++) {
        var workspace = treeState.workspaces[workspaceIndex]
        remoteHost.appendChild(workspaceRow(connection.id, workspace))
        var sessions = Array.isArray(workspace.sessions) ? workspace.sessions : []
        for (var sessionIndex = 0; sessionIndex < sessions.length; sessionIndex++) {
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
    if (menu) return
    menu = create('div', 'dsh-desktop-connection-menu')
    menu.setAttribute('role', 'menu')
    menu.hidden = true
    document.body.appendChild(menu)
    document.addEventListener('pointerdown', function (event) {
      if (menu && !menu.contains(event.target)) closeMenu()
    })
  }

  function menuItem(label, action, danger) {
    var item = create('button', danger ? 'dsh-desktop-danger' : '', label)
    item.type = 'button'
    item.setAttribute('role', 'menuitem')
    item.addEventListener('click', function () {
      if (!selectedAction) return
      closeMenu()
      if (action === 'rename' || action === 'edit') {
        openDialog(action, selectedAction.connection)
      } else if (action === 'delete') {
        openDialog('delete', selectedAction.connection)
      } else {
        sendAction(action, selectedAction.connection)
      }
    })
    return item
  }

  function openMenu(left, top, connection) {
    createMenu()
    selectedAction = { connection: connection }
    while (menu.firstChild) menu.removeChild(menu.firstChild)
    menu.appendChild(menuItem(localize('rename'), 'rename'))
    menu.appendChild(menuItem(localize('copyAddress'), 'copy'))
    if (connection.id !== state.managed.id) {
      menu.appendChild(menuItem(localize('editAddress'), 'edit'))
      menu.appendChild(document.createElement('hr'))
      menu.appendChild(menuItem(localize('disconnect'), 'disconnect'))
      menu.appendChild(menuItem(localize('delete'), 'delete', true))
    }
    menu.style.left = String(Math.min(left, window.innerWidth - 196)) + 'px'
    menu.style.top = String(Math.min(top, window.innerHeight - 180)) + 'px'
    menu.hidden = false
  }

  function closeMenu() {
    if (menu) menu.hidden = true
  }

  function createDialog() {
    if (dialog) return
    dialog = create('div', 'dsh-desktop-connection-dialog')
    dialog.hidden = true
    document.body.appendChild(dialog)
  }

  function openDialog(kind, connection) {
    createDialog()
    selectedAction = { kind: kind, connection: connection }
    while (dialog.firstChild) dialog.removeChild(dialog.firstChild)
    var card = create('div', 'dsh-desktop-connection-dialog-card')
    var title = kind === 'rename'
      ? localize('renameTitle')
      : kind === 'edit'
        ? localize('editAddressTitle')
        : localize('deleteTitle')
    card.appendChild(create('h2', '', title))
    var description = kind === 'delete'
      ? localize('deleteDescription').replace('{name}', connection.name)
      : kind === 'edit'
        ? localize('editAddressDescription')
        : localize('renameDescription')
    card.appendChild(create('p', '', description))
    var nameInput = null
    var urlInput = null
    if (kind === 'rename') {
      card.appendChild(create('label', '', localize('nameLabel')))
      nameInput = create('input')
      nameInput.value = connection.name
      card.appendChild(nameInput)
    }
    if (kind === 'edit') {
      card.appendChild(create('label', '', localize('addressLabel')))
      urlInput = create('input')
      urlInput.value = connection.url
      card.appendChild(urlInput)
    }
    var error = create('div', 'dsh-desktop-connection-dialog-error')
    card.appendChild(error)
    var actions = create('div', 'dsh-desktop-connection-dialog-actions')
    var cancel = create('button', '', localize('cancel'))
    cancel.type = 'button'
    cancel.addEventListener('click', closeDialog)
    actions.appendChild(cancel)
    var confirm = create('button', kind === 'delete' ? 'dsh-desktop-danger' : 'dsh-desktop-primary', kind === 'delete' ? localize('delete') : localize('save'))
    confirm.type = 'button'
    confirm.addEventListener('click', function () {
      error.textContent = ''
      if (kind === 'rename') {
        sendAction('rename', connection, { name: nameInput.value })
      } else if (kind === 'edit') {
        sendAction('edit', connection, { url: urlInput.value })
      } else {
        sendAction('delete', connection)
      }
    })
    actions.appendChild(confirm)
    card.appendChild(actions)
    dialog.appendChild(card)
    dialog.hidden = false
    var focusTarget = nameInput || urlInput
    if (focusTarget) {
      focusTarget.focus()
      focusTarget.select()
    }
  }

  function closeDialog() {
    if (dialog) dialog.hidden = true
    selectedAction = null
  }

  function showToast(message) {
    var toast = document.getElementById('dsh-desktop-connection-toast')
    if (!toast) {
      toast = create('div', 'dsh-desktop-connection-toast')
      toast.id = 'dsh-desktop-connection-toast'
      document.body.appendChild(toast)
    }
    toast.textContent = message
    toast.hidden = false
    window.setTimeout(function () { toast.hidden = true }, 2200)
  }

  function sendAction(action, connection, extra) {
    var requestId = String(++requestSequence)
    selectedAction = Object.assign({ action: action, connection: connection, requestId: requestId }, extra || {})
    post(Object.assign({
      type: 'dsh://workspace-tree:action',
      action: action,
      connectionId: connection.id,
      requestId: requestId,
    }, extra || {}))
  }

  function reportLayout() {
    var overlay = document.querySelector('[data-shell-overlay]')
    var frame = overlay && overlay.parentElement
    var sidebar = frame && frame.firstElementChild
    if (!sidebar) return
    post({
      type: 'dsh://workspace-tree:layout',
      sidebarWidth: Math.round(sidebar.getBoundingClientRect().width),
    })
  }

  function install() {
    var nextTree = findTree()
    if (!nextTree) return false
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
    if (!selectedAction || data.requestId !== selectedAction.requestId) return
    if (data.ok) {
      if (selectedAction.action === 'copy') showToast(data.message || localize('copied'))
      else if (selectedAction.action !== 'disconnect') closeDialog()
      selectedAction = null
      return
    }
    if (dialog && !dialog.hidden) {
      var error = dialog.querySelector('.dsh-desktop-connection-dialog-error')
      if (error) error.textContent = data.message || localize('actionFailed')
    } else {
      showToast(data.message || localize('actionFailed'))
    }
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return
    var data = event.data
    if (!data || typeof data !== 'object' || data.source !== HOST_SOURCE) return
    if (data.type === 'dsh://workspace-tree:state' && data.state) {
      state = data.state
      install()
    } else if (data.type === 'dsh://workspace-tree:result') {
      handleResult(data)
    }
  })

  var observer = new MutationObserver(function () {
    var nextTree = findTree()
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
  window.addEventListener('resize', reportLayout)
  window.addEventListener('pagehide', function () {
    observer.disconnect()
    if (resizeObserver) resizeObserver.disconnect()
  })
  install()
})()
