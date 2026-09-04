// Test-only readout of the public sessions store; never included in the installer.
const loader = window.__ModuleLoader__
const create = loader.create
loader.create = function (...args) {
  const system = create.apply(loader, args)
  loader.load({
    id: 'acceptance-session-observer',
    factory() {
      return {
        inject: ['sessions'],
        apply(ctx) {
          ctx.effect(() => {
            const output = document.createElement('output')
            output.style.cssText = 'position:fixed;bottom:0;right:0;z-index:99999;background:#fff;color:#111;font-size:11px'
            document.body.append(output)
            function update() {
              output.textContent = `验收会话 ID：${ctx.sessions.list.getSnapshot().current || '(未选择)'}`
            }
            const unsubscribe = ctx.sessions.list.subscribe(update)
            update()
            return () => {
              unsubscribe()
              output.remove()
            }
          })
        },
      }
    },
  })
  system.manifest.plugins.push({ id: 'acceptance-session-observer', inject: [], immediately: false })
  return system
}
