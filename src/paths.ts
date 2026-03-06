import { join } from 'node:path';
import { homedir } from 'node:os';

const REPOSH_DIR = join(homedir(), '.reposh');
export const CACHE_DIR = process.env.CACHE_DIR ?? join(REPOSH_DIR, 'cache');
export const HOST_KEY_PATH = process.env.HOST_KEY_PATH ?? join(REPOSH_DIR, 'host_key');
