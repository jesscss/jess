/**
 * COPY of the pure `extendSelector` cases from extend-selector-algorithm.test.ts, driven
 * through the OWN-CONSTRUCTION engine via `extendViaOwn`. (Cases that exercise helper
 * functions — tryExtendSelector, createProcessedSelector, findChainedExtends — are not
 * copied; they are not the extendSelector output contract.)
 *
 * Byte oracle = the original `.toBe(...)` expectations; the harness additionally asserts the
 * own engine is byte-identical where it can build, and records UNSUPPORTED otherwise.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { el, sel, sellist, compound, is, co, pseudo, type Selector } from '../../../index.js';
import { extendViaOwn, reportFrontier, resetFrontier } from './corpus-harness.js';

function not(arg: Selector): Selector {
  return pseudo({ name: ':not', arg });
}

describe('CORPUS (own engine): Extend Selector Algorithm', () => {
  resetFrontier();
  afterAll(() => reportFrontier('algorithm-cases'));

  describe('Validation / partial-compound-in-full', () => {
    it('a.info find .info full → unchanged', () => {
      const r = extendViaOwn(compound([el('a'), el('.info')]), el('.info'), el('.foo'), false, 'a.info find .info full');
      expect(r.valueOf()).toBe('a.info');
    });
    it(':is(a).info find .info full → unchanged (constructor atom target)', () => {
      const r = extendViaOwn(compound([is(el('a')), el('.info')]), el('.info'), compound([el('div'), el('.foo')]), false, ':is(a).info find .info full');
      expect(r.valueOf()).toBe(':is(a).info');
    });
  });

  describe('Full match', () => {
    it('.a,.b find .a full → .a,.b,.c', () => {
      const r = extendViaOwn(sellist([el('.a'), el('.b')]), el('.a'), el('.c'), false, '.a,.b find .a full');
      expect(r.valueOf()).toBe('.a,.b,.c');
    });
    it('.a find .a full → .a,.b', () => {
      const r = extendViaOwn(el('.a'), el('.a'), el('.b'), false, '.a find .a full');
      expect(r.valueOf()).toBe('.a,.b');
    });
    it(':is(.a,.b) find .a full → :is(.a,.b,.c)', () => {
      const r = extendViaOwn(is(sellist([el('.a'), el('.b')])), el('.a'), el('.c'), false, ':is(.a,.b) find .a full');
      expect(r.valueOf()).toBe(':is(.a,.b,.c)');
    });
    it(':is(.a,.b).c find .a.c full → :is(.a,.b).c,.d', () => {
      const r = extendViaOwn(compound([is(sellist([el('.a'), el('.b')])), el('.c')]), compound([el('.a'), el('.c')]), el('.d'), false, ':is(.a,.b).c find .a.c full');
      expect(r.valueOf()).toBe(':is(.a,.b).c,.d');
    });
    it('.a,(.b>.c) find .a full → .a,.b>.c,.d', () => {
      const r = extendViaOwn(sellist([el('.a'), sel([el('.b'), co('>'), el('.c')])]), el('.a'), el('.d'), false, 'list-with-complex find .a full');
      expect(r.valueOf()).toBe('.a,.b>.c,.d');
    });
  });

  describe('Partial match', () => {
    it('.target.class self-extend partial → .target.class', () => {
      const r = extendViaOwn(compound([el('.target'), el('.class')]), el('.class'), el('.class'), true, '.target.class self-extend');
      expect(r.valueOf()).toBe('.target.class');
    });
    it('.z .c find .z partial → :is(.z,.visible) .c', () => {
      const r = extendViaOwn(sel([el('.z'), co(' '), el('.c')]), el('.z'), el('.visible'), true, '.z .c find .z partial');
      expect(r.valueOf()).toBe(':is(.z,.visible) .c');
    });
    it('.z:hover find .z partial → :is(.z,.visible):hover', () => {
      const r = extendViaOwn(compound([el('.z'), pseudo({ name: ':hover' })]), el('.z'), el('.visible'), true, '.z:hover find .z partial');
      expect(r.valueOf()).toBe(':is(.z,.visible):hover');
    });
    it('.z + .z find .z partial → paired :is()', () => {
      const r = extendViaOwn(sel([el('.z'), co('+'), el('.z')]), el('.z'), el('.visible'), true, '.z + .z find .z partial');
      expect(r.valueOf()).toBe(':is(.z,.visible)+:is(.z,.visible)');
    });
    it('.z + .z .sub find .z partial → paired :is() keeps .sub', () => {
      const r = extendViaOwn(sel([el('.z'), co('+'), el('.z'), co(' '), el('.sub')]), el('.z'), el('.visible'), true, '.z + .z .sub find .z partial');
      expect(r.valueOf()).toBe(':is(.z,.visible)+:is(.z,.visible) .sub');
    });
    it('.target.class find .class partial → .target:is(.class,.visible)', () => {
      const r = extendViaOwn(compound([el('.target'), el('.class')]), el('.class'), el('.visible'), true, '.target.class find .class partial');
      expect(r.valueOf()).toBe('.target:is(.class,.visible)');
    });
    it('.a>.b.c find .b partial → .a>:is(.b,.d).c', () => {
      const r = extendViaOwn(sel([el('.a'), co('>'), compound([el('.b'), el('.c')])]), el('.b'), el('.d'), true, '.a>.b.c find .b partial');
      expect(r.valueOf()).toBe('.a>:is(.b,.d).c');
    });
    it('.a>.b.c find .a>.b partial → remainder .a>.b.c,.c.d', () => {
      const r = extendViaOwn(sel([el('.a'), co('>'), compound([el('.b'), el('.c')])]), sel([el('.a'), co('>'), el('.b')]), el('.d'), true, '.a>.b.c find .a>.b partial (remainder)');
      expect(r.valueOf()).toBe('.a>.b.c,.c.d');
    });
    it('.a>.b.c>.d.e find .c.b>.e.d partial → .a>:is(.b.c>.d.e,.f)', () => {
      const r = extendViaOwn(
        sel([el('.a'), co('>'), compound([el('.b'), el('.c')]), co('>'), compound([el('.d'), el('.e')])]),
        sel([compound([el('.c'), el('.b')]), co('>'), compound([el('.e'), el('.d')])]),
        el('.f'), true, 'span-wrap 2-compound reordered'
      );
      expect(r.valueOf()).toBe('.a>:is(.b.c>.d.e,.f)');
    });
    it('.foo.foo find .foo partial → :is(.foo,.ext):is(.foo,.ext)', () => {
      const r = extendViaOwn(compound([el('.foo'), el('.foo')]), el('.foo'), el('.ext'), true, '.foo.foo find .foo partial');
      expect(r.valueOf()).toBe(':is(.foo,.ext):is(.foo,.ext)');
    });
    it('.foo.foo find .foo full → unchanged', () => {
      const r = extendViaOwn(compound([el('.foo'), el('.foo')]), el('.foo'), el('.ext'), false, '.foo.foo find .foo full');
      expect(r.valueOf()).toBe('.foo.foo');
    });
    it('.a>.b find .b partial extend .d>.e → .a>:is(.b,.d>.e)', () => {
      const r = extendViaOwn(sel([el('.a'), co('>'), el('.b')]), el('.b'), sel([el('.d'), co('>'), el('.e')]), true, '.a>.b find .b partial extend .d>.e');
      expect(r.valueOf()).toBe('.a>:is(.b,.d>.e)');
    });
  });

  describe('Compound / list distinctions', () => {
    it('.i.j find .i full → .i.j', () => {
      const r = extendViaOwn(compound([el('.i'), el('.j')]), el('.i'), el('.k'), false, '.i.j find .i full');
      expect(r.valueOf()).toBe('.i.j');
    });
    it('.i.j find .i partial → :is(.i,.k).j', () => {
      const r = extendViaOwn(compound([el('.i'), el('.j')]), el('.i'), el('.k'), true, '.i.j find .i partial');
      expect(r.valueOf()).toBe(':is(.i,.k).j');
    });
    it('.g,.i.j find .i full → unchanged .g,.i.j', () => {
      const r = extendViaOwn(sellist([el('.g'), compound([el('.i'), el('.j')])]), el('.i'), el('.k'), false, '.g,.i.j find .i full');
      expect(r.valueOf()).toBe('.g,.i.j');
    });
  });

  describe('§3a wrap rule', () => {
    it('.a.c.b find .a.b partial (non-contiguous) → :is(.a.b,.q).c', () => {
      const r = extendViaOwn(compound([el('.a'), el('.c'), el('.b')]), compound([el('.a'), el('.b')]), el('.q'), true, '.a.c.b find .a.b non-contiguous');
      expect(r.valueOf()).toBe(':is(.a.b,.q).c');
    });
    it('div+.a.c.b>.y.x find .a.b>.x partial → remainder-in-compound span', () => {
      const r = extendViaOwn(
        sel([el('div'), co('+'), compound([el('.a'), el('.c'), el('.b')]), co('>'), compound([el('.y'), el('.x')])]),
        sel([compound([el('.a'), el('.b')]), co('>'), el('.x')]),
        el('.q'), true, 'div+.a.c.b>.y.x find .a.b>.x'
      );
      expect(r.valueOf()).toBe('div+:is(.a.c.b>.y.x,.q)');
    });
    it('.a.b.c find .a.b partial → :is(.a.b,.q).c', () => {
      const r = extendViaOwn(compound([el('.a'), el('.b'), el('.c')]), compound([el('.a'), el('.b')]), el('.q'), true, '.a.b.c find .a.b partial');
      expect(r.valueOf()).toBe(':is(.a.b,.q).c');
    });
  });

  describe(':is()/:not() target grafts', () => {
    it(':is(.a.b,.x) find .a partial → :is(:is(.a,.q).b,.x)', () => {
      const r = extendViaOwn(is(sellist([compound([el('.a'), el('.b')]), el('.x')])), el('.a'), el('.q'), true, ':is(.a.b,.x) find .a partial');
      expect(r.valueOf()).toBe(':is(:is(.a,.q).b,.x)');
    });
    it(':is(.foo .bar,.baz) find .bar partial → :is(.foo :is(.bar,.q),.baz)', () => {
      const r = extendViaOwn(is(sellist([sel([el('.foo'), co(' '), el('.bar')]), el('.baz')])), el('.bar'), el('.q'), true, ':is(.foo .bar,.baz) find .bar partial');
      expect(r.valueOf()).toBe(':is(.foo :is(.bar,.q),.baz)');
    });
    it(':not(.foo) find .foo full → :not(.foo,.bar)', () => {
      const r = extendViaOwn(not(el('.foo')), el('.foo'), el('.bar'), false, ':not(.foo) find .foo full');
      expect(r.valueOf()).toBe(':not(.foo,.bar)');
    });
    it(':is(.foo) find .foo full → :is(.foo,.ext)', () => {
      const r = extendViaOwn(is(el('.foo')), el('.foo'), el('.ext'), false, ':is(.foo) find .foo full');
      expect(r.valueOf()).toBe(':is(.foo,.ext)');
    });
  });

  describe('Complex partial with :is() head', () => {
    it('.foo .bar find .bar partial → .foo :is(.bar,.ext)', () => {
      const r = extendViaOwn(sel([el('.foo'), co(' '), el('.bar')]), el('.bar'), el('.ext'), true, '.foo .bar find .bar partial');
      expect(r.valueOf()).toBe('.foo :is(.bar,.ext)');
    });
    it(':is(.foo,.a) .bar find .bar partial → :is(.foo,.a) :is(.bar,.ext)', () => {
      const r = extendViaOwn(sel([is(sellist([el('.foo'), el('.a')])), co(' '), el('.bar')]), el('.bar'), el('.ext'), true, ':is(.foo,.a) .bar find .bar partial');
      expect(r.valueOf()).toBe(':is(.foo,.a) :is(.bar,.ext)');
    });
  });

  describe('Root-level partial:false rejection', () => {
    it('.bb .bb find .bb full → unchanged', () => {
      const r = extendViaOwn(sel([el('.bb'), co(' '), el('.bb')]), el('.bb'), el('.cc'), false, '.bb .bb find .bb full');
      expect(r.valueOf()).toBe('.bb .bb');
    });
    it('.aa .dd find .aa full → unchanged', () => {
      const r = extendViaOwn(sel([el('.aa'), co(' '), el('.dd')]), el('.aa'), el('.cc'), false, '.aa .dd find .aa full');
      expect(r.valueOf()).toBe('.aa .dd');
    });
    it('.bb find .bb full → .bb,.cc', () => {
      const r = extendViaOwn(el('.bb'), el('.bb'), el('.cc'), false, '.bb find .bb full');
      expect(r.valueOf()).toBe('.bb,.cc');
    });
  });
});
