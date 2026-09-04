import { randomUUID } from 'node:crypto'

/** Correlate a read-only DSH response across the legacy and current gateway URLs. */
export async function probeDsh(origin, headers = {}, timeout = 1500) {
  for (const endpoint of ['session.list', 'session/list']) {
    const rpcId = randomUUID()
    const response = await fetch(`${origin}/api/${endpoint}`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload: { args: endpoint.includes('/') ? { _request: {} } : {} } }),
      signal: AbortSignal.timeout(timeout),
    })
    if (response.status === 404) {
      await response.body?.cancel()
      continue
    }
    if (!response.ok)
      return false
    const reply = await response.json()
    return reply.rpcId === rpcId && reply.result?.ok === true
  }
  return false
}
