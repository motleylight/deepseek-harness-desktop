// Sent over SSH stdin. All writes belong to one explicitly managed Linux installation.
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import * as fs from 'node:fs/promises'
import net from 'node:net'
import { homedir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import extract from 'extract-zip'
import { probeDsh } from './health.js'

const root = process.env.DSH_SSH_ROOT
const stateFile = path.join(root, 'state.json')
const home = homedir()
const defaultData = path.join(home, '.dsh')
const actions = new Set(['status', 'auth', 'versions', 'install', 'upgrade', 'start', 'stop', 'restart', 'plugins', 'plugin-add', 'plugin-update', 'plugin-remove', 'plugin-enable', 'plugin-disable', 'restore'])
const request = JSON.parse(Buffer.from(process.argv[2], 'base64').toString('utf8'))
let state
let browserCookie

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  }
  catch (error) {
    if (error.code === 'ENOENT')
      return fallback
    throw error
  }
}

async function exists(file) {
  try {
    await fs.stat(file)
    return true
  }
  catch (error) {
    if (error.code === 'ENOENT')
      return false
    throw error
  }
}

async function writeJson(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await fs.rename(temp, file)
}

function versionId(value) {
  if (typeof value !== 'string' || !/^dsh-(?:src-)?\d+\.\d+\.\d+(?:-[a-z0-9.]+)?-\d+$/i.test(value))
    throw new Error('DSH_VERSION_INVALID')
  return value
}

function coreDir(version = state?.version) {
  return path.join(root, 'versions', versionId(version))
}

function dshBin(version = state?.version) {
  return path.join(coreDir(version), 'node_modules/@deepseek-ai/dsh/lib/bin.js')
}

function environment() {
  return { ...process.env, DSH_HOME: state?.data || defaultData, PATH: `${path.join(root, 'pnpm/node_modules/.bin')}:${state?.version ? path.join(coreDir(), 'node_modules/.bin') : ''}:${path.dirname(process.execPath)}:${process.env.PATH}`, CI: '1', npm_config_yes: 'true', DSH_NO_OPEN: '1' }
}

async function run(program, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { env: environment(), stdio: ['ignore', 'pipe', 'pipe'], ...options })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output = (output + chunk).slice(-2 * 1024 * 1024)
      if (!options.quiet)
        process.stderr.write(chunk)
    })
    child.stderr.on('data', chunk => process.stderr.write(chunk))
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolve(output.trim()) : reject(new Error(`REMOTE_COMMAND_FAILED: ${path.basename(program)} exited ${code}`)))
  })
}

async function identity(pid) {
  if (!Number.isInteger(pid) || pid <= 1)
    return null
  try {
    const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8')
    const cmd = await fs.readFile(`/proc/${pid}/cmdline`, 'utf8')
    const owner = await fs.stat(`/proc/${pid}`)
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    return { start: fields[19], group: Number(fields[2]), cmd, uid: owner.uid }
  }
  catch (error) {
    if (['ENOENT', 'ESRCH', 'EACCES'].includes(error.code))
      return null
    throw error
  }
}

async function ownedProcess() {
  if (!state?.process)
    return null
  const actual = await identity(state.process.pid)
  return actual && actual.uid === process.getuid() && actual.start === state.process.start && actual.cmd.split('\0').includes(dshBin()) ? state.process : null
}

async function foreignProcesses() {
  const result = []
  const owned = await ownedProcess()
  for (const entry of await fs.readdir('/proc')) {
    if (!/^\d+$/.test(entry))
      continue
    const pid = Number(entry)
    const actual = await identity(pid)
    if (actual?.uid === process.getuid() && /@deepseek-ai\/dsh\/lib\/bin\.js|(?:^|\0)dsh\0/.test(actual.cmd) && actual.cmd.includes('--profile') && pid !== owned?.pid)
      result.push(pid)
  }
  return result
}

async function status() {
  const processInfo = await ownedProcess()
  return {
    platform: 'linux',
    installed: Boolean(state?.version),
    running: Boolean(processInfo),
    version: state?.coreVersion || state?.version,
    release: state?.version,
    data: state?.data || defaultData,
    port: state?.port || 3080,
    profile: 'web',
    root,
    pid: processInfo?.pid,
    recovery: state?.recovery,
    failure: state?.transition ? 'DSH_RECOVERY_REQUIRED: retry the confirmed restore before starting DSH' : state?.failure,
    existingData: !state && await exists(defaultData),
    existingBin: !state ? process.env.DSH_EXISTING_BIN || undefined : undefined,
    foreignPids: await foreignProcesses(),
  }
}

