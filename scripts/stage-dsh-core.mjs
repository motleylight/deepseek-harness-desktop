import { execFileSync } from 'node:child_process'
/** Materialize a built DSH CLI deploy for the Desktop Windows core ZIP. Requires Node 24. */
import { cpSync, existsSync, globSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'

const [sourceArg, deployArg] = process.argv.slice(2)
if (!sourceArg || !deployArg)
  throw new Error('Usage: node scripts/stage-dsh-core.mjs <built-dsh-checkout> <cli-deploy>')
const source = resolve(sourceArg)
const deploy = resolve(deployArg)
const modules = join(deploy, 'node_modules')
const read = path => JSON.parse(readFileSync(path, 'utf8'))
const cli = read(join(deploy, 'package.json'))
if (cli.name !== '@deepseek-ai/dsh')
  throw new Error('Expected a fresh pnpm deploy of @deepseek-ai/dsh')
const workspace = new Map()
for (const file of execFileSync('git', ['ls-files', '--', '**/package.json'], { cwd: source, encoding: 'utf8' }).trim().split('\n')) {
  const path = join(source, file)
  const manifest = read(path)
  workspace.set(manifest.name, { path: dirname(path), manifest })
}

/** Copy only published files; workspace dependency versions must be portable. */
function copyPackage(name, entry) {
  const target = join(modules, name)
  mkdirSync(target, { recursive: true })
  for (const pattern of entry.manifest.files ?? []) {
    if (pattern.startsWith('!') || pattern.includes('..'))
      throw new Error(`Unsupported files pattern: ${name}: ${pattern}`)
    for (const file of globSync(pattern, { cwd: entry.path })) {
      cpSync(join(entry.path, file), join(target, file), { recursive: true })
    }
  }
  const manifest = structuredClone(entry.manifest)
  delete manifest.devDependencies
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [dependency, version] of Object.entries(manifest[field] ?? {})) {
      if (version.startsWith('workspace:')) {
        const resolved = workspace.get(dependency)
        if (!resolved)
          throw new Error(`Missing workspace package ${dependency}`)
        manifest[field][dependency] = resolved.manifest.version
      }
    }
  }
  writeFileSync(join(target, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
}

copyPackage(cli.name, { path: deploy, manifest: cli })
const visited = new Set()
function includePeers(name) {
  if (visited.has(name))
    return
  visited.add(name)
  const manifestPath = join(modules, name, 'package.json')
  if (!existsSync(manifestPath))
    copyPackage(name, workspace.get(name))
  const manifest = read(manifestPath)
  for (const dependency of Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies })) {
    if (workspace.has(dependency) && !manifest.peerDependenciesMeta?.[dependency]?.optional)
      includePeers(dependency)
  }
}
includePeers(cli.name)
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim()
cpSync(join(source, 'LICENSE'), join(deploy, 'LICENSE'))
writeFileSync(join(deploy, 'package.json'), `${JSON.stringify({ name: 'deepseek-harness-pkg', version: cli.version, private: true, type: 'module', sourceCommit: commit }, null, 2)}\n`)
execFileSync(process.execPath, ['node_modules/@deepseek-ai/dsh/lib/bin.js', 'web', '--help'], { cwd: deploy, stdio: 'inherit' })
execFileSync(process.execPath, ['--input-type=module', '-e', 'await import(\'@deepseek-ai/dsh-app-boot\'); await import(\'@deepseek-ai/dsh-session-title-first-prompt-llm\'); await import(\'@deepseek-ai/dsh-agent-acp\'); console.log(\'Core imports OK\')'], { cwd: deploy, stdio: 'inherit' })
console.log(JSON.stringify({ version: cli.version, commit, workspacePackages: visited.size, deploy }))
