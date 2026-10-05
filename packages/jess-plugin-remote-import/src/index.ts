import type { PluginInterface } from '@jesscss/core';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { extname } from 'node:path';

/** The transport a remote import is fetched through — the global `fetch` shape. */
export type RemoteFetch = (url: string, init: { redirect: 'manual'; signal: AbortSignal }) => Promise<Response>;

export interface RemoteImportPluginOptions {
  /**
   * Hosts remote imports may be fetched from, spelled as a URL prints them
   * (`cdn.example.com`: lowercase, punycode for an IDN). Matching is exact: no
   * wildcards, no ports, and never a private, loopback or link-local address.
   * Required and non-empty. Under Deno, pass the same list to `--allow-net` so
   * the runtime enforces it too.
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
 * Unspecified, private, shared (CGNAT), loopback and link-local ranges. An
 * IPv4-mapped IPv6 address is checked against the IPv4 rules.
 */
const PRIVATE_ADDRESSES = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16]
] as const) {
  PRIVATE_ADDRESSES.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [['::', 127], ['fc00::', 7], ['fe80::', 10]] as const) {
  PRIVATE_ADDRESSES.addSubnet(network, prefix, 'ipv6');
}

/** `[::1]` → `::1`; any other hostname is returned as is. */
const unbracket = (hostname: string): string => (hostname.startsWith('[') ? hostname.slice(1, -1) : hostname);

const isPrivateAddress = (host: string): boolean => {
  const family = isIP(host);
  return family !== 0 && PRIVATE_ADDRESSES.check(host, family === 6 ? 'ipv6' : 'ipv4');
};

/** An http(s) URL, or a protocol-relative one taken as https; undefined for anything else. */
const remoteUrl = (specifier: string): URL | undefined => {
  const href = specifier.startsWith('//') ? `https:${specifier}` : specifier;
  const url = URL.canParse(href) ? new URL(href) : undefined;
  return url?.protocol === 'https:' || url?.protocol === 'http:' ? url : undefined;
};

/** An allow entry as `URL.hostname` spells it. Throws for anything but a bare, public host. */
function allowedHost(entry: string): string {
  const url = URL.canParse(`https://${entry}/`) ? new URL(`https://${entry}/`) : undefined;
  if (url === undefined || entry.includes('*') || url.port !== '' || url.host !== entry.toLowerCase()) {
    throw new Error(
      `remote-import: allow entry "${entry}" is not a host. List each host as a URL spells it, `
      + 'such as "cdn.example.com" — no scheme, port, path or wildcard.'
    );
  }
  if (isPrivateAddress(unbracket(url.hostname))) {
    throw new Error(
      `remote-import: allow entry "${entry}" is a private, loopback or link-local address; remote imports never reach those.`
    );
  }
  return url.hostname;
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

async function readText(response: Response, maxBytes: number, href: string): Promise<string> {
  const tooLarge = () => new Error(`Remote import ${href} is refused: the response is larger than ${maxBytes} bytes.`);
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel();
    throw tooLarge();
  }
  const reader = response.body?.getReader();
  if (reader === undefined) {
    return '';
  }
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    size += chunk.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * Fetches `@import` sources over https from an explicit host allow list. It is
 * never part of the default stack: without it, a URL import is a CSS terminal
 * and nothing is fetched.
 *
 * Only {@link RemoteImportPlugin.getSource} touches the network. A remote import
 * reaches it through Context's ordinary claim → resolve → locate → source route,
 * and a host off the list is rejected at the claim, before any request.
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
    this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    this.timeout = opts.timeout ?? DEFAULT_TIMEOUT;
    this.fetch = opts.fetch ?? guardedFetch;
  }

  /**
   * Claims a remote import of a file — a URL whose path has an extension. An
   * extensionless URL (`https://fonts.googleapis.com/css?…`) names an endpoint,
   * not a stylesheet source, so it stays a CSS terminal. A claimed URL that is
   * plain http or names a host off the allow list is an error, never a silent
   * terminal: configuring this plugin asks for remote sources to be inlined.
   */
  canResolveImport(specifier: string): boolean {
    const url = remoteUrl(specifier);
    if (url === undefined || extname(url.pathname) === '') {
      return false;
    }
    this.check(url);
    return true;
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
   * and the whole exchange at `timeout`.
   */
  async getSource(location: string): Promise<string> {
    const requested = remoteUrl(location);
    if (requested === undefined) {
      throw new Error(`remote-import: "${location}" is not a remote URL.`);
    }
    this.check(requested);
    let url = requested;
    const signal = AbortSignal.timeout(this.timeout);
    try {
      for (let redirects = 0; ; redirects++) {
        const response = await this.fetch(url.href, { redirect: 'manual', signal });
        const target = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
        if (target === null) {
          if (!response.ok) {
            throw new Error(`Remote import ${url.href} failed: HTTP ${response.status}.`);
          }
          return await readText(response, this.maxBytes, url.href);
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

  private check(url: URL): void {
    if (url.protocol !== 'https:') {
      throw new Error(`Remote import ${url.href} is refused: remote imports are https-only.`);
    }
    if (!this.allow.has(url.hostname)) {
      throw new Error(`Remote import ${url.href} is refused: ${url.hostname} is not on the remote-import allow list.`);
    }
  }
}

export const remoteImportPlugin = (opts: RemoteImportPluginOptions): RemoteImportPlugin => new RemoteImportPlugin(opts);

export default remoteImportPlugin;
