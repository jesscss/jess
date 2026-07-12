// @ts-nocheck
/* eslint-disable @typescript-eslint/naming-convention */
import { pathToFileURL } from 'node:url';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const moduleCache = new Map();
const lessPluginFunctionCache = new Map();
const runtimeApi = Deno.args.includes('--runtime-api=less') ? 'less' : 'module';

class Dimension {
  type = 'Dimension';
  value;
  unit;

  constructor(value, unit = '') {
    this.value = value;
    this.unit = unit;
  }

  valueOf() {
    return this.unit ? `${this.value}${this.unit}` : this.value;
  }

  toCSS() {
    return String(this.valueOf());
  }
}

class Color {
  type = 'Color';
  rgb;
  alpha;

  constructor(rgb, alpha = 1) {
    this.rgb = rgb;
    this.alpha = alpha;
  }

  toCSS() {
    const [r, g, b] = this.rgb;
    return this.alpha === 1
      ? `rgb(${r}, ${g}, ${b})`
      : `rgba(${r}, ${g}, ${b}, ${this.alpha})`;
  }
}

class Quoted {
  type = 'Quoted';
  quote;
  value;
  escaped;

  constructor(quote, value, escaped = false) {
    this.quote = quote || '"';
    this.value = value;
    this.escaped = escaped;
  }

  toCSS() {
    return `${this.escaped ? '~' : ''}${this.quote}${this.value}${this.quote}`;
  }
}

class Anonymous {
  type = 'Anonymous';
  value;

  constructor(value) {
    this.value = value;
  }

  toCSS() {
    return String(this.value);
  }
}

class Keyword extends Anonymous {
  type = 'Keyword';
}

class Value {
  type = 'Value';
  value;
  separator;

  constructor(value, separator = ',') {
    this.value = value;
    this.separator = separator;
  }

  toCSS() {
    const sep = this.separator === ' ' ? ' ' : `${this.separator} `;
    return this.value.map(item => item?.toCSS ? item.toCSS() : String(item)).join(sep);
  }
}

class Expression extends Value {
  type = 'Expression';

  constructor(value) {
    super(value, ' ');
  }
}

const lessFacade = {
  tree: {
    Anonymous,
    Color,
    Dimension,
    Expression,
    Keyword,
    Quoted,
    Value
  },
  dimension(value, unit) {
    return new Dimension(value, unit);
  },
  value(values, separator = ',') {
    return new Value(values, separator);
  },
  anonymous(value) {
    return new Anonymous(value);
  },
  color(rgb, alpha) {
    return new Color(rgb, alpha);
  },
  quoted(quote, value, escaped = false) {
    return new Quoted(quote, value, escaped);
  }
};

if (runtimeApi === 'less') {
  globalThis.less ??= lessFacade;
  globalThis.Less ??= lessFacade;
}

const isBridgeValue = value =>
  value
  && typeof value === 'object'
  && value.__jessBridge === true
  && typeof value.kind === 'string';

const decodeBridgeValue = (value) => {
  if (!isBridgeValue(value)) {
    return value;
  }
  switch (value.kind) {
    case 'scalar':
      return value.value;
    case 'dimension':
      return new Dimension(value.value, value.unit ?? '');
    case 'color':
      return new Color(value.rgb, value.alpha ?? 1);
    case 'quoted':
      return new Quoted(value.quote ?? '"', value.value, value.escaped === true);
    case 'keyword':
      return new Keyword(value.value);
    case 'anonymous':
      return new Anonymous(value.value);
    case 'list':
      return new Value((value.items ?? []).map(decodeBridgeValue), value.separator ?? ',');
    case 'sequence':
      return new Expression((value.items ?? []).map(decodeBridgeValue));
    default:
      return value;
  }
};

