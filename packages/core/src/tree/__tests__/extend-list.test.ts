import { Context } from '../../context.js';
import { ExtendList } from '../extend-list.js';
import { Extend, ExtendFlag } from '../extend.js';
import { BasicSelector } from '../selector-basic.js';

describe('ExtendList', () => {
  it('renders a cloned extend array without mutating the canonical list', () => {
    const context = new Context();
    const node = new ExtendList([
      new Extend({
        target: new BasicSelector('.base'),
        flag: ExtendFlag.Exact
      })
    ]);
    const clonedNode = node.clone(true);
    const patchedValue = [
      new Extend({
        target: new BasicSelector('.patched')
      })
    ];

    for (const child of patchedValue) {
      clonedNode.adopt(child, context);
    }
    (clonedNode as unknown as { value: Extend[] }).value = patchedValue;

    expect(clonedNode.toTrimmedString({ context })).toBe('$extend .patched;;');
    expect(node.toTrimmedString()).toBe('$extend .base !exact;;');
    expect(node.get('value')[0]?.get('target').valueOf()).toBe('.base');
  });
});
