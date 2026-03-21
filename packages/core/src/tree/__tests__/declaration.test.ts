import { decl, spaced, color, any } from '..';
import { Context } from '../../context.js';
import { EvalSession } from '../../eval-session.js';
import { AssignmentType } from '../declaration.js';

let context: Context;
describe('Declaration', () => {
  beforeEach(() => {
    context = new Context();
  });
  it('should serialize to CSS', () => {
    let rule = decl({ name: 'color', value: color('#eee') });
    expect(`${rule}`).toBe('color: #eee');
  });

  it('preEval normalizes assignment options in a non-reset session without overwriting canonical options', async () => {
    const rule = decl(
      { name: 'color', value: any('red') },
      { assign: AssignmentType.Add }
    );
    context.session = new EvalSession();

    const preEvald = await rule.preEval(context);

    expect(preEvald.toTrimmedString({ context })).toContain('color:');
    expect(preEvald.toTrimmedString({ context })).not.toContain('+:');
    expect(rule.toTrimmedString()).toContain('+:');
    expect(rule.options?.assign).toBe(AssignmentType.Add);
    expect(rule.options?.normalizedFromAssign).toBeUndefined();
  });
  // it('should serialize to a module', () => {
  //   let rule = decl({ name: expr([any('color')]), value: spaced([any('#eee')]) })
  //   rule.toModule(context, out)
  //   expect(out.toString()).toBe(
  //     '$J.decl({\n  name: $J.expr([$J.any("color")]),\n  value: $J.spaced([$J.any("#eee")])\n})'
  //   )
  // })
});
