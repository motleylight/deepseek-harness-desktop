/** Local-only acceptance proxy simulating native document-start companion injection. */
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { createServer, request } from 'node:http'
import process from 'node:process'

const companion = readFileSync(new URL('../../plugins/dsh-tauri-connections/dist/external.js', import.meta.url), 'utf8')
const observer = readFileSync(new URL('./session-selection-observer.js', import.meta.url), 'utf8')
const server = createServer((incoming, outgoing) => {
  const upstream = request({ hostname: '127.0.0.1', port: 3182, path: incoming.url, method: incoming.method, headers: { ...incoming.headers, 'host': '127.0.0.1:3182', 'origin': 'http://127.0.0.1:3182', 'accept-encoding': 'identity' } }, (response) => {
    const headers = { ...response.headers }
    if (!String(headers['content-type']).includes('text/html')) {
      outgoing.writeHead(response.statusCode, headers)
      response.pipe(outgoing)
      return
    }
    const chunks = []
    response.on('data', chunk => chunks.push(chunk))
    response.on('end', () => {
      delete headers['content-length']
      const originalHtml = Buffer.concat(chunks).toString('utf8')
      const html = originalHtml.replace('<head>', `<head><script>${companion.replaceAll('</script', '<\\/script')}</script>`).replace('</head>', `<script>${observer}</script></head>`)
      outgoing.writeHead(response.statusCode, headers)
      outgoing.end(html)
    })
  })
  upstream.on('error', (error) => {
    outgoing.writeHead(502)
    outgoing.end(error.message)
  })
  incoming.pipe(upstream)
})
server.listen(3183, '127.0.0.1', () => {
  process.stdout.write('Companion acceptance proxy http://127.0.0.1:3183 → DSH :3182\n')
})
