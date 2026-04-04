import { expr, any } from '../index.js';
import { Context } from '../../context.js';
import { addEdge, getEdge } from '../util/cursor.js';
import type { RenderKey } from '../node.js';

let context: Context;
describe('Expression', () => {
  beforeEach(() => {
    context = new Context();
  });

  it('should serialize an expression', () => {
    let rule = expr(any('foo'));
    expect(`${rule}`).toBe('$(foo)');
  });

  it('should serialize an expression consistently', () => {
    let rule = expr(any('foo'));
    expect(`${rule}`).toBe('$(foo)');
  });

  it('a cloned expression can replace its value without mutating the canonical child', () => {
    const rule = expr(any('foo'));
    const replacement = any('bar');
    const clonedRule = rule.clone();

    clonedRule.adopt(replacement, context);
    (clonedRule as unknown as { value: ReturnType<typeof any> }).value = replacement;

    expect(clonedRule.toTrimmedString({ context })).toBe('$(bar)');
    expect(rule.get('value')).not.toBe(replacement);
    expect(rule.toTrimmedString()).toBe('$(foo)');
    expect(clonedRule.get('value')).toBe(replacement);
  });

  it('reads a singular child through the cursor model', () => {
    const canonical = any('foo');
    const alternate = any('bar');
    const rule = expr(canonical);
    const key: RenderKey = Symbol('cursor');
    const cursor = { node: rule, renderKey: key };

    expect(getEdge(cursor, 'value')?.node).toBe(canonical);

    addEdge(rule, 'value', key, alternate);

    expect(getEdge(cursor, 'value')?.node).toBe(alternate);
    expect(rule.value).toBe(canonical);
  });

  it('reads a singular child through get(field, renderKey) without a context', () => {
    const canonical = any('foo');
    const alternate = any('bar');
    const rule = expr(canonical);
    const renderKey = Symbol('render');

    addEdge(rule, 'value', renderKey, alternate);

    expect(rule.get('value')).toBe(canonical);
    expect(rule.get('value', renderKey)).toBe(alternate);
  });

  // it('should serialize to a module', () => {
  //   let rule = call({
  //     name: 'rgb',
  //     value: list([num(100), num(100), num(100)])
  //   })
  //   rule.toModule(context, out)
  //   expect(out.toString()).toBe(
  //     '$J.call({\n  name: "rgb",\n  value: $J.list([\n    $J.num({\n      value: 100,\n      unit: ""\n    }),\n    $J.num({\n      value: 100,\n      unit: ""\n    }),\n    $J.num({\n      value: 100,\n      unit: ""\n    })\n  ]),\n  ref: () => rgb,\n})'
  //   )
  // })
});
