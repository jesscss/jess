import { Context } from '../../context.js';
import { setField } from '../util/field-helpers.js';
import { ExtendList } from '../extend-list.js';
import { Extend, ExtendFlag } from '../extend.js';
import { BasicSelector } from '../selector-basic.js';

describe('ExtendList', () => {
  it('renders a state-patched extend array without mutating the canonical list', () => {
    const context = new Context();
    const node = new ExtendList([
      new Extend({
        target: new BasicSelector('.base'),
        flag: ExtendFlag.Exact
      })
    ]);

    setField(node, 'value', [
      new Extend({
        target: new BasicSelector('.patched')
      })
    ], context);

    expect(node.toTrimmedString({ context })).toBe('$extend .patched;;');
    expect(node.toTrimmedString()).toBe('$extend .base !exact;;');
    expect(node.get('value')[0]?.get('target').valueOf()).toBe('.base');
  });
});
