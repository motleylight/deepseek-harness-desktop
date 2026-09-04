// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { mountNativeWorkspaceActions } from '../plugins/dsh-tauri-connections/src/native-workspace-actions.js'

let stop: (() => void) | undefined
afterEach(() => {
  stop?.()
  document.body.innerHTML = ''
})

it('does not intercept the bundled right-click plugin full menu', () => {
  const key = Symbol.for('dsh.rightclick-menu.extensions')
  Object.assign(globalThis, { [key]: {} })
  document.body.innerHTML = '<div data-dsh-desktop-managed-child="true"><div role="treeitem" aria-expanded="true"><button aria-label="Workspace actions for A">...</button><button aria-label="New session in A">+</button></div></div>'
  const nativeMenu = vi.fn()
  document.addEventListener('contextmenu', nativeMenu)
  stop = mountNativeWorkspaceActions(() => 'New session')
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  document.querySelector('[role="treeitem"]')!.dispatchEvent(event)
  expect(nativeMenu).toHaveBeenCalledOnce()
  expect(event.defaultPrevented).toBe(false)
  document.removeEventListener('contextmenu', nativeMenu)
  Reflect.deleteProperty(globalThis, key)
})

it('adds new session to the original menu and invokes only the clicked row native action', async () => {
  document.body.innerHTML = '<div data-dsh-desktop-managed-child="true"><div role="treeitem" aria-expanded="true"><button aria-label="Workspace actions for A">...</button><button aria-label="New session in A">+</button></div></div>'
  const [more, plus] = document.querySelectorAll('button')
  const create = vi.fn()
  plus.addEventListener('click', create)
  const rename = vi.fn()
  more.addEventListener('click', () => {
    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    menu.innerHTML = '<div role="presentation"><button role="menuitem"><span>Rename</span></button><button role="menuitem">Delete workspace</button></div>'
    menu.querySelector('button')!.addEventListener('click', rename)
    document.body.appendChild(menu)
  })
  stop = mountNativeWorkspaceActions(() => 'New session')
  document.querySelector('[role="treeitem"]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  await vi.waitFor(() => expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(3))
  const items = document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
  expect([...items].map(item => item.textContent)).toEqual(['New session', 'Rename', 'Delete workspace'])
  items[1].click()
  expect(rename).toHaveBeenCalledOnce()
  items[0].click()
  expect(create).toHaveBeenCalledOnce()
  stop()
  expect(document.querySelector('[data-dsh-new-session]')).toBeNull()
  expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(2)
})
