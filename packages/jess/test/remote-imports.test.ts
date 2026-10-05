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

  it('keeps an extensionless endpoint a CSS terminal with the plugin configured', async () => {
    const { fetch, requested } = serve([]);

    const result = await render(entry('@import url("https://fonts.googleapis.com/css?family=Open+Sans");\n'), fetch);

    expect(result.errors).toEqual([]);
    expect(result.css).toBe('@import url("https://fonts.googleapis.com/css?family=Open+Sans");\n');
    expect(requested).toEqual([]);
  });

  it('never lets a remote document reach a local file', async () => {
    const secret = path.join(dir, 'secret.less');
    fs.writeFileSync(secret, '.secret { color: red; }\n');
    const { fetch, requested } = serve([
      ['https://cdn.example.com/theme/main.less', `@import "${secret}";\n`]
    ]);

    const result = await render(entry('@import "https://cdn.example.com/theme/main.less";\n'), fetch);

    expect(result.css).not.toContain('.secret');
    expect(requested).toEqual([
      'https://cdn.example.com/theme/main.less',
      new URL(secret, 'https://cdn.example.com/').href
    ]);
  });
});
