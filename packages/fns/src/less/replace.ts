import { Any, Node, Quoted, defineFunction } from '@jesscss/core';
import { serializeNodeValue } from '../util/serialize-node.js';

const replace = defineFunction(
  'replace',
  function(this: any, input: Node, pattern: Node, replacement: Node, flags?: Node) {
    const serialize = (n: Node) => {
      const trimmed = n.toTrimmedString?.({ context: this.context }) ?? n.valueOf();
      const full = n.toString?.({ context: this.context }) ?? n.valueOf();
      return {
        type: n.type,
        pre: (n as any).pre ?? null,
        post: (n as any).post ?? null,
        valueOf: n.valueOf(),
        trimmed,
        full
      };
    };

    const source = serializeNodeValue(input, this.context);
    const patternValue = serializeNodeValue(pattern, this.context);
    const replacementValue = replacement instanceof Quoted
      ? replacement.valueOf()
      : serializeNodeValue(replacement, this.context);
    const flagValue = flags ? serializeNodeValue(flags, this.context) : '';
    const result = source.replace(new RegExp(patternValue, flagValue), replacementValue);

    if (input instanceof Quoted && !input.options.escaped) {
      return new Quoted(result, { quote: input.options.quote, escaped: false });
    }
    return new Any(result, { role: 'keyword' });
  },
  {
    params: [{
      name: 'input',
      type: Node
    }, {
      name: 'pattern',
      type: Node
    }, {
      name: 'replacement',
      type: Node
    }, {
      name: 'flags',
      type: Node,
      optional: true
    }]
  }
);

export default replace;
