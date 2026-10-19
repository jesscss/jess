import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import jsPlugin, { type JsPlugin } from '../src/index.js';

const workerPath = fileURLToPath(new URL('../src/runtime-worker.ts', import.meta.url));
const denoPath = path.join(
  path.dirname(createRequire(import.meta.url).resolve('deno/package.json')),
  process.platform === 'win32' ? 'deno.exe' : 'deno'
);

const writeModule = (source: string): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-js-lifetime-'));
  const modulePath = path.join(root, 'plugin.ts');
  fs.writeFileSync(modulePath, source, 'utf8');
  return modulePath;
};

const exited = (child: ChildProcessWithoutNullStreams, ms: number): Promise<boolean> =>
  new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => resolve(false), ms);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });

/**
 * The worker as a host runs it, reading request lines from stdin. Closing stdin
 * is what the worker sees when its host dies, however it dies: the pipe's
 * other end closes with the host process.
 */
const startWorker = async (modulePath: string) => {
  const child = spawn(
    denoPath,
    ['run', '--no-prompt', `--allow-read=${path.dirname(modulePath)},${workerPath}`, workerPath, '--runtime-api=module'],
    { stdio: ['pipe', 'pipe', 'pipe'] }
  );
  const lines: Array<{ id?: number; type?: string }> = [];
  const waiters: Array<() => void> = [];
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    for (let idx = buffer.indexOf('\n'); idx >= 0; idx = buffer.indexOf('\n')) {
      lines.push(JSON.parse(buffer.slice(0, idx)) as { id?: number; type?: string });
      buffer = buffer.slice(idx + 1);
      waiters.splice(0).forEach(wake => wake());
    }
  });
  const reply = async (match: (line: { id?: number; type?: string }) => boolean) => {
    while (!lines.some(match)) {
      await new Promise<void>(resolve => waiters.push(resolve));
    }
  };
  await reply(line => line.type === 'ready');
  const send = (request: object) => child.stdin.write(`${JSON.stringify(request)}\n`);
  return { child, send, reply };
};

describe('@jesscss/plugin-js worker lifetime', () => {
  const children: ChildProcessWithoutNullStreams[] = [];
  const plugins: JsPlugin[] = [];

  afterEach(() => {
    for (const child of children.splice(0)) {
      child.kill('SIGKILL');
    }
    for (const plugin of plugins.splice(0)) {
      plugin.dispose();
    }
  });

  it('exits when its host goes away while a plugin call is still running', async () => {
    const modulePath = writeModule('export function spin() { for (;;) {} }');
    const worker = await startWorker(modulePath);
    children.push(worker.child);
    worker.send({ id: 1, type: 'load', modulePath });
    await worker.reply(line => line.id === 1);
    worker.send({ id: 2, type: 'invoke', modulePath, exportName: 'spin', args: [] });
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(worker.child.exitCode).toBe(null);
    worker.child.stdin.end();
    expect(await exited(worker.child, 3000)).toBe(true);
  });

  it('exits when its host goes away, even when a plugin left a timer and a signal listener', async () => {
    const modulePath = writeModule([
      'export function linger() {',
      '  setInterval(() => {}, 1000);',
      '  Deno.addSignalListener(\'SIGTERM\', () => {});',
      '  return 1;',
      '}'
    ].join('\n'));
    const worker = await startWorker(modulePath);
    children.push(worker.child);
    worker.send({ id: 1, type: 'load', modulePath });
    await worker.reply(line => line.id === 1);
    worker.send({ id: 2, type: 'invoke', modulePath, exportName: 'linger', args: [] });
    await worker.reply(line => line.id === 2);

    expect(worker.child.exitCode).toBe(null);
    worker.child.stdin.end();
    expect(await exited(worker.child, 3000)).toBe(true);
  });

  it.each(['Deno.exit(0)', 'close()'])('fails the call at once when a plugin calls %s', async (call) => {
    const modulePath = writeModule(`export function quit() { ${call}; }`);
    const plugin = jsPlugin({ jsReadRoot: path.dirname(modulePath) }) as JsPlugin;
    plugins.push(plugin);
    const mod = await plugin.import(modulePath);
    const started = Date.now();
    await expect(mod.quit()).rejects.toThrow('Deno worker exited unexpectedly.');

    // Well inside the 10 s request timeout, which is what a swallowed exit would wait for.
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('fails startup at once when the worker exits before it is ready', async () => {
    const modulePath = writeModule('export const x = 1;');
    const root = path.dirname(modulePath);
    const denoCommand = path.join(root, 'deno');
    fs.writeFileSync(denoCommand, '#!/bin/sh\n[ "$1" = --version ] && exit 0\necho cannot start >&2\nexit 1\n', { mode: 0o755 });
    const plugin = jsPlugin({ jsReadRoot: root, denoCommand }) as JsPlugin;
    plugins.push(plugin);
    const started = Date.now();
    await expect(plugin.import(modulePath)).rejects.toThrow(/exited during startup\.\ncannot start/);

    // Well inside the 8 s startup timeout.
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
