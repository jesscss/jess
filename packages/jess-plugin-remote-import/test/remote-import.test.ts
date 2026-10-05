import { afterEach, describe, expect, it, vi } from 'vitest';
import { JessError } from '@jesscss/core';
import { RemoteImportPlugin, type RemoteFetch } from '../src/index.js';

/** DNS answers for the default transport's address check; an unlisted host does not resolve. */
const dns = vi.hoisted(() => ({ answers: new Map<string, string>() }));
vi.mock('node:dns/promises', () => ({
  lookup: async (hostname: string) => {
    const address = dns.answers.get(hostname);
    if (address === undefined) {
      throw new Error(`getaddrinfo ENOTFOUND ${hostname}`);
    }
    return [{ address, family: address.includes(':') ? 6 : 4 }];
  }
}));

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

  it.each([
    ['8.8.8.8'], ['127.0.0.1'], ['169.254.169.254'], ['[2001:db8::1]'], ['[::1]'], ['[64:ff9b::808:808]']
  ])('rejects the IP address %s: hosts are named, public or not', (entry) => {
    expect(() => new RemoteImportPlugin({ allow: [entry] })).toThrow('is an IP address; remote imports are fetched from named hosts only');
  });

  it('keeps hosts as a URL spells them', () => {
    expect([...new RemoteImportPlugin({ allow: ['CDN.Example.com', 'fonts.example.com'] }).allow])
      .toEqual(['cdn.example.com', 'fonts.example.com']);
  });
});

describe('RemoteImportPlugin under Deno', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const denoNet = (state: string) => {
    vi.stubGlobal('Deno', { permissions: { querySync: (descriptor: { name: string }) => ({ state: descriptor.name === 'net' ? state : 'denied' }) } });
  };

  it('refuses unrestricted network access, which would leave the allow list unenforced at runtime', () => {
    denoNet('granted');

    expect(() => new RemoteImportPlugin({ allow: ['cdn.example.com', 'fonts.example.com'] }))
      .toThrow('unrestricted network access, so the runtime would not enforce the allow list. Start it with --allow-net=cdn.example.com,fonts.example.com.');
  });

  it('accepts a host-restricted --allow-net', () => {
    denoNet('prompt');

    expect(() => new RemoteImportPlugin({ allow: ['cdn.example.com'] })).not.toThrow();
  });
});

