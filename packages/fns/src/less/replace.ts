import { Any, Node, Quoted, defineFunction } from '@jesscss/core';

function nodeToString(value: Node, context: any): string {
  if (value instanceof Quoted || value instanceof Any) {
    return value.valueOf();
  }
  return value.toString({ context });
}

const replace = defineFunction(
  'replace',
  function(input: Node, pattern: Node, replacement: Node, flags?: Node) {
    const source = nodeToString(input, this.context);
    const patternValue = nodeToString(pattern, this.context);
    const replacementValue = replacement instanceof Quoted
      ? replacement.valueOf()
      : nodeToString(replacement, this.context);
    const flagValue = flags ? nodeToString(flags, this.context) : '';
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
