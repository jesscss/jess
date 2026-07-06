import { Any, Node, defineFunction } from '@jesscss/core';
import { serializeNodeValue } from '../util/serialize-node.js';

/**
 * URL-encode a value (Less `escape()`). Applies `encodeURI` then escapes the
 * characters `encodeURI` leaves untouched but that are unsafe in a URL context
 * (`=`, `:`, `#`, `;`, `(`, `)`), matching less.js. Used by the lowered `%S`/`%D`/
 * `%A` string-format directives.
 */
const escape = defineFunction(
  'escape',
  async function(this: any, value: Node): Promise<Node> {
    const raw = await serializeNodeValue(value, this.context);
    const encoded = encodeURI(raw)
      .replace(/=/g, '%3D')
      .replace(/:/g, '%3A')
      .replace(/#/g, '%23')
      .replace(/;/g, '%3B')
      .replace(/\(/g, '%28')
      .replace(/\)/g, '%29');
    return new Any(encoded, { role: 'keyword' });
  },
  {
    params: [{
      name: 'value',
      type: Node
    }]
  }
);

export default escape;
