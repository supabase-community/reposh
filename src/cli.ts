#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { parseRepoTarget } from './parse-target.js';
import { ensureRepo } from './repo-cache.js';
import { makeBash, makePrefix, makeProgressWriter, execCommand } from './run-command.js';
import { makeSSHServer, makeStdioDuplex, sshInstall } from './ssh.js';

const [,, cmd, ...args] = process.argv;

if (!cmd) {
  console.error('Usage:\n  reposh <org/repo> [command...]\n  reposh ssh install\n  reposh ssh serve\n  reposh ssh proxy');
  process.exit(1);
}

if (cmd === 'ssh') {
  const subcmd = args[0];

  if (subcmd === 'install') {
    await sshInstall();

  } else if (subcmd === 'serve') {
    const server = await makeSSHServer();
    const PORT = parseInt(process.env.PORT ?? '22', 10);
    server.listen(PORT, '0.0.0.0', () => {
      console.error(`SSH server listening on port ${PORT}`);
      console.error(`Connect: ssh <org>/<repo>@localhost`);
    });
    process.on('SIGTERM', () => { console.error('SIGTERM'); process.exit(0); });
    process.on('SIGINT', () => { console.error('SIGINT'); process.exit(0); });

  } else if (subcmd === 'proxy') {
    const server = await makeSSHServer(() => {});
    server._srv.emit('connection', makeStdioDuplex());

  } else {
    console.error(`Unknown subcommand: ${subcmd ?? '(none)'}\nUsage: reposh ssh <serve|proxy>`);
    process.exit(1);
  }

} else {
  const target = parseRepoTarget(cmd);
  if (!target) {
    console.error(`Invalid repo or unknown command: ${cmd}\nUsage: reposh <org/repo> [command...] or reposh ssh <serve|proxy>`);
    process.exit(1);
  }

  const isInteractive = process.stdin.isTTY ?? false;
  const onProgress = makeProgressWriter((msg) => process.stderr.write(msg), isInteractive);

  let repoDir: string;
  try {
    repoDir = await ensureRepo(target, onProgress);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const prefix = makePrefix(target);
  const bash = makeBash(repoDir, prefix);

  if (args.length > 0) {
    const command = args.join(' ');
    try {
      const code = await execCommand(bash, command, (s) => process.stdout.write(s), (s) => process.stderr.write(s));
      process.exit(code);
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  } else {
    const label = `${target.org}/${target.repo}`;
    const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '$ ', terminal: isInteractive });
    process.stdout.write(`${label} shell. Type commands to browse.\n`);
    rl.prompt();

    rl.on('line', async (line) => {
      const command = line.trim();
      if (command === 'exit') { rl.close(); return; }
      if (command) {
        try {
          await execCommand(bash, command, (s) => process.stdout.write(s), (s) => process.stderr.write(s));
        } catch (err) {
          process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
        }
      }
      rl.prompt();
    });

    rl.on('close', () => process.exit(0));
  }
}