const encodeBridgeChildValue = (value) => {
  const encoded = encodeBridgeValue(value);
  if (isBridgeValue(encoded)) {
    return encoded;
  }
  return {
    __jessBridge: true,
    kind: 'scalar',
    value: typeof encoded === 'string' || typeof encoded === 'number' || typeof encoded === 'boolean'
      ? encoded
      : String(encoded)
  };
};

const encodeBridgeValue = (value) => {
  if (value instanceof Dimension) {
    return {
      __jessBridge: true,
      kind: 'dimension',
      value: value.value,
      unit: value.unit || undefined
    };
  }
  if (value instanceof Color) {
    return {
      __jessBridge: true,
      kind: 'color',
      rgb: value.rgb,
      alpha: value.alpha
    };
  }
  if (value instanceof Quoted) {
    return {
      __jessBridge: true,
      kind: 'quoted',
      value: String(value.value),
      quote: value.quote,
      escaped: value.escaped
    };
  }
  if (value instanceof Keyword) {
    return {
      __jessBridge: true,
      kind: 'keyword',
      value: String(value.value)
    };
  }
  if (value instanceof Anonymous) {
    return {
      __jessBridge: true,
      kind: 'anonymous',
      value: String(value.value)
    };
  }
  if (value instanceof Value || value instanceof Expression) {
    return {
      __jessBridge: true,
      kind: value instanceof Expression ? 'sequence' : 'list',
      items: value.value.map(encodeBridgeChildValue),
      separator: value instanceof Expression ? undefined : value.separator
    };
  }
  return value;
};

const isJsonValue = (value) => {
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
};

const send = (payload) => {
  Deno.stdout.writeSync(encoder.encode(`${JSON.stringify(payload)}\n`));
};

const loadModule = async (modulePath) => {
  let mod = moduleCache.get(modulePath);
  if (!mod) {
    const href = pathToFileURL(modulePath).href;
    mod = await import(href);
    moduleCache.set(modulePath, mod);
  }
  const exports = [];
  for (const [name, value] of Object.entries(mod)) {
    if (typeof value === 'function') {
      exports.push({ name, kind: 'function' });
      continue;
    }
    if (isJsonValue(value)) {
      exports.push({ name, kind: 'value', value });
    }
  }
  return exports;
};

// Deprecated Less @plugin support only. Jess @-use is plain ESM and must not
// pass through this injected-variable wrapper.
const createLegacyLessPluginRuntime = (modulePath) => {
  const localFunctions = new Map();
  const functions = {
    add(name, fn) {
      if (typeof name === 'string' && typeof fn === 'function') {
        localFunctions.set(name.toLowerCase(), fn);
      }
    },
    addMultiple(items) {
      for (const [name, fn] of Object.entries(items ?? {})) {
        this.add(name, fn);
      }
    },
    get(name) {
      return localFunctions.get(String(name).toLowerCase());
    }
  };
  const manager = {
    visitors: [],
    addVisitor(visitor) {
      this.visitors.push(visitor);
    },
    addPreProcessor() {},
    addPostProcessor() {},
    registerPlugin(plugin) {
      installPlugin(plugin);
    }
  };
  const less = {
    ...lessFacade,
    functions: {
      functionRegistry: functions
    }
  };
  const installPlugin = (plugin) => {
    if (!plugin) {
      return;
    }
    const candidate = typeof plugin === 'function'
      ? (() => {
          try {
            return new plugin();
          } catch {
            return plugin;
          }
        })()
      : plugin;
    if (candidate && typeof candidate.install === 'function') {
      candidate.install(less, manager, functions);
    }
  };
  const require = (specifier) => {
    throw new Error(`Less @plugin require("${specifier}") is not supported in the Deno sandbox yet.`);
  };
  const registerPlugin = (plugin) => {
    installPlugin(plugin);
  };
  return {
    exports: {},
    functions,
    localFunctions,
    manager,
    require,
    registerPlugin,
    fileInfo: { filename: modulePath }
  };
};

