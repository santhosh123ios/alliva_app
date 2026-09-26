import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const file = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')].find((path) => existsSync(path));
if (file) process.loadEnvFile(file);

const [command, ...args] = process.argv.slice(2);
const child = spawn(command, args, { stdio: 'inherit', env: process.env, shell: process.platform === 'win32' });
child.on('exit', (code) => process.exit(code ?? 1));
