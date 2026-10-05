import type { PluginInterface } from '@jesscss/core';
import { ERR } from '@jesscss/core/diagnostics';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { posix } from 'node:path';

/** The transport a remote import is fetched through — the global `fetch` shape. */
export type RemoteFetch = (url: string, init: { redirect: 'manual'; signal: AbortSignal }) => Promise<Response>;

export interface RemoteImportPluginOptions {
  /**
   * Hosts remote imports may be fetched from and inlined, spelled as a URL
   * prints them (`cdn.example.com`: lowercase, punycode for an IDN). Matching is
   * exact: no wildcards, no ports, and never an IP address. Required and
   * non-empty. Under Deno, pass the same list to `--allow-net` so the runtime
   * enforces it too; unrestricted `--allow-net` is refused.
   */
  allow: readonly string[];

  /**
   * Largest response body accepted, in bytes.
   * @default 524288 (512 KiB)
   */
  maxBytes?: number;

  /**
   * Time limit for one import — every redirect and the body included — in
   * milliseconds.
   * @default 5000
   */
  timeout?: number;

  /**
   * The transport. The default resolves the host and refuses a private,
   * loopback or link-local address before calling the global `fetch`; a
   * replacement takes over that check along with the request.
   */
  fetch?: RemoteFetch;
}

const MAX_REDIRECTS = 5;
const DEFAULT_MAX_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT = 5000;

/**
 * Addresses an allowed host may never resolve to: unspecified, private, shared
 * (CGNAT), loopback, link-local, benchmarking, multicast and reserved IPv4
 * (broadcast included), and unique-local, link-local, site-local and multicast
 * IPv6. An IPv6 address that embeds an IPv4 one is checked by that address.
 */
const PRIVATE_ADDRESSES = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]
] as const) {
  PRIVATE_ADDRESSES.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]] as const) {
  PRIVATE_ADDRESSES.addSubnet(network, prefix, 'ipv6');
}

/** `[::1]` → `::1`; any other hostname is returned as is. */
const unbracket = (hostname: string): string => (hostname.startsWith('[') ? hostname.slice(1, -1) : hostname);

/**
 * The IPv4 address inside an IPv4-compatible (`::/96`, `::` and `::1`
 * included), NAT64 (`64:ff9b::/96`) or 6to4 (`2002::/16`) IPv6 address.
 * IPv4-mapped (`::ffff:0:0/96`) is left to `BlockList`, which checks it itself.
 */
function embeddedIPv4(address: string): string | undefined {
  /** URL serialization spells the address as hex groups (a dotted tail included) around at most one `::`. */
  const href = `http://[${address}]/`;
  if (!URL.canParse(href)) {
    return undefined;
  }
  const [head = '', tail] = unbracket(new URL(href).hostname).split('::');
  const groups = (part: string | undefined) => (part ? part.split(':').map(group => Number.parseInt(group, 16)) : []);
  const left = groups(head);
  const right = groups(tail);
  const g = [...left, ...Array<number>(8 - left.length - right.length).fill(0), ...right];
  const quad = (high: number, low: number) => `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
  if (g[0] === 0x2002) {
    return quad(g[1]!, g[2]!);
  }
  const prefixed = (first: number, second: number) => g[0] === first && g[1] === second && g.slice(2, 6).every(group => group === 0);
  return prefixed(0, 0) || prefixed(0x64, 0xff9b) ? quad(g[6]!, g[7]!) : undefined;
}

const isPrivateAddress = (host: string): boolean => {
  const family = isIP(host);
  if (family === 4) {
    return PRIVATE_ADDRESSES.check(host, 'ipv4');
  }
  if (family !== 6) {
    return false;
  }
  if (PRIVATE_ADDRESSES.check(host, 'ipv6')) {
    return true;
  }
  const v4 = embeddedIPv4(host);
  return v4 !== undefined && PRIVATE_ADDRESSES.check(v4, 'ipv4');
};

/** An http(s) URL, or a protocol-relative one taken as https; undefined for anything else. */
const remoteUrl = (specifier: string): URL | undefined => {
  const href = specifier.startsWith('//') ? `https:${specifier}` : specifier;
  const url = URL.canParse(href) ? new URL(href) : undefined;
  return url?.protocol === 'https:' || url?.protocol === 'http:' ? url : undefined;
};

/** An allow entry as `URL.hostname` spells it. Throws for anything but a bare host name. */
function allowedHost(entry: string): string {
  const url = URL.canParse(`https://${entry}/`) ? new URL(`https://${entry}/`) : undefined;
  if (url === undefined || entry.includes('*') || url.port !== '' || url.host !== entry.toLowerCase()) {
    throw new Error(
      `remote-import: allow entry "${entry}" is not a host. List each host as a URL spells it, `
      + 'such as "cdn.example.com" — no scheme, port, path or wildcard.'
    );
  }
  if (isIP(unbracket(url.hostname)) !== 0) {
    throw new Error(`remote-import: allow entry "${entry}" is an IP address; remote imports are fetched from named hosts only.`);
  }
  return url.hostname;
}

