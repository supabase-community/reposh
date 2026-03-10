import { Bash, defineCommand, OverlayFs } from 'just-bash';
import type { RepoTarget } from './parse-target.js';

export const aliasCommands = [
  defineCommand('ll', (args, ctx) => ctx.exec!(`ls -alF ${args.join(' ')}`, { cwd: ctx.cwd })),
  defineCommand('la', (args, ctx) => ctx.exec!(`ls -a ${args.join(' ')}`, { cwd: ctx.cwd })),
  defineCommand('l', (args, ctx) => ctx.exec!(`ls -CF ${args.join(' ')}`, { cwd: ctx.cwd })),
];

export function makePrefix(target: RepoTarget): string {
  const base = `/repos/${target.host}/${target.org}/${target.repo}`;
  return target.ref ? `${base}@${target.ref}` : base;
}

export function makeBash(repoDir: string, prefix: string): Bash {
  const overlay = new OverlayFs({ root: repoDir, mountPoint: prefix, readOnly: true });
  return new Bash({ fs: overlay, cwd: prefix, customCommands: aliasCommands });
}

export async function execCommand(
  bash: Bash,
  command: string,
  stdout: (s: string) => void,
  stderr: (s: string) => void,
): Promise<number> {
  const result = await bash.exec(command);
  if (result.stdout) stdout(result.stdout);
  if (result.stderr) stderr(result.stderr);
  return result.exitCode;
}

// For interactive terminals: pass messages through as-is (animated \r\x1b[K updates).
// For non-PTY callers (LLMs, scripts): emit one plain line per phase, no ANSI.
export function makeProgressWriter(write: (msg: string) => void, animated: boolean): (msg: string) => void {
  if (animated) return write;
  let lastPhase = '';
  return (msg: string) => {
    if (!msg.includes('\x1b')) { write(msg); return; }
    const m = msg.replace(/\r\x1b\[K/g, '').match(/^(Cloning [^:]+): ([^(]+)/);
    if (m) { const line = `${m[1]}: ${m[2].trim()}`; if (line !== lastPhase) { lastPhase = line; write(`${line}\n`); } }
  };
}
