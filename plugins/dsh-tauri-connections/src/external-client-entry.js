import { installExternalAdapter } from './external-adapter.js'

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
      loader.load({
        id: ENTRY_ID,
        factory() {
          return {
            name: ENTRY_ID,
            inject: ['sessions'],
            apply(ctx) {
              ctx.effect(() => installExternalAdapter(id => ctx.sessions.open(id)))
            },
          }
        },
      })
      system.manifest.plugins.push({ id: ENTRY_ID, inject: ['@deepseek-ai/dsh-client-runtime'], immediately: false })
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
