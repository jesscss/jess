import {
  type JessError,
  type Plugin,
  type ScriptSandboxRoute,
  AbstractPlugin,
  ERR,
  recordPluginModule
} from '@jesscss/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createRequire } from 'node:module';
import { decodeBridgeResult, decodeBridgeValue, encodeBridgeArgs, encodeBridgeValue } from './bridge.js';
import { trustedFnsRealPath } from './trust.js';
import {
  encodeEngineValue,
  engineCode,
  engineFailure,
  hostFacts,
  denoRunArgs,
  encodeHostConfigs,
  readRootsBelowUnreadableFolders,
  type HostConfigs,
  readSetFor,
  type EngineHostFacts
} from './engine.js';

/** The script runtime (`plugin-runtime.ts`), loaded only inside the compile engine. */
type InProcessRuntime = {
  loadModule(modulePath: string): Promise<Array<{ name: string; kind: 'function' | 'value'; value?: unknown }>>;
  invokeExport(modulePath: string, exportName: string, args: unknown[]): Promise<unknown>;
  loadLessPlugin(modulePath: string, options: string | null): Promise<string[]>;
  invokeLessPluginFunction(
    modulePath: string,
    functionName: string,
    args: unknown[],
    options: string | null,
    facts: {
      variable(name: string): { value: unknown; important?: boolean } | null;
      call(name: string, args: unknown[]): unknown;
      fileInfo: { filename: string; entryPath: string } | null;
    }
  ): Promise<{ value?: unknown; logs: PluginLogRecord[]; important?: boolean }>;
};

const loadInProcessRuntime = async (): Promise<InProcessRuntime> => {
  const runtime: InProcessRuntime = await import('./plugin-runtime.js');
  return runtime;
};

/** A thrown value's fields, as the sandbox reports them. */
const thrownFields = (err: unknown): { error: string; errorName: string; stack: string | undefined } => ({
  error: err instanceof Error ? err.message : String(err),
  errorName: err instanceof Error ? err.name : 'Error',
  stack: err instanceof Error ? err.stack : undefined
});

/**
 * A failure raised BY a `@plugin` script (its own `throw`, or a shim member it
 * cannot use), as distinct from a value the engine simply could not compute.
 * The distinction is what lets the compiler report a plugin fault loudly and
 * attributably instead of preserving the call verbatim.
 */
export class PluginFunctionError extends Error {
  readonly functionName: string;
  readonly pluginStack: string | undefined;
  readonly originalName: string;

  constructor(functionName: string, reason: string, pluginStack?: string, originalName = 'Error') {
    super(`Less @plugin function "${functionName}" threw: ${reason}`);
    this.name = 'PluginFunctionError';
    this.functionName = functionName;
    this.pluginStack = pluginStack;
    this.originalName = originalName;
  }
}

/**
 * The sandbox refused a Less 4 plugin-manager API or tree node
 * (`UnsupportedLessPluginApiError` in `runtime-worker.ts`, whose message is the
 * member refused). It is reported
 * as the `plugin/unsupported-feature` diagnostic the in-process bridge of
 * `@jesscss/plugin-less-compat` raises, not as a script that threw.
 */
const lessPluginApiRefusal = (
  plugin: string,
  result: { error?: string; errorName?: string }
): JessError | undefined =>
  result.errorName === 'UnsupportedLessPluginApiError' && result.error !== undefined
    ? ERR.pluginUnsupported({ meta: { plugin, feature: result.error } })
    : undefined;

/**
 * Child-process stdio streams are typed as bare `Writable`/`Readable`, which do
 * not declare `unref`, but the underlying pipe sockets expose it at runtime.
 * The optional structural member lets any stream be passed without an unsafe
 * cast; the runtime `?.` guard covers streams that genuinely lack the method.
 */
const unrefStream = (stream: unknown): void => {
  if (
    typeof stream === 'object'
    && stream !== null
    && 'unref' in stream
    && typeof stream.unref === 'function'
  ) {
    stream.unref();
  }
};

export type JavaScriptSandboxConfig = {
  allowHttp?: boolean;
  allowNetHosts?: string[];
  jsReadRoot?: string;
};

export interface JsPluginOptions extends JavaScriptSandboxConfig {
  denoCommand?: string;

  /**
   * Runtime API exposed inside the Deno worker.
   *
   * Jess `@-use`/script imports run as plain ESM modules. Legacy Less
   * `@plugin` loading can opt into the Less-compatible global shape.
   */
  runtimeApi?: 'module' | 'less';

