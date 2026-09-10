// eslint-disable-next-line antfu/no-import-dist -- The worker ships the self-contained proxy bundle without installing dependencies.
import proxyModule from '../dist/proxy.cjs'

const { createDshProxy } = proxyModule

/** Normalize a DSH launch link without persisting or returning its launch token. */
function address(input) {
  let url
  try {
    const text = input.trim()
    url = new URL(text.includes('://') ? text : `http://${text}`)
  }
  catch { throw new Error('DSH_CONNECTION_URL_INVALID') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash
    || [...url.searchParams.keys()].some(key => key !== 'token') || url.searchParams.getAll('token').length > 1) {
    throw new Error('DSH_CONNECTION_URL_INVALID')
  }
  const token = url.searchParams.get('token')
  if (token !== null && !token)
    throw new Error('DSH_CONNECTION_TOKEN_EMPTY')
  url.search = ''
  if (!url.pathname.endsWith('/'))
    url.pathname += '/'
  return { url, token }
}

/** Per-process authenticated transports; cookies never enter the WebView or saved connection list. */
export class DirectConnections {
  cookies = new Map()
  live = new Map()
  pending = new Map()
  closed = false

  async probe(input) {
    if (this.closed)
      throw new Error('DSH_CONNECTIONS_CLOSED')
    const { url, token } = address(input)
    let cookie = this.cookies.get(url.href) ?? ''
    try {
      if (token !== null) {
        const launch = new URL(url)
        launch.searchParams.set('token', token)
        const response = await fetch(launch, { redirect: 'manual', signal: AbortSignal.timeout(15000) })
        const location = response.headers.get('location')
        await response.body?.cancel()
        if (response.status !== 303 || location === null || new URL(location, url).origin !== url.origin)
          throw new Error('DSH_AUTH_REJECTED')
        cookie = response.headers.getSetCookie().filter(value => value.startsWith('dsh-auth-')).map(value => value.split(';')[0]).join('; ')
        if (!cookie)
          throw new Error('DSH_AUTH_COOKIE_MISSING')
      }
      const response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
        headers: cookie ? { cookie } : {},
      })
      await response.body?.cancel()
      if (response.status === 401 || response.status === 403) {
        this.cookies.delete(url.href)
        throw new Error('DSH_AUTH_REQUIRED: paste a fresh DSH launch link containing ?token= in Edit connection')
      }
      if (!response.ok)
        throw new Error(`DSH_CONNECTION_HTTP_${response.status}`)
      if (this.closed)
        throw new Error('DSH_CONNECTIONS_CLOSED')
      this.cookies.set(url.href, cookie)
      return url.href
    }
    catch (error) {
      // Network errors can include a credential-bearing URL in their causes.
      if (error instanceof Error && error.message.startsWith('DSH_'))
        throw error
      throw new Error('DSH_CONNECTION_UNREACHABLE')
    }
  }

  async open(id, input) {
    if (typeof id !== 'string' || !id)
      throw new Error('DSH_CONNECTION_ID_REQUIRED')
    const previous = this.pending.get(id) ?? Promise.resolve()
    const task = previous.catch(() => {}).then(async () => {
      const url = await this.probe(input)
      await this.live.get(id)?.close()
      this.live.delete(id)
      const parsed = new URL(url)
      const proxy = await createDshProxy({ target: url, authority: parsed.origin, cookie: this.cookies.get(url) })
      if (this.closed) {
        await proxy.close()
        throw new Error('DSH_CONNECTIONS_CLOSED')
      }
      this.live.set(id, proxy)
      return proxy.url
    })
    this.pending.set(id, task)
    try {
      return await task
    }
    finally {
      if (this.pending.get(id) === task)
        this.pending.delete(id)
    }
  }

  async close(id, lease) {
    const proxy = this.live.get(id)
    if (proxy?.url !== lease)
      return
    this.live.delete(id)
    await proxy.close()
  }

  async dispose() {
    this.closed = true
    await Promise.allSettled(this.pending.values())
    await Promise.all([...this.live.values()].map(proxy => proxy.close()))
    this.live.clear()
    this.cookies.clear()
  }
}
