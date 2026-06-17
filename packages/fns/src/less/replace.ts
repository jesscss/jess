import { Any, Node, Quoted, defineFunction } from '@jesscss/core';
import { serializeNodeValue } from '../util/serialize-node.js';

const replace = defineFunction(
  'replace',
  async function(this: any, input: Node, pattern: Node, replacement: Node, flags?: Node) {
    const source = await serializeNodeValue(input, this.context);
    const patternValue = await serializeNodeValue(pattern, this.context);
    const replacementValue = replacement instanceof Quoted
      ? replacement.valueOf()
      : await serializeNodeValue(replacement, this.context);
    const flagValue = flags ? await serializeNodeValue(flags, this.context) : '';
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
