#!/usr/bin/env node
import { Command } from 'commander';
import { parseTarget, formatTarget } from '../parse-target.js';
import { createRepoCache } from '../repo-cache.js';
import { CACHE_DIR } from '../constants.js';
import {
  makeBash,
  makePrefix,
  makeProgressWriter,
  execCommand,
  startShell,
} from './run-command.js';
import { makeSSHServer, makeStdioDuplex, sshInstall } from './ssh.js';
import { cacheLs, cacheRm } from './cache.js';
import pkg from '../../package.json' with { type: 'json' };

const repoCache = createRepoCache();

const program = new Command();

program
  .name('reposh')
  .usage('[host/]<org>/<repo>[:ref] <command>')
  .description(
    'Run a bash command on a public git repo. Shallow clones on first access, then runs locally in a bash sandbox.\n\nPrefix host/ for non-GitHub repos (defaults to github.com).\nAppend :ref to target a branch or tag (e.g. org/repo:v2.0).',
  )
  .version(pkg.version);

// --- cache ---

const cache = program.command('cache').description('Manage the repo cache');

cache
  .command('add')
  .description('Pre-cache one or more repos')
  .argument('<repos...>', 'org/repo[:ref] or host/org/repo[:ref]')
  .action(async (repos: string[]) => {
    for (const arg of repos) {
      const target = parseTarget(arg);
      if (!target || target.source !== 'git') {
        console.error(`Invalid repo: ${arg}`);
        process.exit(1);
      }
      const onProgress = makeProgressWriter(
        (msg) => process.stderr.write(msg),
        process.stdin.isTTY ?? false,
      );
      try {
        await repoCache.ensureRepo(target, { onProgress, force: true });
        console.error(`Cached ${formatTarget(target)}`);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    }
  });

cache
  .command('ls')
  .description('List cached repos with sizes')
  .action(async () => {
    await cacheLs(CACHE_DIR);
  });

cache
  .command('rm')
  .description('Remove a cached repo, or --all to clear the entire cache')
  .argument('[repo]', 'org/repo[:ref] or host/org/repo[:ref]')
  .option('--all', 'Remove all cached repos')
  .option('-y, --yes', 'Skip confirmation')
  .action(
    async (
      repo: string | undefined,
      opts: { all?: boolean; yes?: boolean },
    ) => {
      try {
        await cacheRm(CACHE_DIR, { repo, all: opts.all, skipConfirm: opts.yes });
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    },
  );

// --- ssh ---

const ssh = program.command('ssh', { hidden: true }).description('SSH server commands (experimental)');
ssh.hook('preAction', () => {
  console.error('Note: SSH support is experimental and subject to change.\n');
});

ssh
  .command('install')
  .description('Install reposh as an SSH subsystem')
  .action(async () => {
    await sshInstall();
  });

ssh
  .command('serve')
  .description('Start the SSH server')
  .action(async () => {
    const server = await makeSSHServer();
    const PORT = parseInt(process.env.PORT ?? '22', 10);
    server.listen(PORT, '0.0.0.0', () => {
      console.error(`SSH server listening on port ${PORT}`);
      console.error(`Connect: ssh <org>/<repo>[:ref]@localhost`);
    });
    process.on('SIGTERM', () => {
      console.error('SIGTERM');
      process.exit(0);
    });
    process.on('SIGINT', () => {
      console.error('SIGINT');
      process.exit(0);
    });
  });

ssh
  .command('proxy')
  .description('Run as SSH ProxyCommand')
  .action(async () => {
    const server = await makeSSHServer(() => {});
    server._srv.emit('connection', makeStdioDuplex());
  });

// --- default: reposh <repo> [command...] ---

program
  .passThroughOptions()
  .argument('[repo]')
  .argument('[command...]')
  .action(async (repo: string | undefined, command: string[]) => {
    if (!repo) {
      program.help();
      return;
    }

    const target = parseTarget(repo);
    if (!target || target.source !== 'git') {
      console.error(`Invalid repo or unknown command: ${repo}`);
      process.exit(1);
    }

    const isInteractive = process.stdin.isTTY ?? false;
    const onProgress = makeProgressWriter(
      (msg) => process.stderr.write(msg),
      isInteractive,
    );

    let repoDir: string;
    try {
      repoDir = await repoCache.ensureRepo(target, { onProgress });
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    const prefix = makePrefix(target);
    const bash = makeBash(repoDir, prefix);

    if (command.length > 0) {
      const cmd = command.join(' ');
      try {
        const code = await execCommand(
          bash,
          cmd,
          (s) => process.stdout.write(s),
          (s) => process.stderr.write(s),
        );
        process.exit(code);
      } catch (err) {
        console.error(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
    } else {
      startShell(bash, formatTarget(target), {
        input: process.stdin,
        output: process.stdout,
        stderr: process.stderr,
        isInteractive,
        onClose: () => process.exit(0),
      });
    }
  });

await program.parseAsync();
