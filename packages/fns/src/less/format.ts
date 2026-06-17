import { Any, Node, Quoted, defineFunction } from '@jesscss/core';
import { serializeNodeValue } from '../util/serialize-node.js';

async function applyToken(token: string, value: Node, context: any): Promise<string> {
  const isStringToken = /%s/i.test(token);
  const rawValue = (isStringToken && value instanceof Quoted)
    ? value.valueOf()
    : await serializeNodeValue(value, context);
  return /[A-Z]$/.test(token) ? encodeURIComponent(rawValue) : rawValue;
}

const format = defineFunction(
  '%',
  async function(this: any, template: Node, arg1?: Node, arg2?: Node, arg3?: Node, arg4?: Node) {
    const args = [arg1, arg2, arg3, arg4].filter((arg): arg is Node => !!arg);

    let result = await serializeNodeValue(template, this.context);
    for (const value of args) {
      const match = result.match(/%[sda]/i);
      if (!match) {
        break;
      }
      result = `${result.slice(0, match.index)}${await applyToken(match[0], value, this.context)}${result.slice((match.index ?? 0) + match[0].length)}`;
    }
    result = result.replace(/%%/g, '%');

    if (template instanceof Quoted && !template.escaped) {
      return new Quoted(result, { quote: template.quote, escaped: false });
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
