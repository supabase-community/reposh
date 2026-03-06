import { generateKeyPairSync, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { Duplex } from 'node:stream';
import type {
  Connection,
  AuthContext,
  AcceptConnection,
  RejectConnection,
  Session,
  ServerChannel,
  ExecInfo,
} from 'ssh2';
import { parseRepoTarget } from './parse-target.js';
import { ensureRepo } from './repo-cache.js';
import {
  makeBash,
  makePrefix,
  makeProgressWriter,
  execCommand,
} from './run-command.js';
import { HOST_KEY_PATH } from './paths.js';

const require = createRequire(import.meta.url);
const { Server } = require('ssh2');

type Log = (...args: string[]) => void;

export async function loadOrCreateHostKey(
  log: Log = console.error,
): Promise<Buffer> {
  try {
    const pem = await readFile(HOST_KEY_PATH);
    const fingerprint = createHash('sha256').update(pem).digest('base64');
    log(`Loaded host key from ${HOST_KEY_PATH} (SHA256:${fingerprint})`);
    return pem;
  } catch {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }) as string;
    await mkdir(dirname(HOST_KEY_PATH), { recursive: true });
    await writeFile(HOST_KEY_PATH, pem, { mode: 0o600 });
    const fingerprint = createHash('sha256').update(pem).digest('base64');
    log(`Generated host key → ${HOST_KEY_PATH} (SHA256:${fingerprint})`);
    return Buffer.from(pem);
  }
}

