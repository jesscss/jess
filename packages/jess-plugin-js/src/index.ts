import {
  type Plugin,
  AbstractPlugin
} from '@jesscss/core';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';

export type JavaScriptSandboxConfig = {
  allowHttp?: boolean;
  allowNetHosts?: string[];
  jsReadRoot?: string;
};

export interface JsPluginOptions extends JavaScriptSandboxConfig {
  denoCommand?: string;
}

const SCRIPT_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.mts',
  '.cts'
]);

const RUNTIME_MISSING_MESSAGE = [
  'Deno runtime is required for @jesscss/plugin-js, but no usable Deno binary was found.',
  'If using pnpm, approve build scripts for "deno" (pnpm approve-builds).',
  'If using npm with ignored scripts, reinstall with lifecycle scripts enabled.',
  'Or install native Deno and ensure "deno" is on PATH.'
].join('\n');

const BOOT_TIMEOUT_MS = 8000;
const REQUEST_TIMEOUT_MS = 10_000;

const isPathInside = (candidatePath: string, rootPath: string): boolean => {
  const rel = path.relative(rootPath, candidatePath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

const canonicalPath = (p: string): string => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return p;
  }
};

const normalizePermissionPath = (value: string | null): string | null => {
  if (!value) {
    return null;
  }
  if (value.startsWith('file://')) {
    try {
      return fileURLToPath(value);
    } catch {
      return value;
    }
  }
  return value;
};

const isFnsPath = (importPath: string): boolean => {
  const normalized = importPath.replace(/\\/g, '/');
  const isFnsPackagePath = /(^|\/)(@jesscss\/fns|packages\/fns)(\/|$)/.test(normalized);
  return (
    normalized === '@jesscss/fns'
    || normalized.startsWith('@jesscss/fns/')
    || normalized === '#less'
    || normalized.startsWith('#less/')
    || normalized === '#sass'
    || normalized.startsWith('#sass/')
    || isFnsPackagePath
  );
};

const isJsonValue = (value: unknown) => {
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
};

type BrokerRequest = {
  v: number;
  pid: number;
  id: number;
  datetime: string;
  permission: 'read' | 'write' | 'net' | 'env' | 'run' | 'ffi' | 'sys' | string;
  value: string | null;
};

type BrokerResponse = {
  id: number;
  result: 'allow' | 'deny';
  reason?: string;
};

type RpcRequest =
  | { id: number; type: 'load'; modulePath: string }
  | { id: number; type: 'invoke'; modulePath: string; exportName: string; args: unknown[] };

type RpcResult =
  | { id: number; ok: true; exports?: Array<{ name: string; kind: 'function' | 'value'; value?: unknown }>; value?: unknown }
  | { id: number; ok: false; error: string };

type RuntimeState =
  | { status: 'idle' }
  | { status: 'initializing'; promise: Promise<void> }
  | { status: 'ready' }
  | { status: 'failed'; error: Error };

