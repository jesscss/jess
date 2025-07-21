import { el, sel, sellist, compound, is, co, pseudo, attr, quoted } from '../../..';
import { extendSelector } from '../extend';

describe('Simplified Extend Test Cases', () => {
  describe('Basic full-match extensions', () => {
    it('should extend simple class selector', () => {
      // .btn -> .btn, extend with .primary -> .btn, .primary
      const selector = el('.btn');
      const target = el('.btn');
      const extendWith = el('.primary');

      const result = extendSelector(selector, target, extendWith, false);
      expect(result.valueOf()).toBe('.btn,.primary');
    });

    it('should extend within selector list', () => {
      // .btn, .link -> .btn, extend with .primary -> .btn, .link, .primary
      const selector = sellist([el('.btn'), el('.link')]);
      const target = el('.btn');
      const extendWith = el('.primary');

      const result = extendSelector(selector, target, extendWith, false);
      expect(result.valueOf()).toBe('.btn,.link,.primary');
    });

    it('should extend attribute selector', () => {
      // [type="button"] -> extend with .btn -> [type="button"], .btn
      const selector = compound([el('input'), attr({ name: 'type', op: '=', value: quoted('button') })]);
      const target = compound([el('input'), attr({ name: 'type', op: '=', value: quoted('button') })]);
      const extendWith = el('.btn');

      const result = extendSelector(selector, target, extendWith, false);
      expect(result.valueOf()).toBe('input[type="button"],.btn');
    });
  });

  describe('Basic partial-match extensions', () => {
    it('should extend partial match with :is()', () => {
      // .a > .b -> .b extend with .c -> .a > :is(.b, .c)
      const selector = sel([el('.a'), co('>'), el('.b')]);
      const target = el('.b');
      const extendWith = el('.c');

      const result = extendSelector(selector, target, extendWith, true);
      expect(result.valueOf()).toBe('.a>:is(.b,.c)');
    });

    it('should extend compound partial match', () => {
      // .a > .b.c -> .b extend with .d -> .a > :is(.b, .d).c
      const selector = sel([el('.a'), co('>'), compound([el('.b'), el('.c')])]);
      const target = el('.b');
      const extendWith = el('.d');

      const result = extendSelector(selector, target, extendWith, true);
      expect(result.valueOf()).toBe('.a>:is(.b,.d).c');
    });
  });

  describe('Modern CSS features', () => {
    it('should extend within :is() selector', () => {
      // :is(.a, .b) -> .a extend with .c -> :is(.a, .b, .c)
      const selector = is(sellist([el('.a'), el('.b')]));
      const target = el('.a');
      const extendWith = el('.c');

      const result = extendSelector(selector, target, extendWith, false);
      expect(result.valueOf()).toBe(':is(.a,.b,.c)');
    });

    it('should extend simple pseudo-class', () => {
      // .btn:hover -> .btn extend with .primary -> :is(.btn,.primary):hover
      const selector = compound([el('.btn'), pseudo({ name: ':hover' })]);
      const target = el('.btn');
      const extendWith = el('.primary');

      const result = extendSelector(selector, target, extendWith, false);
      expect(result.valueOf()).toBe(':is(.btn,.primary):hover');
    });

    it('should extend with multiple pseudo-classes', () => {
      // .btn:hover:focus -> .btn extend with .primary -> :is(.btn,.primary):hover:focus
      const selector = compound([
        el('.btn'),
        pseudo({ name: ':hover' }),
        pseudo({ name: ':focus' })
      ]);
      const target = el('.btn');
      const extendWith = el('.primary');

      const result = extendSelector(selector, target, extendWith, false);
      expect(result.valueOf()).toBe(':is(.btn,.primary):hover:focus');
    });

    it('should extend compound selector with attributes', () => {
      // input[type="text"].required -> input extend with .text-field -> :is(input,.text-field)[type="text"].required
      const selector = compound([
        el('input'),
        attr({ name: 'type', op: '=', value: quoted('text') }),
        el('.required')
      ]);
      const target = el('input');
      const extendWith = el('.text-field');

      const result = extendSelector(selector, target, extendWith, false);
      expect(result.valueOf()).toBe(':is(input,.text-field)[type="text"].required');
    });

    it('should extend across combinators correctly', () => {
      // .parent > .child -> .parent extend with .container -> :is(.parent,.container) > .child
      const selector = sel([el('.parent'), co('>'), el('.child')]);
      const target = el('.parent');
      const extendWith = el('.container');

      const result = extendSelector(selector, target, extendWith, true);
      expect(result.valueOf()).toBe(':is(.parent,.container)>.child');
    });
  });

  describe('Error conditions', () => {
    it('should throw when no match is found', () => {
      const selector = el('.a');
      const target = el('.b'); // No match
      const extendWith = el('.c');

      expect(() => {
        extendSelector(selector, target, extendWith, false);
      }).toThrow('No match found for target selector');
    });
  });
});
