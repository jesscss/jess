import { expr, any } from '../index.js';
import { Context } from '../../context.js';
import { getField, getParent, setField } from '../util/field-helpers.js';
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

  it('preEval preserves a state-patched value without mutating the canonical child', async () => {
    const shared = any('bar');
    const source = expr(shared);
    const rule = expr(any('foo'));
    setField(rule, 'value', shared, context);
    const preEvald = await rule.preEval(context);

    // With EvalState, maybeClone returns this — no clone needed.
    expect(preEvald).toBe(rule);
    // State-patched value is visible through getField
    expect(getField(rule, 'value', context)).toBe(shared);
    expect(rule.toTrimmedString({ context })).toBe('$(bar)');
    // Canonical value unchanged
    expect(rule.get('value')).not.toBe(shared);
    // Canonical parent unchanged
    expect(shared.parent).toBe(source);
  });

  it('reads a singular child through the cursor model', () => {
    const canonical = any('foo');
    const alternate = any('bar');
    const rule = expr(canonical);
    const key = {} as RenderKey;
    const cursor = { node: rule, renderKey: key };

    expect(getEdge(cursor, 'value')?.node).toBe(canonical);

    addEdge(rule, 'value', key, alternate);

    expect(getEdge(cursor, 'value')?.node).toBe(alternate);
    expect(rule.value).toBe(canonical);
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
