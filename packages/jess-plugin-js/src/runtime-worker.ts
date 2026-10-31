// @ts-nocheck
/*
 * The Deno process behind `@jesscss/plugin-js`. This module runs twice: as the
 * process's main thread, which only relays (`relay`), and as the worker thread
 * that runs plugin code or whole compiles (`serve`). The work itself lives in
 * `plugin-runtime.ts`, which the Node process can also load in-process.
 */
import { computeResponse, installLessGlobals } from './plugin-runtime.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const isRuntimeThread = typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope;
const runtimeApi = isRuntimeThread ? self.name : Deno.args.includes('--runtime-api=less') ? 'less' : 'module';

if (isRuntimeThread && runtimeApi === 'less') {
  installLessGlobals();
}

const send = (payload) => {
  self.postMessage(`${JSON.stringify(payload)}\n`);
};

const handleRequest = async (req) => {
  if (!req || typeof req.id !== 'number' || typeof req.type !== 'string') {
    return;
  }
  send(await computeResponse(req));
};

/**
 * The worker thread: stdin arrives from the main thread in chunks, and each
 * request line is answered in order, one at a time.
 */
function serve() {
  /*
   * On a worker thread `Deno.exit()` (which `process.exit()` calls) and
   * `close()` would end only the thread and leave every later request
   * unanswered. A plugin that exits ends the process instead, as it did on the
   * main thread, so the host sees the exit at once.
   */
  const exitThread = Deno.exit;
  Deno.exit = (code) => {
    self.postMessage({ exit: code ?? 0 });
    exitThread(code);
  };
  self.close = () => Deno.exit(0);
  let buffer = '';
  let previous = Promise.resolve();
  self.onmessage = (event) => {
    buffer += decoder.decode(event.data, { stream: true });
    for (let idx = buffer.indexOf('\n'); idx >= 0; idx = buffer.indexOf('\n')) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) {
        continue;
      }
      let req;
      try {
        req = JSON.parse(line);
      } catch {
        continue;
      }
      previous = previous.then(() => handleRequest(req));
    }
  };
  send({ type: 'ready' });
}

/**
 * The main thread runs no plugin code, so it is never stuck in one: it relays
 * stdin to the worker thread and replies to stdout, and exits when stdin
 * closes. Stdin closes whenever the host goes away, even a host that is killed
 * before its cleanup runs, so neither a plugin call that never returns nor a
 * timer or signal listener a plugin leaves behind keeps an orphan running.
 */
async function relay() {
  const runtime = new Worker(import.meta.url, { type: 'module', name: runtimeApi });
  runtime.onmessage = ({ data }) => {
    if (typeof data === 'string') {
      Deno.stdout.writeSync(encoder.encode(data));
    } else {
      Deno.exit(data.exit);
    }
  };
  for await (const chunk of Deno.stdin.readable) {
    runtime.postMessage(chunk);
  }
  Deno.exit(0);
}

if (isRuntimeThread) {
  serve();
} else {
  void relay();
}