/**
 * Whether this is Deno with unrestricted network access (`--allow-net` with no
 * host list, or `-A`). Outside Deno, false.
 */
function denoGrantsAllNet(): boolean {
  const deno: unknown = Reflect.get(globalThis, 'Deno');
  const permissions: unknown = typeof deno === 'object' && deno !== null ? Reflect.get(deno, 'permissions') : undefined;
  const querySync: unknown = typeof permissions === 'object' && permissions !== null ? Reflect.get(permissions, 'querySync') : undefined;
  if (typeof querySync !== 'function') {
    return false;
  }
  const status: unknown = Reflect.apply(querySync, permissions, [{ name: 'net' }]);
  return typeof status === 'object' && status !== null && Reflect.get(status, 'state') === 'granted';
}

const guardedFetch: RemoteFetch = async (href, init) => {
  const { hostname } = new URL(href);

  /*
   * ponytail: the answer is checked before `fetch` connects, so a DNS answer
   * that changes in between (rebinding) slips through; pinning the socket to
   * the checked address needs a custom dispatcher.
   */
  const addresses = await lookup(unbracket(hostname), { all: true });
  const blocked = addresses.find(({ address }) => isPrivateAddress(address));
  if (blocked !== undefined) {
    throw new Error(
      `Remote import ${href} is refused: ${hostname} resolves to ${blocked.address}, a private, loopback or link-local address.`
    );
  }
  return fetch(href, init);
};

async function readText(response: Response, maxBytes: number, href: string, signal: AbortSignal): Promise<string> {
  const tooLarge = () => new Error(`Remote import ${href} is refused: the response is larger than ${maxBytes} bytes.`);
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel();
    throw tooLarge();
  }
  const reader = response.body?.getReader();
  if (reader === undefined) {
    return '';
  }

  /** The deadline also ends a body that stalls after its headers, whatever transport produced it. */
  const stop = () => {
    reader.cancel().catch(() => undefined);
  };
  signal.throwIfAborted();
  signal.addEventListener('abort', stop, { once: true });
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  try {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      size += chunk.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw tooLarge();
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    signal.removeEventListener('abort', stop);
  }
  signal.throwIfAborted();
  return text + decoder.decode();
}

/**
 * Fetches `@import` sources over https from an explicit host allow list. It is
 * never part of the default stack: without it, a URL import is a CSS terminal
 * and nothing is fetched.
 *
 * Only {@link RemoteImportPlugin.getSource} touches the network. A remote import
 * reaches it through Context's ordinary claim → resolve → locate → source route,
 * and a URL off the list is left a CSS `@import` or rejected at the claim,
 * before any request.
 */
export class RemoteImportPlugin implements PluginInterface {
  name = 'remote-import';

  /** The allowed hosts, as `URL.hostname` spells them. */
  readonly allow: ReadonlySet<string>;

  private readonly maxBytes: number;
  private readonly timeout: number;
  private readonly fetch: RemoteFetch;

  constructor(opts: RemoteImportPluginOptions) {
    if (opts?.allow === undefined || opts.allow.length === 0) {
      throw new Error('remote-import: remote imports need an explicit host allow list, such as `allow: [\'cdn.example.com\']`.');
    }
    this.allow = new Set(opts.allow.map(allowedHost));
    if (denoGrantsAllNet()) {
      throw new Error(
        'remote-import: Deno was started with unrestricted network access, so the runtime would not enforce the allow list. '
        + `Start it with --allow-net=${[...this.allow].join(',')}.`
      );
    }
    this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    this.timeout = opts.timeout ?? DEFAULT_TIMEOUT;
    this.fetch = opts.fetch ?? guardedFetch;
  }

