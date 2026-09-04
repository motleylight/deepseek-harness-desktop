import { installExternalAdapter } from './external-adapter.js'
import { mountWorkspaceCommands } from './workspace-commands.js'

const ENTRY_ID = 'dsh-tauri-connections-companion'

/** Register the bundled companion in the page's Cordis boot, without changing its server profile. */
export function installExternalClientEntry() {
  if (window === window.top || new URL(location.href).searchParams.get('dsh-desktop-external') !== '1')
    return () => {}
  const key = '__ModuleLoader__'
  const descriptor = Object.getOwnPropertyDescriptor(window, key)
  let restore = () => {}

  function wrap(loader) {
    if (!loader || loader.mode !== 'queue' || typeof loader.create !== 'function')
      return
    const create = loader.create
    function createWithCompanion(...args) {
      dispose()
      const system = create.apply(loader, args)
      if (system.manifest.plugins.some(entry => entry.id === 'dsh-tauri-connections'))
        return system
      const controllers = system.manifest.plugins.some(entry => entry.id === '@deepseek-ai/dsh-api-workspace-controller')
      loader.load({
        id: ENTRY_ID,
        factory() {
          return {
            name: ENTRY_ID,
            inject: ['sessions', 'workspaces', 'connection'],
            apply(ctx) {
              ctx.effect(() => {
                const stopCommands = mountWorkspaceCommands(ctx)
                const stopAdapter = installExternalAdapter(id => ctx.sessions.open(id), { sessions: ctx.sessions.list, workspaces: ctx.workspaces.list, host: ctx.connection.hostDescription })
                return () => {
                  stopCommands()
                  stopAdapter()
                }
              })
            },
          }
        },
      })
      system.manifest.plugins.push({ id: ENTRY_ID, inject: controllers ? ['@deepseek-ai/dsh-api-session-controller', '@deepseek-ai/dsh-api-workspace-controller'] : ['@deepseek-ai/dsh-client-runtime'], immediately: false })
      return system
    }
    loader.create = createWithCompanion
    restore = () => {
      if (loader.create === createWithCompanion)
        loader.create = create
    }
  }

  function dispose() {
    restore()
    window.removeEventListener('pagehide', dispose)
  }

  if (descriptor) {
    wrap(window[key])
  }
  else {
    // Native document-start injection runs before DSH assigns its public boot facade.
    Object.defineProperty(window, key, {
      configurable: true,
      get() { return undefined },
      set(loader) {
        Object.defineProperty(window, key, { configurable: true, enumerable: true, writable: true, value: loader })
        wrap(loader)
      },
    })
    restore = () => {
      delete window[key]
    }
  }
  window.addEventListener('pagehide', dispose)
  return dispose
}
