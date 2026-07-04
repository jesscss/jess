import { Parser } from '../src/index.js';
import { Ampersand, Context, serializeTypes, TreeContext, N, isNode, type Node, type Selector } from '@jesscss/core';

const parser = new Parser();
const isAmpersand = (node: unknown): node is Ampersand => node instanceof Ampersand;

function rulesetSelector(n: Node | string | undefined): Selector {
  if (!isNode(n, N.Ruleset)) {
    throw new Error('Expected a ruleset');
  }
  const { selector } = n;
  if (!isNode(selector, N.Selector)) {
    throw new Error('Expected a selector node');
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return selector as unknown as Selector;
}

// collapseNesting is a render-time option that the Context constructor's public
// option type does not declare, although the runtime accepts it.
function contextOptions(opts: Record<string, unknown>): ConstructorParameters<typeof Context>[0] {
  return opts as ConstructorParameters<typeof Context>[0];
}

describe('Selector Productions', () => {
  describe('relativeSelector', () => {
    it('should parse selector with combinator prefix', () => {
      const { errors, tree } = parser.parse('.parent { > .child { color: red; } }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('(ComplexSelector');
    });

    it('should parse relative selector with > combinator', () => {
      const { errors, tree } = parser.parse('.parent { > .child { color: red; } }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('(ComplexSelector');
    });

    it('should parse relative selector with + combinator', () => {
      const { errors, tree } = parser.parse('.parent { + .sibling { color: red; } }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('(ComplexSelector');
    });

    it('should parse relative selector with ~ combinator', () => {
      const { errors, tree } = parser.parse('.parent { ~ .sibling { color: red; } }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('(ComplexSelector');
    });
  });

  describe('compoundSelector', () => {
    it('should parse compound selector (multiple simple selectors)', () => {
      const { errors, tree } = parser.parse('.foo.bar { color: red; }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('(CompoundSelector');
    });

    it('should parse compound selector with id and class', () => {
      const { errors, tree } = parser.parse('#id.class { color: red; }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('(CompoundSelector');
    });

    it('should parse host pseudo arguments as compound selectors', () => {
      const { errors, tree } = parser.parse(':host(.sel.a), :host-context(.sel.b) { color: red; }');
      expect(errors.length).toBe(0);

      const out = serializeTypes(tree);
      expect(out).toContainString(`
        (PseudoSelector
          name: ':host'
          arg:
            (CompoundSelector
              value:
                [
                  '.sel'
                  '.a'
                ]
            )
        )
      `);
      expect(out).toContainString(`
        (PseudoSelector
          name: ':host-context'
          arg:
            (CompoundSelector
              value:
                [
                  '.sel'
                  '.b'
                ]
            )
        )
      `);
    });

    it('should serialize unknown pseudo arguments from generic sequence nodes', () => {
      const { errors, tree, trivia } = parser.parse(':unknown(.sel.a) { color: red; }');
      expect(errors.length).toBe(0);
      const ruleset = tree.rules[0];
      const selector = rulesetSelector(ruleset);

      expect(selector.toString({ trivia })).toBe(':unknown(.sel.a)');
      expect(serializeTypes(selector)).toContainString(`
        (PseudoSelector
          name: ':unknown'
          arg:
            [
              (Keyword [role=keyword] '.sel')
              (Keyword [role=keyword] '.a')
            ]
        )
      `);
    });

    it.skip('should preserve trivia spacing in unknown pseudo arguments', () => {
      const cases = [
        [':unknown(.sel.a) { color: red; }', ':unknown(.sel.a)'],
        [':unknown(.sel .a) { color: red; }', ':unknown(.sel .a)'],
        [':unknown(.sel/*comment */.a) { color: red; }', ':unknown(.sel/*comment */.a)'],
        [':unknown(.sel /*comment */.a) { color: red; }', ':unknown(.sel /*comment */.a)'],
        [':unknown(.sel/*comment */ .a) { color: red; }', ':unknown(.sel/*comment */ .a)'],
        [':unknown(.sel /*comment */ .a) { color: red; }', ':unknown(.sel /*comment */ .a)']
      ] as const;

      for (const [source, expected] of cases) {
        const { errors, tree, trivia } = parser.parse(source);
        expect(errors.length).toBe(0);
        const ruleset = tree.rules[0];
        expect(rulesetSelector(ruleset).toString({ trivia })).toBe(expected);
      }
    });

    it('should preserve trivia spacing in host pseudo selector arguments', () => {
      const cases = [
        [':host(.sel.a) { color: red; }', ':host(.sel.a)', '(CompoundSelector'],
        [':host(.sel .a) { color: red; }', ':host(.sel .a)', '(ComplexSelector'],
        [':host(.sel/*comment */.a) { color: red; }', ':host(.sel/*comment */.a)', '(CompoundSelector'],
        [':host(.sel /*comment */.a) { color: red; }', ':host(.sel /*comment */.a)', '(ComplexSelector'],
        [':host(.sel/*comment */ .a) { color: red; }', ':host(.sel/*comment */ .a)', '(ComplexSelector'],
        [':host(.sel /*comment */ .a) { color: red; }', ':host(.sel /*comment */ .a)', '(ComplexSelector']
      ] as const;

      for (const [source, expected, shape] of cases) {
        const { errors, tree, trivia } = parser.parse(source);
        expect(errors.length).toBe(0);
        const ruleset = tree.rules[0];
        const selector = rulesetSelector(ruleset);
        expect(selector.toString({ trivia })).toBe(expected);
        expect(serializeTypes(selector)).toContainString(shape);
      }
    });

    it('should parse single simple selector (not compound)', () => {
      const { errors, tree } = parser.parse('.foo { color: red; }');
      expect(errors.length).toBe(0);
      // Single simple selector is a bare string, not a CompoundSelector
      expect(serializeTypes(tree)).toContainString('selector: \'.foo\'');
    });
  });

  describe('complexSelector', () => {
    it('should parse complex selector with descendant combinator', () => {
      const { errors, tree } = parser.parse('.parent .child { color: red; }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('(ComplexSelector');
    });

    it('preserves comments around descendant combinator whitespace', () => {
      const cases = [
        ['.parent /* before-space */.child { color: red; }', '.parent /* before-space */.child'],
        ['.parent/* after-comment */ .child { color: red; }', '.parent/* after-comment */ .child']
      ] as const;

      for (const [source, expected] of cases) {
        const { errors, tree, trivia } = parser.parse(source);
        expect(errors.length).toBe(0);
        const ruleset = tree.rules[0];
        expect(rulesetSelector(ruleset).toString({ trivia })).toBe(expected);
        expect(serializeTypes(rulesetSelector(ruleset))).toContainString('(ComplexSelector');
      }
    });

    it('should parse complex selector with child combinator', () => {
      const { errors, tree } = parser.parse('.parent > .child { color: red; }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('(ComplexSelector');
    });

    it('should parse complex selector with element names and child combinator', () => {
      const { errors, tree } = parser.parse('header > h1 { color: red; }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('(ComplexSelector');
    });

    it('should parse complex selector with adjacent sibling combinator', () => {
      const { errors, tree } = parser.parse('.first + .second { color: red; }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('(ComplexSelector');
    });

    it('should parse complex selector with general sibling combinator', () => {
      const { errors, tree } = parser.parse('.first ~ .second { color: red; }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('(ComplexSelector');
    });

    it('should parse complex selector with extend', () => {
      const { errors, tree } = parser.parse('.extended:extend(.base) { color: red; }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('(Extend');
    });

    it('should parse complex selector with extend all', () => {
      const { errors, tree } = parser.parse('.extended:extend(.base all) { color: red; }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('(Extend');
    });
  });

  describe('selectorList', () => {
    it('should parse selector list with comma-separated selectors', () => {
      // Test with class selectors first to verify selector list parsing works
      const { errors, tree } = parser.parse('.top, .bottom { color: red; }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('[\'.top\', \'.bottom\']');
    });

    it('should parse selector list with element names and complex selector', () => {
      const { errors, tree } = parser.parse('.top, header > h1 { color: red; }');
      expect(errors.length).toBe(0);
      const serialized = serializeTypes(tree);
      expect(serialized).toContainString('\'.top\'');
      expect(serialized).toContainString('header');
    });
  });

  describe('simpleSelector', () => {
    it('should parse class selector', () => {
      const { errors, tree } = parser.parse('.class { color: red; }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('\'.class\'');
    });

    it('should parse id selector', () => {
      const { errors, tree } = parser.parse('#id { color: red; }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('\'#id\'');
    });

    it('should parse universal selector', () => {
      const { errors, tree } = parser.parse('* { color: red; }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('\'*\'');
    });

    it('should parse ampersand selector', () => {
      const { errors, tree } = parser.parse('& { color: red; }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('(Ampersand');
    });

    it('should parse ampersand with suffix', () => {
      const { errors, tree } = parser.parse('&-suffix { color: red; }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('(Ampersand');
    });

    it('should parse ampersand merge template from class suffix form', () => {
      const { errors, tree } = parser.parse('.parent { .foo-& { color: red; } }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('(Ampersand');
    });

    it('should parse ampersand merge template with explicit insertion point', () => {
      const { errors, tree } = parser.parse('.parent { &(.foo-&) { color: red; } }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('(Ampersand');
    });

    it('keeps parsed ampersand prefix templates on the current parser-to-core semantics', async () => {
      const { errors, tree } = parser.parse('.parent { .foo-& { color: red; } }');
      const context = new Context(contextOptions({ collapseNesting: true }));

      expect(errors.length).toBe(0);
      const css = await tree.render(context, { context, collapseNesting: true });

      expect(css).toBeString(`
        .parent {
          color: red;
        }
      `);
    });

    it('keeps parsed ampersand mid-template forms on the current parser-to-core semantics', async () => {
      const { errors, tree } = parser.parse('.parent { &(.foo-&-bar) { color: red; } }');
      const context = new Context(contextOptions({ collapseNesting: true }));

      expect(errors.length).toBe(0);
      const css = await tree.render(context, { context, collapseNesting: true });

      expect(css).toBeString(`
        .parent {
          color: red;
        }
      `);
    });

    it.skip('should parse empty quoted ampersand template as an explicit empty parent template', () => {
      const { errors, tree } = parser.parse('.parent { &(\"\").utility { color: red; } }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('(Ampersand');
      const amp = [...tree.nodes(true)].find(isAmpersand);
      expect(amp).toBeDefined();
      expect(amp?.appendValue).toBe('');
    });

    it.skip('should parse &(nil) as an explicit nil parent template', () => {
      const { errors, tree } = parser.parse('.parent { &(nil).utility { color: red; } }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('(Ampersand');
      const amp = [...tree.nodes(true)].find(isAmpersand);
      expect(amp).toBeDefined();
      expect(amp?.appendValue).toBe('');
    });

    it('should parse pseudo selector', () => {
      // Pseudo selectors need an element or be nested
      const { errors, tree } = parser.parse('.test:hover { color: red; }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('\'.test\'');
    });

    it('should parse attribute selector', () => {
      // Attribute selectors need an element or be nested
      const { errors, tree } = parser.parse('.test[attr] { color: red; }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('\'.test\'');
    });

    it('should parse interpolated selector', () => {
      const { errors, tree } = parser.parse('.@{var} { color: red; }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('(InterpolatedSelector');
    });

    it('should parse dimension in selector (for keyframes)', () => {
      const { errors, tree } = parser.parse('@keyframes test { 0% { color: red; } }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContain('selector: \'0%\'');
    });
  });

  describe('extend', () => {
    it('should parse :extend() with single target', () => {
      const { errors, tree } = parser.parse('.extended:extend(.base) { color: red; }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('(Extend');
    });

    it('should parse :extend() with multiple targets', () => {
      const { errors, tree } = parser.parse('.extended:extend(.base, .other) { color: red; }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('(Extend');
    });

    it('should parse :extend() with all flag', () => {
      const { errors, tree } = parser.parse('.extended:extend(.base all) { color: red; }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('(Extend');
    });

    it('should parse nested extend', () => {
      const { errors, tree } = parser.parse(`
        .amp-test-a,
        .amp-test-b {
          .amp-test-c &.amp-test-d&.amp-test-e {
            .amp-test-f&+&.amp-test-g:extend(.amp-test-h) {}
          }
        }
      `);
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('(Extend');
    });

    it('should parse compound selectors that glue a class onto an ampersand before :extend()', () => {
      const { errors, tree } = parser.parse(`
        .first-level {
          .second-level {
            .active&:extend(.extend-this) { }
            &.active2:extend(.extend-this) { }
          }
        }
      `);
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('(Extend');
    });

    it.skip('should not parse extend within a psuedo selector', () => {
      const { errors } = parser.parse(`
        .test:is(.a:extend(.b)) {}
      `);
      expect(errors.length).toBe(1);
    });
  });

  describe('ampersandExtend', () => {
    it('should parse &:extend() statement', () => {
      const { errors, tree } = parser.parse('.parent { &:extend(.base); }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('(Extend');
    });

    it('should parse &:extend() with all flag', () => {
      const { errors, tree } = parser.parse('.parent { &:extend(.base all); }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('(Extend');
    });

    it('should parse &:extend() with multiple targets', () => {
      const { errors, tree } = parser.parse('.parent { &:extend(.base, .other); }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('(Extend');
    });

    it('allows selector lists when each extend target is allowed', () => {
      const context = new TreeContext({ allowExtendSelectors: ['simple'] });
      const localParser = new Parser();
      // @ts-expect-error -- the bound parse() collapses its overloads, hiding the third (context) argument the 'stylesheet' rule accepts at runtime.
      const { errors, tree } = localParser.parse('.parent { &:extend(.base, .other); }', 'Stylesheet', { context });

      expect(errors).toHaveLength(0);
      expect(serializeTypes(tree)).toContainString('(Extend');
    });
  });
});