  /**
   * Milliseconds a single worker request may run before it is abandoned and
   * the worker is killed (see {@link RENDER_TIMEOUT_MS}). Mainly a test seam
   * for proving a runaway script is terminated without waiting the full
   * default.
   */
  requestTimeoutMs?: number;
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

/**
 * Absolute path to the Deno binary the `deno` npm dependency downloads at
 * install time, or undefined when that package (or its binary) is absent.
 *
 * `@jesscss/plugin-js` declares `deno` as a dependency precisely so `@plugin`
 * execution works without a native Deno install; resolving that binary here is
 * what makes the dependency load-bearing rather than decorative. Relying on a
 * bare `deno` on PATH masked this on machines with a system Deno while failing
 * anywhere it is only installed via the dependency (CI, fresh clones). The
 * binary sits next to the package's own `bin.cjs` shim, which execs the exact
 * same path.
 */
const resolveBundledDenoPath = (): string | undefined => {
  try {
    const packageDir = path.dirname(createRequire(import.meta.url).resolve('deno/package.json'));
    const binary = path.join(packageDir, process.platform === 'win32' ? 'deno.exe' : 'deno');
    return fs.existsSync(binary) ? binary : undefined;
  } catch {
    return undefined;
  }
};

const BOOT_TIMEOUT_MS = 8000;
const IDLE_SHUTDOWN_MS = 5_000;

/** A whole render is one request, so it gets a whole render's time. */
const RENDER_TIMEOUT_MS = 120_000;

/**
 * Consecutive unexpected worker deaths (with no successful reply between) after
 * which the plugin stops auto-restarting and latches to `failed`. Bounds a
 * worker that crashes on every start (a broken binary, a poisoned module that
 * kills on load) instead of spin-restarting it forever.
 */
const MAX_WORKER_DEATHS = 3;

/**
 * Environment variables that inject a Node.js debugger/inspector bootloader
 * into child processes (VS Code / Cursor "Auto Attach", `node --inspect`, etc.).
 *
 * These must never leak into the sandboxed Deno worker: the injected bootloader
 * tries to read the environment, the Jess Deno sandbox denies `env` permission,
 * and the worker never signals ready — producing a spurious
 * "Timed out waiting for Deno worker startup" failure. Deno does not use any of
 * these vars, so stripping them is safe.
 */
const DEBUG_ENV_KEY_RE = /^(NODE_OPTIONS|NODE_INSPECT|VSCODE_INSPECTOR_OPTIONS)/i;
const DEBUG_ENV_VALUE_RE = /js-debug|bootloader/i;

/**
 * Returns a copy of `env` with Node debugger/inspector-attach variables removed,
 * so a spawned Deno subprocess starts regardless of the parent's debug env.
 * The Deno permission sandbox is untouched; this only stops leaking the debugger
 * into it.
 */
export const sanitizeSpawnEnv = (
  env: Readonly<Record<string, string | undefined>> = process.env
): Record<string, string | undefined> => {
  const clean: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (DEBUG_ENV_KEY_RE.test(key)) {
      continue;
    }
    if (typeof value === 'string' && DEBUG_ENV_VALUE_RE.test(value)) {
      continue;
    }
    clean[key] = value;
  }
  return clean;
};

const isJsonValue = (value: unknown) => {
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
};

export type PluginLogRecord = { level: 'warn' | 'error' | 'info' | 'debug'; message: string };

/**
 * The compiler-side capabilities a legacy `@plugin` function body needs. The
 * dialect adapter supplies these bound to the LIVE evaluation frame of the call
 * site, which the script reaches directly: script and compiler share the
 * engine's realm.
 */
export interface PluginCallCapabilities {
  /** Resolve `@name` at the call site. `null` means "no such variable". */
  lookupVariable?(name: string): { value: unknown; important?: boolean } | null;

  /** Evaluate a built-in function (`less.functions.functionRegistry.get(...)`). */
  callFunction?(name: string, args: unknown[]): unknown;

  /** The file/entry pair a plugin reads through `this.currentFileInfo`. */
  currentFileInfo?: { filename: string; entryPath: string };

  /** Records a diagnostic emitted by the plugin through `less.logger`. */
  log?(record: PluginLogRecord): void;

  /** Propagates `!important` picked up while resolving a variable. */
  markImportant?(): void;
}

/** A `@plugin` function bound to the live call-site capabilities. */
export type ContextualPluginFunction = (
  args?: readonly unknown[] | unknown,
  capabilities?: PluginCallCapabilities
) => unknown | Promise<unknown>;

const EMPTY_PLUGIN_CALL_CAPABILITIES: PluginCallCapabilities = {};

function normalizePluginCallArgs(args: readonly unknown[] | unknown): readonly unknown[] {
  if (args === undefined) {
    return [];
  }
  return Array.isArray(args) ? args : [args];
}

