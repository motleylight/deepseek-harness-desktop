import { SshManager } from './manager.js'

export const name = 'dsh-tauri-ssh'

/** The same service is consumed by the Desktop stdio host; remote services outlive disposal. */
export function apply(ctx, config = {}) {
  const manager = new SshManager(config)
  ctx.provide('dshSsh', manager)
  ctx.effect(() => () => {
    void manager.dispose()
  })
}