async function probe() {
  try {
    const origin = `http://127.0.0.1:${state.port}`
    const cookie = await authenticate()
    return await probeDsh(origin, { cookie })
  }
  catch { return false }
}

async function authenticate() {
  if (browserCookie !== undefined)
    return browserCookie
  if (!await ownedProcess())
    throw new Error('DSH_NOT_RUNNING')
  const origin = `http://127.0.0.1:${state.port}`
  const index = await fetch(origin, { redirect: 'manual', signal: AbortSignal.timeout(2000) })
  await index.body?.cancel()
  if (index.status === 200)
    return browserCookie = ''
  if (index.status !== 401)
    throw new Error(`DSH_AUTH_HTTP_${index.status}`)
  const log = await fs.open(path.join(root, 'dsh.log'), 'r')
  let text
  try {
    const { size } = await log.stat()
    const buffer = Buffer.alloc(Math.min(size, 128 * 1024))
    await log.read(buffer, 0, buffer.length, size - buffer.length)
    text = buffer.toString('utf8')
  }
  finally { await log.close() }
  const urls = [...text.matchAll(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+)/g)]
  const url = urls.at(-1)?.[1]
  if (!url || new URL(url).origin !== origin)
    throw new Error('DSH_AUTH_TOKEN_UNAVAILABLE: restart the managed DSH to issue a launch token')
  const exchange = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(2000) })
  await exchange.body?.cancel()
  const cookie = exchange.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  if (exchange.status !== 303 || !cookie)
    throw new Error('DSH_AUTH_EXCHANGE_FAILED')
  return browserCookie = cookie
}

async function stop() {
  const owned = await ownedProcess()
  if (!owned)
    return
  process.kill(-owned.pid, 'SIGTERM')
  for (let count = 0; count < 100; count++) {
    if (!await ownedProcess()) {
      state.process = null
      await writeJson(stateFile, state)
      return
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('DSH_STOP_TIMEOUT: service is still running; core was not changed')
}

async function start() {
  browserCookie = undefined
  if (state?.transition)
    throw new Error('DSH_RECOVERY_REQUIRED: retry the confirmed restore before starting DSH')
  if (!state?.version)
    throw new Error('DSH_NOT_INSTALLED')
  if (await ownedProcess())
    return
  if ((await foreignProcesses()).length)
    throw new Error('DSH_EXISTING_PROCESS: stop the existing DSH before taking over')
  await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', () => reject(new Error(`DSH_PORT_BUSY: ${state.port}`)))
    server.listen(state.port, '127.0.0.1', () => server.close(resolve))
  })
  const log = await fs.open(path.join(root, 'dsh.log'), 'a', 0o600)
  const child = spawn(process.execPath, [dshBin(), '--profile', 'web', '--host', '127.0.0.1', '--port', String(state.port), '--no-open'], { detached: true, env: environment(), stdio: ['ignore', log.fd, log.fd] })
  try {
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', reject)
    })
  }
  finally {
    await log.close()
  }
  child.unref()
  const current = await identity(child.pid)
  state.process = { pid: child.pid, start: current?.start }
  await writeJson(stateFile, state)
  for (let count = 0; count < 90; count++) {
    if (await ownedProcess() && await probe()) {
      delete state.failure
      await writeJson(stateFile, state)
      return
    }
    if (!await ownedProcess())
      break
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  state.failure = 'DSH_START_FAILED: inspect remote dsh.log; recovery snapshot is preserved'
  await writeJson(stateFile, state)
  throw new Error(state.failure)
}

async function versions() {
  const metadata = await releaseMetadata('?per_page=100')
  const releases = metadata.filter(item => !item.draft && item.assets?.some(asset => asset.name === 'deepseek-harness-pkg-linux.zip'))
  return { latest: releases.find(item => !item.prerelease)?.tag_name || releases[0]?.tag_name, versions: releases.map(item => item.tag_name), installed: state?.version }
}