/** One render sent to the compile engine (`engine-runtime.ts`), or the warm-up ahead of one. */
type EngineWireRequest =
  | {
    type: 'render';
    compiler: { module: string; exportName: string };
    compilerOptions: unknown;
    method: EngineRenderRequest['method'];
    args: unknown;
    host: EngineHostFacts;
    configs: HostConfigs | undefined;
  }
  | {
    type: 'warm';
    compiler: { module: string; exportName: string };
    compilerOptions: unknown;
    extension: string | undefined;
    host: EngineHostFacts;
  };

type RpcRequest = { id: number } & EngineWireRequest;

type RpcResult =
  | {
    id: number;
    ok: true;
    value?: unknown;

    /** A `render` reply: what the render printed to stderr. */
    stderr?: string;
  }
  | {
    id: number;
    ok: false;

    /** A `render` reply: what the render printed, and a thrown `JessError`'s fields. */
    stderr?: string;
    jessError?: Record<string, unknown>;
    code?: string;
    error?: string;
    errorName?: string;
    stack?: string;
  };

type RuntimeState =
  | { status: 'idle' }
  | { status: 'initializing'; promise: Promise<void> }
  | { status: 'ready' }
  | { status: 'failed'; error: Error }
  | { status: 'disposed' };

export class JsPlugin extends AbstractPlugin {
  private static cleanupRegistered = false;
  private static liveInstances = new Set<JsPlugin>();
  name = 'js';
  supportedExtensions = Array.from(SCRIPT_EXTENSIONS);
  private runtimeState: RuntimeState = { status: 'idle' };
  private worker: ChildProcessWithoutNullStreams | undefined;

  /** The `--allow-read` list the running Deno process was started with. */
  private workerReadSet: string | undefined;

  /** The `--allow-read` list the next Deno process starts with (set by a render). */
  private nextReadSet: readonly string[] | undefined;

  /** The read set renders hold the engine under, how many hold it, and how many wait (see `useReadSet`). */
  private readSetTurn: { key: string; users: number; waiting: number; done: Promise<void>; end: () => void } | undefined;

  /** Whether a render ran in this plugin's engine (a prewarmed one that never did is let go). */
  private engineUsed = false;

  /** Stops the ahead-of-time start still on its way when the engine is let go: no spawn, no more file reads. */
  private prewarmAbort: AbortController | undefined;

  /** Inside the compile engine: the script runtime of this realm. */
  private inProcess: Promise<InProcessRuntime> | undefined;
  private workerBuffer = '';
  private nextRequestId = 1;
  private pending = new Map<number, {
    resolve: (value: RpcResult) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();

  private idleTimer: NodeJS.Timeout | undefined;
  private denoCommand: string | undefined;

  /**
   * Consecutive unexpected worker deaths since the last successful reply. One
   * crash self-heals (the next call restarts a clean worker); a worker that
   * dies on every start latches the plugin to `failed` instead of spin-restarting.
   */
  private consecutiveWorkerDeaths = 0;

  constructor(public opts: JsPluginOptions = {}) {
    super();
    JsPlugin.liveInstances.add(this);
    JsPlugin.registerProcessCleanup();
  }

  /**
   * Nothing to start ahead of time: a render that reaches a script moves into
   * the compile engine, which starts with that render's read root.
   */
  prewarm() {
    return undefined;
  }

  private static registerProcessCleanup() {
    if (JsPlugin.cleanupRegistered) {
      return;
    }
    JsPlugin.cleanupRegistered = true;
    const cleanup = () => {
      for (const instance of JsPlugin.liveInstances) {
        try {
          instance.dispose();
        } catch {
          // ignore
        }
      }
    };
    process.once('beforeExit', cleanup);
    process.once('exit', cleanup);
  }

  private clearIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
  }

  private scheduleIdleShutdown() {
    this.clearIdleTimer();
    if (this.pending.size > 0 || this.runtimeState.status !== 'ready') {
      return;
    }
    this.idleTimer = setTimeout(() => {
      this.shutdown();
      this.runtimeState = { status: 'idle' };
    }, IDLE_SHUTDOWN_MS);
    this.idleTimer.unref?.();
  }