function handleConnection(client: Connection, log: Log): void {
  log('Client connected');
  let username = '';

  client.on('authentication', (ctx: AuthContext) => {
    username = ctx.username;
    ctx.accept();
  });

  client.on('ready', () => {
    client.on('session', (accept: AcceptConnection<Session>) => {
      const session = accept();
      let hasPty = false;
      session.on('pty', (accept: () => void) => {
        hasPty = true;
        accept();
      });

      const target = parseRepoTarget(username);
      const prefix = target ? makePrefix(target) : '';
      const resolveRepo = (onProgress: (msg: string) => void) =>
        target
          ? ensureRepo(target, onProgress)
          : Promise.reject(
              new Error(
                'Usage: ssh <org>/<repo>@<host> [command]\nExample: ssh facebook/react@reposh ls',
              ),
            );

      session.on(
        'exec',
        async (
          accept: AcceptConnection<ServerChannel>,
          _reject: RejectConnection,
          info: ExecInfo,
        ) => {
          const channel = accept();
          const command = info.command;
          log(`exec ${username}: ${command}`);

          let repoDir: string;
          try {
            repoDir = await resolveRepo(
              makeProgressWriter((msg) => channel.stderr.write(msg), hasPty),
            );
          } catch (err) {
            channel.stderr.write(
              `${err instanceof Error ? err.message : String(err)}\n`,
            );
            channel.exit(1);
            channel.end();
            return;
          }

          try {
            const bash = makeBash(repoDir, prefix);
            const code = await execCommand(
              bash,
              command,
              (s) => channel.write(s),
              (s) => channel.stderr.write(s),
            );
            channel.exit(code);
          } catch (err) {
            channel.stderr.write(
              `Error: ${err instanceof Error ? err.message : String(err)}\n`,
            );
            channel.exit(1);
          }
          channel.end();
        },
      );

      session.on('shell', async (accept: AcceptConnection<ServerChannel>) => {
        const channel = accept();

        let repoDir: string;
        try {
          repoDir = await resolveRepo((msg) =>
            channel.write(msg.replace(/\n/g, '\r\n')),
          );
        } catch (err) {
          channel.write(
            `${err instanceof Error ? err.message : String(err)}\r\n`,
          );
          channel.end();
          return;
        }

        const bash = makeBash(repoDir, prefix);
        const label = target ? `${target.org}/${target.repo}` : 'repo';
        channel.write(`${label} shell. Type commands to browse.\r\n$ `);

        let buf = '';
        channel.on('data', async (data: Buffer) => {
          const chunk = data.toString();
          for (const ch of chunk) {
            if (ch === '\r' || ch === '\n') {
              channel.write('\r\n');
              const command = buf.trim();
              buf = '';
              if (command === 'exit') {
                channel.end();
                return;
              }
              if (command) {
                try {
                  await execCommand(
                    bash,
                    command,
                    (s) => channel.write(s.replace(/\n/g, '\r\n')),
                    (s) => channel.write(s.replace(/\n/g, '\r\n')),
                  );
                } catch (err) {
                  channel.write(
                    `Error: ${err instanceof Error ? err.message : String(err)}\r\n`,
                  );
                }
              }
              channel.write('$ ');
            } else if (ch === '\x7f' || ch === '\b') {
              if (buf.length > 0) {
                buf = buf.slice(0, -1);
                channel.write('\b \b');
              }
            } else {
              buf += ch;
              channel.write(ch);
            }
          }
        });
      });
    });
  });

  client.on('end', () => log('Client disconnected'));
  client.on('error', (err: Error) => log('Client error:', err.message));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function makeSSHServer(log: Log = console.error): Promise<any> {
  return loadOrCreateHostKey(log).then(
    (hostKey) =>
      new Server({ hostKeys: [hostKey] }, (client: Connection) =>
        handleConnection(client, log),
      ),
  );
}

export async function sshInstall(): Promise<void> {
  // Strip npx-injected temp dirs from PATH before checking, so we don't
  // mistake the npx-provided binary for a real global install.
  const cleanPath = (process.env.PATH ?? '')
    .split(':')
    .filter(p => !p.includes('_npx') && !/\/(tmp|T)\//.test(p))
    .join(':');
  const isInstalled = (() => {
    try { execSync('which reposh', { env: { PATH: cleanPath }, stdio: 'ignore' }); return true; }
    catch { return false; }
  })();
  if (isInstalled) {
    console.log('reposh already on PATH - skipping npm install.');
  } else {
    console.log('Installing reposh globally...');
    execSync('npm install -g reposh', { stdio: 'inherit' });
  }

  const configPath = join(homedir(), '.ssh', 'config');
  const block = `
# Added by reposh
Host reposh
  ProxyCommand reposh ssh proxy
  StrictHostKeyChecking accept-new
  UserKnownHostsFile ~/.reposh/known_hosts
`;

  let existing = '';
  try {
    existing = await readFile(configPath, 'utf8');
  } catch {
    // config doesn't exist yet
  }

  if (existing.includes('Host reposh')) {
    console.log('Host reposh already exists in ~/.ssh/config - skipping.');
    return;
  }

  await mkdir(join(homedir(), '.ssh'), { recursive: true });
  await writeFile(configPath, existing + block, { mode: 0o600 });
  console.log('Added to ~/.ssh/config:');
  console.log(block.trim());
  console.log('\nUsage: ssh <org/repo>@reposh [command]');
  console.log('Example: ssh facebook/react@reposh ls');
}

// Creates a duplex stream over stdin/stdout for use as a ProxyCommand.
// Stubs out net.Socket methods that ssh2 may call.
export function makeStdioDuplex(): Duplex {
  const duplex = new Duplex({
    read() {},
    write(
      chunk: Buffer,
      _enc: BufferEncoding,
      cb: (err?: Error | null) => void,
    ) {
      if (!process.stdout.write(chunk)) {
        process.stdout.once('drain', cb);
      } else {
        cb();
      }
    },
  });

  const noop = () => duplex;
  (duplex as unknown as Record<string, unknown>).setTimeout = noop;
  (duplex as unknown as Record<string, unknown>).setNoDelay = noop;
  (duplex as unknown as Record<string, unknown>).setKeepAlive = noop;

  process.stdin.on('data', (chunk: Buffer) => duplex.push(chunk));
  process.stdin.on('end', () => duplex.push(null));
  duplex.on('close', () => process.exit(0));

  return duplex;
}