async function releaseMetadata(suffix) {
  const response = await fetch(`https://api.github.com/repos/dsh-tauri-desk/deepseek-harness-pkg/releases${suffix}`, { headers: { 'user-agent': 'dsh-tauri-ssh', 'accept': 'application/vnd.github+json' }, signal: AbortSignal.timeout(20000) })
  if (!response.ok)
    throw new Error(`DSH_RELEASE_HTTP_${response.status}`)
  return response.json()
}

async function stageRelease(version, staging) {
  if (process.arch !== 'x64')
    throw new Error('DSH_ARCH_UNSUPPORTED: the Desktop Linux release currently targets x64')
  const release = await releaseMetadata(`/tags/${version}`)
  const asset = release.assets?.find(item => item.name === 'deepseek-harness-pkg-linux.zip')
  if (!asset || !/^sha256:[a-f0-9]{64}$/.test(asset.digest || ''))
    throw new Error('DSH_RELEASE_DIGEST_REQUIRED')
  const url = asset.browser_download_url
  if (!url?.startsWith(`https://github.com/dsh-tauri-desk/deepseek-harness-pkg/releases/download/${version}/`))
    throw new Error('DSH_RELEASE_URL_INVALID')
  const downloads = path.join(root, 'downloads')
  await fs.mkdir(downloads, { recursive: true, mode: 0o700 })
  const archive = path.join(downloads, `${version}.zip`)
  if (await exists(archive)) {
    const digest = createHash('sha256')
    for await (const chunk of createReadStream(archive))
      digest.update(chunk)
    if (`sha256:${digest.digest('hex')}` !== asset.digest)
      await fs.unlink(archive)
  }
  if (!await exists(archive))
    await downloadRelease(asset, `${archive}.partial`, archive)
  process.stderr.write(`Extracting ${version}\n`)
  await extract(archive, { dir: staging })
  if (!await exists(path.join(staging, 'node_modules/@deepseek-ai/dsh/lib/bin.js')))
    throw new Error('DSH_ARCHIVE_LAYOUT_INVALID')
  if (!await exists(path.join(root, 'pnpm/node_modules/pnpm/bin/pnpm.cjs'))) {
    process.stderr.write('Installing private pnpm\n')
    await run('npm', ['install', '--prefix', path.join(root, 'pnpm'), '--no-audit', '--no-fund', 'pnpm@10.28.2'])
  }
}

async function downloadRelease(asset, temporary, destination) {
  process.stderr.write(`Downloading ${asset.name}\n`)
  const url = asset.browser_download_url
  const response = await fetch(url, { signal: AbortSignal.timeout(10 * 60 * 1000) })
  if (!response.ok || !response.body)
    throw new Error(`DSH_DOWNLOAD_HTTP_${response.status}`)
  const hash = createHash('sha256')
  const stream = Readable.fromWeb(response.body)
  let downloaded = 0
  let loggedAt = 0
  stream.on('data', (chunk) => {
    hash.update(chunk)
    downloaded += chunk.length
    if (downloaded > asset.size)
      stream.destroy(new Error('DSH_RELEASE_SIZE_MISMATCH'))
    if (Date.now() - loggedAt > 2000) {
      process.stderr.write(`Download ${Math.floor(downloaded / asset.size * 100)}%\n`)
      loggedAt = Date.now()
    }
  })
  await pipeline(stream, createWriteStream(temporary, { mode: 0o600 }))
  if (`sha256:${hash.digest('hex')}` !== asset.digest)
    throw new Error('DSH_RELEASE_DIGEST_MISMATCH')
  await fs.rename(temporary, destination)
}