  /**
   * The Deno executable this instance spawns, resolved once. An explicit
   * `denoCommand` option wins; otherwise the binary of the `deno` dependency,
   * whose exact version this package pins, so every install runs the Deno its
   * sandbox was tested on. A Deno on PATH is the fallback for an install whose
   * `deno` binary was never downloaded (its install script did not run).
   * Throws the actionable RUNTIME_MISSING guidance when nothing runs.
   */
  private resolveDenoCommand(): string {
    if (this.denoCommand !== undefined) {
      return this.denoCommand;
    }
    const runs = (command: string): boolean =>
      spawnSync(command, ['--version'], {
        stdio: 'ignore',
        env: sanitizeSpawnEnv(process.env)
      }).status === 0;

    const explicit = this.opts.denoCommand;
    if (explicit !== undefined) {
      if (!runs(explicit)) {
        throw new Error(RUNTIME_MISSING_MESSAGE);
      }
      return (this.denoCommand = explicit);
    }

    /*
     * The pinned binary is used without running it first: `deno --version`
     * blocks this thread for ~40 ms. A binary that cannot run fails the
     * spawn, which reports the same guidance.
     */
    const bundled = resolveBundledDenoPath();
    if (bundled !== undefined) {
      return (this.denoCommand = bundled);
    }
    if (runs('deno')) {
      return (this.denoCommand = 'deno');
    }
    throw new Error(RUNTIME_MISSING_MESSAGE);
  }

  private ensureRuntime(): Promise<void> {
    if (this.runtimeState.status === 'ready') {
      this.clearIdleTimer();
      return Promise.resolve();
    }
    if (this.runtimeState.status === 'initializing') {
      return this.runtimeState.promise;
    }
    if (this.runtimeState.status === 'failed') {
      return Promise.reject(this.runtimeState.error);
    }
    if (this.runtimeState.status === 'disposed') {
      return Promise.reject(new Error('Deno worker has been disposed.'));
    }

    /*
     * A start stopped on purpose (`shutdown`) settles after the state was reset,
     * maybe after the next start began: it must not mark that one ready or failed.
     */
    const current = () => this.runtimeState.status === 'initializing' && this.runtimeState.promise === promise;
    const promise: Promise<void> = this.startRuntime().then(
      () => {
        if (current()) {
          this.runtimeState = { status: 'ready' };
          this.scheduleIdleShutdown();
        }
      },
      (err: Error) => {
        if (current()) {
          this.runtimeState = { status: 'failed', error: err };
        }
        throw err;
      }
    );
    this.runtimeState = { status: 'initializing', promise };
    return promise;
  }