const loadLessPlugin = async (modulePath) => {
  let functions = lessPluginFunctionCache.get(modulePath);
  if (functions) {
    return Array.from(functions.keys());
  }
  const source = await Deno.readTextFile(modulePath);
  const runtime = createLegacyLessPluginRuntime(modulePath);
  const module = { exports: runtime.exports };
  const loader = new Function(
    'module',
    'exports',
    'require',
    'registerPlugin',
    'functions',
    'tree',
    'less',
    'fileInfo',
    'process',
    source
  );
  loader(
    module,
    module.exports,
    runtime.require,
    runtime.registerPlugin,
    runtime.functions,
    lessFacade.tree,
    {
      ...lessFacade,
      functions: {
        functionRegistry: runtime.functions
      }
    },
    runtime.fileInfo,
    undefined
  );
  const exported = module.exports?.default ?? module.exports;
  if (typeof exported === 'function' || (exported && typeof exported.install === 'function')) {
    runtime.registerPlugin(exported);
  }
  functions = runtime.localFunctions;
  lessPluginFunctionCache.set(modulePath, functions);
  return Array.from(functions.keys());
};

const invokeLessPluginFunction = async (modulePath, functionName, args) => {
  let functions = lessPluginFunctionCache.get(modulePath);
  if (!functions) {
    await loadLessPlugin(modulePath);
    functions = lessPluginFunctionCache.get(modulePath);
  }
  const fn = functions?.get(String(functionName).toLowerCase());
  if (typeof fn !== 'function') {
    throw new Error(`Less @plugin function "${functionName}" is not registered.`);
  }
  const result = encodeBridgeValue(await fn(...args.map(decodeBridgeValue)));
  if (!isJsonValue(result)) {
    throw new Error(`Result for Less @plugin function "${functionName}" is not JSON-serializable.`);
  }
  return result;
};

const invokeExport = async (modulePath, exportName, args) => {
  const mod = moduleCache.get(modulePath) ?? await import(pathToFileURL(modulePath).href);
  moduleCache.set(modulePath, mod);
  const target = mod?.[exportName];
  if (typeof target !== 'function') {
    throw new Error(`Export "${exportName}" is not callable.`);
  }
  const result = encodeBridgeValue(await target(...args.map(decodeBridgeValue)));
  if (!isJsonValue(result)) {
    throw new Error(`Result for "${exportName}" is not JSON-serializable.`);
  }
  return result;
};

const handleRequest = async (req) => {
  if (!req || typeof req.id !== 'number' || typeof req.type !== 'string') {
    return;
  }
  try {
    if (req.type === 'load') {
      const exports = await loadModule(req.modulePath);
      send({ id: req.id, ok: true, exports });
      return;
    }
    if (req.type === 'invoke') {
      const value = await invokeExport(req.modulePath, req.exportName, req.args ?? []);
      send({ id: req.id, ok: true, value });
      return;
    }
    if (req.type === 'loadLessPlugin') {
      const functions = await loadLessPlugin(req.modulePath);
      send({ id: req.id, ok: true, functions });
      return;
    }
    if (req.type === 'invokeLessPluginFunction') {
      const value = await invokeLessPluginFunction(req.modulePath, req.functionName, req.args ?? []);
      send({ id: req.id, ok: true, value });
      return;
    }
    send({ id: req.id, ok: false, error: `Unknown request type "${req.type}".` });
  } catch (err) {
    send({ id: req.id, ok: false, error: err?.message ?? String(err) });
  }
};

async function main() {
  send({ type: 'ready' });

  let buffer = '';
  for await (const chunk of Deno.stdin.readable) {
    buffer += decoder.decode(chunk, { stream: true });
    let idx = buffer.indexOf('\n');
    while (idx >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      idx = buffer.indexOf('\n');
      if (!line) {
        continue;
      }
      let req;
      try {
        req = JSON.parse(line);
      } catch {
        continue;
      }
      await handleRequest(req);
    }
  }
}

void main();
