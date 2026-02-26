import { Any, Node, Quoted, defineFunction } from '@jesscss/core';
import { serializeNodeValue } from '../util/serialize-node.js';

function applyToken(token: string, value: Node, context: any): string {
  const isStringToken = /%s/i.test(token);
  const rawValue = (isStringToken && value instanceof Quoted)
    ? value.valueOf()
    : serializeNodeValue(value, context);
  return /[A-Z]$/.test(token) ? encodeURIComponent(rawValue) : rawValue;
}

const format = defineFunction(
  '%',
  function(this: any, template: Node, arg1?: Node, arg2?: Node, arg3?: Node, arg4?: Node) {
    const args = [arg1, arg2, arg3, arg4].filter((arg): arg is Node => !!arg);

    let result = serializeNodeValue(template, this.context);
    for (const value of args) {
      result = result.replace(/%[sda]/i, (token) => applyToken(token, value, this.context));
    }
    result = result.replace(/%%/g, '%');

    if (template instanceof Quoted && !template.options.escaped) {
      return new Quoted(result, { quote: template.options.quote, escaped: false });
    }
    return new Any(result, { role: 'keyword' });
  },
  {
    params: [{
      name: 'template',
      type: Node
    }, {
      name: 'arg1',
      type: Node,
      optional: true
    }, {
      name: 'arg2',
      type: Node,
      optional: true
    }, {
      name: 'arg3',
      type: Node,
      optional: true
    }, {
      name: 'arg4',
      type: Node,
      optional: true
    }]
  }
);

export default format;