  /**
   * Starts Deno under native permission flags (ledger A19): read only
   * `readSet`, every other read answered "not found" (`--ignore-read`),
   * network only with `allowHttp`, and no env, write, run, ffi or sys. Deno
   * enforces them itself.
   */
  private startWorker(readSet: readonly string[]): Promise<void> {
    const denoCommand = this.resolveDenoCommand();
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const compiledWorkerPath = path.join(moduleDir, 'runtime-worker.js');
    const sourceWorkerPath = path.join(moduleDir, 'runtime-worker.ts');
    const workerScriptPath = fs.existsSync(compiledWorkerPath)
      ? compiledWorkerPath
      : sourceWorkerPath;
    const args = denoRunArgs(readSet, this.opts, workerScriptPath);
    const child = spawn(
      denoCommand,
      args,
      {
        stdio: ['pipe', 'pipe', 'pipe'],

        /*
         * Deno keeps the web Cache API (`caches`) on disk by default, keyed by
         * the main module, which every engine shares: without write permission
         * a script could store data a later render, of any project, reads back.
         */
        env: { ...sanitizeSpawnEnv(process.env), DENO_CACHE_DB_MODE: 'memory' }
      }
    );
    this.worker = child;
    child.unref();
    unrefStream(child.stdin);
    unrefStream(child.stdout);
    unrefStream(child.stderr);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => this.onWorkerStdout(chunk));
    child.on('exit', () => this.onWorkerExit(child));
    return new Promise<void>((resolve, reject) => {
      let stderrText = '';
      const timer = setTimeout(() => {
        reject(new Error(stderrText.trim()
          ? `Timed out waiting for Deno worker startup.\n${stderrText.trim()}`
          : 'Timed out waiting for Deno worker startup.'));
      }, BOOT_TIMEOUT_MS);
      const onStderr = (chunk: string) => {
        stderrText += chunk;
      };
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
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JSON.parse returns any; validated by field check below
            const parsed = JSON.parse(line) as { type?: string };
            if (parsed.type === 'ready') {
              clearTimeout(timer);
              child.stdout.off('data', onData);
              child.stderr.off('data', onStderr);
              resolve();
              return;
            }
          } catch {
            // ignore until ready payload appears
          }
        }
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onStderr);
      child.once('error', (err) => {
        clearTimeout(timer);
        child.stdout.off('data', onData);
        child.stderr.off('data', onStderr);
        reject(new Error(`${RUNTIME_MISSING_MESSAGE}\n${err.message}`));
      });

      /*
       * A worker that dies before it is ready fails startup at once, with its
       * stderr. One that exits without a word is most likely not Deno at all
       * (a \`denoCommand\` naming another program), so it gets the same guidance
       * as a missing binary.
       */
      child.once('close', () => {
        clearTimeout(timer);
        reject(new Error(stderrText.trim()
          ? `Deno worker exited during startup.\n${stderrText.trim()}`
          : `${RUNTIME_MISSING_MESSAGE}\nDeno worker exited during startup without a word: "${denoCommand}" may not be Deno.`));
      });
    });
  }

  private onWorkerExit(child: ChildProcessWithoutNullStreams) {
    /*
     * A process stopped on purpose (`shutdown`) is no longer `this.worker`; its
     * exit can arrive after the next process started, and must not touch it.
     */
    if (child !== this.worker) {
      return;
    }
    this.worker = undefined;
    const err = new Error('Deno worker exited unexpectedly.');
    this.rejectAllPending(err);
    if (this.runtimeState.status === 'disposed') {
      return;
    }

    /*
     * An unexpected exit (a script calling `Deno.exit()`, an OOM, a panic)
     * must not brick the plugin: reset to `idle` so the next call starts a
     * clean worker, exactly as the request-timeout path does. A worker that
     * dies on every start would otherwise spin-restart forever, so after
     * MAX_WORKER_DEATHS consecutive deaths with no successful reply in between
     * we latch to `failed`. The counter resets on the next delivered reply.
     */
    this.consecutiveWorkerDeaths++;
    this.runtimeState = this.consecutiveWorkerDeaths > MAX_WORKER_DEATHS
      ? { status: 'failed', error: err }
      : { status: 'idle' };
  }

  private async startRuntime(): Promise<void> {
    this.resolveDenoCommand();
    const readSet = this.nextReadSet;
    if (readSet === undefined) {
      throw new Error('The Deno engine starts only for a render.');
    }
    this.workerReadSet = readSet.join('\u0000');
    let child: ChildProcessWithoutNullStreams | undefined;
    try {
      const started = this.startWorker(readSet);
      child = this.worker;
      await started;
    } catch (err: unknown) {
      /* A process stopped on purpose is already shut down, and `this.worker` may be the next one. */
      if (child === undefined || child === this.worker) {
        this.shutdown();
      }
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
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JSON.parse returns any; validated by field checks below
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

      // A delivered reply proves the worker is healthy, so clear the death streak.
      this.consecutiveWorkerDeaths = 0;
      pending.resolve(parsed);
      if (this.pending.size === 0) {
        this.scheduleIdleShutdown();
      }
    }
  }

  private rejectAllPending(err: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(err);
    }
    this.pending.clear();
  }

  private async callWorker(request: EngineWireRequest): Promise<RpcResult> {
    await this.ensureRuntime();
    this.clearIdleTimer();
    if (!this.worker?.stdin.writable) {
      throw new Error('Deno worker is not available.');
    }
    const id = this.nextRequestId++;
    const payload: RpcRequest = { ...request, id };
    return await new Promise<RpcResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const pending = this.pending.get(id);
        if (!pending) {
          return;
        }
        this.pending.delete(id);
        pending.reject(new Error('Timed out waiting for Deno worker response.'));

        /*
         * A timeout means the worker is still running the request — a script
         * that loops forever or hangs on a never-resolving await. Abandoning the
         * promise would leave that work burning a CPU in the background. Tear the
         * worker down (SIGKILL, so a script that traps SIGTERM cannot keep
         * running) and let the next call spin up a fresh one.
         */
        this.abortRuntime(new Error('Deno worker killed after a request timed out.'));
      }, this.opts.requestTimeoutMs ?? RENDER_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timeout });
      this.worker!.stdin.write(`${JSON.stringify(payload)}\n`);
    });
  }

  /**
   * Kill the worker and reset to idle after an abnormal event (a request
   * timeout). Remaining in-flight calls are rejected with `reason`; a later
   * call restarts a clean worker. SIGKILL because a sandboxed script may trap
   * SIGTERM, and a synchronous runaway loop never services a signal handler.
   */
  private abortRuntime(reason: Error) {
    this.rejectAllPending(reason);
    this.shutdown();
    if (this.runtimeState.status !== 'disposed') {
      this.runtimeState = { status: 'idle' };
    }
  }

  /**
   * Tear the worker down. Always SIGKILL: the worker is a sandbox with no state
   * worth flushing, and a sandboxed script can register a `SIGTERM` handler
   * (`Deno.addSignalListener` needs no permission) to trap a graceful signal and
   * keep background work — e.g. a spinning Web Worker — running. SIGKILL cannot
   * be trapped, so idle and dispose teardown stop the process unconditionally.
   */
  private shutdown() {
    this.clearIdleTimer();
    if (this.worker && !this.worker.killed) {
      this.worker.stdin.destroy();
      this.worker.stdout.destroy();
      this.worker.stderr.destroy();
      this.worker.kill('SIGKILL');
    }
    this.worker = undefined;

    /* The exit of a process stopped on purpose rejects nothing, so a request still waiting is answered here. */
    this.rejectAllPending(new Error('The Deno engine was stopped before it answered.'));
  }

  dispose() {
    this.shutdown();
    JsPlugin.liveInstances.delete(this);
    this.runtimeState = { status: 'disposed' };
  }

  async import(absoluteFilePath: string, route?: ScriptSandboxRoute): Promise<Record<string, any>> {
    const ext = path.extname(absoluteFilePath);
    if (!SCRIPT_EXTENSIONS.has(ext)) {
      throw new Error(`Plugin "${this.name}" cannot import "${absoluteFilePath}"`);
    }
    const fnsRealPath = trustedFnsRealPath(absoluteFilePath);
    if (fnsRealPath === undefined) {
      if (inEngine()) {
        return this.importInProcess(path.resolve(absoluteFilePath));
      }
      return (route ?? noRoute(absoluteFilePath)).reroute();
    }

    /*
     * Trust boundary: everything above runs in the Deno sandbox. We reach here
     * ONLY for a file whose realpath is inside the `@jesscss/fns` package this
     * plugin itself resolved (`trustedFnsRealPath`), because that code is ours
     * and must call compiler internals a sandboxed worker cannot reach. Any
     * script a user imports — including one that names or symlinks itself
     * `@jesscss/fns` — resolves to `undefined` and is sandboxed above.
     *
     * We import the CANONICAL realpath we just checked, not the lexical input,
     * so the file loaded is the exact file whose trust we verified — a symlink
     * component swapped after the check cannot redirect the load to other code.
     */
    const modulePath = pathToFileURL(fnsRealPath).href;
    const module = await import(modulePath);
    const safeModule: Record<string, any> = {};
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- dynamic import returns any; entries are validated below
    for (const [key, value] of Object.entries(module as Record<string, unknown>)) {
      if (typeof value === 'function' || isJsonValue(value)) {
        safeModule[key] = value;
      }
    }
    return safeModule;
  }

  /**
   * Loads a legacy Less `@plugin` wrapper file in Deno Less-compat mode.
   *
   * @deprecated Less `@plugin` is deprecated. Prefer `@-from` for
   * ESM-style script imports or `@-use` for Sass-module-style namespace imports.
   */
  async importLessPlugin(
    absoluteFilePath: string,
    options: string | null = null,
    route?: ScriptSandboxRoute
  ): Promise<{ functions: Record<string, ContextualPluginFunction> }> {
    const ext = path.extname(absoluteFilePath);
    if (!SCRIPT_EXTENSIONS.has(ext)) {
      throw new Error(`Plugin "${this.name}" cannot import Less plugin "${absoluteFilePath}"`);
    }
    if (inEngine()) {
      return this.importLessPluginInProcess(path.resolve(absoluteFilePath), options);
    }
    return (route ?? noRoute(absoluteFilePath)).reroute();
  }

  private resolveVariableFact(
    name: string,
    capabilities: PluginCallCapabilities
  ): { value: unknown; important?: boolean } | null {
    const hit = capabilities.lookupVariable?.(name);
    if (!hit) {
      return null;
    }
    return { value: encodeBridgeValue(hit.value), important: hit.important === true };
  }

  private resolveCallFact(
    need: { name: string; args: unknown[] },
    capabilities: PluginCallCapabilities
  ): unknown {
    const decoded = need.args.map(decodeBridgeValue);
    const answer = capabilities.callFunction?.(need.name, decoded);
    return answer === undefined ? null : encodeBridgeValue(answer);
  }

  /** Context-facing executable-plugin capability used by the direct AST path. */
  async importPlugin(
    absoluteFilePath: string,
    options: string | null = null,
    route?: ScriptSandboxRoute
  ): Promise<{ functions: Record<string, ContextualPluginFunction> }> {
    return this.importLessPlugin(absoluteFilePath, options, route);
  }

  /*
   * ---- Inside the compile engine: scripts in this realm, which is the sandbox --
   * The same runtime and the same value conversion as the per-call worker,
   * minus the process boundary: a plugin call is a function call, and the scope
   * reads and built-in calls a Less 4 plugin body makes are answered by the live
   * call site directly.
   */

  private runtime(): Promise<InProcessRuntime> {
    this.inProcess ??= loadInProcessRuntime();
    return this.inProcess;
  }

  private async importInProcess(modulePath: string): Promise<Record<string, unknown>> {
    const runtime = await this.runtime();
    const moduleObject: Record<string, unknown> = {};
    for (const item of await runtime.loadModule(modulePath)) {
      moduleObject[item.name] = item.kind === 'function'
        ? async (...args: unknown[]) => {
          try {
            return decodeBridgeValue(await runtime.invokeExport(modulePath, item.name, encodeBridgeArgs(args)));
          } catch (err) {
            const fields = thrownFields(err);
            throw lessPluginApiRefusal(path.basename(modulePath), fields) ?? new Error(fields.error);
          }
        }
        : item.value;
    }
    return moduleObject;
  }

  private async importLessPluginInProcess(
    modulePath: string,
    options: string | null
  ): Promise<{ functions: Record<string, ContextualPluginFunction> }> {
    const runtime = await this.runtime();
    let names: string[];
    try {
      names = await runtime.loadLessPlugin(modulePath, options);
    } catch (err) {
      const fields = thrownFields(err);
      throw lessPluginApiRefusal(path.basename(modulePath), fields)
        ?? new PluginFunctionError(path.basename(modulePath), fields.error, fields.stack);
    }
    const functions: Record<string, ContextualPluginFunction> = {};
    for (const functionName of names) {
      functions[functionName] = async (args, capabilities = EMPTY_PLUGIN_CALL_CAPABILITIES) => {
        let outcome: Awaited<ReturnType<InProcessRuntime['invokeLessPluginFunction']>>;
        try {
          outcome = await runtime.invokeLessPluginFunction(
            modulePath,
            functionName,
            encodeBridgeArgs([...normalizePluginCallArgs(args)]),
            options,
            {
              variable: name => this.resolveVariableFact(name, capabilities),
              call: (name, callArgs) => this.resolveCallFact({ name, args: callArgs }, capabilities),
              fileInfo: capabilities.currentFileInfo ?? null
            }
          );
        } catch (err) {
          const fields = thrownFields(err);
          throw lessPluginApiRefusal(path.basename(modulePath), fields)
            ?? new PluginFunctionError(functionName, fields.error, fields.stack, fields.errorName);
        }
        for (const record of outcome.logs) {
          capabilities.log?.(record);
        }
        if (outcome.important) {
          capabilities.markImportant?.();
        }
        return decodeBridgeResult(outcome.value);
      };
    }
    return { functions };
  }

  /*
   * ---- The compile engine: a whole render in the Deno sandbox ----------------
   */

  /**
   * Runs one whole render in this plugin's Deno process: one request carrying
   * the compiler's identity, its options as data and the render's arguments,
   * one reply carrying the result. The process stays up between renders, so
   * the compiler and the scripts it loaded stay warm; a render under another
   * read root starts a new process. What the render printed is written to this
   * process's stderr; a thrown `JessError` is rethrown as one.
   */
  async renderInEngine(request: EngineRenderRequest): Promise<unknown> {
    this.engineUsed = true;
    const { code, release } = await this.useReadSet(request);
    let result: RpcResult;
    try {
      const configs = request.configs && { ...request.configs, above: await this.configsAboveReadRoots(request) };
      result = await this.callWorker({
        type: 'render',
        compiler: request.compiler,
        compilerOptions: encodeEngineValue(request.compilerOptions, 'options'),
        method: request.method,
        args: encodeEngineValue(request.args, 'render arguments'),
        host: hostFacts(code),
        configs: encodeHostConfigs(configs)
      });
    } finally {
      release();
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
    if (!result.ok) {
      throw engineFailure(result);
    }
    return result.value;
  }

  /**
   * The host's config search above each read root, keyed by the folder above
   * it, which the sandbox cannot read: every folder inside a root shares that
   * part of its settings, so it is resolved once per render and sent as data.
   */
  private async configsAboveReadRoots(request: EngineRenderRequest): Promise<Record<string, unknown>> {
    const search = request.configsAbove;
    if (search === undefined) {
      return {};
    }
    const above: Record<string, unknown> = {};
    for (const root of await readRootsBelowUnreadableFolders(request.entryDir, this.opts.jsReadRoot ?? request.jsReadRoot)) {
      const chain = search(root);
      if (chain !== undefined) {
        above[path.dirname(root)] = chain;
      }
    }
    return above;
  }

  /**
   * Holds the engine under `request`'s read set until `release`. One Deno
   * process serves one read set, so a render under another read set waits
   * until every render under the running one has finished, and only then is
   * the process switched: a render never runs, or is killed, in a process
   * started for another render's read set. While a render waits, no new render
   * joins the running set, so neither set starves.
   */
  private async useReadSet(request: EngineRequestBase, signal?: AbortSignal): Promise<{ code: string[]; release: () => void }> {
    const code = await engineCode(request.compiler.module, import.meta.url, signal);
    const readSet = await readSetFor(request.entryDir, this.opts.jsReadRoot ?? request.jsReadRoot, code);
    const key = readSet.join('\u0000');
    for (let turn = this.readSetTurn; turn !== undefined && (turn.key !== key || turn.waiting > 0); turn = this.readSetTurn) {
      turn.waiting++;
      await turn.done;
      signal?.throwIfAborted();
    }
    if (this.readSetTurn === undefined) {
      let end = (): void => undefined;
      const done = new Promise<void>((resolve) => {
        end = resolve;
      });
      this.readSetTurn = { key, users: 0, waiting: 0, done, end };
      if (this.workerReadSet !== key && this.runtimeState.status !== 'idle') {
        this.shutdown();
        if (this.runtimeState.status !== 'disposed') {
          this.runtimeState = { status: 'idle' };
        }
      }
      this.nextReadSet = readSet;
    }
    const turn = this.readSetTurn;
    turn.users++;
    let released = false;
    return {
      code,
      release: () => {
        if (released) {
          return;
        }
        released = true;
        turn.users--;
        if (turn.users === 0) {
          this.readSetTurn = undefined;
          turn.end();
        }
      }
    };
  }

  /**
   * Starts the engine for a render that may reach a script, before it does:
   * Deno starts, imports the compiler and loads the entry's dialect while the
   * render runs in Node. Nothing waits on it; a render that never reaches a
   * script lets it go with {@link releaseEngine}.
   */
  prewarmEngine(request: EngineRequestBase & { extension: string | undefined }): void {
    if (inEngine() || this.runtimeState.status !== 'idle') {
      return;
    }
    const prewarm = new AbortController();
    this.prewarmAbort = prewarm;
    const warm = async () => {
      const { code, release } = await this.useReadSet(request, prewarm.signal);
      try {
        if (prewarm.signal.aborted) {
          return;
        }
        await this.callWorker({
          type: 'warm',
          compiler: request.compiler,
          compilerOptions: encodeEngineValue(request.compilerOptions, 'options'),
          extension: request.extension,
          host: hostFacts(code)
        });
      } finally {
        release();
      }
    };
    warm().catch(() => undefined);
  }

  /** Ends an engine that was started ahead of time and never ran a render. */
  releaseEngine(): void {
    if (!this.engineUsed) {
      this.prewarmAbort?.abort();
      this.abortRuntime(new Error('The prewarmed Deno engine was not needed.'));
    }
  }
}

