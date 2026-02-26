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
    // #region agent log
    fetch('http://127.0.0.1:7246/ingest/5495253d-8cd1-42e7-9850-458424cd0fb8', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Debug-Session-Id': '34ceef'
      },
      body: JSON.stringify({
        sessionId: '34ceef',
        runId: 'format-spacing-focus',
        hypothesisId: 'H_fmt_1_H_fmt_2',
        location: 'packages/fns/src/less/format.ts:format:before',
        message: 'format input serialization snapshot',
        data: {
          template: {
            type: template.type,
            pre: (template as any).pre ?? null,
            trimmed: template.toTrimmedString?.({ context: this.context }) ?? template.valueOf(),
            full: template.toString?.({ context: this.context }) ?? template.valueOf()
          },
          args: args.map((arg) => ({
            type: arg.type,
            pre: (arg as any).pre ?? null,
            trimmed: arg.toTrimmedString?.({ context: this.context }) ?? arg.valueOf(),
            full: arg.toString?.({ context: this.context }) ?? arg.valueOf()
          }))
        },
        timestamp: Date.now()
      })
    }).catch(() => {});
    // #endregion

    let result = serializeNodeValue(template, this.context);
    for (const value of args) {
      result = result.replace(/%[sda]/i, (token) => applyToken(token, value, this.context));
    }
    result = result.replace(/%%/g, '%');

    // #region agent log
    fetch('http://127.0.0.1:7246/ingest/5495253d-8cd1-42e7-9850-458424cd0fb8', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Debug-Session-Id': '34ceef'
      },
      body: JSON.stringify({
        sessionId: '34ceef',
        runId: 'format-spacing-focus',
        hypothesisId: 'H_fmt_3',
        location: 'packages/fns/src/less/format.ts:format:after',
        message: 'format output snapshot',
        data: {
          result,
          returnType: template instanceof Quoted && !template.options.escaped ? 'Quoted' : 'Any'
        },
        timestamp: Date.now()
      })
    }).catch(() => {});
    // #endregion

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
