import { describe, expect, it } from 'vitest';
import { RemoteImportPlugin, type RemoteFetch } from '../src/index.js';

/** A transport over canned routes that records every request; anything unrouted fails the test. */
function serve(routes: ReadonlyArray<readonly [url: string, respond: () => Response]>): { fetch: RemoteFetch; requested: string[] } {
  const requested: string[] = [];
  const byUrl = new Map(routes);
  return {
    requested,
    fetch: async (url) => {
      requested.push(url);
      const route = byUrl.get(url);
      if (route === undefined) {
        throw new Error(`unrouted request ${url}`);
      }
      return route();
    }
  };
}

const redirect = (location: string) => () => new Response(null, { status: 302, headers: { location } });

describe('RemoteImportPlugin allow list', () => {
  it('requires an explicit, non-empty allow list', () => {
    expect(() => new RemoteImportPlugin({ allow: [] })).toThrow('explicit host allow list');
    expect(() => {
      Reflect.construct(RemoteImportPlugin, []);
    }).toThrow('explicit host allow list');
  });

  it.each([
    ['*'],
    ['*.example.com'],
    ['https://cdn.example.com'],
    ['cdn.example.com:8443'],
    ['cdn.example.com:443'],
    ['cdn.example.com/styles'],
    ['user@cdn.example.com'],
    ['2130706433']
  ])('rejects %s, which is not a bare host', (entry) => {
    expect(() => new RemoteImportPlugin({ allow: [entry] })).toThrow('is not a host');
  });

  it.each([['127.0.0.1'], ['10.1.2.3'], ['172.20.0.1'], ['192.168.1.1'], ['169.254.169.254'], ['100.100.100.200'], ['0.0.0.0'], ['[::1]'], ['[fd00::1]'], ['[fe80::1]'], ['[::ffff:7f00:1]']])(
    'rejects the private, loopback or link-local address %s',
    (entry) => {
      expect(() => new RemoteImportPlugin({ allow: [entry] })).toThrow('private, loopback or link-local');
    }
  );

  it('keeps hosts as a URL spells them', () => {
    expect([...new RemoteImportPlugin({ allow: ['CDN.Example.com', '[2001:db8::1]'] }).allow]).toEqual(['cdn.example.com', '[2001:db8::1]']);
  });
});

describe('RemoteImportPlugin claim', () => {
  const { fetch, requested } = serve([]);
  const plugin = new RemoteImportPlugin({ allow: ['cdn.example.com'], fetch });

  it('claims an https or protocol-relative file URL on an allowed host', () => {
    expect(plugin.canResolveImport('https://cdn.example.com/theme.less')).toBe(true);
    expect(plugin.canResolveImport('//cdn.example.com/theme.less?v=2')).toBe(true);
  });

  it('leaves non-URLs and extensionless endpoints to stay CSS terminals, whatever their host', () => {
    expect(plugin.canResolveImport('theme.less')).toBe(false);
    expect(plugin.canResolveImport('C:/styles/theme.less')).toBe(false);
    expect(plugin.canResolveImport('https://fonts.googleapis.com/css?family=Open+Sans')).toBe(false);
    expect(plugin.canResolveImport('https://cdn.example.com/')).toBe(false);
  });

  it.each([
    ['https://evil.example/theme.less', 'evil.example is not on the remote-import allow list'],
    ['https://cdn.example.com.evil.example/theme.less', 'cdn.example.com.evil.example is not on the remote-import allow list'],
    ['https://cdn.example.com@evil.example/theme.less', 'evil.example is not on the remote-import allow list'],
    ['https://169.254.169.254/latest.less', '169.254.169.254 is not on the remote-import allow list'],
    ['http://cdn.example.com/theme.less', 'https-only']
  ])('rejects %s before any request', (specifier, reason) => {
    expect(() => plugin.canResolveImport(specifier)).toThrow(reason);
    expect(requested).toEqual([]);
  });

  it('locates the first allowed https candidate without a request', () => {
    expect(plugin.locate(['theme.less', 'http://cdn.example.com/a.less', 'https://evil.example/a.less', '//cdn.example.com/a.less'])).toBe('https://cdn.example.com/a.less');
    expect(plugin.locate(['https://evil.example/a.less'])).toBeNull();
    expect(requested).toEqual([]);
  });
});

