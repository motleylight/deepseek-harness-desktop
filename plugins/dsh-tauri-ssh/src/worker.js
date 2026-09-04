import process from 'node:process'
import { createInterface } from 'node:readline'
import { SshManager } from './manager.js'

const manager = new SshManager({ storagePath: process.argv[2] })
const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
input.on('line', async (line) => {
  let request
  try {
    if (line.length > 65536)
      throw new Error('SSH_REQUEST_TOO_LARGE')
    request = JSON.parse(line)
    const { method, params = {} } = request
    let value
    if (method === 'list')
      value = await manager.list()
    else if (method === 'save')
      value = await manager.save(params)
    else if (method === 'remove')
      value = await manager.remove(params.id)
    else if (method === 'enable')
      value = await manager.enable(params.id, params.enabled)
    else if (method === 'operation')
      value = await manager.operation(params.id, params.request)
    else
      throw new Error('SSH_METHOD_INVALID')
    process.stdout.write(`${JSON.stringify({ id: request.id, ok: true, value })}\n`)
  }
  catch (error) {
    process.stdout.write(`${JSON.stringify({ id: request?.id, ok: false, error: error.message })}\n`)
  }
})
input.once('close', async () => {
  await manager.dispose()
  process.exit(0)
})
