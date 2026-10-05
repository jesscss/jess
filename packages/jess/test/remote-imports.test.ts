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

  const render = (file: string, fetch?: RemoteFetch, less: Record<string, unknown> = {}) => new Compiler({
    language: { less },
    compile: fetch === undefined ? {} : { plugins: [remoteImportPlugin({ allow: ['cdn.example.com'], fetch })] }
  }).renderToResult(file, { suppressWarnings: true, colors: false });

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

  it('fetches an extensionless URL on an allowed host as written, and parses it as the importing language', async () => {
    const { fetch, requested } = serve([
      ['https://cdn.example.com/theme/main.less', '@import "vars";\n.main { color: @tone; }\n'],
      ['https://cdn.example.com/theme/vars', '@tone: red;\n']
    ]);

    const allowed = await render(entry('@import "https://cdn.example.com/theme/main.less";\n'), fetch);

    expect(allowed.errors).toEqual([]);
    expect(allowed.css).toBe('.main {\n  color: red;\n}\n');
    expect(requested).toEqual(['https://cdn.example.com/theme/main.less', 'https://cdn.example.com/theme/vars']);
  });

  /*
   * The allow list names the hosts that are fetched and inlined, not the ones a
   * stylesheet may reference. An extensionless URL off the list — Google Fonts —
   * is a stylesheet the browser fetches, so it stays a CSS @import.
   */
  it('keeps an extensionless URL off the allow list a CSS @import, and fetches nothing', async () => {
    const { fetch, requested } = serve([]);
    const source = [
      '@import url("https://fonts.googleapis.com/css?family=Open+Sans");',
      '@import "//fonts.googleapis.com/css2?family=Inter";',
      '@import (optional, multiple) "https://8.8.8.8/theme";',
      '@import "http://cdn.example.com/theme";',
      ''
    ].join('\n');

    const result = await render(entry(source), fetch);

    expect(result.errors).toEqual([]);
    expect(result.css).toBe([
      '@import url("https://fonts.googleapis.com/css?family=Open+Sans");',
      '@import "//fonts.googleapis.com/css2?family=Inter";',
      '@import "https://8.8.8.8/theme";',
      '@import "http://cdn.example.com/theme";',
      ''
    ].join('\n'));
    expect(requested).toEqual([]);
  });

  it('never fetches a URL Less classifies as CSS, even on an allowed host', async () => {
    const { fetch, requested } = serve([]);
    const source = [
      '@import "https://cdn.example.com/theme.css";',
      '@import url(https://cdn.example.com/print.css) print;',
      '@import (css) "https://cdn.example.com/theme.less";',
      ''
    ].join('\n');

    const result = await render(entry(source), fetch);

    expect(result.errors).toEqual([]);
    expect(result.css).toBe([
      '@import "https://cdn.example.com/theme.css";',
      '@import url(https://cdn.example.com/print.css) print;',
      '@import "https://cdn.example.com/theme.less";',
      ''
    ].join('\n'));
    expect(requested).toEqual([]);
  });

  it.each([
    ['a .less URL', '@import "https://evil.example/theme.less";', 'evil.example is not on the remote-import allow list'],
    ['a URL with any other extension', '@import url("https://evil.example/theme.php?v=2");', 'evil.example is not on the remote-import allow list'],
    ['(less)', '@import (less) "https://fonts.googleapis.com/css?family=Open+Sans";', 'fonts.googleapis.com is not on the remote-import allow list'],
    ['(reference)', '@import (reference) "https://evil.example/theme";', 'evil.example is not on the remote-import allow list'],
    ['(inline)', '@import (inline) "https://evil.example/theme";', 'evil.example is not on the remote-import allow list'],
    ['@-import', '@-import "https://evil.example/theme";', 'evil.example is not on the remote-import allow list'],
    ['an IP-literal host', '@import "https://8.8.8.8/theme.less";', '8.8.8.8 is an IP address, and remote imports are fetched from named hosts only'],
    ['plain http', '@import (reference) "http://cdn.example.com/theme";', 'remote imports are https-only']
  ])('refuses an import that must be inlined but cannot be fetched — %s — before any request', async (_case, source, reason) => {
    const { fetch, requested } = serve([]);

    const result = await render(entry(`${source}\n`), fetch);

    expect(result.errors).toEqual([expect.objectContaining({
      code: 'import/load-failed',
      message: expect.stringContaining(reason)
    })]);
    expect(requested).toEqual([]);
  });

  /* `@compose` has no CSS meaning, so it always loads: the @import policy with no CSS @import to fall back to. */
  it('composes an allowed URL like an @import, and refuses an off-list one, extensionless included', async () => {
    const { fetch, requested } = serve([['https://cdn.example.com/theme/tokens.less', '.tokens { color: red; }\n']]);

    const allowed = await render(entry('@compose "https://cdn.example.com/theme/tokens.less";\n'), fetch);
    const offList = await render(entry('@compose "https://fonts.googleapis.com/css?family=Open+Sans";\n'), fetch);

    expect(allowed.errors).toEqual([]);
    expect(allowed.css).toBe('.tokens {\n  color: red;\n}\n');
    expect(offList.errors).toEqual([expect.objectContaining({
      code: 'import/load-failed',
      message: expect.stringContaining('fonts.googleapis.com is not on the remote-import allow list')
    })]);
    expect(requested).toEqual(['https://cdn.example.com/theme/tokens.less']);
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

  it.each([
    ['an allowed host', 'https://cdn.example.com/theme/vars.json', true],
    ['a host off the list', 'https://evil.example/theme/vars.json', true],
    ['no plugin', 'https://cdn.example.com/theme/vars.json', false]
  ])('refuses @use of a URL on %s: modules load from local files only', async (_case, specifier, withPlugin) => {
    const network = vi.spyOn(globalThis, 'fetch');
    const { fetch, requested } = serve([]);

    const result = await render(entry(`@use "${specifier}";\n`), withPlugin ? fetch : undefined);

    expect(result.errors).toEqual([expect.objectContaining({
      message: expect.stringContaining(`Module ${specifier} is remote; @use and @plugin load modules from local files only`)
    })]);
    expect(requested).toEqual([]);
    expect(network).not.toHaveBeenCalled();
  });

  /*
   * rewriteUrls and rootpath apply inside a fetched document exactly as inside a
   * local import, except that a rewritten URL is rebased onto the document's URL
   * — absolute, so rootpath has nothing to prefix.
   */
  describe('URL rewriting inside a fetched document', () => {
    const body = '@import "fonts.css";\n.r { a: url("img/a.png"); b: url(./img/b.png); c: url("../c.png"); d: url(/d.png); e: url(../../../../e.png); }\n';
    const css = (fonts: string, a: string, b: string, c: string, e: string) => [
      `@import "${fonts}";`,
      '.r {',
      `  a: url("${a}");`,
      `  b: url(${b});`,
      `  c: url("${c}");`,
      '  d: url(/d.png);',
      `  e: url(${e});`,
      '}',
      ''
    ].join('\n');
    const theme = 'https://cdn.example.com/theme/';

    it.each([
      ['off', { rootpath: '/static/' }, css('/static/fonts.css', '/static/img/a.png', '/static/img/b.png', '/c.png', '../../e.png')],
      ['all', {}, css(`${theme}fonts.css`, `${theme}img/a.png`, `${theme}img/b.png`, 'https://cdn.example.com/c.png', 'https://cdn.example.com/e.png')],
      ['all', { rootpath: '/static/' }, css(`${theme}fonts.css`, `${theme}img/a.png`, `${theme}img/b.png`, 'https://cdn.example.com/c.png', 'https://cdn.example.com/e.png')],
      ['local', {}, css('fonts.css', 'img/a.png', `${theme}img/b.png`, 'https://cdn.example.com/c.png', 'https://cdn.example.com/e.png')]
    ])('rewriteUrls: %s with %o', async (rewriteUrls, options, expected) => {
      const { fetch } = serve([[`${theme}main.less`, body]]);

      const result = await render(entry(`@import "${theme}main.less";\n`), fetch, { rewriteUrls, ...options });

      expect(result.errors).toEqual([]);
      expect(result.css).toBe(expected);
    });

    it('keeps the escapes of an unquoted URL and escapes the document URL it is rebased onto', async () => {
      const { fetch } = serve([['https://cdn.example.com/it\'s/main.less', '.r { a: url(img/a\\ b.png); }\n']]);

      const result = await render(entry('@import "https://cdn.example.com/it\'s/main.less";\n'), fetch, { rewriteUrls: 'all' });

      expect(result.errors).toEqual([]);
      expect(result.css).toBe('.r {\n  a: url(https://cdn.example.com/it\\\'s/img/a\\ b.png);\n}\n');
    });
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
