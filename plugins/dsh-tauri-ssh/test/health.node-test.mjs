import assert from 'node:assert/strict'
import { it } from 'node:test'
import { probeDsh } from '../src/health.js'

it('Supports both gateway generations without accepting unrelated HTTP success', async (t) => {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push(JSON.parse(options.body))
    if (url.endsWith('session.list'))
      return new Response('not found', { status: 404 })
    const request = JSON.parse(options.body)
    assert.deepEqual(request.payload.args, { _request: {} })
    return Response.json({ rpcId: request.rpcId, result: { ok: true, value: { items: [] } } })
  })
  assert.equal(await probeDsh('http://127.0.0.1:3080'), true)
  assert.deepEqual(requests.map(item => item.method), ['session.list', 'session/list'])
  t.mock.method(globalThis, 'fetch', async () => Response.json({ rpcId: 'unrelated', result: { ok: true } }))
  assert.equal(await probeDsh('http://127.0.0.1:3080'), false)
})

it('Does not treat authentication failure as a gateway version difference', async (t) => {
  let count = 0
  t.mock.method(globalThis, 'fetch', async () => {
    count++
    return new Response('unauthorized', { status: 401 })
  })
  assert.equal(await probeDsh('http://127.0.0.1:3080'), false)
  assert.equal(count, 1)
})
