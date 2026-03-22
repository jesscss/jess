import { expr, any } from '../index.js';
import { Context } from '../../context.js';
import { EvalSession } from '../../eval-session.js';
import { sessionGetParent, sessionPatchField } from '../util/session-helpers.js';

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

  it('preEval preserves a session-patched value across the clone boundary without mutating the canonical child parent', async () => {
    const shared = any('bar');
    const source = expr(shared);
    const rule = expr(any('foo'));
    context.session = new EvalSession({ resetEvalState: true });

    sessionPatchField(rule, 'value', shared, context);
    const preEvald = await rule.preEval(context);

    expect(preEvald).not.toBe(rule);
    expect((preEvald as typeof rule).value).toBe(shared);
    expect(`${preEvald}`).toBe('$(bar)');
    expect(rule.value).not.toBe(shared);
    expect(shared.parent).toBe(source);
    expect(sessionGetParent(shared, context)).toBe(preEvald);
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
