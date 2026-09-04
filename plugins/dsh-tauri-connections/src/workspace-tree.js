/** Mounts the connection groups in the existing DSH workspace tree; returns full teardown. */
import { isDesktopMessage } from './desktop-message.js'
import { mountNativeWorkspaceActions } from './native-workspace-actions.js'
import { createSessionIndicators } from './session-indicators.js'
import { readWorkspaceSnapshot } from './workspace-snapshot.js'
import { mountWorkspaceToolbar } from './workspace-toolbar.js'

export function mountWorkspaceTree(ctx) {
  if (window === window.top)
    return () => {}
  let disposed = false
  let hasState = false
  const listeners = []
  const timers = []
  const originalChildren = new Map()
  const collapsed = new Set()
  const collapsedWorkspaces = new Set()
  const selectedSessions = new Map()
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
  let menuTarget = null
  const pendingActions = new Map()
  let requestSequence = 0
  let view = { groupBy: 'workspace', orderBy: 'updated' }
  let localSnapshot = { workspaces: [], unassigned: [] }
  let previousLocal = ''
  const indicators = createSessionIndicators()
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
      '.dsh-desktop-connection-row{box-sizing:border-box;display:flex;align-items:center;gap:6px;height:34px;padding:0 8px;border-radius:8px;color:var(--dsw-alias-label-primary);cursor:pointer;font-size:14px;line-height:20px;user-select:none}',
      '.dsh-desktop-connection-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsh-desktop-connection-row[data-depth="session"][aria-selected="true"]{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsh-desktop-connection-row[data-depth="workspace"]{margin-left:14px}',
      '.dsh-desktop-connection-row[data-depth="session"]{margin:2px 0 0 14px;height:32px;gap:0}',
      '.dsh-desktop-connection-row[data-depth="session"] .dsh-desktop-connection-title{margin:0 6px 0 4px}',
      '.dsh-desktop-connection-row .dsh-desktop-connection-icon{display:inline-flex;flex:none;width:16px;height:20px;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary)}',
      '.dsh-desktop-connection-row[data-selected="true"] .dsh-desktop-folder{color:var(--dsw-alias-state-business-primary)}',
      '.dsh-desktop-connection-row .dsh-desktop-chevron,.dsh-desktop-connection-row:hover .dsh-desktop-folder{display:none}',
      '.dsh-desktop-connection-row:hover .dsh-desktop-chevron{display:inline-flex;color:var(--dsw-alias-label-caption)}',
      '.dsh-desktop-connection-row[aria-expanded="true"] .dsh-desktop-chevron svg{transform:rotate(90deg)}',
      '.dsh-desktop-connection-row:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}',
      '#dsh-desktop-external-connections>[data-connection-id]{margin-top:4px}',
      '.dsh-desktop-connection-row .dsh-desktop-connection-title{overflow:hidden;flex:1;min-width:0;text-overflow:ellipsis;white-space:nowrap}',
      '.dsh-desktop-row-create{visibility:hidden;display:inline-flex;align-items:center;justify-content:center;flex:none;width:24px;height:24px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}',
      '.dsh-desktop-connection-row:hover .dsh-desktop-row-create,.dsh-desktop-connection-row:focus-within .dsh-desktop-row-create{visibility:visible}',
      '.dsh-desktop-row-create:hover,.dsh-desktop-badge:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '[data-dsh-desktop-flat="true"]>[data-dsh-desktop-managed-child="true"]{display:none!important}',
      '.dsh-desktop-connection-row[data-flat="true"]{margin-left:0;gap:4px}',
      '.dsh-desktop-badge{flex:0 1 auto;max-width:62px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:1px solid var(--dsw-alias-border-l2);border-radius:4px;padding:1px 4px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:10px;line-height:16px;cursor:pointer}',
      '.dsh-desktop-session-status{display:inline-block;flex:none;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-business-primary);margin:0 5px}',
      '.dsh-desktop-session-status[data-status="running"]{width:10px;height:10px;background:transparent;border:1.5px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-label-primary);animation:dsh-desktop-spin .8s linear infinite}',
      '@keyframes dsh-desktop-spin{to{transform:rotate(360deg)}}',
      '@media(prefers-reduced-motion:reduce){.dsh-desktop-session-status[data-status="running"]{animation:none;border-color:var(--dsw-alias-state-business-primary)}}',
      '[data-dsh-desktop-managed-child="true"]{margin-left:14px !important}',
      '.dsh-desktop-connection-host[data-selected="false"] ~ [data-dsh-desktop-managed-child="true"] [role="treeitem"][aria-selected="true"]:not(:hover){background:transparent}',
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
    // React owns the local rows; only move our two hosts after native insertions.
    if (tree.firstElementChild !== managedHost)
      tree.prepend(managedHost)
    if (tree.lastElementChild !== remoteHost)
      tree.appendChild(remoteHost)
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

  function svgPath(path, size = 16) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`)
    svg.setAttribute('width', String(size))
    svg.setAttribute('height', String(size))
    svg.setAttribute('aria-hidden', 'true')
    const shape = document.createElementNS(svg.namespaceURI, 'path')
    shape.setAttribute('d', path)
    shape.setAttribute('fill', 'currentColor')
    svg.appendChild(shape)
    return svg
  }

  function addFolder(row, open) {
    const folder = create('span', 'dsh-desktop-connection-icon dsh-desktop-folder')
    // DSH's open-folder and disclosure silhouettes, with the native 16/14px slots.
    folder.appendChild(svgPath(open
      ? 'M5.19629 1.57104C5.81144 1.5711 6.38623 1.8786 6.72754 2.39038L7.19922 3.09839C7.28454 3.22635 7.42824 3.30344 7.58203 3.30347H12.1699C13.5039 3.30348 14.5859 4.38548 14.5859 5.71948V6.62671C15.2694 7.02689 15.6605 7.85012 15.4385 8.68726L14.3848 12.658C14.1037 13.7164 13.1449 14.4527 12.0498 14.4529H2.91699C1.51651 14.4529 0.451662 13.2814 0.501954 11.9519V3.98706C0.501954 2.65305 1.58396 1.57104 2.91797 1.57104H5.19629ZM3.7793 7.75562C3.30994 7.75562 2.89883 8.07153 2.77832 8.52515L1.91602 11.7722C1.74167 12.4291 2.23734 13.073 2.91699 13.073H12.0498C12.5191 13.0728 12.9304 12.757 13.0508 12.3035L14.1045 8.33374C14.1819 8.04202 13.9619 7.756 13.6602 7.75562H3.7793ZM2.91797 2.9519C2.34625 2.9519 1.88281 3.41534 1.88281 3.98706V7.2937C2.33068 6.7269 3.02249 6.37476 3.7793 6.37476H13.2051V5.71948C13.2051 5.14777 12.7416 4.68434 12.1699 4.68433H7.58203C6.96675 4.6843 6.39209 4.37595 6.05078 3.86401L5.5791 3.15601C5.49379 3.02821 5.34995 2.95196 5.19629 2.9519H2.91797Z'
      : 'M3 1.8h2.6c.6 0 1.1.3 1.4.8l.5.8h5.4a2.1 2.1 0 0 1 2.1 2.1v6.4a2.1 2.1 0 0 1-2.1 2.1H3a2.1 2.1 0 0 1-2.1-2.1v-8A2.1 2.1 0 0 1 3 1.8Zm0 1.3a.8.8 0 0 0-.8.8v8c0 .4.4.8.8.8h9.9c.4 0 .8-.4.8-.8V5.5a.8.8 0 0 0-.8-.8H7.5c-.5 0-.9-.2-1.1-.6l-.6-.8a.4.4 0 0 0-.3-.2H3Z'))
    row.appendChild(folder)
    const chevron = create('span', 'dsh-desktop-connection-icon dsh-desktop-chevron')
    chevron.appendChild(svgPath('M4.25 2.82782L4.25 11.1722C4.25 11.6622 4.84243 11.9076 5.18891 11.5611L9.36109 7.38891C9.57588 7.17412 9.57588 6.82588 9.36109 6.61109L5.18891 2.43891C4.84243 2.09243 4.25 2.33782 4.25 2.82782Z', 14))
    row.appendChild(chevron)
  }

  function endpointRow(connection) {
    const row = create('div', 'dsh-desktop-connection-row')
    row.setAttribute('role', 'treeitem')
    row.setAttribute('tabindex', '0')
    row.setAttribute('aria-expanded', String(!collapsed.has(connection.id)))
    row.setAttribute('data-connection-id', connection.id)
    row.setAttribute('data-selected', String(state.selectedConnectionId === connection.id))
    row.setAttribute('aria-level', '1')
    row.title = `${connection.name}\n${connection.url}`
    addFolder(row, !collapsed.has(connection.id))
    row.querySelectorAll('.dsh-desktop-connection-icon').forEach(icon => icon.addEventListener('click', (event) => {
      event.stopPropagation()
      toggle(connection.id)
    }))
    const title = create('span', 'dsh-desktop-connection-title', connection.name)
    row.appendChild(title)
    row.appendChild(createButton(localize('newWorkspace'), () => sendAction('add-workspace', connection)))
    row.addEventListener('click', () => {
      post({ type: 'dsh://workspace-tree:action', action: 'select', connectionId: connection.id })
    })
    row.addEventListener('keydown', (event) => {
      if (event.target !== row)
        return
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
    row.setAttribute('aria-level', '2')
    const key = JSON.stringify([connectionId, workspace.id])
    row.setAttribute('data-workspace-key', key)
    row.setAttribute('data-selected', String(state.selectedConnectionId === connectionId && workspace.sessions?.some(session => session.id === selectedSessions.get(connectionId))))
    row.setAttribute('aria-expanded', String(!collapsedWorkspaces.has(key)))
    row.title = workspace.title
    addFolder(row, !collapsedWorkspaces.has(key))
    row.appendChild(create('span', 'dsh-desktop-connection-title', workspace.title))
    if (workspace.id)
      row.appendChild(createButton(localize('newSession'), () => sendAction('new-session', { id: connectionId }, { workspaceId: workspace.id })))
    function toggleWorkspace(closed = !collapsedWorkspaces.has(key)) {
      if (closed)
        collapsedWorkspaces.add(key)
      else collapsedWorkspaces.delete(key)
      render()
    }
    row.addEventListener('click', () => toggleWorkspace())
    row.addEventListener('keydown', (event) => {
      if (event.target !== row)
        return
      if (['Enter', ' ', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault()
        toggleWorkspace(event.key === 'ArrowLeft' || (event.key !== 'ArrowRight' && !collapsedWorkspaces.has(key)))
      }
    })
    return row
  }

  function createButton(label, action) {
    const button = create('button', 'dsh-desktop-row-create')
    button.type = 'button'
    button.setAttribute('aria-label', label)
    button.title = label
    button.appendChild(svgPath('M7.25 2h1.5v5.25H14v1.5H8.75V14h-1.5V8.75H2v-1.5h5.25Z'))
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      action()
    })
    return button
  }

  function badge(name, label, open) {
    const button = create('button', 'dsh-desktop-badge', name)
    button.type = 'button'
    button.title = name
    button.setAttribute('aria-label', label.replace('{name}', name))
    button.setAttribute('aria-haspopup', 'menu')
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      const rect = button.getBoundingClientRect()
      open(rect.left, rect.bottom + 4)
    })
    return button
  }

  function sessionRow(connectionId, session, workspace, flat = false) {
    const row = create('div', 'dsh-desktop-connection-row')
    row.setAttribute('role', 'treeitem')
    row.setAttribute('tabindex', '0')
    row.setAttribute('data-depth', 'session')
    row.setAttribute('aria-level', flat ? '1' : '3')
    row.setAttribute('data-flat', String(flat))
    row.setAttribute('data-session-key', JSON.stringify([connectionId, session.id]))
    row.setAttribute('aria-selected', String(state.selectedConnectionId === connectionId && selectedSessions.get(connectionId) === session.id))
    row.title = session.title
    const status = indicators.get(connectionId, session.id)
    if (status !== 'idle')
      row.appendChild(statusDot(status))
    else if (!flat)
      row.appendChild(create('span', 'dsh-desktop-connection-icon'))
    row.appendChild(create('span', 'dsh-desktop-connection-title', session.blank ? localize('newSession') : session.title))
    if (flat) {
      const connection = [state.managed, ...state.connections].find(item => item.id === connectionId)
      row.appendChild(badge(connection.name, localize('connectionBadge'), (left, top) => openMenu(left, top, connection, undefined, true)))
      const workspaceBadge = badge(workspace?.title || localize('ungrouped'), localize('workspaceBadge'), (left, top) => openMenu(left, top, connection, workspace, true))
      workspaceBadge.disabled = !workspace
      row.appendChild(workspaceBadge)
    }
    const more = createButton(localize('sessionActions'), () => {
      const rect = more.getBoundingClientRect()
      openMenu(rect.left, rect.bottom + 4, { id: connectionId }, undefined, false, session)
    })
    more.replaceChildren(svgPath('M3 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm5 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm5 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z'))
    row.appendChild(more)
    function openSession() {
      selectedSessions.set(connectionId, session.id)
      sendAction('open-session', { id: connectionId }, {
        sessionId: session.id,
        sessionTitle: session.title,
      })
      render()
    }
    row.addEventListener('click', openSession)
    row.addEventListener('keydown', (event) => {
      if (event.target !== row)
        return
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        openSession()
      }
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
    indicators.retain([state.managed.id, ...state.connections.map(connection => connection.id)])
    for (const connection of [state.managed, ...state.connections]) {
      const snapshot = connection.id === state.managed.id ? localSnapshot : state.trees[connection.id]
      if (snapshot)
        indicators.update(connection.id, [...(snapshot.unassigned || []), ...snapshot.workspaces.flatMap(workspace => workspace.sessions || [])], snapshot.currentSessionId, state.selectedConnectionId === connection.id)
    }
    const focused = document.activeElement?.closest('.dsh-desktop-connection-row')
    const focusKey = focused && ['data-connection-id', 'data-workspace-key', 'data-session-key'].map(key => [key, focused.getAttribute(key)]).find(([, value]) => value)
    while (managedHost.firstChild) managedHost.removeChild(managedHost.firstChild)
    while (remoteHost.firstChild) remoteHost.removeChild(remoteHost.firstChild)
    managedHost.setAttribute('data-collapsed', String(collapsed.has(state.managed.id)))
    managedHost.setAttribute('data-selected', String(state.selectedConnectionId === state.managed.id))
    tree.setAttribute('data-dsh-desktop-flat', String(view.groupBy === 'flat'))
    if (view.groupBy === 'flat') {
      const sessions = [state.managed, ...state.connections].flatMap((connection) => {
        const snapshot = connection.id === state.managed.id ? localSnapshot : state.trees[connection.id]
        if (!snapshot)
          return []
        if (snapshot.currentSessionId)
          selectedSessions.set(connection.id, snapshot.currentSessionId)
        const rows = (snapshot.workspaces || []).flatMap(workspace => (workspace.sessions || []).filter(session => visibleSession(session, snapshot)).map(session => ({ connection, workspace, session })))
        return [...rows, ...(snapshot.unassigned || []).filter(session => visibleSession(session, snapshot)).map(session => ({ connection, workspace: undefined, session }))]
      })
      if (view.orderBy === 'updated')
        sessions.sort((a, b) => (b.session.updatedAt || 0) - (a.session.updatedAt || 0))
      sessions.forEach(({ connection, workspace, session }) => remoteHost.appendChild(sessionRow(connection.id, session, workspace, true)))
    }
    else {
      managedHost.appendChild(endpointRow(state.managed))

      for (let index = 0; index < state.connections.length; index++) {
        const connection = state.connections[index]
        remoteHost.appendChild(endpointRow(connection))
        if (collapsed.has(connection.id))
          continue
        const treeState = state.trees[connection.id]
        if (!treeState || !Array.isArray(treeState.workspaces))
          continue
        if (treeState.currentSessionId)
          selectedSessions.set(connection.id, treeState.currentSessionId)
        for (let workspaceIndex = 0; workspaceIndex < treeState.workspaces.length; workspaceIndex++) {
          const workspace = treeState.workspaces[workspaceIndex]
          remoteHost.appendChild(workspaceRow(connection.id, workspace))
          if (collapsedWorkspaces.has(JSON.stringify([connection.id, workspace.id])))
            continue
          const sessions = Array.isArray(workspace.sessions) ? workspace.sessions.filter(session => visibleSession(session, treeState)) : []
          if (view.orderBy === 'updated')
            sessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
          for (let sessionIndex = 0; sessionIndex < sessions.length; sessionIndex++) {
            remoteHost.appendChild(sessionRow(connection.id, sessions[sessionIndex]))
          }
        }
        const unassigned = (treeState.unassigned || []).filter(session => visibleSession(session, treeState))
        if (unassigned.length) {
          remoteHost.appendChild(workspaceRow(connection.id, { id: '', title: localize('ungrouped'), sessions: unassigned }))
          if (!collapsedWorkspaces.has(JSON.stringify([connection.id, '']))) {
            if (view.orderBy === 'updated')
              unassigned.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
            unassigned.forEach(session => remoteHost.appendChild(sessionRow(connection.id, session)))
          }
        }
      }
    }
    refreshManagedChildren()
    refreshLocalReminder()
    if (focusKey) {
      const [key, value] = focusKey
      Array.from(tree.querySelectorAll('.dsh-desktop-connection-row')).find(row => row.getAttribute(key) === value)?.focus({ preventScroll: true })
    }
  }

  function localize(key) {
    return state.labels[key] || ''
  }

  function visibleSession(session, snapshot) {
    return !session.subagent && (!session.blank || snapshot.currentSessionId === session.id)
  }

  function statusDot(status) {
    const dot = create('span', 'dsh-desktop-session-status')
    dot.setAttribute('data-status', status)
    dot.setAttribute('aria-label', localize(status))
    dot.title = localize(status)
    return dot
  }

  function refreshLocalReminder() {
    tree.querySelectorAll('[data-dsh-local-reminder]').forEach(node => node.remove())
    if (view.groupBy === 'flat' || indicators.get(state.managed.id, localSnapshot.currentSessionId) !== 'completed')
      return
    const row = tree.querySelector('[data-dsh-desktop-managed-child="true"] [role="treeitem"][aria-selected="true"]')
    if (row) {
      const dot = statusDot('completed')
      dot.setAttribute('data-dsh-local-reminder', '')
      row.appendChild(dot)
    }
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
    const target = menuTarget
    const item = create('button', danger ? 'dsh-desktop-danger' : '', label)
    item.type = 'button'
    item.setAttribute('role', 'menuitem')
    item.addEventListener('click', () => {
      if (!target)
        return
      closeMenu()
      const extra = target.workspace
        ? { workspaceId: target.workspace.id, workspaceTitle: target.workspace.title }
        : target.session ? { sessionId: target.session.id, sessionTitle: target.session.title } : undefined
      sendAction(['rename', 'edit', 'delete'].includes(action) ? `request-${action}` : action, target.connection, extra)
    })
    return item
  }

  function openMenu(left, top, connection, workspace, compact = false, session) {
    createMenu()
    menuTarget = { connection, workspace, session }
    while (menu.firstChild) menu.removeChild(menu.firstChild)
    if (session) {
      menu.appendChild(menuItem(localize('renameSession'), 'rename-session'))
      menu.appendChild(menuItem(localize('forkSession'), 'fork-session'))
      menu.appendChild(menuItem(localize('archiveSession'), 'archive-session'))
      menu.appendChild(document.createElement('hr'))
      menu.appendChild(menuItem(localize('openPath'), 'open-item-path'))
      menu.appendChild(menuItem(localize('copyPath'), 'copy-path'))
      menu.appendChild(menuItem(localize('copySessionId'), 'copy-session-id'))
      menu.appendChild(document.createElement('hr'))
      menu.appendChild(menuItem(localize('refresh'), 'refresh'))
    }
    else if (workspace) {
      menu.appendChild(menuItem(localize('newSession'), 'new-session'))
      if (!compact) {
        menu.appendChild(document.createElement('hr'))
        menu.appendChild(menuItem(localize('renameWorkspace'), 'rename-workspace'))
        menu.appendChild(menuItem(localize('openPath'), 'open-item-path'))
        menu.appendChild(menuItem(localize('copyPath'), 'copy-path'))
        menu.appendChild(menuItem(localize('archiveWorkspace'), 'archive-workspace'))
        menu.appendChild(menuItem(localize('deleteWorkspace'), 'delete-workspace', true))
        menu.appendChild(document.createElement('hr'))
        menu.appendChild(menuItem(localize('refresh'), 'refresh'))
      }
    }
    else {
      menu.appendChild(menuItem(localize('newWorkspace'), 'add-workspace'))
    }
    if (!workspace && !session && !compact) {
      menu.appendChild(document.createElement('hr'))
      menu.appendChild(menuItem(localize('rename'), 'rename'))
      menu.appendChild(menuItem(localize('copyAddress'), 'copy'))
      if (connection.id !== state.managed.id) {
        menu.appendChild(menuItem(localize('editAddress'), 'edit'))
        menu.appendChild(document.createElement('hr'))
        menu.appendChild(menuItem(localize('disconnect'), 'disconnect'))
        menu.appendChild(menuItem(localize('delete'), 'delete', true))
      }
    }
    menu.style.left = `${String(Math.max(0, Math.min(left, lastWidth - 196)))}px`
    menu.hidden = false
    menu.style.top = `${String(Math.max(0, Math.min(top, window.innerHeight - menu.getBoundingClientRect().height - 8)))}px`
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
    pendingActions.set(requestId, action)
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
    const action = pendingActions.get(data.requestId)
    if (!action)
      return
    pendingActions.delete(data.requestId)
    if (data.ok) {
      if (action === 'copy' || action === 'copy-path' || action === 'copy-session-id')
        showToast(data.message || localize('copied'))
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
  function refreshLocal() {
    const workspaces = ctx.workspaces.list.getSnapshot()
    if (workspaces.phase !== 'ready' || workspaces.error || ctx.sessions.list.getSnapshot().phase !== 'ready')
      return
    const snapshot = readWorkspaceSnapshot(ctx)
    const serialized = JSON.stringify(snapshot)
    if (serialized === previousLocal)
      return
    previousLocal = serialized
    localSnapshot = snapshot
    render()
  }
  listeners.push(ctx.workspaces.list.subscribe(refreshLocal), ctx.sessions.list.subscribe(refreshLocal))
  refreshLocal()
  const stopNativeActions = mountNativeWorkspaceActions(() => localize('newSession'))
  function selectManagedSession(event) {
    const row = event.target instanceof Element && event.target.closest('[data-dsh-desktop-managed-child="true"] [role="treeitem"], [data-dsh-desktop-managed-child="true"][role="treeitem"]')
    if (!row || !tree?.contains(row))
      return
    if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ')
      return
    post({ type: 'dsh://workspace-tree:action', action: 'select', connectionId: state.managed.id })
  }
  listen(window, 'click', selectManagedSession, true)
  listen(window, 'keydown', selectManagedSession, true)
  const stopToolbar = mountWorkspaceToolbar(() => state.labels.toolbar || {}, (action) => {
    if (action === 'select-managed')
      post({ type: 'dsh://workspace-tree:action', action: 'select', connectionId: state.managed.id })
    else
      post({ type: 'dsh://workspace-tree:toolbar', action })
  }, (next) => {
    view = next
    render()
  }, () => !hasState || state.selectedConnectionId === state.managed.id)
  listen(window, 'contextmenu', (event) => {
    const row = event.target instanceof Element && event.target.closest('[data-connection-id], [data-workspace-key], [data-session-key]')
    if (!row || !tree || !tree.contains(row))
      return
    const key = row.getAttribute('data-workspace-key')
    if (key && !JSON.parse(key)[1])
      return
    const sessionKey = row.getAttribute('data-session-key')
    const [id, workspaceId] = key ? JSON.parse(key) : sessionKey ? [JSON.parse(sessionKey)[0]] : [row.getAttribute('data-connection-id')]
    const connection = [state.managed].concat(state.connections).find(item => item.id === id)
    if (!connection)
      return
    event.preventDefault()
    event.stopPropagation()
    const workspace = state.trees[id]?.workspaces?.find(item => item.id === workspaceId)
    const snapshot = id === state.managed.id ? localSnapshot : state.trees[id]
    const session = sessionKey && [...(snapshot?.unassigned || []), ...(snapshot?.workspaces || []).flatMap(workspace => workspace.sessions || [])].find(item => item.id === JSON.parse(sessionKey)[1])
    openMenu(event.clientX, event.clientY, connection, workspace, false, session || undefined)
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
    pendingActions.clear()
    stopToolbar()
    stopNativeActions()
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
    tree?.removeAttribute('data-dsh-desktop-flat')
    tree?.querySelectorAll('[data-dsh-local-reminder]').forEach(node => node.remove())
    menu?.remove()
    document.getElementById('dsh-desktop-workspace-tree-styles')?.remove()
    document.getElementById('dsh-desktop-connection-toast')?.remove()
    post({ type: 'dsh://workspace-tree:disposed' })
  }
  listen(window, 'pagehide', dispose)
  post({ type: 'dsh://workspace-tree:ready' })
  return dispose
}
