// @ts-nocheck
/*
 * The compile engine, inside the Deno sandbox: a whole render (parse, eval,
 * serialize) runs here, with plugin scripts in-process, so a plugin call is an
 * ordinary function call. The host sends one `render` request per render and
 * receives the result and what the render printed, as data.
 */
import Module from 'node:module';
import os from 'node:os';

/** Read by `JsPlugin`: inside the engine, scripts run in this realm, which is the sandbox. */
globalThis[Symbol.for('@jesscss/plugin-js/engine')] = true;

/** Thrown when a rebuilt function reads or writes a name from the caller's scope. */
class InlineFunctionCaptureError extends Error {
  constructor(where, name) {
    super(`The function at ${where} uses \`${name}\` from outside its own body. A function passed in compiler options is rebuilt from its source in the sandbox, so it cannot see the caller's variables; move it into a module and pass the module, or pass \`${name}\` as an argument.`);
    this.name = 'InlineFunctionCaptureError';
    this.code = 'plugin/inline-function-captures';
  }
}

/**
 * Rebuilds a function the host sent as source (`fn.toString()`). Plugin
 * functions are pure, so the source is the function. The body runs inside a
 * `with` scope whose proxy claims every name that is not a global: a read or
 * write of the caller's variables throws an error naming the variable instead
 * of silently resolving to a global or `undefined`. This `new Function` only
 * ever runs inside the Deno sandbox.
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
 * Turns the host's encoded options back into values: `__jessFn` is a rebuilt
 * function, `__jessPlugin` a plugin made again by the factory that made it on
 * the host (its module, export and arguments), never a live object.
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
  if (value.__jessPlugin) {
    const { module, exportName, args } = value.__jessPlugin;
    const factory = (await import(module))[exportName];
    return await factory(...await decodeEngineValue(args));
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

  /** One warm compiler per (class, options): what it loaded stays loaded. */
  compilers: new Map(),
  nodePath: [],
  booted: false
};

/**
 * Host facts a render reads from its process, supplied as data so the
 * sandbox needs no `env` or `sys` permission: the working directory, terminal
 * width, home and temp paths, and a fixed set of environment variables.
 */
const applyHostFacts = (host) => {
  engine.nodePath = host.nodePath ?? [];
  globalThis.process.cwd = () => host.cwd;
  globalThis.process.stdout.columns = host.columns;
  if (engine.booted) {
    return;
  }
  engine.booted = true;
  Object.defineProperty(globalThis.process, 'env', { value: { ...host.env }, configurable: true, writable: true });
  os.homedir = () => host.homedir;
  os.tmpdir = () => host.tmpdir;

  /*
   * The config loader (cosmiconfig) loads `styles.config.ts` by compiling it to
   * a temp `.cjs` file beside the config, requiring that, and deleting it: a
   * write. Deno loads TypeScript itself, so here the loader requires the file
   * directly and the sandbox needs no write permission.
   */
  /* `NODE_PATH` folders join package lookup, as Node adds them (the env itself is not readable here). */
  const nodeModulePaths = Module._nodeModulePaths;
  Module._nodeModulePaths = from => [...nodeModulePaths(from), ...engine.nodePath];

  if (host.cosmiconfigLoaders) {
    const require = Module.createRequire(import.meta.url);
    require(host.cosmiconfigLoaders).loadTsSync = filepath => require(filepath);
  }
};

/** A thrown error as data; a `JessError` keeps its fields so the host prints the same frame. */
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

const compilerFor = async (req) => {
  let Compiler = engine.classes.get(req.compiler.module);
  if (!Compiler) {
    Compiler = (await import(req.compiler.module))[req.compiler.exportName];
    engine.classes.set(req.compiler.module, Compiler);
  }
  const key = `${req.compiler.module}\u0000${req.compiler.exportName}\u0000${JSON.stringify(req.compilerOptions)}`;
  let compiler = engine.compilers.get(key);
  if (!compiler) {
    compiler = new Compiler(await decodeEngineValue(req.compilerOptions));
    engine.compilers.set(key, compiler);
  }
  return compiler;
};

const RENDER_METHODS = new Set(['render', 'renderToResult', 'renderString', 'safeRender']);

/**
 * One render. What it prints (its diagnostics) is collected and returned as
 * text, so the host writes it to its own stderr, in order, before it returns
 * or throws the result.
 */
export const renderInEngine = async (req) => {
  applyHostFacts(req.host);
  const printed = [];
  const stderr = globalThis.process.stderr;
  const write = stderr.write;
  const consoleError = console.error;
  const consoleWarn = console.warn;
  stderr.write = (chunk) => {
    printed.push(String(chunk));
    return true;
  };
  console.error = (...items) => {
    printed.push(`${items.map(String).join(' ')}\n`);
  };
  console.warn = console.error;
  try {
    if (!RENDER_METHODS.has(req.method)) {
      throw new Error(`Unknown render method "${req.method}".`);
    }
    const compiler = await compilerFor(req);
    const value = await compiler[req.method](...await decodeEngineValue(req.args));
    return { ok: true, value, stderr: printed.join('') };
  } catch (err) {
    return { ok: false, stderr: printed.join(''), ...errorToData(err) };
  } finally {
    stderr.write = write;
    console.error = consoleError;
    console.warn = consoleWarn;
  }
};

/**
 * Gets the engine ready for a render before it is asked for one: the
 * compiler imported and made, and the entry's dialect loaded by rendering an
 * empty source of the entry's extension. A render that follows finds them
 * warm; one that never comes costs only this process.
 */
export const warmEngine = async (req) => {
  applyHostFacts(req.host);
  const compiler = await compilerFor(req);
  if (req.extension) {
    await compiler.renderString('', { extension: req.extension }).catch(() => undefined);
  }
  return { ok: true };
};
