#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { parseRepoTarget } from './parse-target.js';
import { ensureRepo } from './repo-cache.js';
import {
  makeBash,
  makePrefix,
  makeProgressWriter,
  execCommand,
} from './run-command.js';

const [, , targetArg, ...cmdParts] = process.argv;

if (!targetArg) {
  console.error(
    'Usage: repocat <org/repo> [command...]\nExample: repocat supabase/supabase ls',
  );
  process.exit(1);
}

const target = parseRepoTarget(targetArg);
if (!target) {
  console.error(
    `Invalid repo: ${targetArg}\nExpected: org/repo or host/org/repo`,
  );
  process.exit(1);
}

const isInteractive = process.stdin.isTTY ?? false;
const onProgress = makeProgressWriter(
  (msg) => process.stderr.write(msg),
  isInteractive,
);

let repoDir: string;
try {
  repoDir = await ensureRepo(target, onProgress);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const prefix = makePrefix(target);
const bash = makeBash(repoDir, prefix);

if (cmdParts.length > 0) {
  const command = cmdParts.join(' ');
  try {
    const code = await execCommand(
      bash,
      command,
      (s) => process.stdout.write(s),
      (s) => process.stderr.write(s),
    );
    process.exit(code);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
} else {
  const label = `${target.org}/${target.repo}`;
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '$ ',
    terminal: isInteractive,
  });
  process.stdout.write(`${label} shell. Type commands to browse.\n`);
  rl.prompt();

  rl.on('line', async (line) => {
    const command = line.trim();
    if (command === 'exit') {
      rl.close();
      return;
    }
    if (command) {
      try {
        await execCommand(
          bash,
          command,
          (s) => process.stdout.write(s),
          (s) => process.stderr.write(s),
        );
      } catch (err) {
        process.stderr.write(
          `Error: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    }
    rl.prompt();
  });

  rl.on('close', () => process.exit(0));
}