export class JsPlugin extends AbstractPlugin {
  name = 'js';
  supportedExtensions = Array.from(SCRIPT_EXTENSIONS);
  private runtimeState: RuntimeState = { status: 'idle' };
  private brokerServer: net.Server | undefined;
  private brokerSocketPath: string | undefined;
  private worker: ChildProcessWithoutNullStreams | undefined;
  private workerBuffer = '';
  private nextRequestId = 1;
  private pending = new Map<number, {
    resolve: (value: RpcResult) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();

  constructor(public opts: JsPluginOptions = {}) {
    super();
  }

  prewarm() {
    return this.ensureRuntime().catch(() => undefined);
  }

  private ensureRuntimeAvailable(): void {
    const denoCommand = this.opts.denoCommand ?? 'deno';
    const result = spawnSync(denoCommand, ['--version'], {
      stdio: 'ignore'
    });
    if (result.status !== 0) {
      throw new Error(RUNTIME_MISSING_MESSAGE);
    }
  }

  private ensureRuntime(): Promise<void> {
    if (this.runtimeState.status === 'ready') {
      return Promise.resolve();
    }
    if (this.runtimeState.status === 'initializing') {
      return this.runtimeState.promise;
    }
    if (this.runtimeState.status === 'failed') {
      return Promise.reject(this.runtimeState.error);
    }
    const promise = this.startRuntime().then(
      () => {
        this.runtimeState = { status: 'ready' };
      },
      (err: Error) => {
        this.runtimeState = { status: 'failed', error: err };
        throw err;
      }
    );
    this.runtimeState = { status: 'initializing', promise };
    return promise;
  }

  private createBrokerPath() {
    if (process.platform === 'win32') {
      const rand = `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      return `\\\\.\\pipe\\jess-deno-broker-${rand}`;
    }
    // macOS temp dir paths can exceed unix socket limits. Keep this short.
    const rand = Math.floor(Math.random() * 10000);
    return `/tmp/jd-${process.pid}-${Date.now()}-${rand}.sock`;
  }

  private isReadAllowed(value: string | null): boolean {
    const normalized = normalizePermissionPath(value);
    if (!normalized) {
      return false;
    }
    const requestedPath = canonicalPath(path.resolve(normalized));
    const jsReadRoot = this.opts.jsReadRoot ? canonicalPath(path.resolve(this.opts.jsReadRoot)) : undefined;
    if (jsReadRoot && isPathInside(requestedPath, jsReadRoot)) {
      return true;
    }
    return requestedPath.includes(`${path.sep}node_modules${path.sep}`);
  }

  private isNetAllowed(value: string | null): boolean {
    if (!this.opts.allowHttp) {
      return false;
    }
    const allowHosts = this.opts.allowNetHosts ?? [];
    if (allowHosts.length === 0) {
      return true;
    }
    if (!value) {
      return false;
    }
    const host = value.split(':')[0] ?? value;
    return allowHosts.includes(host);
  }

  private handleBrokerRequest(request: BrokerRequest): BrokerResponse {
    const deny = (reason: string): BrokerResponse => ({
      id: request.id,
      result: 'deny',
      reason
    });
    switch (request.permission) {
      case 'read':
        return this.isReadAllowed(request.value)
          ? { id: request.id, result: 'allow' }
          : deny('Read access denied by Jess policy.');
      case 'net':
        return this.isNetAllowed(request.value)
          ? { id: request.id, result: 'allow' }
          : deny('Network access denied by Jess policy.');
      case 'env':
      case 'run':
      case 'ffi':
      case 'sys':
      case 'write':
        return deny(`${request.permission} permission denied by Jess policy.`);
      default:
        return deny(`Permission "${request.permission}" denied by Jess policy.`);
    }
  }

  private async startBroker(): Promise<string> {
    const socketPath = this.createBrokerPath();
    if (process.platform !== 'win32' && fs.existsSync(socketPath)) {
      fs.unlinkSync(socketPath);
    }
    const server = net.createServer((socket) => {
      let buf = '';
      socket.setEncoding('utf8');
      socket.on('data', (chunk) => {
        buf += chunk;
        let idx = buf.indexOf('\n');
        while (idx >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          idx = buf.indexOf('\n');
          if (!line) {
            continue;
          }
          let req: BrokerRequest | undefined;
          try {
            req = JSON.parse(line) as BrokerRequest;
          } catch {
            socket.write(JSON.stringify({
              id: -1,
              result: 'deny',
              reason: 'Malformed permission request.'
            }) + '\n');
            continue;
          }
          const response = this.handleBrokerRequest(req);
          socket.write(`${JSON.stringify(response)}\n`);
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => resolve());
    });
    this.brokerServer = server;
    this.brokerSocketPath = socketPath;
    return socketPath;
  }

  private startWorker(socketPath: string): Promise<void> {
    const denoCommand = this.opts.denoCommand ?? 'deno';
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const compiledWorkerPath = path.join(moduleDir, 'runtime-worker.js');
    const sourceWorkerPath = path.join(moduleDir, 'runtime-worker.ts');
    const workerScriptPath = fs.existsSync(compiledWorkerPath)
      ? compiledWorkerPath
      : sourceWorkerPath;
    const child = spawn(
      denoCommand,
      ['run', '--no-prompt', workerScriptPath],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          DENO_PERMISSION_BROKER_PATH: socketPath
        }
      }
    );
    this.worker = child;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => this.onWorkerStdout(chunk));
    child.on('exit', () => {
      const err = new Error('Deno worker exited unexpectedly.');
      this.rejectAllPending(err);
      if (this.runtimeState.status !== 'failed') {
        this.runtimeState = { status: 'failed', error: err };
      }
    });
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Timed out waiting for Deno worker startup.'));
      }, BOOT_TIMEOUT_MS);
      const onData = (chunk: string) => {
        this.workerBuffer += chunk;
        let idx = this.workerBuffer.indexOf('\n');
        while (idx >= 0) {
          const line = this.workerBuffer.slice(0, idx).trim();
          this.workerBuffer = this.workerBuffer.slice(idx + 1);
          idx = this.workerBuffer.indexOf('\n');
          if (!line) {
            continue;
          }
          try {
            const parsed = JSON.parse(line) as { type?: string };
            if (parsed.type === 'ready') {
              clearTimeout(timer);
              child.stdout.off('data', onData);
              resolve();
              return;
            }
          } catch {
            // ignore until ready payload appears
          }
        }
      };
      child.stdout.on('data', onData);
      child.once('error', (err) => {
        clearTimeout(timer);
        child.stdout.off('data', onData);
        reject(err);
      });
    });
  }

  private async startRuntime(): Promise<void> {
    this.ensureRuntimeAvailable();
    const socketPath = await this.startBroker();
    try {
      await this.startWorker(socketPath);
    } catch (err: any) {
      this.shutdown();
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  private onWorkerStdout(chunk: string) {
    this.workerBuffer += chunk;
    let idx = this.workerBuffer.indexOf('\n');
    while (idx >= 0) {
      const line = this.workerBuffer.slice(0, idx).trim();
      this.workerBuffer = this.workerBuffer.slice(idx + 1);
      idx = this.workerBuffer.indexOf('\n');
      if (!line) {
        continue;
      }
      let parsed: RpcResult | undefined;
      try {
        parsed = JSON.parse(line) as RpcResult;
      } catch {
        continue;
      }
      if (!parsed || typeof parsed.id !== 'number') {
        continue;
      }
      const pending = this.pending.get(parsed.id);
      if (!pending) {
        continue;
      }
      this.pending.delete(parsed.id);
      clearTimeout(pending.timeout);
      pending.resolve(parsed);
    }
  }

  private rejectAllPending(err: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(err);
    }
    this.pending.clear();
  }

  private async callWorker(
    request:
      | { type: 'load'; modulePath: string }
      | { type: 'invoke'; modulePath: string; exportName: string; args: unknown[] }
  ): Promise<RpcResult> {
    await this.ensureRuntime();
    if (!this.worker || !this.worker.stdin.writable) {
      throw new Error('Deno worker is not available.');
    }
    const id = this.nextRequestId++;
    const payload: RpcRequest = { ...request, id };
    return await new Promise<RpcResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Timed out waiting for Deno worker response.'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timeout });
      this.worker!.stdin.write(`${JSON.stringify(payload)}\n`);
    });
  }

  private shutdown() {
    if (this.worker && !this.worker.killed) {
      this.worker.kill();
    }
    this.worker = undefined;
    if (this.brokerServer) {
      this.brokerServer.close();
      this.brokerServer = undefined;
    }
    if (this.brokerSocketPath && process.platform !== 'win32') {
      try {
        if (fs.existsSync(this.brokerSocketPath)) {
          fs.unlinkSync(this.brokerSocketPath);
        }
      } catch {
        // ignore
      }
    }
    this.brokerSocketPath = undefined;
  }

  dispose() {
    this.shutdown();
    this.runtimeState = { status: 'idle' };
  }

  private assertAllowedPath(absoluteFilePath: string) {
    const resolvedPath = path.resolve(absoluteFilePath);
    const jsReadRoot = this.opts.jsReadRoot ? path.resolve(this.opts.jsReadRoot) : undefined;
    if (!jsReadRoot) {
      return;
    }
    if (isPathInside(resolvedPath, jsReadRoot)) {
      return;
    }
    // pnpm layouts may resolve package files outside project root.
    if (resolvedPath.includes(`${path.sep}node_modules${path.sep}`)) {
      return;
    }
    throw new Error(`Script path "${resolvedPath}" is outside jsReadRoot "${jsReadRoot}"`);
  }

  async import(absoluteFilePath: string): Promise<Record<string, any>> {
    const ext = path.extname(absoluteFilePath);
    if (!SCRIPT_EXTENSIONS.has(ext)) {
      throw new Error(`Plugin "${this.name}" cannot import "${absoluteFilePath}"`);
    }
    if (!isFnsPath(absoluteFilePath)) {
      this.assertAllowedPath(absoluteFilePath);
      await this.ensureRuntime();
      const modulePath = path.resolve(absoluteFilePath);
      const loadResult = await this.callWorker({ type: 'load', modulePath });
      if (!loadResult.ok) {
        throw new Error(loadResult.error);
      }
      const moduleObject: Record<string, any> = {};
      const exported = loadResult.exports ?? [];
      for (const item of exported) {
        if (item.kind === 'function') {
          moduleObject[item.name] = async (...args: unknown[]) => {
            const invokeResult = await this.callWorker({
              type: 'invoke',
              modulePath,
              exportName: item.name,
              args
            });
            if (!invokeResult.ok) {
              throw new Error(invokeResult.error);
            }
            return invokeResult.value;
          };
        } else {
          moduleObject[item.name] = item.value;
        }
      }
      return moduleObject;
    }
    const modulePath = pathToFileURL(path.resolve(absoluteFilePath)).href;
    const module = await import(modulePath);
    const safeModule: Record<string, any> = {};
    for (const [key, value] of Object.entries(module as Record<string, any>)) {
      if (typeof value === 'function' || isJsonValue(value)) {
        safeModule[key] = value;
      }
    }
    return safeModule;
  }
}

const jsPlugin = ((opts?: JsPluginOptions) => {
  return new JsPlugin(opts);
}) satisfies Plugin;

export default jsPlugin;
