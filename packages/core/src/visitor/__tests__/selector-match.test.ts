import { el, compound, sel } from '../../tree';
import { findNeedleInHaystack, SelectorMatchVisitor } from '../selector-match';
import { Context } from '../../context';

let context: Context;

describe('Selector match visitor', () => {
  beforeEach(() => {
    context = new Context();
  });

  it('iterates through matchable components', () => {
    let visitor = new SelectorMatchVisitor();
    // let rule = el('.foo')
    // visitor.start(rule)
    // let result = visitor.components().next()
    // // console.log(result.value)
    // expect(result.value?.valueOf()).toBe('.foo')

    let a = el('a');
    let id = el('#id');
    let one = el('.one');
    let two = el('.two');

    let sel1 = compound([
      a,
      id,
      one,
      two
    ]);

    visitor.start(sel1);
    /** @note - visitor iterates in reverse */
    let co = visitor.components();
    let result = co.next();
    expect(result.value?.valueOf()).toBe('.two');
    result = co.next();
    expect(result.value?.valueOf()).toBe('.one');
    result = co.next();
    expect(result.value?.valueOf()).toBe('#id');
    result = co.next();
    expect(result.value?.valueOf()).toBe('a');
  });
});