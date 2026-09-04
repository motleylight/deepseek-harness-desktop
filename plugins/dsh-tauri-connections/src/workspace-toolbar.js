/** Retains the native buttons and menu; routes creation/search through Desktop's endpoint picker. */
export function mountWorkspaceToolbar(getLabels, dispatch, onViewChange) {
  const originals = new Map()
  let previousView = ''
  function actionOf(button) {
    if (button.matches('.dshp-newSession, .dshp-brand'))
      return 'new-session'
    const label = originals.get(button)?.aria ?? button.getAttribute('aria-label')
    if (label === 'New session' || label === '新建会话')
      return 'new-session'
    if (label === 'Search sessions' || label === '搜索会话')
      return 'search'
    if (label === 'Add workspace' || label === '添加工作区')
      return 'add-workspace'
    if (label === 'View options' || label === '视图选项')
      return 'view'
  }
  function refresh() {
    const labels = getLabels()
    document.querySelectorAll('button').forEach((button) => {
      const action = actionOf(button)
      if (!action || !labels[action])
        return
      if (!originals.has(button))
        originals.set(button, { aria: button.getAttribute('aria-label'), title: button.getAttribute('title') })
      if (button.getAttribute('aria-label') !== labels[action])
        button.setAttribute('aria-label', labels[action])
      if (button.getAttribute('title') !== labels[action])
        button.setAttribute('title', labels[action])
    })
    // Native workspace view preferences are shared across the entire tree, including projections.
    try {
      const value = localStorage.getItem('dsh.workspace.view.v5') || '{}'
      if (value !== previousView) {
        previousView = value
        const state = JSON.parse(value)
        onViewChange({ groupBy: state.groupBy === 'flat' ? 'flat' : 'workspace', orderBy: state.orderBy === 'manual' ? 'manual' : 'updated' })
      }
    }
    catch { /* A denied or malformed browser preference leaves the native default view in place. */ }
  }
  function click(event) {
    if (event.target instanceof Element && event.target.matches('input[class*="searchInput"]')) {
      event.preventDefault()
      event.stopImmediatePropagation()
      dispatch('search')
      return
    }
    const button = event.target instanceof Element && event.target.closest('button')
    if (!button)
      return
    const action = actionOf(button)
    if (!action || action === 'view')
      return
    event.preventDefault()
    event.stopImmediatePropagation()
    dispatch(action)
  }
  window.addEventListener('click', click, true)
  const timer = window.setInterval(refresh, 200)
  refresh()
  return () => {
    window.clearInterval(timer)
    window.removeEventListener('click', click, true)
    originals.forEach((value, button) => {
      for (const [attribute, original] of [['aria-label', value.aria], ['title', value.title]]) {
        if (original === null)
          button.removeAttribute(attribute)
        else button.setAttribute(attribute, original)
      }
    })
  }
}
