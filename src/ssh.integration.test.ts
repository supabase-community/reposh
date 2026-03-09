import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { ClientChannel } from 'ssh2'

const { repoDir, hostKeyPath } = vi.hoisted(() => {
  const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs')
  const { join } = require('node:path')
  const { tmpdir } = require('node:os')

  const tmpDir = mkdtempSync(join(tmpdir(), 'reposh-integration-'))
  const repoDir = join(tmpDir, 'repo')
  mkdirSync(repoDir, { recursive: true })
  mkdirSync(join(repoDir, 'src'))
  writeFileSync(join(repoDir, 'README.md'), '# Test Repo\n')
  writeFileSync(join(repoDir, 'hello.txt'), 'hello world\n')
  writeFileSync(join(repoDir, 'src', 'index.ts'), 'console.log("hi")\n')

  return { repoDir, hostKeyPath: join(tmpDir, 'host_key') }
})

vi.mock('./repo-cache.js', () => ({
  ensureRepo: vi.fn(async () => repoDir),
}))

vi.mock('./paths.js', () => ({
  HOST_KEY_PATH: hostKeyPath,
}))

import { makeSSHServer } from './ssh.js'
import { Client } from 'ssh2'

function connect(port: number, username = 'test/repo'): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client()
    client.on('ready', () => resolve(client))
    client.on('error', reject)
    client.connect({
      host: '127.0.0.1',
      port,
      username,
      password: 'ignored',
      hostVerifier: () => true,
    })
  })
}

function exec(
  client: Client,
  command: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, channel) => {
      if (err) return reject(err)
      let stdout = ''
      let stderr = ''
      let code = -1
      channel.on('data', (data: Buffer) => {
        stdout += data.toString()
      })
      channel.stderr.on('data', (data: Buffer) => {
        stderr += data.toString()
      })
      channel.on('exit', (exitCode: number) => {
        code = exitCode
      })
      channel.on('close', () => resolve({ stdout, stderr, code }))
    })
  })
}

function openShell(client: Client): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    client.shell((err, channel) => {
      if (err) return reject(err)
      resolve(channel)
    })
  })
}

function waitFor(
  channel: ClientChannel,
  pattern: string,
  timeout = 5000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = ''
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for "${pattern}"`)),
      timeout,
    )
    const onData = (chunk: Buffer) => {
      buf += chunk.toString()
      if (buf.includes(pattern)) {
        clearTimeout(timer)
        channel.removeListener('data', onData)
        resolve(buf)
      }
    }
    channel.on('data', onData)
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let server: any
let port: number

beforeAll(async () => {
  server = await makeSSHServer(() => {})
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port
      resolve()
    })
  })
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(resolve))
})

describe('exec mode', () => {
  it('lists files in the repo', async () => {
    const client = await connect(port)
    try {
      const result = await exec(client, 'ls')
      expect(result.stdout).toContain('README.md')
      expect(result.stdout).toContain('hello.txt')
      expect(result.stdout).toContain('src')
      expect(result.code).toBe(0)
    } finally {
      client.end()
    }
  })

  it.skipIf(process.platform === 'win32')('reads file contents', async () => {
    const client = await connect(port)
    try {
      const result = await exec(client, 'cat hello.txt')
      expect(result.stdout).toContain('hello world')
      expect(result.code).toBe(0)
    } finally {
      client.end()
    }
  })

  it.skipIf(process.platform === 'win32')('handles nested directories', async () => {
    const client = await connect(port)
    try {
      const result = await exec(client, 'cat src/index.ts')
      expect(result.stdout).toContain('console.log')
      expect(result.code).toBe(0)
    } finally {
      client.end()
    }
  })

  it('returns error for invalid repo target', async () => {
    const client = await connect(port, 'invalid')
    try {
      const result = await exec(client, 'ls')
      expect(result.stderr).toContain('Usage:')
      expect(result.code).toBe(1)
    } finally {
      client.end()
    }
  })
})

describe('shell mode', () => {
  it('opens interactive shell and runs commands', async () => {
    const client = await connect(port)
    try {
      const channel = await openShell(client)

      const greeting = await waitFor(channel, '$ ')
      expect(greeting).toContain('shell')

      const outputPromise = waitFor(channel, '$ ')
      channel.write('echo hello\r')
      const output = await outputPromise
      expect(output).toContain('hello')

      const closePromise = new Promise<void>((resolve) =>
        channel.on('close', resolve),
      )
      channel.write('exit\r')
      await closePromise
    } finally {
      client.end()
    }
  })
})
