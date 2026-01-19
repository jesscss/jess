import { Parser } from '../src/index.js';
import { serializeTypes } from '@jesscss/core';

const parser = new Parser();

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

    it('should parse single simple selector (not compound)', () => {
      const { errors, tree } = parser.parse('.foo { color: red; }');
      expect(errors.length).toBe(0);
      // Single simple selector should not create CompoundSelector
      expect(serializeTypes(tree)).toContainString('(BasicSelector');
    });
  });

  describe('complexSelector', () => {
    it('should parse complex selector with descendant combinator', () => {
      const { errors, tree } = parser.parse('.parent .child { color: red; }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('(ComplexSelector');
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
      expect(serializeTypes(tree)).toContainString('(SelectorList');
    });

    it('should parse selector list with element names and complex selector', () => {
      const { errors, tree } = parser.parse('.top, header > h1 { color: red; }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('(SelectorList');
    });
  });

  describe('simpleSelector', () => {
    it('should parse class selector', () => {
      const { errors, tree } = parser.parse('.class { color: red; }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('(BasicSelector');
    });

    it('should parse id selector', () => {
      const { errors, tree } = parser.parse('#id { color: red; }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('(BasicSelector');
    });

    it('should parse universal selector', () => {
      const { errors, tree } = parser.parse('* { color: red; }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('(BasicSelector');
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

    it('should parse pseudo selector', () => {
      // Pseudo selectors need an element or be nested
      const { errors, tree } = parser.parse('.test:hover { color: red; }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('(BasicSelector');
    });

    it('should parse attribute selector', () => {
      // Attribute selectors need an element or be nested
      const { errors, tree } = parser.parse('.test[attr] { color: red; }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('(BasicSelector');
    });

    it('should parse interpolated selector', () => {
      const { errors, tree } = parser.parse('.@{var} { color: red; }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('(InterpolatedSelector');
    });

    it('should parse dimension in selector (for keyframes)', () => {
      const { errors, tree } = parser.parse('@keyframes test { 0% { color: red; } }');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree)).toContainString('(BasicSelector');
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

    it('should not parse extend within a psuedo selector', () => {
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
  });
});
