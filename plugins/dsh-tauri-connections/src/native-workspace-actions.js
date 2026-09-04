/** Extend the native workspace menu through its existing row buttons; retain React-owned actions. */
export function mountNativeWorkspaceActions(getLabel) {
  let active
  const additions = new Set()
  function controls(target) {
    const row = target instanceof Element && target.closest('[data-dsh-desktop-managed-child="true"] [role="treeitem"][aria-expanded], [data-dsh-desktop-managed-child="true"][role="treeitem"][aria-expanded]')
    if (!row)
      return
    const buttons = Array.from(row.querySelectorAll('button'))
    const create = buttons.find(button => /^(?:New session in |在“)/.test(button.getAttribute('aria-label') || ''))
    const more = buttons.find(button => /^(?:Workspace actions for |工作区“)/.test(button.getAttribute('aria-label') || ''))
    if (create && more)
      return { row, create, more }
  }
  function remember(event) {
    const found = controls(event.target)
    if (found && found.more.contains(event.target))
      active = found
  }
  function context(event) {
    // The bundled right-click plugin already supplies the full native row menu.
    if (globalThis[Symbol.for('dsh.rightclick-menu.extensions')])
      return
    const found = controls(event.target)
    if (!found) {
      const row = event.target instanceof Element && event.target.closest('[data-dsh-desktop-managed-child="true"] [role="treeitem"][aria-selected]')
      const more = row && Array.from(row.querySelectorAll('button')).find(button => /^(?:Session actions for |会话“)/.test(button.getAttribute('aria-label') || ''))
      if (more) {
        event.preventDefault()
        event.stopPropagation()
        more.click()
      }
      return
    }
    event.preventDefault()
    event.stopPropagation()
    active = found
    found.more.click()
  }
  function refresh() {
    additions.forEach((node) => {
      if (!node.isConnected)
        additions.delete(node)
    })
    if (!active?.row.isConnected)
      return
    const menus = Array.from(document.querySelectorAll('[role="menu"]')).filter(menu => !menu.classList.contains('dsh-desktop-connection-menu'))
    if (menus.length !== 1 || menus[0].querySelector('[data-dsh-new-session]'))
      return
    const first = menus[0].querySelector('button[role="menuitem"]')
    if (!first)
      return
    const target = active
    const item = first.cloneNode(false)
    item.removeAttribute('aria-haspopup')
    item.removeAttribute('aria-expanded')
    item.setAttribute('data-dsh-new-session', '')
    const icon = first.querySelector('svg')?.parentElement.cloneNode(false)
    const plus = target.create.querySelector('svg')
    if (icon && plus) {
      icon.appendChild(plus.cloneNode(true))
      item.appendChild(icon)
    }
    const label = first.lastElementChild?.cloneNode(false) || document.createElement('span')
    label.textContent = getLabel()
    item.appendChild(label)
    item.addEventListener('click', (event) => {
      event.stopPropagation()
      if (!target.row.isConnected)
        return
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      target.create.click()
    })
    const viewport = first.closest('[role="menu"]')?.querySelector('[role="presentation"]') || menus[0]
    viewport.prepend(item)
    additions.add(item)
    active = undefined
  }
  const observer = new MutationObserver(refresh)
  observer.observe(document.body, { childList: true, subtree: true })
  window.addEventListener('click', remember, true)
  window.addEventListener('contextmenu', context, true)
  return () => {
    observer.disconnect()
    window.removeEventListener('click', remember, true)
    window.removeEventListener('contextmenu', context, true)
    additions.forEach(node => node.remove())
  }
}
