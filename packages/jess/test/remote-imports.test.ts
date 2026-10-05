import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { remoteImportPlugin, type RemoteFetch } from '@jesscss/plugin-remote-import';
import { Compiler } from '../src/index.js';

/** A transport over canned sources that records every request; anything unrouted is a failed request. */
function serve(sources: ReadonlyArray<readonly [url: string, source: string]>): { fetch: RemoteFetch; requested: string[] } {
  const requested: string[] = [];
  const byUrl = new Map(sources);
  return {
    requested,
    fetch: async (url) => {
      requested.push(url);
      const source = byUrl.get(url);
      return source === undefined ? new Response('not found', { status: 404 }) : new Response(source);
    }
  };
}

describe('remote @import', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-remote-imports-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const entry = (source: string): string => {
    const file = path.join(dir, 'entry.less');
    fs.writeFileSync(file, source);
    return file;
  };

  const render = (file: string, fetch?: RemoteFetch) => new Compiler(fetch === undefined
    ? {}
    : { compile: { plugins: [remoteImportPlugin({ allow: ['cdn.example.com'], fetch })] } }
  ).renderToResult(file, { suppressWarnings: true, colors: false });

  it('stays a CSS terminal without the plugin, and nothing is fetched — jsDelivr npm URLs included', async () => {
    const network = vi.spyOn(globalThis, 'fetch');
    const file = entry([
      '@import "https://cdn.example.com/theme.less";',
      '@import "https://cdn.jsdelivr.net/npm/jess-no-such-package/theme.less";',
      '.a { color: red; }',
      ''
    ].join('\n'));

    const result = await render(file);

    expect(result.errors).toEqual([]);
    expect(result.css).toBe([
      '@import "https://cdn.example.com/theme.less";',
      '@import "https://cdn.jsdelivr.net/npm/jess-no-such-package/theme.less";',
      '.a {',
      '  color: red;',
      '}',
      ''
    ].join('\n'));
    expect(network).not.toHaveBeenCalled();
  });

  it('inlines an allowed import and resolves its own imports against its URL', async () => {
    const { fetch, requested } = serve([
      ['https://cdn.example.com/theme/main.less', '@import "vars.less";\n@import "../base/reset.less?v=2";\n.main { color: @tone; }\n'],
      ['https://cdn.example.com/theme/vars.less', '@tone: red;\n'],
      ['https://cdn.example.com/base/reset.less?v=2', '.reset { margin: 0; }\n']
    ]);

    const result = await render(entry('@import "https://cdn.example.com/theme/main.less";\n'), fetch);

    expect(result.errors).toEqual([]);
    expect(result.css).toBe('.reset {\n  margin: 0;\n}\n.main {\n  color: red;\n}\n');
    expect(requested).toEqual([
      'https://cdn.example.com/theme/main.less',
      'https://cdn.example.com/theme/vars.less',
      'https://cdn.example.com/base/reset.less?v=2'
    ]);
  });

  it('makes a blocked host an error rather than a terminal, even under (optional)', async () => {
    const { fetch, requested } = serve([]);

    const result = await render(entry('@import (optional) "https://evil.example/x.less";\n.a { color: red; }\n'), fetch);

    expect(result.errors).toEqual([expect.objectContaining({
      code: 'import/load-failed',
      message: expect.stringContaining('evil.example is not on the remote-import allow list')
    })]);
    expect(requested).toEqual([]);
  });

  it('fetches an extensionless URL as written: an allowed host inlines it, an off-list host is an error', async () => {
    const { fetch, requested } = serve([
      ['https://cdn.example.com/theme/main.less', '@import "vars";\n.main { color: @tone; }\n'],
      ['https://cdn.example.com/theme/vars', '@tone: red;\n']
    ]);

    const allowed = await render(entry('@import "https://cdn.example.com/theme/main.less";\n'), fetch);
    const offList = await render(entry('@import url("https://fonts.googleapis.com/css?family=Open+Sans");\n'), fetch);

    expect(allowed.errors).toEqual([]);
    expect(allowed.css).toBe('.main {\n  color: red;\n}\n');
    expect(offList.errors).toEqual([expect.objectContaining({
      code: 'import/load-failed',
      message: expect.stringContaining('fonts.googleapis.com is not on the remote-import allow list')
    })]);
    expect(requested).toEqual(['https://cdn.example.com/theme/main.less', 'https://cdn.example.com/theme/vars']);
  });

  it('keeps a (css) URL import a CSS @import with the plugin configured, whatever its host', async () => {
    const { fetch, requested } = serve([]);
    const source = '@import (css) url("https://fonts.googleapis.com/css?family=Open+Sans");\n';

    const result = await render(entry(source), fetch);

    expect(result.errors).toEqual([]);
    expect(result.css).toBe('@import url("https://fonts.googleapis.com/css?family=Open+Sans");\n');
    expect(requested).toEqual([]);
  });

  it('skips a remote file the server reports missing under (optional), and reports it missing otherwise', async () => {
    const { fetch } = serve([]);

    const optional = await render(entry('@import (optional) "https://cdn.example.com/missing.less";\n.a { color: red; }\n'), fetch);
    const required = await render(entry('@import "https://cdn.example.com/missing.less";\n'), fetch);

    expect(optional.errors).toEqual([]);
    expect(optional.css).toBe('.a {\n  color: red;\n}\n');
    expect(required.errors).toEqual([expect.objectContaining({ code: 'import/not-found' })]);
  });

  it('reads an (inline) URL through the plugin like a local file, and refuses an off-list host before any request', async () => {
    const base = '.base { margin: 0; }\n';
    fs.writeFileSync(path.join(dir, 'base.css'), base);
    const { fetch, requested } = serve([['https://cdn.example.com/theme/base.css', base]]);

    const local = await render(entry('@import (inline) "base.css";\n'));
    const allowed = await render(entry('@import (inline) "https://cdn.example.com/theme/base.css";\n'), fetch);
    const offList = await render(entry('@import (inline) "https://evil.example/x.css";\n'), fetch);

    expect(allowed.errors).toEqual([]);
    expect(allowed.css).toContain(base);
    expect(allowed.css).toBe(local.css);
    expect(offList.errors).toEqual([expect.objectContaining({
      message: expect.stringContaining('evil.example is not on the remote-import allow list')
    })]);
    expect(requested).toEqual(['https://cdn.example.com/theme/base.css']);
  });

  it('never fetches for data-uri(): a URL keeps its url() fallback', async () => {
    const { fetch, requested } = serve([]);

    const result = await render(entry('.a { b: data-uri("https://cdn.example.com/img/x.png"); }\n'), fetch);

    expect(result.errors).toEqual([]);
    expect(result.css).toBe('.a {\n  b: url("https://cdn.example.com/img/x.png");\n}\n');
    expect(requested).toEqual([]);
  });

  it('refuses @use of a URL: modules load from local files only', async () => {
    const { fetch, requested } = serve([]);

    const result = await render(entry('@use "https://cdn.example.com/theme/vars.json";\n'), fetch);

    expect(result.errors).toEqual([expect.objectContaining({
      message: expect.stringContaining('https://cdn.example.com/theme/vars.json is remote')
    })]);
    expect(requested).toEqual([]);
  });

  describe('a remote document never reaches the local disk', () => {
    const marker = 'TOPSECRET-TOKEN';

    /*
     * Every route a document names a file by. The fetched document names a real
     * local file by absolute path; each route must take it as a path on the
     * document's host instead, so the marker never reaches the output.
     */
    it.each([
      ['@import', (file: string) => `@import "${file}.less";\n`],
      ['@import (inline)', (file: string) => `@import (inline) "${file}.txt";\n`],
      ['data-uri()', (file: string) => `.a { b: data-uri("${file}.txt"); }\n`],
      ['@use', (file: string) => `@use "${file}.json";\n.a { b: @secret.token; }\n`],
      ['@plugin', (file: string) => `@plugin "${file}.js";\n.a { b: pwn(); }\n`]
    ])('through %s', async (_route, body) => {
      const local = path.join(dir, 'secret');
      fs.writeFileSync(`${local}.less`, `.secret { b: ${marker}; }\n`);
      fs.writeFileSync(`${local}.txt`, marker);
      fs.writeFileSync(`${local}.json`, JSON.stringify({ token: marker }));
      fs.writeFileSync(`${local}.js`, `registerPlugin({ install(_less, _manager, functions) { functions.add('pwn', () => '${marker}'); } });\n`);
      const { fetch, requested } = serve([['https://cdn.example.com/theme/main.less', body(local)]]);

      const result = await render(entry('@import "https://cdn.example.com/theme/main.less";\n'), fetch);

      expect(result.css).not.toContain(marker);
      expect(result.errors.map(error => error.message).join('\n')).not.toContain(marker);
      expect(requested.every(url => url.startsWith('https://cdn.example.com/'))).toBe(true);
    });

    it('refuses a path that does not resolve onto the document\'s host', async () => {
      const { fetch, requested } = serve([['https://cdn.example.com/theme/main.less', '@import "C:/secret.less";\n']]);

      const result = await render(entry('@import "https://cdn.example.com/theme/main.less";\n'), fetch);

      expect(result.errors).toEqual([expect.objectContaining({
        message: expect.stringContaining('does not name a resource on its host')
      })]);
      expect(requested).toEqual(['https://cdn.example.com/theme/main.less']);
    });
  });
});
