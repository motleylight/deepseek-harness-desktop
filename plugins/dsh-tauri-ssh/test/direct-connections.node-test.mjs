import assert from 'node:assert/strict'
import http from 'node:http'
import { test } from 'node:test'
import { DirectConnections } from '../src/direct-connections.js'

async function server(t, name) {
  let cookieSeen
  const listener = http.createServer((req, res) => {
    cookieSeen = req.headers.cookie
    if (req.url === '/?token=valid') {
      res.writeHead(303, { 'location': '/', 'set-cookie': `dsh-auth-${name}=${name}; HttpOnly; SameSite=Strict; Path=/` })
    }
    else if (req.url === '/?token=redirect') {
      res.writeHead(303, { 'location': 'https://attacker.invalid/', 'set-cookie': 'dsh-auth-foreign=secret' })
    }
    else {
      res.writeHead(req.headers.cookie === `dsh-auth-${name}=${name}` ? 200 : 401)
    }
    res.end(name)
  })
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => {
    listener.closeAllConnections()
    listener.close(resolve)
  }))
  return { url: `http://127.0.0.1:${listener.address().port}/`, cookie: () => cookieSeen }
}

test('launch tokens authenticate separate origins without exposing remote cookies', async (t) => {
  const a = await server(t, 'a')
  const b = await server(t, 'b')
  const manager = new DirectConnections()
  t.after(() => manager.dispose())
  await assert.rejects(manager.probe(a.url), /DSH_AUTH_REQUIRED/)
  assert.equal(await manager.probe(`${a.url}?token=valid`), a.url)
  await assert.rejects(manager.probe(b.url), /DSH_AUTH_REQUIRED/)
  assert.equal(await manager.probe(`${b.url}?token=valid`), b.url)
  const [first, second] = await Promise.all([manager.open('a', a.url), manager.open('b', b.url)])
  const response = await fetch(first)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('set-cookie'), null)
  assert.equal(await response.text(), 'a')
  assert.equal(await (await fetch(second)).text(), 'b')
  assert.equal(a.cookie(), 'dsh-auth-a=a')
  assert.equal(b.cookie(), 'dsh-auth-b=b')
  const replacement = await manager.open('a', a.url)
  await manager.close('a', first)
  assert.equal((await fetch(replacement)).status, 200)
  await assert.rejects(fetch(first))
  await manager.close('a', replacement)
  await assert.rejects(fetch(replacement))
  assert.equal((await fetch(second)).status, 200)
})

test('invalid launch links and cross-origin redirects do not disclose or retain tokens', async (t) => {
  const remote = await server(t, 'a')
  const manager = new DirectConnections()
  t.after(() => manager.dispose())
  for (const suffix of ['?token=wrong', '?token=redirect', '?token=', '?token=valid&extra=x', '?token=valid&token=other']) {
    await assert.rejects(manager.probe(remote.url + suffix), (error) => {
      assert.equal(error.message.includes('wrong'), false)
      assert.equal(error.message.includes('redirect'), false)
      return true
    })
  }
  assert.equal(manager.cookies.size, 0)
  await manager.dispose()
  await assert.rejects(manager.open('a', remote.url), /CLOSED/)
})