/**
 * A script reached outside a render the compiler can move into the sandbox:
 * the compiler class declares no `moduleIdentity` of its own, or the call came
 * from no render at all (`compile`, a direct plugin call).
 */
const noRoute = (absoluteFilePath: string): ScriptSandboxRoute => ({
  reroute: () => Promise.reject(new Error(`The script "${absoluteFilePath}" runs only inside a render the compiler moves into the @jesscss/plugin-js sandbox. A compiler class does that when it declares its own \`static moduleIdentity = { module: import.meta.url, exportName: '<ClassName>' }\`.`))
});

/** Set by the compile engine (`engine-runtime.ts`) in the Deno realm it runs in. */
const inEngine = (): boolean => Reflect.get(globalThis, Symbol.for('@jesscss/plugin-js/engine')) === true;

/** What every engine request carries: the compiler, and what decides the read root. */
type EngineRequestBase = {
  /** The compiler class the host runs, made again in the engine by its module and export. */
  compiler: { module: string; exportName: string };
  compilerOptions: unknown;

  /** The entry stylesheet's folder and the script root, which decide the read root. */
  entryDir: string;
  jsReadRoot: string;
};

/** One render the compiler moves into the engine (see `renderInEngine`). */
export type EngineRenderRequest = EngineRequestBase & {
  method: 'render' | 'renderToResult' | 'renderString' | 'safeRender';
  args: readonly unknown[];

  /** The `styles.config` settings the host resolved, sent as data. */
  configs?: HostConfigs;

  /** The host's config search above a read root (none for a package root); run here, never sent. */
  configsAbove?: (root: string) => unknown;
};

/**
 * Global flag set when @jesscss/plugin-js is loaded.
 * less-compat checks this before running @plugin scripts (scripts must be run when plugin-js/Deno is present).
 */
export const JESS_PLUGIN_JS_GLOBAL = '__JESS_PLUGIN_JS_AVAILABLE__';

declare let globalThis: { [k: string]: unknown };
if (typeof globalThis !== 'undefined') {
  globalThis[JESS_PLUGIN_JS_GLOBAL] = true;
}

const jsPlugin = ((opts?: JsPluginOptions) =>
  recordPluginModule(new JsPlugin(opts), import.meta.url, 'default', [opts])) satisfies Plugin;

export default jsPlugin;