async function install() {
  if (!state && ((await exists(defaultData)) || process.env.DSH_EXISTING_BIN) && request.adopt !== true)
    throw new Error('DSH_ADOPTION_REQUIRED: existing installation or data was found')
  if ((await foreignProcesses()).length)
    throw new Error('DSH_EXISTING_PROCESS: stop the existing DSH before installation or adoption')
  const version = versionId(request.version || (await versions()).latest)
  const destination = coreDir(version)
  if (!await exists(dshBin(version))) {
    const staging = path.join(root, 'versions', `.staging-${randomUUID()}`)
    await fs.mkdir(staging, { recursive: true, mode: 0o700 })
    await stageRelease(version, staging)
    await run(process.execPath, [path.join(staging, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '--version'])
    await fs.rename(staging, destination)
  }
  const previous = state?.version
  const wasRunning = Boolean(await ownedProcess())
  if (state && version === previous)
    return
  await stop()
  let adoptionBackup
  if (previous || await exists(defaultData)) {
    const backup = path.join(root, 'backups', randomUUID())
    await fs.mkdir(backup, { recursive: true, mode: 0o700 })
    try {
      const data = state?.data || defaultData
      if (await exists(data))
        await fs.cp(data, path.join(backup, 'data'), { recursive: true, dereference: false })
    }
    catch (error) {
      if (wasRunning)
        await start()
      throw error
    }
    if (previous)
      state.recovery = { version: previous, backup, at: new Date().toISOString() }
    else
      adoptionBackup = backup
  }
  const manifest = await readJson(path.join(destination, 'node_modules/@deepseek-ai/dsh/package.json'), {})
  state = { ...state, ...(adoptionBackup ? { adoptionBackup } : {}), format: 1, version, coreVersion: manifest.version, data: defaultData, port: state?.port || 3080, process: null }
  await writeJson(stateFile, state)
  await start()
}

async function plugins() {
  if (!state)
    return []
  const dir = path.join(state.data, 'profiles/web')
  const manifest = await readJson(path.join(dir, 'package.json'), {})
  const disabled = await readJson(path.join(dir, 'disabled-plugins.json'), {})
  const bundles = manifest.dsh?.profile?.bundles || []
  const result = []
  for (const id of Object.keys(manifest.dependencies || {})) {
    if (!/^(?:@[\w.-]+\/)?[\w.-]+$/.test(id))
      continue
    const pkg = await readJson(path.join(dir, 'node_modules', id, 'package.json'), {})
    result.push({ id, version: pkg.version || '', description: pkg.description || '', enabled: bundles.includes(id), disabled: Boolean(disabled[id]), protected: id.startsWith('@deepseek-ai/') })
  }
  return result
}

async function changePlugin() {
  if (!state)
    throw new Error('DSH_NOT_INSTALLED')
  const verb = request.action.slice('plugin-'.length)
  const id = String(request.spec || request.id || '')
  if (!/^(?:@[\w.-]+\/)?[\w.-]+(?:@[a-z0-9.^~+*-]+)?$/i.test(id) && !/^github:[\w.-]+\/[\w.-]+(?:#[\w./-]+)?$/.test(id))
    throw new Error('DSH_PLUGIN_SPEC_INVALID')
  if (id.startsWith('@deepseek-ai/') && verb !== 'add')
    throw new Error('DSH_CORE_PACKAGE_PROTECTED')
  const wasRunning = Boolean(await ownedProcess())
  await stop()
  try {
    if (verb === 'enable' || verb === 'disable') {
      const dir = path.join(state.data, 'profiles/web')
      const manifestFile = path.join(dir, 'package.json')
      const manifest = await readJson(manifestFile, {})
      if (!Object.hasOwn(manifest.dependencies || {}, id))
        throw new Error('DSH_PLUGIN_NOT_INSTALLED')
      const disabledFile = path.join(dir, 'disabled-plugins.json')
      const disabled = await readJson(disabledFile, {})
      const previous = structuredClone(manifest)
      const bundles = manifest.dsh?.profile?.bundles
      if (!Array.isArray(bundles))
        throw new Error('DSH_PROFILE_BUNDLES_INVALID')
      manifest.dsh.profile.bundles = verb === 'disable' ? bundles.filter(item => item !== id) : [...new Set([...bundles, id])]
      if (verb === 'disable')
        disabled[id] = { disabledAt: String(Math.floor(Date.now() / 1000)), reason: 'user' }
      else
        delete disabled[id]
      await writeJson(manifestFile, manifest)
      try {
        await writeJson(disabledFile, disabled)
      }
      catch (error) {
        await writeJson(manifestFile, previous)
        throw error
      }
    }
    else {
      await run(process.execPath, [dshBin(), 'plugin', '--profile', 'web', verb, id])
    }
  }
  finally {
    if (wasRunning)
      await start()
  }
  return plugins()
}

async function restore() {
  const recovery = state?.recovery
  if (!recovery || request.confirm !== true)
    throw new Error('DSH_RESTORE_CONFIRMATION_REQUIRED')
  if (typeof recovery.backup !== 'string' || path.dirname(path.resolve(recovery.backup)) !== path.join(root, 'backups'))
    throw new Error('DSH_RECOVERY_PATH_INVALID')
  const staged = path.join(root, 'backups', `restore-stage-${randomUUID()}`)
  await fs.mkdir(staged, { mode: 0o700 })
  if (await exists(path.join(recovery.backup, 'data')))
    await fs.cp(path.join(recovery.backup, 'data'), staged, { recursive: true, dereference: false })
  await stop()
  const preserved = path.join(root, 'backups', `before-restore-${randomUUID()}`)
  state.transition = { kind: 'restore', preserved, staged }
  await writeJson(stateFile, state)
  const hadData = await exists(state.data)
  if (hadData)
    await fs.rename(state.data, preserved)
  try {
    await fs.rename(staged, state.data)
  }
  catch (error) {
    if (hadData)
      await fs.rename(preserved, state.data)
    throw error
  }
  state.version = versionId(recovery.version)
  state.coreVersion = (await readJson(path.join(coreDir(), 'node_modules/@deepseek-ai/dsh/package.json'), {})).version
  state.process = null
  delete state.recovery
  delete state.transition
  await writeJson(stateFile, state)
  await start()
}

async function main() {
  if (process.platform !== 'linux' || root !== path.join(home, '.local/share/dsh-desktop') || !actions.has(request.action))
    throw new Error('DSH_REMOTE_REQUEST_INVALID')
  state = await readJson(stateFile, null)
  if (state && (state.format !== 1 || state.data !== defaultData))
    throw new Error('DSH_REMOTE_STATE_INVALID')
  if (request.action === 'status')
    return status()
  if (request.action === 'auth')
    return { cookie: await authenticate() }
  if (request.action === 'versions')
    return versions()
  if (request.action === 'plugins')
    return plugins()
  await fs.mkdir(root, { recursive: true, mode: 0o700 })
  const lock = path.join(root, 'operation.lock')
  try {
    await fs.mkdir(lock)
  }
  catch (error) {
    if (error.code !== 'EEXIST')
      throw error
    const owner = await readJson(path.join(lock, 'owner.json'), null)
    const actual = owner && await identity(owner.pid)
    if (actual?.start === owner?.start && owner)
      throw new Error('DSH_OPERATION_BUSY: another management operation owns this host')
    if (!owner && Date.now() - (await fs.stat(lock)).mtimeMs < 10000)
      throw new Error('DSH_OPERATION_BUSY: another management operation is acquiring this host')
    if (owner?.group) {
      for (const pid of await fs.readdir('/proc')) {
        if (!/^\d+$/.test(pid))
          continue
        const member = await identity(Number(pid))
        if (member?.uid === process.getuid() && member.group === owner.group && member.cmd)
          throw new Error('DSH_OPERATION_BUSY: a previous operation still has running child processes')
      }
    }
    if (owner)
      await fs.unlink(path.join(lock, 'owner.json'))
    await fs.rmdir(lock)
    await fs.mkdir(lock)
  }
  const owner = await identity(process.pid)
  await writeJson(path.join(lock, 'owner.json'), { pid: process.pid, start: owner.start, group: owner.group })
  try {
    state = await readJson(stateFile, null)
    if (state && (state.format !== 1 || state.data !== defaultData))
      throw new Error('DSH_REMOTE_STATE_INVALID')
    if (request.action === 'install' || request.action === 'upgrade') {
      await install()
    }
    else if (request.action === 'start') {
      await start()
    }
    else if (request.action === 'stop') {
      await stop()
    }
    else if (request.action === 'restart') {
      await stop()
      await start()
    }
    else if (request.action === 'restore') {
      await restore()
    }
    else if (request.action.startsWith('plugin-')) {
      return await changePlugin()
    }
    return await status()
  }
  finally {
    await fs.unlink(path.join(lock, 'owner.json'))
    await fs.rmdir(lock)
  }
}

main().then((value) => {
  process.stdout.write(`DSH_SSH_RESULT:${JSON.stringify({ ok: true, value })}\n`)
}).catch((error) => {
  process.stdout.write(`DSH_SSH_RESULT:${JSON.stringify({ ok: false, error: error.message })}\n`)
  process.exitCode = 1
})
