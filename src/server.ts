import { generateKeyPairSync, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { Bash, defineCommand, OverlayFs } from 'just-bash';
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

const require = createRequire(import.meta.url);
const { Server } = require('ssh2');

const PORT = parseInt(process.env.PORT ?? '22', 10);

const aliasCommands = [
  defineCommand('ll', (args, ctx) =>
    ctx.exec!(`ls -alF ${args.join(' ')}`, { cwd: ctx.cwd }),
  ),
  defineCommand('la', (args, ctx) =>
    ctx.exec!(`ls -a ${args.join(' ')}`, { cwd: ctx.cwd }),
  ),
  defineCommand('l', (args, ctx) =>
    ctx.exec!(`ls -CF ${args.join(' ')}`, { cwd: ctx.cwd }),
  ),
];


const HOST_KEY_PATH = resolve(process.env.HOST_KEY_PATH ?? './host_key');

async function loadOrCreateHostKey(): Promise<Buffer> {
  try {
    const pem = await readFile(HOST_KEY_PATH);
    const fingerprint = createHash('sha256').update(pem).digest('base64');
    console.log(
      `Loaded host key from ${HOST_KEY_PATH} (SHA256:${fingerprint})`,
    );
    return pem;
  } catch {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }) as string;
    await writeFile(HOST_KEY_PATH, pem, { mode: 0o600 });
    const fingerprint = createHash('sha256').update(pem).digest('base64');
    console.log(
      `Generated host key → ${HOST_KEY_PATH} (SHA256:${fingerprint})`,
    );
    return Buffer.from(pem);
  }
}

function makeBash(repoDir: string, prefix: string) {
  const overlay = new OverlayFs({ root: repoDir, mountPoint: prefix, readOnly: true });
  return new Bash({ fs: overlay, cwd: prefix, customCommands: aliasCommands });
}

// For interactive terminals: pass messages through as-is (animated \r\x1b[K updates).
// For non-PTY callers (LLMs, scripts): emit one plain line per phase, no ANSI.
function makeProgressWriter(write: (msg: string) => void, animated: boolean): (msg: string) => void {
  if (animated) return write;
  let lastPhase = '';
  return (msg: string) => {
    // Plain messages (no ANSI) pass through as-is
    if (!msg.includes('\x1b')) { write(msg); return; }
    const m = msg.replace(/\r\x1b\[K/g, '').match(/^(Cloning [^:]+): ([^(]+)/);
    if (m) { const line = `${m[1]}: ${m[2].trim()}`; if (line !== lastPhase) { lastPhase = line; write(`${line}\n`); } }
  };
}

async function main() {
  const hostKey = await loadOrCreateHostKey();

  const server = new Server({ hostKeys: [hostKey] }, (client: Connection) => {
    console.log('Client connected');

    let username = '';
    client.on('authentication', (ctx: AuthContext) => {
      username = ctx.username;
      ctx.accept();
    });

    client.on('ready', () => {
      client.on('session', (accept: AcceptConnection<Session>) => {
        const session = accept();
        let hasPty = false;
        session.on('pty', (accept: () => void) => { hasPty = true; accept(); });

        const target = parseRepoTarget(username);

        const prefix = target ? `/repos/${target.host}/${target.org}/${target.repo}` : '';

        const resolveRepo = (onProgress: (msg: string) => void) =>
          target
            ? ensureRepo(target, onProgress)
            : Promise.reject(new Error('Usage: ssh <org>/<repo>@<host> [command]\nExample: ssh supabase/supabase@repo.now ls'));

        session.on(
          'exec',
          async (
            accept: AcceptConnection<ServerChannel>,
            _reject: RejectConnection,
            info: ExecInfo,
          ) => {
            const channel = accept();
            const command = info.command;
            console.log(`exec ${username}: ${command}`);

            let repoDir: string;
            try {
              repoDir = await resolveRepo(makeProgressWriter((msg) => channel.stderr.write(msg), hasPty));
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
              const result = await bash.exec(command);
              if (result.stdout) channel.write(result.stdout);
              if (result.stderr) channel.stderr.write(result.stderr);
              channel.exit(result.exitCode);
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
            repoDir = await resolveRepo((msg) => channel.write(msg.replace(/\n/g, '\r\n')));
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
                if (command === 'exit' || command === 'quit') {
                  channel.end();
                  return;
                }
                if (command) {
                  try {
                    const result = await bash.exec(command);
                    if (result.stdout)
                      channel.write(result.stdout.replace(/\n/g, '\r\n'));
                    if (result.stderr)
                      channel.write(result.stderr.replace(/\n/g, '\r\n'));
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

    client.on('end', () => console.log('Client disconnected'));
    client.on('error', (err: Error) =>
      console.error('Client error:', err.message),
    );
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`SSH server listening on port ${PORT}`);
    console.log(`Connect: ssh <org>/<repo>@localhost`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM');
  process.exit(0);
});
process.on('SIGINT', () => {
  console.log('SIGINT');
  process.exit(0);
});
