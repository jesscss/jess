import { spawnSync } from 'node:child_process';

const forwardedArgs = process.argv.slice(2);
if (forwardedArgs[0] === '--') {
  forwardedArgs.shift();
}

const normalizedArgs = forwardedArgs.map((arg) => {
  if (arg.startsWith('packages/core/')) {
    return arg.slice('packages/core/'.length);
  }
  return arg;
});

const args = [
  'exec',
  'vitest',
  '--run',
  '-c',
  'packages/core/vitest.config.ts',
  '--maxWorkers=1',
  '--fileParallelism=false',
  ...normalizedArgs
];

const result = spawnSync('pnpm', args, {
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