  /**
   * Claims an https import on the allow list: the list names the hosts that are
   * fetched and inlined, not the ones a stylesheet may reference. Less has
   * already left every URL it classifies as CSS (an authored `.css` path,
   * `(css)`) a CSS `@import`, so any other http(s) or protocol-relative
   * import gets here. Off the list, an extensionless one — Google Fonts'
   * `/css?family=…` — stays a CSS `@import` (false), unless it must load
   * (`(inline)`, `(reference)`, `(less)`, `@compose`); any other cannot be a
   * CSS `@import` and is an error. Never a request.
   */
  canResolveImport(specifier: string, _currentDir: string, _searchPaths: string[], mustLoad: boolean): boolean {
    const url = remoteUrl(specifier);
    if (url === undefined) {
      return false;
    }
    const refusal = this.refusal(url);
    if (refusal === undefined) {
      return true;
    }
    if (!mustLoad && posix.extname(url.pathname) === '') {
      return false;
    }
    throw new Error(refusal);
  }

  /** The first candidate that is an allowed https URL — never a request. */
  locate(candidates: string[]): string | null {
    for (const candidate of candidates) {
      const url = remoteUrl(candidate);
      if (url?.protocol === 'https:' && this.allow.has(url.hostname)) {
        return url.href;
      }
    }
    return null;
  }

  /**
   * Fetches one located URL. Same-origin redirects are followed (at most five);
   * a redirect to another origin is refused. The body is capped at `maxBytes`
   * and the whole exchange at `timeout`. A 404 or 410 is a missing file
   * (`import/not-found`), which `(optional)` skips.
   */
  async getSource(location: string): Promise<string> {
    const requested = remoteUrl(location);
    if (requested === undefined) {
      throw new Error(`remote-import: "${location}" is not a remote URL.`);
    }
    const refusal = this.refusal(requested);
    if (refusal !== undefined) {
      throw new Error(refusal);
    }
    let url = requested;
    const signal = AbortSignal.timeout(this.timeout);
    try {
      for (let redirects = 0; ; redirects++) {
        const response = await this.fetch(url.href, { redirect: 'manual', signal });
        const target = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
        if (target === null && response.ok) {
          return await readText(response, this.maxBytes, url.href, signal);
        }

        /** Only a 2xx body is read; any other is released before the next hop or the error. */
        await response.body?.cancel();
        if (target === null) {
          if (response.status === 404 || response.status === 410) {
            throw ERR.importNotFound({
              reason: `${url.href} answered HTTP ${response.status}.`,
              meta: { specifier: location, from: url.origin }
            });
          }
          throw new Error(`Remote import ${url.href} failed: HTTP ${response.status}.`);
        }
        const next = new URL(target, url);
        if (next.origin !== url.origin) {
          throw new Error(`Remote import ${url.href} is refused: it redirects to ${next.origin}, and cross-host redirects are not followed.`);
        }
        if (redirects === MAX_REDIRECTS) {
          throw new Error(`Remote import ${location} is refused: more than ${MAX_REDIRECTS} redirects.`);
        }
        url = next;
      }
    } catch (error) {
      if (signal.aborted) {
        throw new Error(`Remote import ${location} timed out after ${this.timeout}ms.`, { cause: error });
      }
      throw error;
    }
  }

  /** Why this URL is not fetched, or undefined when it is. */
  private refusal(url: URL): string | undefined {
    if (url.protocol !== 'https:') {
      return `Remote import ${url.href} is refused: remote imports are https-only.`;
    }
    if (isIP(unbracket(url.hostname)) !== 0) {
      return `Remote import ${url.href} is refused: ${url.hostname} is an IP address, and remote imports are fetched from named hosts only.`;
    }
    if (!this.allow.has(url.hostname)) {
      return `Remote import ${url.href} is refused: ${url.hostname} is not on the remote-import allow list.`;
    }
    return undefined;
  }
}

export const remoteImportPlugin = (opts: RemoteImportPluginOptions): RemoteImportPlugin => new RemoteImportPlugin(opts);

export default remoteImportPlugin;
