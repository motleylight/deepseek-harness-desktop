import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import net from 'node:net'
import process from 'node:process'

const helper = readFileSync(new URL('../dist/remote.cjs', import.meta.url), 'utf8')
const bootstrap = readFileSync(new URL('./bootstrap.sh', import.meta.url), 'utf8')
const shellPath = readFileSync(new URL('./shell-path.sh', import.meta.url), 'utf8')

/** SSH operands are never accepted as option fragments or shell commands. */
export function validateTarget(value) {
  const host = String(value.host || '').trim()
  const user = String(value.user || '').trim()
  const port = value.port === '' || value.port == null ? undefined : Number(value.port)
  if ((!/^\w[\w.-]*$/.test(host) && !net.isIP(host)) || host.length > 253)
    throw new Error('SSH_HOST_INVALID')
  if (user && !/^[a-z_][\w.-]*\$?$/i.test(user))
    throw new Error('SSH_USER_INVALID')
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535))
    throw new Error('SSH_PORT_INVALID')
  return { host, user, port }
}

/** Preserve ambient Host, IdentityFile, ProxyJump, agent and known-host settings. */
export function sshArgs(target, tunnel) {
  const value = validateTarget(target)
  const args = ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3']
  if (value.user)
    args.push('-l', value.user)
  if (value.port)
    args.push('-p', String(value.port))
  if (tunnel)
    args.push('-N', '-o', 'ExitOnForwardFailure=yes', '-L', `127.0.0.1:${tunnel.local}:127.0.0.1:${tunnel.remote}`)
  else
    args.push('-o', 'ClearAllForwardings=yes')
  args.push('--', value.host)
  if (!tunnel)
    args.push('sh -s')
  return args
}

/** Owns only local SSH children. It never terminates remote DSH processes on disposal. */
export class SshTransport {
  constructor({ program = 'ssh', prefix = [], spawnProcess = spawn } = {}) {
    this.program = program
    this.prefix = prefix
    this.spawnProcess = spawnProcess
    this.children = new Set()
  }

  launch(target, tunnel) {
    const child = this.spawnProcess(this.program, [...this.prefix, ...sshArgs(target, tunnel)], { windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] })
    this.children.add(child)
    child.once('close', () => this.children.delete(child))
    return child
  }

  async run(target, request, onLog = () => {}) {
    const child = this.launch(target)
    const encoded = Buffer.from(JSON.stringify(request)).toString('base64')
    const source = `${shellPath}\n${bootstrap.replaceAll('__ACTION__', request.action === 'install' ? 'install' : 'inspect')
    }\n"$DSH_NODE" - '${encoded}' <<'DSH_SSH_REMOTE_HELPER'\n${helper}\nDSH_SSH_REMOTE_HELPER\n`
    return new Promise((resolve, reject) => {
      let stdout = ''
      let stderr = ''
      const timer = setTimeout(() => {
        void this.kill(child)
        reject(new Error('SSH_OPERATION_TIMEOUT: remote outcome must be inspected before retrying'))
      }, 15 * 60 * 1000)
      child.stdout.on('data', (data) => {
        stdout = (stdout + data).slice(-4 * 1024 * 1024)
      })
      child.stderr.on('data', (data) => {
        stderr = (stderr + data).slice(-8000)
        onLog(String(data))
      })
      child.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        const line = stdout.split('\n').findLast(item => item.startsWith('DSH_SSH_RESULT:'))
        if (!line) {
          reject(new Error(`SSH_FAILED: ${stderr || `exit ${code}`}. Use the same system ssh in a terminal to resolve authentication or host-key prompts.`))
          return
        }
        try {
          const result = JSON.parse(line.slice('DSH_SSH_RESULT:'.length))
          if (!result.ok)
            throw new Error(result.error)
          if (code !== 0)
            throw new Error(`SSH_EXIT_${code}`)
          resolve(result.value)
        }
        catch (error) { reject(error) }
      })
      child.stdin.on('error', () => { /* SSH may reject authentication before reading the script. */ })
      child.stdin.end(source)
    })
  }

  async kill(child) {
    if (!child || child.exitCode !== null || child.signalCode !== null)
      return
    if (process.platform === 'win32') {
      await new Promise((resolve) => {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        killer.on('error', resolve)
        killer.on('close', resolve)
      })
    }
    else {
      try {
        process.kill(-child.pid, 'SIGTERM')
      }
      catch (error) {
        if (error.code !== 'ESRCH')
          throw error
      }
    }
  }

  async dispose() {
    await Promise.all([...this.children].map(child => this.kill(child)))
  }
}

export async function unusedPort(preferred = 0) {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(preferred, '127.0.0.1', () => {
      const port = server.address().port
      server.close(error => error ? reject(error) : resolve(port))
    })
  })
}
