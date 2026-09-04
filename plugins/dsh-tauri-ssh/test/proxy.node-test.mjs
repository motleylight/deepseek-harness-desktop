import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { test } from 'node:test'
// eslint-disable-next-line antfu/no-import-dist -- Exercise the shipped bundle, including its vendored HTTP proxy.
import proxyModule from '../dist/proxy.cjs'

const { createDshProxy } = proxyModule
test('loopback bridge keeps remote cookies private and rejects cross-site and rebinding requests', async (t) => {
  let seen
  let seenUrl
  const target = http.createServer((req, res) => {
    seen = req.headers
    seenUrl = req.url
    res.writeHead(200, { 'set-cookie': 'remote-secret=value; SameSite=Strict' })
    res.end('authenticated')
  })
  await new Promise(resolve => target.listen(0, '127.0.0.1', resolve))
  const proxy = await createDshProxy({ tunnelPort: target.address().port, remotePort: 3080, cookie: 'dsh-private=secret' })
  t.after(async () => {
    await proxy.close()
    await new Promise(resolve => target.close(resolve))
  })
  assert.equal((await fetch(proxy.origin)).status, 403)
  assert.equal((await fetch(proxy.url, { headers: { origin: 'https://attacker.invalid' } })).status, 403)
  assert.equal((await fetch(`${proxy.origin}/?dsh-ssh-token=${'字'.repeat(64)}`)).status, 403)
  const response = await fetch(proxy.url)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('set-cookie'), null)
  assert.equal(response.headers.get('referrer-policy'), 'same-origin')
  assert.equal(seen.cookie, 'dsh-private=secret')
  assert.equal(seen.host, '127.0.0.1:3080')
  assert.equal(seen.origin, 'http://127.0.0.1:3080')
  assert.equal((await fetch(`${proxy.origin}/api/test`, { headers: { origin: proxy.origin } })).status, 200)
  assert.equal((await fetch(`${proxy.origin}/asset.js`, { headers: { referer: proxy.url } })).status, 200)
  const combo = '/plugins/??@deepseek-ai/dsh-client-modules/client.js&rev=abc'
  assert.equal((await fetch(`${proxy.origin}${combo}`, { headers: { referer: proxy.url } })).status, 200)
  assert.equal(seenUrl, combo)
  const rebound = await new Promise((resolve, reject) => {
    const request = http.get(proxy.url, { headers: { host: 'attacker.invalid' } }, (response) => {
      response.resume()
      resolve(response.statusCode)
    })
    request.on('error', reject)
  })
  assert.equal(rebound, 403)
})

test('closing the bridge closes upgraded sockets as well as its listener', async () => {
  const target = http.createServer()
  let upstream
  target.on('upgrade', (request, socket) => {
    upstream = socket
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
  })
  await new Promise(resolve => target.listen(0, '127.0.0.1', resolve))
  const proxy = await createDshProxy({ tunnelPort: target.address().port, remotePort: 3080 })
  const socket = net.connect(proxy.port, '127.0.0.1')
  const upgraded = new Promise(resolve => socket.once('data', resolve))
  socket.write(`GET /api/live HTTP/1.1\r\nHost: 127.0.0.1:${proxy.port}\r\nOrigin: ${proxy.origin}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`)
  assert.match(String(await upgraded), /101 Switching/)
  const closed = new Promise(resolve => socket.once('close', resolve))
  await proxy.close()
  await closed
  upstream?.destroy()
  await new Promise(resolve => target.close(resolve))
})
