import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

const root = fileURLToPath(new URL('.', import.meta.url))
const dist = fileURLToPath(new URL('dist/', import.meta.url))
mkdirSync(dist, { recursive: true })
const client = buildSync({ absWorkingDir: root, entryPoints: ['src/client.js'], bundle: true, platform: 'browser', format: 'cjs', write: false, target: 'es2021' }).outputFiles[0].text
writeFileSync(`${dist}/client.cjs`, `window.__ModuleLoader__.load({id:"dsh-tauri-connections",factory:function(require){var module={exports:{}};var exports=module.exports;\n${client}\nreturn module.exports;}});\n`)
buildSync({ absWorkingDir: root, entryPoints: ['src/index.js'], outfile: `${dist}/index.js`, platform: 'node', format: 'esm' })
buildSync({ absWorkingDir: root, entryPoints: ['src/external-bootstrap.js'], outfile: `${dist}/external.js`, bundle: true, platform: 'browser', format: 'iife', target: 'es2021' })
