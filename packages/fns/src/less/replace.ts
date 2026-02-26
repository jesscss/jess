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
    // #region agent log
    fetch('http://127.0.0.1:7246/ingest/5495253d-8cd1-42e7-9850-458424cd0fb8', {
      method: 'POST',
      headers: {
        ['Content-Type']: 'application/json',
        ['X-Debug-Session-Id']: '34ceef'
      },
      body: JSON.stringify({
        sessionId: '34ceef',
        runId: 'replace-spacing-focus',
        hypothesisId: 'H_rep_1_H_rep_2_H_rep_3',
        location: 'packages/fns/src/less/replace.ts:replace:before',
        message: 'replace input serialization snapshot',
        data: {
          input: serialize(input),
          pattern: serialize(pattern),
          replacement: serialize(replacement),
          flags: flags ? serialize(flags) : null
        },
        timestamp: Date.now()
      })
    }).catch(() => {});
    // #endregion

    const source = serializeNodeValue(input, this.context);
    const patternValue = serializeNodeValue(pattern, this.context);
    const replacementValue = replacement instanceof Quoted
      ? replacement.valueOf()
      : serializeNodeValue(replacement, this.context);
    const flagValue = flags ? serializeNodeValue(flags, this.context) : '';
    const result = source.replace(new RegExp(patternValue, flagValue), replacementValue);

    // #region agent log
    fetch('http://127.0.0.1:7246/ingest/5495253d-8cd1-42e7-9850-458424cd0fb8', {
      method: 'POST',
      headers: {
        ['Content-Type']: 'application/json',
        ['X-Debug-Session-Id']: '34ceef'
      },
      body: JSON.stringify({
        sessionId: '34ceef',
        runId: 'replace-spacing-focus',
        hypothesisId: 'H_rep_4',
        location: 'packages/fns/src/less/replace.ts:replace:after',
        message: 'replace output snapshot',
        data: {
          source,
          patternValue,
          replacementValue,
          flagValue,
          result,
          returnType: input instanceof Quoted && !input.options.escaped ? 'Quoted' : 'Any'
        },
        timestamp: Date.now()
      })
    }).catch(() => {});
    // #endregion

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
