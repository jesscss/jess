// @ts-nocheck
import { pathToFileURL } from 'node:url';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const moduleCache = new Map();

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

const invokeExport = async (modulePath, exportName, args) => {
  const mod = moduleCache.get(modulePath) ?? await import(pathToFileURL(modulePath).href);
  moduleCache.set(modulePath, mod);
  const target = mod?.[exportName];
  if (typeof target !== 'function') {
    throw new Error(`Export "${exportName}" is not callable.`);
  }
  const result = await target(...args);
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
    send({ id: req.id, ok: false, error: `Unknown request type "${req.type}".` });
  } catch (err) {
    send({ id: req.id, ok: false, error: err?.message ?? String(err) });
  }
};

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
