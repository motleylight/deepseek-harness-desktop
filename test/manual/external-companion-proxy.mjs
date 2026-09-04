/** Local-only acceptance proxy simulating native document-start companion injection. */
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { createServer, request } from 'node:http'
import process from 'node:process'

const observer = readFileSync(new URL('./session-selection-observer.js', import.meta.url), 'utf8')
function startProxy(port, target, managed) {
  const server = createServer((incoming, outgoing) => {
    const upstream = request({ hostname: '127.0.0.1', port: target, path: incoming.url, method: incoming.method, headers: { ...incoming.headers, 'host': `127.0.0.1:${target}`, 'origin': `http://127.0.0.1:${target}`, 'accept-encoding': 'identity' } }, (response) => {
      const headers = { ...response.headers }
      const htmlResponse = String(headers['content-type']).includes('text/html')
      const scriptResponse = managed && String(headers['content-type']).includes('javascript')
      if (!htmlResponse && !scriptResponse) {
        outgoing.writeHead(response.statusCode, headers)
        response.pipe(outgoing)
        return
      }
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        delete headers['content-length']
        const originalHtml = Buffer.concat(chunks).toString('utf8')
        if (scriptResponse) {
        // The same SlotOutlet export patch applied by the production launcher, in memory only.
          const script = originalHtml.includes('function SlotOutlet(') && !originalHtml.includes('exports.SlotOutlet')
            ? originalHtml.replace(/^(\s*)return module.exports;/m, '$1exports.SlotOutlet = SlotOutlet;\n$1return module.exports;')
            : originalHtml
          outgoing.writeHead(response.statusCode, headers)
          outgoing.end(script)
          return
        }
        const companion = managed ? '' : readFileSync(new URL('../../plugins/dsh-tauri-connections/dist/external.js', import.meta.url), 'utf8')
        const html = originalHtml.replace('<head>', `<head><script>${companion.replaceAll('</script', '<\\/script')}</script>`).replace('</head>', `<script>${observer}</script></head>`)
        outgoing.writeHead(response.statusCode, headers)
        outgoing.end(html)
      })
    })
    upstream.on('error', (error) => {
      if (outgoing.headersSent) {
        outgoing.destroy(error)
        return
      }
      outgoing.writeHead(502)
      outgoing.end(error.message)
    })
    incoming.pipe(upstream)
  })
  server.on('upgrade', (incoming, socket, head) => {
    const upstream = request({ hostname: '127.0.0.1', port: target, path: incoming.url, headers: { ...incoming.headers, host: `127.0.0.1:${target}`, origin: `http://127.0.0.1:${target}` } })
    upstream.on('upgrade', (response, peer, upstreamHead) => {
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n`)
      if (head.length)
        peer.write(head)
      if (upstreamHead.length)
        socket.write(upstreamHead)
      socket.pipe(peer).pipe(socket)
      peer.on('error', () => socket.destroy())
      socket.on('error', () => peer.destroy())
      socket.on('close', () => peer.destroy())
      peer.on('close', () => socket.destroy())
    })
    upstream.on('error', () => socket.destroy())
    upstream.on('response', () => socket.destroy())
    upstream.end()
  })
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`Acceptance proxy http://127.0.0.1:${port} → DSH :${target}\n`)
  })
}
startProxy(3183, 3182, false)
startProxy(3184, 3181, true)
startProxy(3186, 3185, false)
