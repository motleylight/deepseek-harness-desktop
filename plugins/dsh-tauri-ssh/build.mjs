import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('.', import.meta.url))
Promise.all([
  build({ absWorkingDir: root, entryPoints: ['src/remote.js'], outfile: 'dist/remote.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node22', legalComments: 'eof' }),
  build({ absWorkingDir: root, entryPoints: ['src/proxy.js'], outfile: 'dist/proxy.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node22', legalComments: 'eof' }),
]).catch((error) => {
  throw error
})
