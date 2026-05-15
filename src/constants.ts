import { join } from 'node:path';
import { homedir } from 'node:os';

const REPOSH_DIR = join(homedir(), '.reposh');
export const CACHE_DIR = process.env.REPOSH_CACHE_DIR ?? join(REPOSH_DIR, 'cache');
export const RESOLUTIONS_DIR = process.env.REPOSH_RESOLUTIONS_DIR ?? join(REPOSH_DIR, 'package-resolutions');
export const HOST_KEY_PATH = process.env.REPOSH_HOST_KEY_PATH ?? join(REPOSH_DIR, 'host_key');
export const CACHE_TTL = parseInt(process.env.REPOSH_CACHE_TTL ?? String(30 * 60 * 1000), 10);