describe('RemoteImportPlugin fetch', () => {
  const allow = ['cdn.example.com'];

  it('fetches the located URL with manual redirects and a deadline', async () => {
    let init: Parameters<RemoteFetch>[1] | undefined;
    const plugin = new RemoteImportPlugin({
      allow,
      fetch: async (_url, requestInit) => {
        init = requestInit;
        return new Response('@tone: red;');
      }
    });

    await expect(plugin.getSource('https://cdn.example.com/a.less?v=2')).resolves.toBe('@tone: red;');
    expect(init?.redirect).toBe('manual');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('refuses a host off the list without a request', async () => {
    const { fetch, requested } = serve([]);
    const plugin = new RemoteImportPlugin({ allow, fetch });

    await expect(plugin.getSource('https://evil.example/a.less')).rejects.toThrow('not on the remote-import allow list');
    await expect(plugin.getSource('theme.less')).rejects.toThrow('is not a remote URL');
    expect(requested).toEqual([]);
  });

  it('follows a same-origin redirect', async () => {
    const { fetch, requested } = serve([
      ['https://cdn.example.com/a.less', redirect('/v2/a.less')],
      ['https://cdn.example.com/v2/a.less', () => new Response('.a {}')]
    ]);

    await expect(new RemoteImportPlugin({ allow, fetch }).getSource('https://cdn.example.com/a.less')).resolves.toBe('.a {}');
    expect(requested).toEqual(['https://cdn.example.com/a.less', 'https://cdn.example.com/v2/a.less']);
  });

  it.each([
    ['another host', 'https://evil.example/a.less', 'https://evil.example'],
    ['another allowed host', 'https://fonts.example.com/a.less', 'https://fonts.example.com'],
    ['plain http on the same host', 'http://cdn.example.com/a.less', 'http://cdn.example.com'],
    ['another port', 'https://cdn.example.com:8443/a.less', 'https://cdn.example.com:8443']
  ])('refuses a redirect to %s without following it', async (_case, location, origin) => {
    const { fetch, requested } = serve([['https://cdn.example.com/a.less', redirect(location)]]);
    const plugin = new RemoteImportPlugin({ allow: [...allow, 'fonts.example.com'], fetch });

    await expect(plugin.getSource('https://cdn.example.com/a.less')).rejects.toThrow(`redirects to ${origin}, and cross-host redirects are not followed`);
    expect(requested).toEqual(['https://cdn.example.com/a.less']);
  });

  it('stops a redirect loop', async () => {
    const { fetch, requested } = serve([['https://cdn.example.com/a.less', redirect('/a.less')]]);

    await expect(new RemoteImportPlugin({ allow, fetch }).getSource('https://cdn.example.com/a.less')).rejects.toThrow('more than 5 redirects');
    expect(requested).toHaveLength(6);
  });

  it('reports a failed response', async () => {
    const { fetch } = serve([['https://cdn.example.com/a.less', () => new Response('missing', { status: 404 })]]);

    await expect(new RemoteImportPlugin({ allow, fetch }).getSource('https://cdn.example.com/a.less')).rejects.toThrow('failed: HTTP 404');
  });

  it('refuses a body over the size cap, declared or streamed', async () => {
    const chunks = (...sizes: number[]) => new ReadableStream<Uint8Array>({
      start(controller) {
        for (const size of sizes) {
          controller.enqueue(new Uint8Array(size).fill(0x61));
        }
        controller.close();
      }
    });
    const { fetch } = serve([
      ['https://cdn.example.com/declared.less', () => new Response('small', { headers: [['content-length', '2000']] })],
      ['https://cdn.example.com/streamed.less', () => new Response(chunks(600, 600))],
      ['https://cdn.example.com/exact.less', () => new Response(chunks(600, 400))]
    ]);
    const plugin = new RemoteImportPlugin({ allow, fetch, maxBytes: 1000 });

    await expect(plugin.getSource('https://cdn.example.com/declared.less')).rejects.toThrow('larger than 1000 bytes');
    await expect(plugin.getSource('https://cdn.example.com/streamed.less')).rejects.toThrow('larger than 1000 bytes');
    await expect(plugin.getSource('https://cdn.example.com/exact.less')).resolves.toHaveLength(1000);
  });

  it('gives up at the deadline', async () => {
    const plugin = new RemoteImportPlugin({
      allow,
      timeout: 10,
      fetch: (_url, { signal }) => new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason));
      })
    });

    await expect(plugin.getSource('https://cdn.example.com/a.less')).rejects.toThrow('timed out after 10ms');
  });

  it('refuses a host that resolves to a loopback address with the default transport', async () => {
    await expect(new RemoteImportPlugin({ allow: ['localhost'] }).getSource('https://localhost/a.less'))
      .rejects.toThrow(/localhost resolves to (127\.0\.0\.1|::1), a private, loopback or link-local address/);
  });
});
