import { Context } from '../../context.js';
import { EvalSession } from '../../eval-session.js';
import { patchField } from '../util/session-helpers.js';
import { ExtendList } from '../extend-list.js';
import { Extend, ExtendFlag } from '../extend.js';
import { BasicSelector } from '../selector-basic.js';

describe('ExtendList', () => {
  it('renders a session-patched extend array without mutating the canonical list', () => {
    const context = new Context();
    context.session = new EvalSession();
    const node = new ExtendList([
      new Extend({
        target: new BasicSelector('.base'),
        flag: ExtendFlag.Exact
      })
    ]);

    patchField(node, 'value', [
      new Extend({
        target: new BasicSelector('.patched')
      })
    ], context);

    expect(node.toTrimmedString({ context })).toBe('$extend .patched;;');
    expect(node.toTrimmedString()).toBe('$extend .base !exact;;');
    expect(node.value[0]?.target.valueOf()).toBe('.base');
  });
});
