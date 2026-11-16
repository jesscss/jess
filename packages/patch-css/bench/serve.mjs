/*
 * node bench/serve.mjs <dir> [port] [results.json]: serves <dir> cross-origin isolated, so the
 * harness's performance.now() resolves 5 µs rather than 0.1 ms, and writes each POST to /results
 * to results.json (default bench/results.json), so a run in a hidden tab can be read from a shell.
 */
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
const root = process.argv[2], port = Number(process.argv[3] ?? 4817);
const resultsFile = process.argv[4] ?? new URL('results.json', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/results') {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }
    await writeFile(resultsFile, body);
    res.writeHead(204).end();
    return;
  }
  const path = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (!path.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream', 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, '127.0.0.1', () => console.log(`serving ${root} on http://127.0.0.1:${port}`));
