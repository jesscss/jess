import { groupItems, makeKeyword, defineFunction } from '@jesscss/core/value';
import type { Fn, ValueObj } from '@jesscss/core/value';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import { lookupMime } from '../util/mime.js';

/**
 * Less `data-uri()` — inline a file as a `data:` URL. The MIME type may be given
 * explicitly or guessed from the extension; text is percent-encoded and binary is
 * base64-encoded. If the injected IO capability cannot read the file, it returns
 * the authored `url()` call as a value-domain keyword.
 */
const dataUri: Fn = defineFunction('data-uri', {
  params: [{ kinds: 'any' }, { kinds: 'any', optional: true }],
  variadic: true,
  body: (value, ctx): MaybePromise<ValueObj> => {
    const items = groupItems(value);
    if (items.length === 0) {
      throw new TypeError('data-uri() requires a path');
    }
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
      if (useBase64) {
        mimetype += ';base64';
      }
    } else {
      useBase64 = /;base64$/i.test(mimetype);
    }

    const finish = (bytes: Uint8Array | null): ValueObj => {
      if (!bytes) {
        return makeKeyword(`url("${rawPath}")`);
      }
      const encoded = useBase64 ? Buffer.from(bytes).toString('base64') : encodeURIComponent(Buffer.from(bytes).toString());
      return makeKeyword(`url("data:${mimetype},${encoded}${fragment}")`);
    };
    const bytes = ctx.io?.readFile(filePath);
    return bytes && isThenable(bytes) ? bytes.then(finish) : finish(bytes ?? null);
  }
});

export default dataUri;
