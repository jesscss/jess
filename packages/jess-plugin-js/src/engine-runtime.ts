// @ts-nocheck
/*
 * The compile engine, inside the Deno sandbox: the WHOLE compile (parse, eval,
 * render) runs here, with plugin scripts in-process, so a plugin call is an
 * ordinary function call. The host sends one `compile` request per render
 * (`computeResponse` in `plugin-runtime.ts`) and receives the CSS and what the
 * compile printed, as data.
 */
import Module from 'node:module';
import os from 'node:os';

/** Thrown when a rebuilt inline function reads or writes a name from the caller's scope. */
class InlineFunctionCaptureError extends Error {
  constructor(where, name) {
    super(`The function at ${where} uses \`${name}\` from outside its own body. A function passed in compiler options is rebuilt from its source in the sandbox, so it cannot see the caller's variables; move it into a module and pass the module, or pass \`${name}\` as an argument.`);
    this.name = 'InlineFunctionCaptureError';
    this.code = 'plugin/inline-function-captures';
  }
}

/**
 * Rebuilds a function the host sent as source (`fn.toString()`). Plugin
 * functions are pure (owner ruling), so the source is the function. The body
 * runs inside a `with` scope whose proxy claims every name that is not a
 * global: a read or write of the caller's variables throws an actionable
 * error naming the variable, instead of silently resolving to a global or
 * `undefined`. This `new Function` only ever runs inside the Deno sandbox.
 * ponytail: the capture check fires when the captured name is reached, not at
 * rebuild; a static free-variable pass needs a JS parser in the engine.
 */
const rebuildFunction = ({ source, where }) => {
  const scope = new Proxy(Object.create(null), {
    has: (_target, key) => typeof key === 'string' && !(key in globalThis),
    get: (_target, key) => {
      if (key === Symbol.unscopables) {
        return undefined;
      }
      throw new InlineFunctionCaptureError(where, String(key));
    },
    set: (_target, key) => {
      throw new InlineFunctionCaptureError(where, String(key));
    }
  });
  const build = body => new Function('__jessScope', `with (__jessScope) { return (${body}); }`)(scope);
  try {
    return build(source);
  } catch (err) {
    if (!(err instanceof SyntaxError)) {
      throw err;
    }

    /* A method shorthand (`install(less) { … }`) is not an expression on its own. */
    return build(`{ ${source} }[Object.keys({ ${source} })[0]]`);
  }
};

/**
 * Turns the host's encoded options back into values: `__jessFn` is a
 * rebuilt function, `__jessInstance` an instance re-created from the module
 * that exports its class, by identity (`new Class(...args)`), never a live
 * object sent across.
 */
const decodeEngineValue = async (value) => {
  if (Array.isArray(value)) {
    return Promise.all(value.map(decodeEngineValue));
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (value.__jessFn) {
    return rebuildFunction(value.__jessFn);
  }
  if (value.__jessInstance) {
    const { module, exportName, args } = value.__jessInstance;
    const exported = (await import(module))[exportName];
    return new exported(...await decodeEngineValue(args));
  }
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = await decodeEngineValue(item);
  }
  return out;
};

const engine = {
  /** The compiler class per module URL, imported once per process. */
  classes: new Map(),

  /** One warm compiler per (class, options): plugins it loaded stay loaded. */
  compilers: new Map(),
  nodePath: [],
  booted: false
};

/**
 * Host facts the compile reads from its process: the working directory, the
 * home and temp directory paths and a fixed allowlist of environment variables, supplied as data so the sandbox
 * needs no `env` permission and no read permission on the working directory.
 * `NODE_PATH` folders are added to package lookup, as Node adds them.
 */
const applyHostFacts = (host) => {
  globalThis.process.cwd = () => host.cwd;
  globalThis.process.stdout.columns = host.columns;
  if (!engine.booted) {
    engine.booted = true;
    Object.defineProperty(globalThis.process, 'env', { value: { ...host.env }, configurable: true, writable: true });

    /* Read at load by cosmiconfig's dependency `env-paths`: facts, not `sys`/`env` grants. */
    os.homedir = () => host.homedir;
    os.tmpdir = () => host.tmpdir;

    /*
     * The config loader (cosmiconfig) loads a TypeScript `styles.config.ts` by
     * compiling it with the `typescript` package to a temp `.cjs` file beside
     * the config, requiring that, and deleting it: a write into the project.
     * Deno loads TypeScript itself, so in the engine the loader requires the
     * file directly, and the sandbox needs no write permission.
     */
    if (host.cosmiconfigLoaders) {
      const require = Module.createRequire(import.meta.url);
      require(host.cosmiconfigLoaders).loadTsSync = filepath => require(filepath);
    }
    const nodeModulePaths = Module._nodeModulePaths;
    Module._nodeModulePaths = from => [...nodeModulePaths(from), ...engine.nodePath];
  }
  engine.nodePath = host.nodePath;
};

/** A thrown compile error as data; a `JessError` keeps its fields so the host prints the same frame. */
const errorToData = (err) => {
  if (err && err.name === 'JessError') {
    const fields = {};
    for (const [key, item] of Object.entries(err)) {
      if (key !== 'node' && key !== 'fileObj') {
        fields[key] = item;
      }
    }
    if (err.fileObj) {
      fields.fileObj = { ...err.fileObj };
    }
    return { jessError: fields };
  }
  return {
    error: err?.message ?? String(err),
    errorName: err?.name ?? 'Error',
    code: err?.code,
    stack: typeof err?.stack === 'string' ? err.stack : undefined
  };
};

export const compileInEngine = async (req) => {
  applyHostFacts(req.host);
  let Compiler = engine.classes.get(req.compiler.module);
  if (!Compiler) {
    Compiler = (await import(req.compiler.module))[req.compiler.exportName];
    engine.classes.set(req.compiler.module, Compiler);
  }
  const key = `${req.compiler.module}\u0000${JSON.stringify(req.compilerOptions)}`;
  let compiler = engine.compilers.get(key);
  if (!compiler) {
    compiler = new Compiler(await decodeEngineValue(req.compilerOptions));
    engine.compilers.set(key, compiler);
  }
  const renderOptions = await decodeEngineValue(req.renderOptions ?? {});

  /* Inside the sandbox, scripts run in-process: this realm IS the sandbox. */
  renderOptions.compile = { ...renderOptions.compile, jsSandbox: false };

  /*
   * What the compile prints (its warnings, and errors it collected) is returned
   * as data, so the host writes it to its own stderr, in order, before it
   * reports the result.
   */
  const printed = [];
  const stderr = globalThis.process.stderr;
  const write = stderr.write;
  const consoleError = console.error;
  stderr.write = (chunk) => {
    printed.push(String(chunk));
    return true;
  };
  console.error = (...items) => {
    printed.push(`${items.map(String).join(' ')}\n`);
  };
  try {
    const started = performance.now();
    const css = await compiler.render(req.filePath, renderOptions);
    return { ok: true, css, stderr: printed.join(''), renderMs: performance.now() - started };
  } catch (err) {
    return { ok: false, stderr: printed.join(''), ...errorToData(err) };
  } finally {
    stderr.write = write;
    console.error = consoleError;
  }
};