describe('RemoteImportPlugin claim', () => {
  const { fetch, requested } = serve([]);
  const plugin = new RemoteImportPlugin({ allow: ['cdn.example.com'], fetch });
  const claim = (specifier: string, mustLoad = false) => plugin.canResolveImport(specifier, '/styles', [], mustLoad);

  it('claims an https or protocol-relative URL on an allowed host, with or without an extension', () => {
    expect(claim('https://cdn.example.com/theme.less')).toBe(true);
    expect(claim('//cdn.example.com/theme.less?v=2')).toBe(true);
    expect(claim('https://cdn.example.com/css?family=Open+Sans')).toBe(true);
    expect(claim('https://cdn.example.com/theme', true)).toBe(true);
  });

  it('leaves anything but an http(s) URL alone', () => {
    expect(claim('theme.less')).toBe(false);
    expect(claim('C:/styles/theme.less')).toBe(false);
    expect(claim('data:text/css,a{}')).toBe(false);
  });

  /* The allow list names the hosts that are fetched and inlined, not the ones a stylesheet may reference. */
  it.each([
    ['https://fonts.googleapis.com/css?family=Open+Sans'],
    ['//fonts.googleapis.com/css2?family=Inter'],
    ['https://8.8.8.8/theme'],
    ['http://cdn.example.com/theme']
  ])('leaves %s, extensionless and not fetched, a CSS @import', (specifier) => {
    expect(claim(specifier)).toBe(false);
    expect(requested).toEqual([]);
  });

  it.each([
    ['https://fonts.googleapis.com/css?family=Open+Sans', true, 'fonts.googleapis.com is not on the remote-import allow list'],
    ['https://evil.example/theme.less', false, 'evil.example is not on the remote-import allow list'],
    ['https://evil.example/theme.php?v=2', false, 'evil.example is not on the remote-import allow list'],
    ['https://cdn.example.com.evil.example/theme.less', false, 'cdn.example.com.evil.example is not on the remote-import allow list'],
    ['https://cdn.example.com@evil.example/theme.less', false, 'evil.example is not on the remote-import allow list'],
    ['https://169.254.169.254/latest.less', false, '169.254.169.254 is an IP address, and remote imports are fetched from named hosts only'],
    ['https://[2001:db8::1]/theme', true, '[2001:db8::1] is an IP address'],
    ['http://cdn.example.com/theme.less', false, 'https-only'],
    ['http://cdn.example.com/theme', true, 'https-only']
  ])('refuses %s (must load: %s), which cannot stay a CSS @import, before any request', (specifier, mustLoad, reason) => {
    expect(() => claim(specifier, mustLoad)).toThrow(reason);
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

  it('reports a 404 or 410 as a missing file and any other failure as a failed load', async () => {
    const { fetch } = serve([
      ['https://cdn.example.com/gone.less', () => new Response('gone', { status: 410 })],
      ['https://cdn.example.com/missing.less', () => new Response('missing', { status: 404 })],
      ['https://cdn.example.com/broken.less', () => new Response('broken', { status: 500 })]
    ]);
    const plugin = new RemoteImportPlugin({ allow, fetch });

    for (const missing of ['https://cdn.example.com/missing.less', 'https://cdn.example.com/gone.less']) {
      const error: unknown = await plugin.getSource(missing).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(JessError);
      expect(error).toMatchObject({ code: 'import/not-found' });
    }
    await expect(plugin.getSource('https://cdn.example.com/broken.less')).rejects.toThrow('failed: HTTP 500');
  });

  it('releases the body of every response it does not read', async () => {
    const released: string[] = [];
    const body = (name: string) => new ReadableStream<Uint8Array>({
      cancel() {
        released.push(name);
      }
    });
    const { fetch } = serve([
      ['https://cdn.example.com/a.less', () => new Response(body('redirect'), { status: 302, headers: { location: '/missing.less' } })],
      ['https://cdn.example.com/missing.less', () => new Response(body('not found'), { status: 404 })]
    ]);

    await expect(new RemoteImportPlugin({ allow, fetch }).getSource('https://cdn.example.com/a.less')).rejects.toThrow();
    expect(released).toEqual(['redirect', 'not found']);
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

  it('gives up at the deadline when the body stalls after the headers, whatever the transport', async () => {
    const stalled = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('.a {'));
      }
    });
    const plugin = new RemoteImportPlugin({ allow, timeout: 10, fetch: async () => new Response(stalled) });

    await expect(plugin.getSource('https://cdn.example.com/a.less')).rejects.toThrow('timed out after 10ms');
  });

});

describe('RemoteImportPlugin default transport', () => {
  afterEach(() => {
    dns.answers.clear();
    vi.unstubAllGlobals();
  });

  it.each([
    ['127.0.0.1'], ['10.1.2.3'], ['172.20.0.1'], ['192.168.1.1'], ['169.254.169.254'], ['100.100.100.200'], ['0.0.0.0'],
    ['198.18.0.1'], ['224.0.0.1'], ['255.255.255.255'],
    ['::'], ['::1'], ['fd00::1'], ['fe80::1'], ['fec0::1'], ['ff02::1'], ['::ffff:7f00:1'],
    ['::a9fe:a9fe'], ['64:ff9b::a9fe:a9fe'], ['2002:a9fe:a9fe::1']
  ])('refuses an allowed host that resolves to the private, loopback or link-local address %s', async (address) => {
    const network = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', network);
    dns.answers.set('cdn.example.com', address);

    await expect(new RemoteImportPlugin({ allow: ['cdn.example.com'] }).getSource('https://cdn.example.com/a.less'))
      .rejects.toThrow(`cdn.example.com resolves to ${address}, a private, loopback or link-local address`);
    expect(network).not.toHaveBeenCalled();
  });

  it.each([['93.184.215.14'], ['2001:db8::1'], ['64:ff9b::808:808'], ['2002:808:808::1']])(
    'fetches from an allowed host that resolves to the public address %s',
    async (address) => {
      const network = vi.fn<typeof fetch>(async () => new Response('.a {}'));
      vi.stubGlobal('fetch', network);
      dns.answers.set('cdn.example.com', address);

      await expect(new RemoteImportPlugin({ allow: ['cdn.example.com'] }).getSource('https://cdn.example.com/a.less')).resolves.toBe('.a {}');
      expect(network).toHaveBeenCalledOnce();
    }
  );
});
