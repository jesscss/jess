import { makeKeyword } from '@jesscss/core/value';
import type { Fn, List, ValueObj } from '@jesscss/core/value';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import { lookupMime } from '../util/mime.js';

/**
 * `data-uri('mimetype', 'file')` / `data-uri('file')` — inline a referenced file
 * as a `url("data:…")`. The mimetype is given explicitly or guessed from the
 * extension; a text payload is percent-encoded, binary is base64-encoded (Less 4.x
 * `functions/data-uri.js`; verified byte-identical against the alpha `urls` golden).
 * A trailing `#fragment` is split off and re-appended verbatim.
 *
 * VALUE-DOMAIN CARRIER: legacy returns a `URL(Quoted)` node; the value substrate has
 * no url kind, so the verbatim `url("…")` bytes ride a `Keyword` (as `svg-gradient`
 * does). IO is the injected {@link import('@jesscss/core/value').FnCtx.io} capability —
 * absent (no IO host) or an unreadable file degrades to a plain `url("path")` fallback
 * rather than throwing, so a bad reference never regresses the whole document.
 *
 * NOTE (vs old Less <3): there is NO ~32KB size-threshold fallback — 4.x/v5 always
 * inline the full payload (the golden embeds a >15KB base64 blob verbatim).
 */
export const dataUri: Fn = {
  name: 'data-uri',
  params: [{ kinds: 'any' }, { kinds: 'any', optional: true }],
  variadic: true,
  body: (list, ctx): MaybePromise<ValueObj> => {
    const items = list.items;
    if (items.length === 0) return verbatim(list);
    const hasMime = items.length >= 2;
    const rawPath = ctx.stringify(hasMime ? items[1]! : items[0]!);
    const explicitMime = hasMime ? ctx.stringify(items[0]!) : undefined;

    let fragment = '';
    let filePath = rawPath;
    const hash = rawPath.indexOf('#');
    if (hash !== -1) {
      fragment = rawPath.slice(hash);
      filePath = rawPath.slice(0, hash);
    }

    let mimetype = explicitMime;
    let useBase64: boolean;
    if (mimetype === undefined) {
      const guess = lookupMime(filePath);
      mimetype = guess.type;
      useBase64 = !guess.ascii;
      if (useBase64) mimetype += ';base64';
    } else {
      useBase64 = /;base64$/i.test(mimetype);
    }

    const finish = (bytes: Uint8Array | null): ValueObj => {
      if (!bytes) return fallbackUrl(rawPath);
      const buf = Buffer.from(bytes);
      const encoded = useBase64 ? buf.toString('base64') : encodeURIComponent(buf.toString());
      return makeKeyword(`url("data:${mimetype},${encoded}${fragment}")`);
    };
    const bytes = ctx.io?.readFile(filePath);
    return bytes && isThenable(bytes) ? bytes.then(finish) : finish(bytes ?? null);
  },
};

/** File-not-found / no-IO fallback: the path as a plain `url()` (matches 4.x's URL fallback). */
function fallbackUrl(rawPath: string): ValueObj {
  return makeKeyword(`url("${rawPath}")`);
}

/** Malformed call (no args) — emit verbatim so it never regresses the document. */
function verbatim(list: List): ValueObj {
  return makeKeyword(`data-uri(${list.items.map((i) => i.bytes).join(', ')})`);
}
