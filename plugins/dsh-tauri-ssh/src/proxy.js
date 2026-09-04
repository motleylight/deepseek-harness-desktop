import { Buffer } from 'node:buffer'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import http from 'node:http'
import httpProxy from 'http-proxy'

/** Keeps DSH's authority-bound cookie outside a cross-site Desktop iframe. */
export async function createDshProxy({ port = 0, tunnelPort, remotePort, cookie = '' }) {
  const token = randomBytes(32).toString('hex')
  const remoteOrigin = `http://127.0.0.1:${remotePort}`
  let origin
  const sockets = new Set()
  const proxy = httpProxy.createProxyServer({ target: `http://127.0.0.1:${tunnelPort}`, ws: true, headers: { host: `127.0.0.1:${remotePort}`, origin: remoteOrigin, ...(cookie ? { cookie } : {}) } })
  function authorize(request) {
    if (request.headers.host !== new URL(origin).host)
      return false
    if (request.headers.origin && request.headers.origin !== origin)
      return false
    let url
    try {
      url = new URL(request.url, origin)
    }
    catch { return false }
    const supplied = url.searchParams.get('dsh-ssh-token') || request.headers['x-dsh-ssh-token'] || ''
    const exactToken = typeof supplied === 'string' && /^[a-f0-9]{64}$/.test(supplied) && timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
    let samePage = request.headers.origin === origin
    if (request.headers.referer) {
      try {
        samePage ||= new URL(request.headers.referer).origin === origin
      }
      catch { /* Invalid referrers never authenticate a request. */ }
    }
    if (!exactToken && !samePage)
      return false
    if (url.searchParams.has('dsh-ssh-token'))
      url.searchParams.delete('dsh-ssh-token')
    request.url = `${url.pathname}${url.search}`
    delete request.headers['x-dsh-ssh-token']
    delete request.headers.cookie
    request.headers.host = new URL(remoteOrigin).host
    request.headers.origin = remoteOrigin
    request.headers.referer = `${remoteOrigin}/`
    return true
  }
  proxy.on('proxyRes', (response) => {
    delete response.headers['set-cookie']
    response.headers['referrer-policy'] = 'same-origin'
    response.headers['cache-control'] = 'no-store'
  })
  proxy.on('error', (_, __, response) => {
    if ('writeHead' in response && !response.headersSent)
      response.writeHead(502)
    response.end()
  })
  const server = http.createServer((request, response) => {
    if (!authorize(request)) {
      response.writeHead(403, { 'referrer-policy': 'no-referrer' })
      response.end('DSH_DESKTOP_AUTH_REQUIRED')
      return
    }
    proxy.web(request, response)
  })
  server.on('upgrade', (request, socket, head) => {
    if (!authorize(request)) {
      socket.destroy()
      return
    }
    proxy.ws(request, socket, head)
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  const localPort = server.address().port
  origin = `http://127.0.0.1:${localPort}`
  return {
    port: localPort,
    origin,
    url: `${origin}/?dsh-ssh-token=${token}`,
    async close() {
      for (const socket of sockets)
        socket.destroy()
      proxy.close()
      await new Promise(resolve => server.close(resolve))
    },
  }
}
