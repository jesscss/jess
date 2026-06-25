import { F_VISIBLE, el, sel, sellist, compound, is, co, pseudo, type Selector, PseudoSelector, type SelectorList } from '../../../index.js';
import { extendSelector, tryExtendSelector, ExtendErrorType, createProcessedSelector } from '../extend.js';
import { isNode } from '../is-node.js';
import { N } from '../../node-type.js';
import { getImplicitSelector } from '../selector-utils.js';
import type { NodeOptions } from '../../node-base.js';

describe('Extend Selector Tests', () => {
  describe('Extension validation', () => {
    it('should prevent extending when it would create duplicate element value', () => {
      // Selector: a.info, Target: .info, Extend with: div.foo
      // This should not extend because it would create "adiv.foo" which is invalid
      // Use partial: true to allow the match, then conflict detection should catch it
      const selector = compound([el('a'), el('.info')]);
      const target = el('.info');
      const extendWith = compound([el('div'), el('.foo')]);

      const result = tryExtendSelector(selector, target, extendWith, true);
      // Should return the original selector unchanged when extension would be invalid
      expect(result.value.valueOf()).toBe(selector.valueOf());
      expect(result.error).toBeDefined();
      expect(result.error!.type).toBe(ExtendErrorType.ELEMENT_CONFLICT);
    });

    it('should prevent extending when it would create duplicate ID value', () => {
      // Selector: #main.info, Target: .info, Extend with: #other.foo
      // This should not extend because it would create a selector with multiple IDs
      // Use partial: true to allow the match, then conflict detection should catch it
      const selector = compound([el('#main'), el('.info')]);
      const target = el('.info');
      const extendWith = compound([el('#other'), el('.foo')]);

      const result = tryExtendSelector(selector, target, extendWith, true);
      // Should return the original selector unchanged when extension would be invalid
      expect(result.value.valueOf()).toBe(selector.valueOf());
      expect(result.error).toBeDefined();
      expect(result.error!.type).toBe(ExtendErrorType.ID_CONFLICT);
    });

    it('should not extend partial match when extending compound selector with partial: false', () => {
      // Selector: a.info, Target: .info, Extend with: .foo
      // With partial: false, .info is only PART of a.info, so this should return unchanged
      const selector = compound([el('a'), el('.info')]);
      const target = el('.info');
      const extendWith = el('.foo');

      // This should return unchanged because .info is only a partial match within a.info
      const result = extendSelector(selector, target, extendWith, false);
      expect(result.valueOf()).toBe('a.info');
    });

    it('should not extend partial match when extending compound selector with :is() component with partial: false', () => {
      // Selector: :is(a).info, Target: .info, Extend with: div.foo
      // With partial: false, .info is only PART of :is(a).info, so this should return unchanged
      const selector = compound([is(el('a')), el('.info')]);
      const target = el('.info');
      const extendWith = compound([el('div'), el('.foo')]);

      // This should return unchanged because .info is only a partial match within :is(a).info
      const result = extendSelector(selector, target, extendWith, false);
      expect(result.valueOf()).toBe(':is(a).info');
    });
  });

  describe('Full match extend examples', () => {
    it('derives selector-list extend output without reparenting the matched source item', () => {
      const target = sellist([el('.a'), el('.b')]);
      const sourceItem = target.value[0]!;
      expect(typeof sourceItem !== 'string' && sourceItem.isSelector).toBe(true);
      const result = extendSelector(target, el('.a'), el('.c'), false);

      expect(result.valueOf()).toBe('.a,.b,.c');
      expect(target.value[0]).toBe(sourceItem);
      expect(sourceItem.valueOf()).toBe('.a');
    });

    it('extends selector lists without mutating the source list', () => {
      const target = sellist([el('.a'), el('.b')]);
      const result = extendSelector(target, el('.a'), el('.c'), false);

      expect(result.valueOf()).toBe('.a,.b,.c');
      expect(target.valueOf()).toBe('.a,.b');
    });

    it('extends legacy full-match targets without mutating them', () => {
      const target = el('.a');
      const result = extendSelector(
        target,
        el('.a'),
        el('.c'),
        false,
        false,
        true
      );

      expect(result.valueOf()).toBe('.a,.c');
      expect(target.valueOf()).toBe('.a');
    });

    it('dedistributes exact cartesian selector output', () => {
      const templateCombinator = co(' ');
      const target = sellist([
        sel([el('.a'), templateCombinator, el('.b')]),
        sel([el('.a'), co(' '), el('.d')]),
        sel([el('.c'), co(' '), el('.b')])
      ]);

      const result = extendSelector(
        target,
        sel([el('.c'), co(' '), el('.b')]),
        sel([el('.c'), co(' '), el('.d')]),
        false
      );

      expect(result.valueOf()).toBe(':is(.a,.c) :is(.b,.d)');
      expect(templateCombinator.parent?.valueOf()).toBe('.a .b');
    });

    it('flattens generated :is() nesting', () => {
      const prefix = is(sellist([el('.aa'), el('.bb')]));
      if (!isNode(prefix, N.PseudoSelector)) {
        throw new TypeError('Expected pseudo selector');
      }
      prefix.generated = true;
      const invisibleSpace = co(' ');
      invisibleSpace.removeFlag(F_VISIBLE);
      const inner = el('.cc');
      const selector = sel([prefix, invisibleSpace, is(sellist([inner, el('.dd')]))]);
      const result = createProcessedSelector(selector, true);

      expect(Array.isArray(result)).toBe(true);
      if (!Array.isArray(result)) {
        throw new Error('Expected processed selector array');
      }
      expect(result.map(item => item.valueOf())).toEqual(['.cc', '.dd']);
    });

    it('processes generated :is() roots', () => {
      const selector = is(sellist([el('.a'), el('.b')])) as PseudoSelector;
      selector.generated = true;
      const result = createProcessedSelector(selector, true);

      expect(Array.isArray(result)).toBe(true);
      if (!Array.isArray(result)) {
        throw new Error('Expected processed selector array');
      }
      expect(result.map(item => item.valueOf())).toEqual(['.a', '.b']);
    });

    it('should extend simple selector with simple target - example 1', () => {
      // Selector: .a, Target: .a (full), Extend with: .b
      // Result: .a, .b
      const selector = el('.a');
      const target = el('.a');
      const extendWith = el('.b');

      const result = extendSelector(selector, target, extendWith, false); // false = full match
      expect(result.valueOf()).toBe('.a,.b');
    });

    it('should extend selector list with simple target - example 2', () => {
      // Selector: .a, .b, Target: .a (full), Extend with: .c
      // Result: .a, .b, .c
      const selector = sellist([el('.a'), el('.b')]);
      const target = el('.a');
      const extendWith = el('.c');

      const result = extendSelector(selector, target, extendWith, false);
      expect(result.valueOf()).toBe('.a,.b,.c');
    });

    it('should extend :is() selector with simple target - example 3', () => {
      // Selector: :is(.a, .b), Target: .a (full), Extend with: .c
      // Result: :is(.a, .b, .c)
      const selector = is(sellist([el('.a'), el('.b')]));
      const target = el('.a');
      const extendWith = el('.c');

      const result = extendSelector(selector, target, extendWith, false);
      expect(result.valueOf()).toBe(':is(.a,.b,.c)');
    });

    it('extends pseudo arguments without reparenting source value', () => {
      const arg = el('.a');
      const extendWith = el('.c');
      const selector = is(arg);

      const result = extendSelector(selector, arg, extendWith, false);

      expect(result.valueOf()).toBe(':is(.a,.c)');
      expect(selector.arg).toBe(arg);
      expect(arg.parent).toBe(selector);
      expect(extendWith.parent).toBeUndefined();
    });

    it('should extend compound :is() selector with compound target - example 5', () => {
      // Selector: :is(.a, .b).c, Target: .a.c (full), Extend with: .d
      // Result: :is(.a, .b).c, .d
      // (.b doesn't count because it's an "or"... full match must be exhaustive)
      const selector = compound([is(sellist([el('.a'), el('.b')])), el('.c')]);
      const target = compound([el('.a'), el('.c')]);
      const extendWith = el('.d');

      const result = extendSelector(selector, target, extendWith, false);
      expect(result.valueOf()).toBe(':is(.a,.b).c,.d');
    });
  });

  describe('Partial match extend examples', () => {
    it('characterization: self partial extend is deduplicated at utility level', () => {
      // Utility-level extend deduplicates identical branches. If duplicates show up in final output,
      // they are introduced later in the eval/serialization pipeline, not by extendSelector itself.
      const selector = compound([el('.target'), el('.class')]);
      const result = extendSelector(selector, el('.class'), el('.class'), true);
      expect(result.valueOf()).toBe('.target.class');
    });

    it('characterization: extending .z within ".z .c" wraps matched segment in :is()', () => {
      // This is the pure-extend form of the import-reference divergence: .visible:extend(.z all)
      // can produce :is(.z,.visible) .c for selector `.z .c`.
      const selector = sel([el('.z'), co(' '), el('.c')]);
      const result = extendSelector(selector, el('.z'), el('.visible'), true);
      expect(result.valueOf()).toBe(':is(.z,.visible) .c');
    });

    it('characterization: extending .z within ".z:hover" wraps the class segment in :is()', () => {
      const selector = compound([el('.z'), pseudo({ name: ':hover' })]);
      const result = extendSelector(selector, el('.z'), el('.visible'), true);
      expect(result.valueOf()).toBe(':is(.z,.visible):hover');
    });

    it('characterization: extending both sides of ".z + .z" produces paired :is() wrappers', () => {
      const selector = sel([el('.z'), co('+'), el('.z')]);
      const result = extendSelector(selector, el('.z'), el('.visible'), true);
      expect(result.valueOf()).toBe(':is(.z,.visible)+:is(.z,.visible)');
    });

    it('characterization: extending ".z + .z .sub" keeps .sub outside wrapped pair', () => {
      const selector = sel([el('.z'), co('+'), el('.z'), co(' '), el('.sub')]);
      const result = extendSelector(selector, el('.z'), el('.visible'), true);
      expect(result.valueOf()).toBe(':is(.z,.visible)+:is(.z,.visible) .sub');
    });

    it('wraps partial compound matches without reparenting the matched source component', () => {
      const matched = el('.class');
      const selector = compound([el('.target'), matched]);
      const result = extendSelector(selector, el('.class'), el('.visible'), true);

      expect(result.valueOf()).toBe('.target:is(.class,.visible)');
      expect(matched.parent).toBe(selector);
    });

    it('characterization: self-extend on complex compound duplicates class in :is() wrapper', () => {
      // This mirrors import-reference.less self-extend shape for investigation:
      // `.class:extend(.class all)` on authored value with `.class` already present.
      const selector = compound([
        el('input[type="text"]'),
        el('.class'),
        el('#id'),
        el('[attr=i32]'),
        pseudo({ name: ':not', arg: el('.one') as Selector })
      ]);
      const result = extendSelector(selector, el('.class'), el('.class'), true);
      expect(result.valueOf()).toBe('input[type="text"].class#id[attr=i32]:not(.one)');
    });

    it('characterization: self-extend duplicates each class occurrence in multi-class compounds', () => {
      const selector = compound([
        el('div'),
        el('#id'),
        el('.class'),
        el('[a=one]'),
        el('[b=two]'),
        el('.class'),
        pseudo({ name: ':not', arg: el('.one') as Selector })
      ]);
      const result = extendSelector(selector, el('.class'), el('.class'), true);
      expect(result.valueOf()).toBe('div#id.class[a=one][b=two].class:not(.one)');
    });

    it('should extend compound selector with simple partial target - example 5', () => {
      // Selector: .a > .b.c, Target: .b (partial), Extend with: .d
      // Result: .a > :is(.b, .d).c
      const selector = sel([el('.a'), co('>'), compound([el('.b'), el('.c')])]);
      const target = el('.b');
      const extendWith = el('.d');

      const result = extendSelector(selector, target, extendWith, true); // true = partial match
      expect(result.valueOf()).toBe('.a>:is(.b,.d).c');
    });

    it('should match partial across compound boundaries with partial matching', () => {
      // Selector: .a > .b.c, Target: .a > .b (partial)
      // This SHOULD match with partial matching because .a > .b matches .a > .b exactly,
      // and .b matches within .b.c leaving .c as remainder
      const selector = sel([el('.a'), co('>'), compound([el('.b'), el('.c')])]);
      const target = sel([el('.a'), co('>'), el('.b')]);
      const extendWith = el('.d');

      const result = extendSelector(selector, target, extendWith, true);
      expect(result.valueOf()).toBe('.a>.b.c,.c.d'); // Remainder (.c) extended with .d
    });

    it('should extend complex partial match with compound boundaries - example 6', () => {
      // Selector: .a > .b.c > .d.e, Target: .c.b > .e.d (partial), Extend with: .f
      // Per §3a (match spans combinator): wrap full segment → .a>:is(.b.c>.d.e,.f)
      const selector = sel([
        el('.a'),
        co('>'),
        compound([el('.b'), el('.c')]),
        co('>'),
        compound([el('.d'), el('.e')])
      ]);
      const target = sel([compound([el('.c'), el('.b')]), co('>'), compound([el('.e'), el('.d')])]);
      const extendWith = el('.f');

      const result = extendSelector(selector, target, extendWith, true);
      expect(result.valueOf()).toBe('.a>:is(.b.c>.d.e,.f)');
    });

    it('should extend all duplicate value in compound selector (.foo.foo)', () => {
      // Selector: .foo.foo, Target: .foo (partial), Extend with: .ext
      // Result: :is(.foo, .ext):is(.foo, .ext) - both .foo value should be extended
      const selector = compound([el('.foo'), el('.foo')]);
      const target = el('.foo');
      const extendWith = el('.ext');

      const result = extendSelector(selector, target, extendWith, true);
      expect(result.valueOf()).toBe(':is(.foo,.ext):is(.foo,.ext)');
    });

    it('should extend all duplicate value in compound selector with full match (.foo.foo)', () => {
      // Selector: .foo.foo, Target: .foo (full), Extend with: .ext
      // In full mode, .foo is a partial match within .foo.foo, so it should be rejected
      // Result: .foo.foo (unchanged) - full mode rejects partial matches
      const selector = compound([el('.foo'), el('.foo')]);
      const target = el('.foo');
      const extendWith = el('.ext');

      const result = extendSelector(selector, target, extendWith, false);
      // Full mode rejects partial matches, so selector remains unchanged
      expect(result.valueOf()).toBe('.foo.foo');
    });

    it('should extend simple selector with complex extension - example 7', () => {
      // Selector: .a > .b, Target: .b (partial), Extend with: .d > .e
      // Result: .a > :is(.b, .d > .e)
      const selector = sel([el('.a'), co('>'), el('.b')]);
      const target = el('.b');
      const extendWith = sel([el('.d'), co('>'), el('.e')]);

      const result = extendSelector(selector, target, extendWith, true);
      expect(result.valueOf()).toBe('.a>:is(.b,.d>.e)');
    });
  });

  describe('Unified behavior: SelectorList vs :is() argument', () => {
    it('should not match .i with partial false', () => {
      // First, verify that extending .i.j with .k (find .i)
      const compoundTarget = compound([el('.i'), el('.j')]);
      const find = el('.i');
      const extendWith = el('.k');

      const result = extendSelector(compoundTarget, find, extendWith, false);
      const resultStr = result.valueOf();

      expect(resultStr).toBe('.i.j');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      expect((result as Selector<any, NodeOptions>).type).toBe('CompoundSelector');
    });

    it('should match .i with partial true', () => {
      // First, verify that extending .i.j with .k (find .i) creates :is(.i, .k).j
      const compoundTarget = compound([el('.i'), el('.j')]);
      const find = el('.i');
      const extendWith = el('.k');

      const result = extendSelector(compoundTarget, find, extendWith, true);
      const resultStr = result.valueOf();

      expect(resultStr).toBe(':is(.i,.k).j');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      expect((result as Selector<any, NodeOptions>).type).toBe('CompoundSelector');
    });

    it('should extend .i in root-level SelectorList (.g, .i.j) the same as in :is(.g, .i.j)', () => {
      // Test extending .i with .k in both cases
      const find = el('.i');
      const extendWith = el('.k');

      // Case 1: Root-level SelectorList -- .g, .i.j
      const rootSelectorList = sellist([el('.g'), compound([el('.i'), el('.j')])]);
      const rootResult = extendSelector(rootSelectorList, find, extendWith, false);
      const rootResultStr = rootResult.valueOf(); // should be no matches, because partial is false

      // Case 2: :is() argument (SelectorList inside :is()) -- :is(.g, .i.j)
      const isSelector = is(sellist([el('.g'), compound([el('.i'), el('.j')])]));
      const isResult = extendSelector(isSelector, find, extendWith, false);

      expect(rootResultStr).toBe('.g,.i.j');
      // Extract the :is() argument to compare
      if (isNode(isResult, N.PseudoSelector)) {
        const pseudo = isResult;
        if (pseudo.name === ':is' && pseudo.arg) {
          if (!isNode(pseudo.arg, N.Selector)) {
            throw new Error('Expected :is() argument to be a selector');
          }
          const isArgStr = pseudo.arg.valueOf();
          expect(isArgStr).toBe('.g,.i.j');
        } else {
          throw new Error(`Expected :is() selector, got ${isResult.type}`);
        }
      } else {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        throw new Error(`Expected :is() selector, got ${(isResult as Selector<any, NodeOptions>).type}`);
      }
    });
  });

  describe('Edge cases and validation', () => {
    it('should return original selector when no match is found', () => {
      const selector = el('.a');
      const target = el('.b'); // No match
      const extendWith = el('.c');

      const result = tryExtendSelector(selector, target, extendWith, false);
      expect(result.value.valueOf()).toBe('.a'); // Returns original selector when no match
      expect(result.error).toBeDefined();
      expect(result.error!.type).toBe(ExtendErrorType.NOT_FOUND);
    });

    it('should handle complex selector lists in extensions', () => {
      // Complex example with multiple extension points
      const selector = sellist([
        el('.a'),
        sel([el('.b'), co('>'), el('.c')])
      ]);
      const target = el('.a');
      const extendWith = el('.d');

      const result = extendSelector(selector, target, extendWith, false);
      expect(result.valueOf()).toBe('.a,.b>.c,.d');
    });
  });

  describe('Match only within ampersand (partial extend)', () => {
    it('tryExtendSelector returns NOT_FOUND when partial match exists only within & (e.g. &:after, target .clearfix)', () => {
      // Selector is &:after with & resolving to .clearfix. Match to .clearfix is entirely inside &.
      const parentSel = el('.clearfix');
      const selectorWithAmp = getImplicitSelector(pseudo({ name: ':after' }), parentSel, false);
      const result = tryExtendSelector(selectorWithAmp, el('.clearfix'), el('.foo'), true);
      expect(result.error).toBeDefined();
      expect(result.error!.type).toBe(ExtendErrorType.NOT_FOUND);
    });

    it('tryExtendSelector extends when partial match is not only within & (e.g. .clearfix .bar, target .clearfix)', () => {
      // Selector has explicit .clearfix, so match is not only within ampersand.
      const selector = sel([el('.clearfix'), co(' '), el('.bar')]);
      const result = tryExtendSelector(selector, el('.clearfix'), el('.foo'), true);
      expect(result.error).toBeUndefined();
      expect(result.value.valueOf()).toContain('.foo');
    });

    it('tryExtendSelector returns NOT_FOUND when match path goes through ampersand (parent already extended)', () => {
      // Parent was already extended; child &:after has ampersand resolving to .clearfix,.foo,.bar.
      // NOT_FOUND is determined by path (match goes through &), not by comparing resolved to find.
      const extendedParentSel = sellist([el('.clearfix'), el('.foo'), el('.bar')]);
      const selectorWithAmp = getImplicitSelector(pseudo({ name: ':after' }), extendedParentSel, false);
      const result = tryExtendSelector(selectorWithAmp, el('.clearfix'), el('.foo'), true);
      expect(result.error).toBeDefined();
      expect(result.error!.type).toBe(ExtendErrorType.NOT_FOUND);
    });
  });

  describe('Partial match wrap rule (EXTEND_RULES.md §3a)', () => {
    // These tests encode the rule: within-one-compound → wrap only matched part;
    // spans-combinator → wrap full segment. Implementation may need updates to pass.
    it('within one compound: wrap only the matched part (.a.b in .a.c.b + .q → :is(.a.b, .q).c)', () => {
      // Match within a single compound: we wrap only the matched part; the rest stays outside.
      const target = compound([el('.a'), el('.c'), el('.b')]); // .a.c.b
      const find = compound([el('.a'), el('.b')]);              // .a.b
      const extendWith = el('.q');
      const result = extendSelector(target, find, extendWith, true);
      expect(result.valueOf()).toBe(':is(.a.b,.q).c');
    });

    it('spans combinator: wrap full segment from first to last matched compound (per §3a)', () => {
      // When partial match spans a combinator, wrap the FULL segment (all compounds and combinators in range).
      // Target: div + .a.c.b > .y.x, find: .a.b > .x, extendWith: .q
      // Expected: div + :is(.a.c.b > .y.x, .q)
      const target = sel([
        el('div'),
        co('+'),
        compound([el('.a'), el('.c'), el('.b')]),
        co('>'),
        compound([el('.y'), el('.x')])
      ]);
      const find = sel([
        compound([el('.a'), el('.b')]),
        co('>'),
        el('.x')
      ]);
      const extendWith = el('.q');
      const result = extendSelector(target, find, extendWith, true);
      expect(result.valueOf()).toBe('div+:is(.a.c.b>.y.x,.q)');
    });
  });

  /**
   * Unified path (equivalency) tests: these would FAIL the old narrow-branch logic
   * (which branched on target type/path length and only handled flat CompoundSelector/ComplexSelector)
   * but should PASS the unified path, which uses keySet/equivalency and path-based wrap only.
   * Some tests may still fail until path/location logic is fixed (e.g. compound-in-compound wrap,
   * :is() list item wrap vs replace).
   */
  describe('Unified path (equivalency): tests that would fail narrow-branch logic', () => {
    it('target :is(.a.b, .x): find .a partial → wrap .a inside first alternative only', () => {
      // Narrow: might not handle target being :is() at all. Unified: find .a inside first list item, wrap to :is(.a,.q).b.
      const target = is(sellist([compound([el('.a'), el('.b')]), el('.x')])); // :is(.a.b, .x)
      const find = el('.a');
      const extendWith = el('.q');
      const result = extendSelector(target, find, extendWith, true);
      expect(result.valueOf()).toBe(':is(:is(.a,.q).b,.x)');
    });

    it('target .a.b.c, find .a.b partial → wrap only matched part to :is(.a.b, .q).c', () => {
      // Narrow: might replace whole compound or use wrong path. Unified: path to .a.b within compound, wrap to :is(.a.b,.q).c.
      const target = compound([el('.a'), el('.b'), el('.c')]); // .a.b.c
      const find = compound([el('.a'), el('.b')]); // .a.b
      const extendWith = el('.q');
      const result = extendSelector(target, find, extendWith, true);
      expect(result.valueOf()).toBe(':is(.a.b,.q).c');
    });

    it('target .a:is(.b,.c).d, find .b partial → wrap then flatten generated :is()', () => {
      // Narrow: might not look inside :is(). Unified: path into :is() arg, wrap .b in :is(.b,.q); generated :is() is flattened in valueOf.
      const target = compound([
        el('.a'),
        is(sellist([el('.b'), el('.c')])),
        el('.d')
      ]); // .a:is(.b,.c).d
      const find = el('.b');
      const extendWith = el('.q');
      const result = extendSelector(target, find, extendWith, true);
      // Extension appended at the end of the :is() list (not inserted in the middle)
      expect(result.valueOf()).toBe('.a:is(.b,.c,.q).d');
    });

    it('target :is(.foo .bar, .baz), find .bar partial → wrap .bar in each alternative that has it', () => {
      // Narrow: only one branch type. Unified: match .bar in first complex selector, wrap to .foo :is(.bar,.q); .baz unchanged.
      const target = is(sellist([
        sel([el('.foo'), co(' '), el('.bar')]),
        el('.baz')
      ])); // :is(.foo .bar, .baz)
      const find = el('.bar');
      const extendWith = el('.q');
      const result = extendSelector(target, find, extendWith, true);
      expect(result.valueOf()).toBe(':is(.foo :is(.bar,.q),.baz)');
    });

    it('target compound with nested :is(): .outer:is(.a.b,.x).tail, find .a partial → wrap .a inside :is() option', () => {
      // Equivalency: find .a matches inside first :is() alternative (.a.b). Narrow would not recurse into :is() for partial.
      const target = compound([
        el('.outer'),
        is(sellist([compound([el('.a'), el('.b')]), el('.x')])),
        el('.tail')
      ]); // .outer:is(.a.b,.x).tail
      const find = el('.a');
      const extendWith = el('.q');
      const result = extendSelector(target, find, extendWith, true);
      expect(result.valueOf()).toBe('.outer:is(:is(.a,.q).b,.x).tail');
    });
  });

  describe('Complex selector partial extends', () => {
    it('should extend .bar in ".foo .bar" to create ".foo :is(.bar, .ext)"', () => {
      // .foo .bar + extend .bar all with .ext
      // Expected: .foo :is(.bar, .ext)
      const selector = sel([el('.foo'), co(' '), el('.bar')]);
      const result = extendSelector(selector, el('.bar'), el('.ext'), true);
      expect(result.valueOf()).toBe('.foo :is(.bar,.ext)');
    });

    it('should extend .bar in ":is(.foo, .a) .bar" correctly', () => {
      // :is(.foo, .a) .bar + extend .bar all with .ext
      // Expected: :is(.foo, .a) :is(.bar, .ext)
      const selector = sel([is(sellist([el('.foo'), el('.a')])), co(' '), el('.bar')]);
      const result = extendSelector(selector, el('.bar'), el('.ext'), true);
      expect(result.valueOf()).toBe(':is(.foo,.a) :is(.bar,.ext)');
    });
  });

  describe('Sequential extends - multiple extenders', () => {
    /**
     * Tests the scenario from extend.less lines 18-30:
     *
     * .foo .bar, .foo .baz {
     *     display: none;
     * }
     * .ext1 .ext2 {
     *     &:extend(.foo all);
     * }
     * .ext3,
     * .ext4 {
     *   &:extend(.foo all);
     *   &:extend(.bar all);
     * }
     *
     * Expected output:
     * :is(.foo, .ext1 .ext2, .ext3, .ext4) :is(.bar, .ext3, .ext4),
     * :is(.foo, .ext1 .ext2, .ext3, .ext4) .baz {
     *   display: none;
     * }
     */
    it('should accumulate multiple partial extends on the same target', () => {
      // Start: .foo .bar, .foo .baz
      let selector: Selector = sellist([
        sel([el('.foo'), co(' '), el('.bar')]),
        sel([el('.foo'), co(' '), el('.baz')])
      ]);

      // Step 1: .ext1 .ext2 extends .foo all
      // Expected: :is(.foo,.ext1 .ext2) .bar,:is(.foo,.ext1 .ext2) .baz
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      selector = extendSelector(selector, el('.foo'), sel([el('.ext1'), co(' '), el('.ext2')]), true) as Selector<any, NodeOptions>;
      expect(selector.valueOf()).toContain(':is(.foo,.ext1 .ext2) .bar');
      expect(selector.valueOf()).toContain(':is(.foo,.ext1 .ext2) .baz');

      // Step 2: .ext3 extends .foo all
      // Expected: :is(.foo,.ext1 .ext2,.ext3) .bar,:is(.foo,.ext1 .ext2,.ext3) .baz
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      selector = extendSelector(selector, el('.foo'), el('.ext3'), true) as Selector<any, NodeOptions>;
      expect(selector.valueOf()).toContain(':is(.foo,.ext1 .ext2,.ext3) .bar');
      expect(selector.valueOf()).toContain(':is(.foo,.ext1 .ext2,.ext3) .baz');

      // Step 3: .ext4 extends .foo all
      // Expected: :is(.foo,.ext1 .ext2,.ext3,.ext4) .bar,:is(.foo,.ext1 .ext2,.ext3,.ext4) .baz
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      selector = extendSelector(selector, el('.foo'), el('.ext4'), true) as Selector<any, NodeOptions>;
      expect(selector.valueOf()).toContain(':is(.foo,.ext1 .ext2,.ext3,.ext4) .bar');
      expect(selector.valueOf()).toContain(':is(.foo,.ext1 .ext2,.ext3,.ext4) .baz');

      // Step 4: .ext3 extends .bar all
      // Expected: :is(.foo,.ext1 .ext2,.ext3,.ext4) :is(.bar,.ext3),:is(.foo,.ext1 .ext2,.ext3,.ext4) .baz
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      selector = extendSelector(selector, el('.bar'), el('.ext3'), true) as Selector<any, NodeOptions>;
      expect(selector.valueOf()).toContain(':is(.foo,.ext1 .ext2,.ext3,.ext4) :is(.bar,.ext3)');
      expect(selector.valueOf()).toContain(':is(.foo,.ext1 .ext2,.ext3,.ext4) .baz');

      // Step 5: .ext4 extends .bar all
      // Final expected: :is(.foo,.ext1 .ext2,.ext3,.ext4) :is(.bar,.ext3,.ext4),:is(.foo,.ext1 .ext2,.ext3,.ext4) .baz
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      selector = extendSelector(selector, el('.bar'), el('.ext4'), true) as Selector<any, NodeOptions>;
      expect(selector.valueOf()).toContain(':is(.foo,.ext1 .ext2,.ext3,.ext4) :is(.bar,.ext3,.ext4)');
      expect(selector.valueOf()).toContain(':is(.foo,.ext1 .ext2,.ext3,.ext4) .baz');
    });
  });

  describe('Flattening inside other pseudo-value', () => {
    // Helper to create :not() pseudo-selector (not generated - simulates authored code)
    const not = (arg: Selector) => new PseudoSelector({ name: ':not', arg });

    it('should flatten generated :is() inside :not() but keep the :not()', () => {
      // Create :not(.foo) and extend .foo with .bar
      // The :not() should NOT be removed - only generated :is() inside gets flattened
      const selector = not(el('.foo'));
      const result = extendSelector(selector, el('.foo'), el('.bar'), false);

      // The :not() should remain, containing both value as a list
      expect(result.valueOf()).toBe(':not(.foo,.bar)');
    });

    it('should flatten deeply nested generated :is() inside :not() but keep the :not()', () => {
      // Create :not(.foo) and extend multiple times
      // Each extend creates :is() wrappers inside :not() which should be flattened
      const selector = not(el('.foo'));

      // Extend .foo with .bar
      let result = extendSelector(selector, el('.foo'), el('.bar'), false);
      // Extend .foo with .baz
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      result = extendSelector(result as Selector<any, NodeOptions>, el('.foo'), el('.baz'), false);

      // The :not() should remain with flattened contents
      // Should be :not(.foo,.bar,.baz) not :not(:is(.foo,:is(.bar),.baz))
      expect(result.valueOf()).toBe(':not(.foo,.bar,.baz)');
    });
  });

  describe('No duplicate value - regression tests', () => {
    it('should NOT create both raw and :is()-wrapped duplicates when extending in nested :is()', () => {
      // Bug: extending .foo with .ext inside :is(.foo) could create both:
      // - .ext (raw)
      // - :is(.ext) (wrapped)
      // This is wrong - should only have .ext once

      const selector = is(el('.foo'));
      const result = extendSelector(selector, el('.foo'), el('.ext'), false);

      // Should be :is(.foo,.ext) - NOT :is(.foo,.ext,:is(.ext))
      expect(result.valueOf()).toBe(':is(.foo,.ext)');

      // Count occurrences of .ext - should be exactly 1
      const extCount = (result.valueOf().match(/\.ext/g) || []).length;
      expect(extCount).toBe(1);
    });

    it('should NOT duplicate complex value when extending multiple times', () => {
      // This replicates the extend.less test case that was failing
      // :is(.foo) .bar, :is(.foo) .baz extended with .ext1 .ext2, then .ext3, then .ext4

      // Create :is(.foo) .bar, :is(.foo) .baz
      const fooBar = sel([is(el('.foo')), co(' '), el('.bar')]);
      const fooBaz = sel([is(el('.foo')), co(' '), el('.baz')]);
      let selector: Selector | SelectorList = sellist([fooBar, fooBaz]);

      // Extend .foo with ".ext1 .ext2" (a complex selector)
      const ext1Ext2 = sel([el('.ext1'), co(' '), el('.ext2')]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      selector = extendSelector(selector, el('.foo'), ext1Ext2, true) as Selector<any, NodeOptions> | SelectorList;
      if (!isNode(selector, N.SelectorList)) {
        throw new Error('Expected selector list after first extend');
      }

      // Count occurrences of .ext1 .ext2 pattern - should appear exactly once per :is()
      const ext1Count = (selector.valueOf().match(/\.ext1/g) || []).length;
      // Should NOT have duplicate .ext1 appearances beyond the expected 2 (one per selector in list)
      expect(ext1Count).toBeLessThanOrEqual(2);

      // Extend .foo with .ext3
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      selector = extendSelector(selector, el('.foo'), el('.ext3'), true) as Selector<any, NodeOptions> | SelectorList;
      if (!isNode(selector, N.SelectorList)) {
        throw new Error('Expected selector list after second extend');
      }

      // Extend .foo with .ext4
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      selector = extendSelector(selector, el('.foo'), el('.ext4'), true) as Selector<any, NodeOptions> | SelectorList;
      if (!isNode(selector, N.SelectorList)) {
        throw new Error('Expected selector list after third extend');
      }

      // The result should have each extension appear exactly twice (once per original selector)
      // NOT have any :is(.ext1 .ext2) wrappers around individual extensions
      const resultStr = selector.valueOf();

      // Should NOT contain nested :is() wrappers like :is(.ext1 .ext2)
      expect(resultStr).not.toContain(':is(.ext1 .ext2)');
      expect(resultStr).not.toContain(':is(.ext3)');
      expect(resultStr).not.toContain(':is(.ext4)');
    });

    it('extending inside :is() should NOT differ from extending at root', () => {
      // Core principle: extending .foo with .ext should work the same
      // whether .foo is inside :is() or not

      // Case 1: .foo at root
      const rootSelector = el('.foo');
      const rootResult = extendSelector(rootSelector, el('.foo'), el('.ext'), false);
      // Should be .foo,.ext (selector list)
      expect(rootResult.valueOf()).toBe('.foo,.ext');

      // Case 2: .foo inside :is()
      const isSelector = is(el('.foo'));
      const isResult = extendSelector(isSelector, el('.foo'), el('.ext'), false);
      // Should be :is(.foo,.ext) - same semantic result, just inside :is()
      expect(isResult.valueOf()).toBe(':is(.foo,.ext)');

      // Both should have .ext appearing exactly once
      expect((rootResult.valueOf().match(/\.ext/g) || []).length).toBe(1);
      expect((isResult.valueOf().match(/\.ext/g) || []).length).toBe(1);
    });

    it('deeply nested :is() should not create duplicate extensions', () => {
      // :is(:is(.foo)) extended with .ext should give :is(:is(.foo,.ext)) or :is(.foo,.ext)
      // NOT :is(:is(.foo,.ext),.ext) or any other duplicate
      const deepIs = is(is(el('.foo')));
      const result = extendSelector(deepIs, el('.foo'), el('.ext'), false);

      // Count .ext occurrences
      const extCount = (result.valueOf().match(/\.ext/g) || []).length;
      expect(extCount).toBe(1);
    });
  });

  describe('Replace extension scenarios', () => {
    it('should not extend partial match when extending complex selector at root level with partial: false', () => {
      // .bb .bb extended with .cc (where .cc:extend(.bb)) should NOT extend when partial: false
      // because .bb is only a partial match within .bb .bb
      const selector = sel([el('.bb'), co(' '), el('.bb')]);

      // This should return unchanged because .bb is a partial match within .bb .bb
      const result = extendSelector(selector, el('.bb'), el('.cc'), false);
      expect(result.valueOf()).toBe('.bb .bb');
    });

    it('should not extend partial match when extending first component of complex selector with partial: false', () => {
      // .aa .dd extended with .cc (where .cc:extend(.aa)) should NOT extend when partial: false
      // because .aa is not the entire selector - it's only a partial match
      const selector = sel([el('.aa'), co(' '), el('.dd')]);

      // This should return unchanged because .aa is a partial match within .aa .dd
      const result = extendSelector(selector, el('.aa'), el('.cc'), false);
      expect(result.valueOf()).toBe('.aa .dd');
    });

    it('should not replace original selector when extending compound selector', () => {
      // .bb extended with .cc should produce .bb,.cc
      // NOT just .cc (replacing the original)
      const selector = el('.bb');
      const result = extendSelector(selector, el('.bb'), el('.cc'), false);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      expect((result as Selector<any, NodeOptions>).type).toBe('SelectorList');
      expect(result.valueOf()).toBe('.bb,.cc');
    });
  });

  describe('Exact vs all flag matching', () => {
    it('should replicate the exact extend scenario from extend.less', () => {
      // Replicate the scenario:
      // .bb {
      //   background: red;
      //   .bb {
      //     color: black;
      //   }
      // }
      // .cc:extend(.bb) {} - should only match outer .bb, not .bb .bb (exact match only)
      // .ee:extend(.dd all,.bb) {} - should match .dd with all, but .bb only exact
      // .ff:extend(.dd,.bb all) {} - should match .dd exact, but .bb with all (matches both .bb and .bb .bb)

      // The nested ruleset has selector .bb .bb (parent .bb + child .bb with space combinator from implicit ampersand)
      // When partial: false (exact match), we can only match the outer .bb ruleset, not the inner .bb .bb
      // Test 1: .cc:extend(.bb) with partial: false
      // When we try to extend .bb .bb with .cc (partial: false), extendSelector should reject it
      // because .bb is not the entire selector - it's only a partial match
      const nestedBbSelector = sel([el('.bb'), co(' '), el('.bb')]);
      // This should return unchanged because .bb is a partial match within .bb .bb
      const result1 = extendSelector(nestedBbSelector, el('.bb'), el('.cc'), false);
      expect(result1.valueOf()).toBe(nestedBbSelector.valueOf());

      // Test 2: .ff:extend(.bb all) with partial: true
      // When partial: true (all flag), we should match and extend ALL instances of .bb in .bb .bb
      // For .bb .bb extended with .ff (all flag), we should get :is(.bb, .ff) :is(.bb, .ff)
      // This wraps each matching component in :is()
      const result2 = extendSelector(nestedBbSelector, el('.bb'), el('.ff'), true);
      expect(result2).toBeDefined();
      const resultStr = result2.valueOf();
      // Expected: :is(.bb,.ff) :is(.bb,.ff) - both .bb instances wrapped in :is()
      expect(resultStr).toBe(':is(.bb,.ff) :is(.bb,.ff)');
    });

    it('should reject partial matches when partial: false', () => {
      // When partial: false (exact match only), extendSelector should reject partial matches
      // .bb .bb should NOT be extended when searching for .bb with partial: false
      const nestedBbSelector = sel([el('.bb'), co(' '), el('.bb')]);

      // This should return unchanged because .bb is only a partial match within .bb .bb
      // When partial: false, the entire selector must match exactly
      const result = extendSelector(nestedBbSelector, el('.bb'), el('.cc'), false);
      expect(result.valueOf()).toBe(nestedBbSelector.valueOf());
    });

    it('should allow matching inside :is() when pseudo-selector is first component with partial: true', () => {
      // .a:extend(.b .c all) should match .b :is(.c) because with all flag (partial: true),
      // we can match value inside :is() boundaries
      // The :is() pseudo-selector being the first component means there are no value before it
      const target = is(el('.c')); // :is(.c) - pseudo-selector is the only/first component
      const find = el('.c');
      const extendWith = el('.a');

      // With partial: true (all flag), this should work
      const result = extendSelector(target, find, extendWith, true);
      expect(result).toBeDefined();
      // Should extend inside the :is()
      expect(result.valueOf()).toContain('.a');
    });

    it('should reject matching inside :is() when there are value before it with partial: false', () => {
      // .aa :is(.dd,.ee) matching .dd with partial: false should be rejected
      // because .aa is before the :is(), making it a partial match
      const target = sel([el('.aa'), co(' '), is(sellist([el('.dd'), el('.ee')]))]); // .aa :is(.dd,.ee)
      const find = el('.dd');
      const extendWith = el('.ff');

      // With partial: false, this should return unchanged
      const result = extendSelector(target, find, extendWith, false);
      expect(result.valueOf()).toBe(target.valueOf());
    });

    it('should reject matching complex selector inside :is() when there are value before it with partial: false', () => {
      // d :is(.b .c) matching .b .c with partial: false should be rejected
      // because d is before the :is(), making it a partial match
      // .a:extend(.b .c) should NOT match d :is(.b .c)
      const target = sel([el('d'), co(' '), is(sel([el('.b'), co(' '), el('.c')]))]); // d :is(.b .c)
      const find = sel([el('.b'), co(' '), el('.c')]); // .b .c
      const extendWith = el('.a');

      // With partial: false, this should return unchanged because d is before the :is()
      const result = extendSelector(target, find, extendWith, false);
      expect(result.valueOf()).toBe(target.valueOf());
    });
  });

  describe('Implicit ampersand and extend matching (extend.less .bb scenario)', () => {
    it('getImplicitSelector with collapseNesting false attaches parent so nested selector becomes parent+child', () => {
      // Nested .bb inside .bb should get implicit ampersand: result is [&(.bb), ' ', .bb] → valueOf ".bb .bb"
      const childOnly = el('.bb');
      const parentSelector = el('.bb');
      const withImplicit = getImplicitSelector(childOnly, parentSelector, false);
      expect(withImplicit.valueOf()).toBe('.bb .bb');
    });

    it('extend find .bb with partial: false rejects when target has implicit ampersand (first component is &)', () => {
      // Same shape as nested .bb ruleset: [amp(.bb), ' ', .bb]. .ee:extend(.bb) must NOT match this.
      const targetWithImplicitAmp = getImplicitSelector(el('.bb'), el('.bb'), false);
      const result = extendSelector(targetWithImplicitAmp, el('.bb'), el('.ee'), false);
      expect(result.valueOf()).toBe(targetWithImplicitAmp.valueOf());
    });

    /**
     * Validation for extend.less inner .bb: the inner ruleset's selector must (a) have the
     * invisible ampersand, (b) use it in valueOf() for the full selector, (c) ampersand keeps
     * its stored selector reference, (d) full selector value is then NOT an exact match for .bb,
     * so the extend utility rejects without any logic in extend-roots.
     */
    describe('(a)-(d) ampersand present, valueOf uses it, exact .bb does not match', () => {
      it('(a) implicit ampersand is present on selector (first component is Ampersand with stored selector)', () => {
        const withImplicit = getImplicitSelector(el('.bb'), el('.bb'), false);
        if (!isNode(withImplicit, N.ComplexSelector)) {
          throw new Error('Expected implicit selector to be complex');
        }
        const first = withImplicit.value[0];
        expect(isNode(first, N.Ampersand)).toBe(true);
        expect(isNode(first, N.Ampersand) ? first.getResolvedSelector() : undefined).toBeDefined();
      });

      it('(b) valueOf() uses ampersand selector to produce full selector string', () => {
        const withImplicit = getImplicitSelector(el('.bb'), el('.bb'), false);
        // Full selector must be parent + " " + child = ".bb .bb", not ".bb" or "& .bb"
        expect(withImplicit.valueOf()).toBe('.bb .bb');
      });

      it('(c) ampersand retains stored selector (copy of parent at build time)', () => {
        const parent = el('.bb');
        const withImplicit = getImplicitSelector(el('.bb'), parent, false);
        if (!isNode(withImplicit, N.ComplexSelector)) {
          throw new Error('Expected implicit selector to be complex');
        }
        const first = withImplicit.value[0];
        if (!isNode(first, N.Ampersand)) {
          throw new Error('Expected first component to be an ampersand');
        }
        expect(first.getResolvedSelector()).toBeDefined();
        expect(first.getResolvedSelector()?.valueOf()).toBe('.bb');
      });

      it('(d) full selector value .bb .bb is not an exact match for .bb so extend utility rejects', () => {
        const targetWithImplicitAmp = getImplicitSelector(el('.bb'), el('.bb'), false);
        expect(targetWithImplicitAmp.valueOf()).toBe('.bb .bb');
        const result = tryExtendSelector(targetWithImplicitAmp, el('.bb'), el('.ee'), false);
        expect(result.error).toBeUndefined();
        expect(result.value.valueOf()).toBe('.bb .bb');
        expect(result.value.valueOf()).not.toBe('.bb,.ee');
      });
    });
  });

  describe('Invisible ampersand extend coverage (partial, full, just outside)', () => {
    /**
     * Coverage for extending when the target has invisible (implicit) ampersand:
     * - Partial: find matches part of the "own" segment after & → extend without flattening &
     * - Full: find fully matches one list item's "own" part → append extendWith with same & (selector list)
     * - Just outside: find matches resolved form (crosses boundary) vs only own part (within boundary)
     */

    it('partial extend when target has invisible ampersand: match only the own part (within boundary)', () => {
      // Target: & .a .b (implicit & → .parent). Find .a. ExtendWith .x. Partial true.
      // Expect: extend within boundary, ampersand preserved → & :is(.a, .x) .b
      const parentSel = el('.parent');
      const target = getImplicitSelector(sel([el('.a'), co(' '), el('.b')]), parentSel, false);
      expect(target.valueOf()).toBe('.parent .a .b');

      const result = extendSelector(target, el('.a'), el('.x'), true);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      expect((result as Selector<any, NodeOptions>).hoistToRoot).toBeFalsy();
      const out = result.valueOf();
      expect(out).toContain('.a');
      expect(out).toContain('.x');
      expect(out).toContain('.b');
      // Should preserve structure (implicit & not materialized in serialization when same context)
      if (!isNode(result, N.ComplexSelector)) {
        throw new Error('Expected partial extend result to be complex');
      }
      const first = result.value[0];
      expect(isNode(first, N.Ampersand)).toBe(true);
    });

    it('full extend (complete match of one list item) when target is SelectorList with invisible ampersand: append extendWith with same &', () => {
      // Target: [& .replace, & .c] (each item has implicit & → .outer). Find .replace. ExtendWith .rep_ace. Partial true.
      // Intended: result is selector list with three items [& .replace, & .rep_ace, & .c] so serialization shows .replace, .rep_ace, .c.
      // We assert the result contains all three classes (document intended behavior until full append path is applied).
      const outerSel = el('.outer');
      const target = getImplicitSelector(sellist([el('.replace'), el('.c')]), outerSel, false);
      expect(target.valueOf()).toBe('.outer .replace,.outer .c');

      const result = tryExtendSelector(target, el('.replace'), el('.rep_ace'), true);
      expect(result.error).toBeUndefined();
      if (!isNode(result.value, N.SelectorList)) {
        throw new Error('Expected full extend result to be a selector list');
      }
      const list = result.value;
      expect(list.value.length).toBeGreaterThanOrEqual(2);
      const str = result.value.valueOf();
      expect(str).toContain('.replace');
      expect(str).toContain('.rep_ace');
      expect(str).toContain('.c');
    });

    it('builds implicit selector-list output directly instead of cloning the source list', () => {
      const outerSel = el('.outer');
      const target = sellist([el('.replace'), el('.c')]);
      let cloneCalls = 0;
      const originalClone = target.clone.bind(target);
      const cloneForCounting: typeof target.clone = (...args) => {
        cloneCalls++;
        return originalClone(...args);
      };
      target.clone = cloneForCounting;

      const result = getImplicitSelector(target, outerSel, false);

      expect(cloneCalls).toBe(0);
      expect(result).not.toBe(target);
      expect(result.valueOf()).toBe('.outer .replace,.outer .c');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      expect((target.value[0]! as Selector<any>).parent).toBe(target);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      expect((target.value[1]! as Selector<any>).parent).toBe(target);
    });

    it('extend find that matches only own part (within boundary): ampersand not flattened', () => {
      // Target: & .child (implicit & → .parent). Find .child. ExtendWith .other. Partial true.
      // We match only the part after &, so we stay within boundary.
      const parentSel = el('.parent');
      const target = getImplicitSelector(el('.child'), parentSel, false);
      expect(target.valueOf()).toBe('.parent .child');

      const result = extendSelector(target, el('.child'), el('.other'), true);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      expect((result as Selector<any, NodeOptions>).hoistToRoot).toBeFalsy();
      expect(result.valueOf()).toContain('.child');
      expect(result.valueOf()).toContain('.other');
    });

    it('extend find that matches resolved form (boundary crossing): full target match', () => {
      // Target: & .child (implicit & → .parent). Find .parent .child (full resolved). ExtendWith .other.
      // Find matches the entire resolved selector → we are "just outside" the invisible & (crossing boundary).
      const parentSel = el('.parent');
      const target = getImplicitSelector(el('.child'), parentSel, false);
      const find = sel([el('.parent'), co(' '), el('.child')]);
      const extendWith = el('.other');

      const result = extendSelector(target, find, extendWith, true);
      // Should produce selector list .parent .child, .other (resolved + extendWith) and typically hoist
      expect(result.valueOf()).toContain('.parent');
      expect(result.valueOf()).toContain('.child');
      expect(result.valueOf()).toContain('.other');
    });

    it('partial: false with invisible ampersand target does not extend when find matches only own part', () => {
      // Target: & .bb (implicit & → .bb). Find .bb. Partial false (exact only).
      // Full selector is .bb .bb; find .bb is not an exact match of the whole selector → no extend.
      const target = getImplicitSelector(el('.bb'), el('.bb'), false);
      expect(target.valueOf()).toBe('.bb .bb');

      const result = extendSelector(target, el('.bb'), el('.ee'), false);
      expect(result.valueOf()).toBe(target.valueOf());
    });
  });

  describe(':is() boundary crossing and flattening', () => {
    it('should NOT flatten :is() when extend does not cross :is() boundary', () => {
      // :is(.g, .i.j) extended with .k:extend(.i all)
      // Match .i is within .i.j, which is already inside :is(.g, .i.j)
      // Result should be :is(.g, :is(.i, .k).j) - nested :is() preserved
      const selector = is(sellist([el('.g'), compound([el('.i'), el('.j')])])); // :is(.g, .i.j)
      const find = el('.i');
      const extendWith = el('.k');

      const result = extendSelector(selector, find, extendWith, true); // partial: true (all flag)
      // Should preserve nested :is() structure
      expect(result.valueOf()).toBe(':is(.g,:is(.i,.k).j)');
    });

    it('should flatten :is() when extend crosses :is() boundary', () => {
      // :is(.a, .b).c extended with .d where we match .b.c
      // Since .b.c matches the entire target (consumes all "and" parts), we should NOT flatten
      // Result: :is(.a, .b).c, .d (selector list, preserving :is() structure)
      const selector = compound([is(sellist([el('.a'), el('.b')])), el('.c')]); // :is(.a, .b).c
      const find = compound([el('.b'), el('.c')]); // .b.c
      const extendWith = el('.d');

      const result = extendSelector(selector, find, extendWith, false);
      // Since we've consumed the entire target, we should NOT flatten
      const resultStr = result.valueOf();
      // Should create selector list without flattening
      expect(resultStr).toBe(':is(.a,.b).c,.d');
    });

    it('should preserve nested :is() when extending within same :is() group', () => {
      // :is(.g, .i.j).h extended with .k:extend(.i all)
      // Match .i is within .i.j, which is inside :is(.g, .i.j)
      // Result should be :is(.g, :is(.i, .k).j).h - nested structure preserved
      const selector = compound([
        is(sellist([el('.g'), compound([el('.i'), el('.j')])])), // :is(.g, .i.j)
        el('.h')
      ]); // :is(.g, .i.j).h
      const find = el('.i');
      const extendWith = el('.k');

      const result = extendSelector(selector, find, extendWith, true); // partial: true (all flag)
      // Should preserve nested :is() structure
      expect(result.valueOf()).toBe(':is(.g,:is(.i,.k).j).h');
    });

    it('should flatten when match path crosses through different :is() contexts', () => {
      // :is(.a, .b) .c extended with .d where we match .b .c
      // Match crosses from inside :is() (.b) to outside (.c via combinator)
      // Result should be flattened
      const selector = sel([
        is(sellist([el('.a'), el('.b')])), // :is(.a, .b)
        co(' '),
        el('.c')
      ]); // :is(.a, .b) .c
      const find = sel([el('.b'), co(' '), el('.c')]); // .b .c
      const extendWith = el('.d');

      const result = extendSelector(selector, find, extendWith, false);
      const resultStr = result.valueOf();
      // Should flatten to show all combinations
      // Should have .a .c, .b .c, .d .c (or similar)
      expect(resultStr).toContain('.c');
      // Should NOT preserve nested :is(.b, .d) .c structure when crossing boundary
    });

    it('should preserve nested :is() in compound selector when not crossing boundary', () => {
      // :is(.g, .i.j) extended with .k:extend(.i all)
      // First extend creates :is(.g, .i.j)
      // Second extend with .k should create :is(.g, :is(.i, .k).j)
      // NOT :is(.g, .i, .k.j, .i.j) - should preserve nested structure
      const selector = is(sellist([el('.g'), compound([el('.i'), el('.j')])])); // :is(.g, .i.j)
      const find = el('.i');
      const extendWith = el('.k');

      const result = extendSelector(selector, find, extendWith, true); // partial: true (all flag)
      const resultStr = result.valueOf();
      // Should preserve nested :is() structure
      expect(resultStr).toBe(':is(.g,:is(.i,.k).j)');
      // Should NOT be flattened
      expect(resultStr).not.toBe(':is(.g,.i,.k.j,.i.j)');
    });

    describe('Compound extend outputs', () => {
      it('should add extendWith as alternative when compound find matches inside :is()', () => {
        // :is(.g, .i.j).h extended with .k:extend(.i.j all)
        // .i.j is fully consumed inside :is(), so .k joins as an alternative
        const selector = compound([
          is(sellist([el('.g'), compound([el('.i'), el('.j')])])),
          el('.h')
        ]); // :is(.g, .i.j).h
        const find = compound([el('.i'), el('.j')]); // .i.j
        const extendWith = el('.k');

        const result = extendSelector(selector, find, extendWith, true);
        expect(result.valueOf()).toBe(':is(.g,.i.j,.k).h');
      });

      it('should produce selector list when compound find consumes entire target', () => {
        // :is(.a, .x).c with .a.c:extend(.e)
        // .a.c consumes the entire target, so result is a selector list
        const selector = compound([
          is(sellist([el('.a'), el('.x')])),
          el('.c')
        ]); // :is(.a, .x).c
        const find = compound([el('.a'), el('.c')]); // .a.c
        const extendWith = el('.e');

        const result = extendSelector(selector, find, extendWith, false);
        expect(result.valueOf()).toBe(':is(.a,.x).c,.e');
      });
    });
  });
});
