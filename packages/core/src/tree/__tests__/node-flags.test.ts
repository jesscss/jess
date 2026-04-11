import {
  F_STATIC,
  F_NON_STATIC,
  F_MAY_ASYNC,
  any,
  dimension,
  num,
  color,
  bool,
  comment,
  co,
  nil,
  list,
  paren,
  expr,
  seq,
  ref,
  interpolated,
  call,
  op,
  decl,
  quoted,
  url,
  block
} from '../index.js';

describe('Node Flags', () => {
  describe('leaf node flag assignment', () => {
    it('Any should be F_STATIC', () => {
      const node = any('hello');
      expect(node.hasFlag(F_STATIC)).toBe(true);
      expect(node.hasFlag(F_NON_STATIC)).toBe(false);
      expect(node.hasFlag(F_MAY_ASYNC)).toBe(false);
    });

    it('Dimension should be F_STATIC', () => {
      const node = dimension([10, 'px']);
      expect(node.hasFlag(F_STATIC)).toBe(true);
      expect(node.hasFlag(F_NON_STATIC)).toBe(false);
      expect(node.hasFlag(F_MAY_ASYNC)).toBe(false);
    });

    it('Num should be F_STATIC', () => {
      const node = num(42);
      expect(node.hasFlag(F_STATIC)).toBe(true);
      expect(node.hasFlag(F_NON_STATIC)).toBe(false);
    });

    it('Color should be F_STATIC', () => {
      const node = color([255, 0, 0, 1]);
      expect(node.hasFlag(F_STATIC)).toBe(true);
      expect(node.hasFlag(F_NON_STATIC)).toBe(false);
      expect(node.hasFlag(F_MAY_ASYNC)).toBe(false);
    });

    it('Bool should be F_STATIC', () => {
      const node = bool(true);
      expect(node.hasFlag(F_STATIC)).toBe(true);
      expect(node.hasFlag(F_NON_STATIC)).toBe(false);
    });

    it('Comment should be F_STATIC', () => {
      const node = comment('/* test */');
      expect(node.hasFlag(F_STATIC)).toBe(true);
      expect(node.hasFlag(F_NON_STATIC)).toBe(false);
    });

    it('Combinator should be F_STATIC', () => {
      const node = co('>');
      expect(node.hasFlag(F_STATIC)).toBe(true);
      expect(node.hasFlag(F_NON_STATIC)).toBe(false);
    });

    it('Nil should be F_STATIC (invisible but static)', () => {
      const node = nil();
      expect(node.hasFlag(F_STATIC)).toBe(true);
      expect(node.hasFlag(F_NON_STATIC)).toBe(false);
    });
  });

  describe('non-static node flag assignment', () => {
    it('Reference should be F_NON_STATIC and F_MAY_ASYNC', () => {
      const node = ref({ key: any('color') });
      expect(node.hasFlag(F_NON_STATIC)).toBe(true);
      expect(node.hasFlag(F_MAY_ASYNC)).toBe(true);
      expect(node.hasFlag(F_STATIC)).toBe(false);
    });

    it('Interpolated should be F_NON_STATIC and F_MAY_ASYNC', () => {
      const node = interpolated({
        source: 'hello%%',
        replacements: [ref({ key: any('name') })]
      });
      expect(node.hasFlag(F_NON_STATIC)).toBe(true);
      expect(node.hasFlag(F_MAY_ASYNC)).toBe(true);
      expect(node.hasFlag(F_STATIC)).toBe(false);
    });

    it('Operation should be F_NON_STATIC', () => {
      const node = op([dimension([10, 'px']), '+', dimension([5, 'px'])]);
      expect(node.hasFlag(F_NON_STATIC)).toBe(true);
      expect(node.hasFlag(F_STATIC)).toBe(false);
    });

    it('Call should be F_NON_STATIC and F_MAY_ASYNC', () => {
      const node = call({ name: 'rgb', args: list([num(255), num(0), num(0)]) });
      expect(node.hasFlag(F_NON_STATIC)).toBe(true);
      expect(node.hasFlag(F_MAY_ASYNC)).toBe(true);
      expect(node.hasFlag(F_STATIC)).toBe(false);
    });
  });

  describe('flag bubbling via adopt()', () => {
    it('container with all-static children should get F_STATIC', () => {
      const items = [any('hello'), any('world')];
      const node = list(items);
      expect(node.hasFlag(F_STATIC)).toBe(true);
      expect(node.hasFlag(F_NON_STATIC)).toBe(false);
      expect(node.hasFlag(F_MAY_ASYNC)).toBe(false);
    });

    it('container with one non-static child should get F_NON_STATIC', () => {
      const items = [any('hello'), ref({ key: any('name') })];
      const node = list(items as any);
      expect(node.hasFlag(F_NON_STATIC)).toBe(true);
      expect(node.hasFlag(F_STATIC)).toBe(false);
    });

    it('container with one async child should get F_MAY_ASYNC', () => {
      const items = [any('hello'), ref({ key: any('name') })];
      const node = list(items as any);
      expect(node.hasFlag(F_MAY_ASYNC)).toBe(true);
    });

    it('F_NON_STATIC takes precedence over F_STATIC', () => {
      const items = [any('static-child'), ref({ key: any('dynamic') })];
      const node = list(items as any);
      expect(node.hasFlag(F_NON_STATIC)).toBe(true);
      expect(node.hasFlag(F_STATIC)).toBe(false);
    });

    it('nested static containers should bubble F_STATIC up', () => {
      const inner = list([any('a'), any('b')]);
      const outer = paren(inner);
      expect(inner.hasFlag(F_STATIC)).toBe(true);
      expect(outer.hasFlag(F_STATIC)).toBe(true);
      expect(outer.hasFlag(F_NON_STATIC)).toBe(false);
    });

    it('nested non-static containers should bubble F_NON_STATIC up', () => {
      const inner = list([any('a'), ref({ key: any('x') })] as any);
      const outer = paren(inner);
      expect(outer.hasFlag(F_NON_STATIC)).toBe(true);
      expect(outer.hasFlag(F_STATIC)).toBe(false);
    });

    it('F_MAY_ASYNC should bubble through multiple levels', () => {
      const r = ref({ key: any('x') });
      const inner = list([r] as any);
      const outer = paren(inner);
      expect(outer.hasFlag(F_MAY_ASYNC)).toBe(true);
    });

    it('expression is always F_NON_STATIC (needs unwrapping)', () => {
      const node = expr(any('hello'));
      expect(node.hasFlag(F_NON_STATIC)).toBe(true);
      expect(node.hasFlag(F_STATIC)).toBe(false);
    });

    it('sequence with all static children should be F_STATIC', () => {
      const node = seq([any('a'), any('b')]);
      expect(node.hasFlag(F_STATIC)).toBe(true);
    });

    it('Declaration with expr value gets F_NON_STATIC from Expression', () => {
      const d = decl({
        name: any('color', { role: 'property' }),
        value: expr(any('red'))
      });
      expect(d.hasFlag(F_NON_STATIC)).toBe(true);
      expect(d.hasFlag(F_STATIC)).toBe(false);
      expect(d.hasFlag(F_MAY_ASYNC)).toBe(false);
    });

    it('Declaration with direct static value (no expr) should be F_STATIC', () => {
      const d = decl({
        name: any('color', { role: 'property' }),
        value: any('red')
      });
      expect(d.hasFlag(F_STATIC)).toBe(true);
      expect(d.hasFlag(F_NON_STATIC)).toBe(false);
    });

    it('Declaration with interpolated name should be F_NON_STATIC', () => {
      const d = decl({
        name: interpolated({
          source: 'col%%',
          replacements: [ref({ key: any('suffix') })]
        }),
        value: expr(any('red'))
      });
      expect(d.hasFlag(F_NON_STATIC)).toBe(true);
      expect(d.hasFlag(F_MAY_ASYNC)).toBe(true);
    });

    it('Declaration with non-static value should be F_NON_STATIC', () => {
      const d = decl({
        name: any('color', { role: 'property' }),
        value: expr(ref({ key: any('main-color') }))
      });
      expect(d.hasFlag(F_NON_STATIC)).toBe(true);
      expect(d.hasFlag(F_MAY_ASYNC)).toBe(true);
    });
  });

  describe('flag exclusivity', () => {
    it('addFlag(F_STATIC) is a no-op when F_NON_STATIC is set', () => {
      const node = any('test');
      node.addFlag(F_NON_STATIC);
      node.addFlag(F_STATIC);
      expect(node.hasFlag(F_NON_STATIC)).toBe(true);
      expect(node.hasFlag(F_STATIC)).toBe(false);
    });

    it('addFlag(F_NON_STATIC) removes F_STATIC', () => {
      const node = any('test');
      expect(node.hasFlag(F_STATIC)).toBe(true);
      node.addFlag(F_NON_STATIC);
      expect(node.hasFlag(F_NON_STATIC)).toBe(true);
      expect(node.hasFlag(F_STATIC)).toBe(false);
    });
  });

  describe('Quoted flag behavior', () => {
    it('Quoted with string value should be F_STATIC', () => {
      const node = quoted('"hello world"');
      expect(node.hasFlag(F_STATIC)).toBe(true);
      expect(node.hasFlag(F_NON_STATIC)).toBe(false);
    });

    it('Quoted with interpolation should be F_NON_STATIC', () => {
      const interp = interpolated({
        source: 'hello%%',
        replacements: [ref({ key: any('name') })]
      });
      const node = quoted(interp);
      expect(node.hasFlag(F_NON_STATIC)).toBe(true);
      expect(node.hasFlag(F_MAY_ASYNC)).toBe(true);
    });
  });

  describe('Url flag behavior', () => {
    it('Url with static quoted path should be F_STATIC', () => {
      const node = url(quoted('"image.png"'));
      expect(node.hasFlag(F_STATIC)).toBe(true);
    });

    it('Url with static Any path should be F_STATIC', () => {
      const node = url(any('image.png'));
      expect(node.hasFlag(F_STATIC)).toBe(true);
    });
  });

  describe('Block flag behavior', () => {
    it('Block with static child should be F_STATIC', () => {
      const node = block(any('test'));
      expect(node.hasFlag(F_STATIC)).toBe(true);
    });

    it('Block with non-static child should be F_NON_STATIC', () => {
      const node = block(ref({ key: any('x') }));
      expect(node.hasFlag(F_NON_STATIC)).toBe(true);
    });
  });

  describe('Paren flag behavior', () => {
    it('non-escaped Paren with static child inherits F_STATIC', () => {
      const node = paren(any('hello'));
      expect(node.hasFlag(F_STATIC)).toBe(true);
      expect(node.hasFlag(F_NON_STATIC)).toBe(false);
    });

    it('escaped Paren is always F_NON_STATIC', () => {
      const node = paren(any('hello'), { escaped: true });
      expect(node.hasFlag(F_NON_STATIC)).toBe(true);
      expect(node.hasFlag(F_STATIC)).toBe(false);
    });

    it('Paren with non-static child gets F_NON_STATIC', () => {
      const node = paren(ref({ key: any('x') }));
      expect(node.hasFlag(F_NON_STATIC)).toBe(true);
      expect(node.hasFlag(F_MAY_ASYNC)).toBe(true);
    });
  });

  describe('Quoted escaped flag behavior', () => {
    it('escaped Quoted with string value is F_NON_STATIC', () => {
      const node = quoted('2/1', { escaped: true });
      expect(node.hasFlag(F_NON_STATIC)).toBe(true);
      expect(node.hasFlag(F_STATIC)).toBe(false);
    });

    it('non-escaped Quoted with string value is F_STATIC', () => {
      const node = quoted('hello');
      expect(node.hasFlag(F_STATIC)).toBe(true);
      expect(node.hasFlag(F_NON_STATIC)).toBe(false);
    });
  });

  describe('Expression always non-static', () => {
    it('Expression wrapping static Any is still F_NON_STATIC', () => {
      const node = expr(any('hello'));
      expect(node.hasFlag(F_NON_STATIC)).toBe(true);
      expect(node.hasFlag(F_STATIC)).toBe(false);
    });

    it('Expression wrapping Dimension is F_NON_STATIC', () => {
      const node = expr(dimension({ number: 42, unit: 'px' }));
      expect(node.hasFlag(F_NON_STATIC)).toBe(true);
    });

    it('Expression wrapping Reference is F_NON_STATIC and F_MAY_ASYNC', () => {
      const node = expr(ref({ key: any('x') }));
      expect(node.hasFlag(F_NON_STATIC)).toBe(true);
      expect(node.hasFlag(F_MAY_ASYNC)).toBe(true);
    });
  });

  describe('composed containers', () => {
    it('list of static values is F_STATIC', () => {
      const node = list([any('a'), any('b'), dimension({ number: 1 })]);
      expect(node.hasFlag(F_STATIC)).toBe(true);
      expect(node.hasFlag(F_NON_STATIC)).toBe(false);
    });

    it('list with one non-static child gets F_NON_STATIC', () => {
      const node = list([any('a'), ref({ key: any('b') })]);
      expect(node.hasFlag(F_NON_STATIC)).toBe(true);
      expect(node.hasFlag(F_STATIC)).toBe(false);
    });

    it('sequence of static values is F_STATIC', () => {
      const node = seq([any('a'), any('b')]);
      expect(node.hasFlag(F_STATIC)).toBe(true);
    });

    it('sequence with expression child gets F_NON_STATIC', () => {
      const node = seq([any('a'), expr(any('b'))]);
      expect(node.hasFlag(F_NON_STATIC)).toBe(true);
      expect(node.hasFlag(F_STATIC)).toBe(false);
    });

    it('Declaration wrapping expr(ref()) gets F_NON_STATIC and F_MAY_ASYNC', () => {
      const d = decl({
        name: any('color', { role: 'property' }),
        value: expr(ref({ key: any('main-color') }))
      });
      expect(d.hasFlag(F_NON_STATIC)).toBe(true);
      expect(d.hasFlag(F_MAY_ASYNC)).toBe(true);
    });

    it('Declaration with static name and value (no expr wrapper) is F_STATIC', () => {
      const d = decl({
        name: any('color', { role: 'property' }),
        value: any('red')
      });
      expect(d.hasFlag(F_STATIC)).toBe(true);
    });

    it('nested lists: list(list(static)) is F_STATIC', () => {
      const inner = list([any('a'), any('b')]);
      const outer = list([inner, any('c')]);
      expect(outer.hasFlag(F_STATIC)).toBe(true);
    });

    it('nested lists: list(list(ref())) is F_NON_STATIC', () => {
      const inner = list([any('a'), ref({ key: any('x') })]);
      const outer = list([inner, any('c')]);
      expect(outer.hasFlag(F_NON_STATIC)).toBe(true);
      expect(outer.hasFlag(F_MAY_ASYNC)).toBe(true);
    });

    it('paren(expr(static)) is F_NON_STATIC because of Expression', () => {
      const node = paren(expr(any('foo')));
      expect(node.hasFlag(F_NON_STATIC)).toBe(true);
    });

    it('Combinator is always F_STATIC', () => {
      const node = co(' ');
      expect(node.hasFlag(F_STATIC)).toBe(true);
    });

    it('escaped paren wrapping escaped quoted is F_NON_STATIC', () => {
      const node = paren(quoted('2/1', { escaped: true }), { escaped: true });
      expect(node.hasFlag(F_NON_STATIC)).toBe(true);
    });

    it('F_VISIBLE is preserved when adding F_STATIC', () => {
      const node = any('hello');
      expect(node.hasFlag(F_STATIC)).toBe(true);
      expect(node.visible).toBe(true);
    });

    it('F_VISIBLE is preserved when adding F_NON_STATIC', () => {
      const node = expr(any('hello'));
      expect(node.hasFlag(F_NON_STATIC)).toBe(true);
      expect(node.visible).toBe(true);
    });
  });
});
