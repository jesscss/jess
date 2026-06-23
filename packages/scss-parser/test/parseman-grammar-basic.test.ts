/**
 * Smoke tests for the Parseman-based ScssGrammar — NOT part of the main
 * test suite. Run to validate the new grammar against basic SCSS features
 * before wiring it in as the default parser.
 */
import { describe, it, expect } from 'vitest';
import { ScssGrammar } from '../src/parseman/grammar.js';

const g = new ScssGrammar();

function parse(input: string, rule: string = 'Stylesheet') {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return g.parse(rule as any, input);
}

describe('ScssGrammar (Parséman) — basic smoke tests', () => {
  describe('CSS features preserved', () => {
    it('parses CSS ruleset', () => {
      const { errors } = parse('a { color: red; }');
      expect(errors.length).toBe(0);
    });
    it('parses multiple rulesets', () => {
      const { errors } = parse('a { color: red; } b { margin: 0; }');
      expect(errors.length).toBe(0);
    });
    it('parses @media', () => {
      const { errors } = parse('@media screen { a { color: red; } }');
      expect(errors.length).toBe(0);
    });
    it('parses Declaration standalone', () => {
      const { errors } = parse('color: red', 'Declaration');
      expect(errors.length).toBe(0);
    });
    it('parses CustomDeclaration standalone', () => {
      const { errors } = parse('--custom: value', 'anyDeclaration');
      expect(errors.length).toBe(0);
    });
  });

  describe('Line comments', () => {
    it('skips // comment before rule', () => {
      const { errors } = parse('// comment\na { color: red; }');
      expect(errors.length).toBe(0);
    });
    it('skips // comment inside rule', () => {
      const { errors } = parse('a {\n  // a comment\n  color: red;\n}');
      expect(errors.length).toBe(0);
    });
    it('skips // comment after declaration', () => {
      const { errors } = parse('a { color: red; // inline\n}');
      expect(errors.length).toBe(0);
    });
  });

  describe('SCSS variable declarations', () => {
    it('parses $var: value;', () => {
      const { errors } = parse('$color: red;');
      expect(errors.length).toBe(0);
    });
    it('parses variable without semicolon', () => {
      const { errors } = parse('$x: 1px');
      expect(errors.length).toBe(0);
    });
    it('parses variable with !default', () => {
      const { errors } = parse('$color: red !default;');
      expect(errors.length).toBe(0);
    });
    it('parses variable with !global', () => {
      const { errors } = parse('$color: red !global;');
      expect(errors.length).toBe(0);
    });
    it('parses variable in ruleset', () => {
      const { errors } = parse('.a { $local: 1px; color: $local; }');
      expect(errors.length).toBe(0);
    });
    it('variable has VarDeclaration type', () => {
      const { errors, tree } = parse('$color: red;');
      expect(errors.length).toBe(0);
      expect(tree?.type).toBe('Rules');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      expect((tree as any)?.rules?.[0]?.type).toBe('VarDeclaration');
    });
  });

  describe('SCSS variable references', () => {
    it('parses $var as Reference', () => {
      const { errors } = parse('color: $primary', 'Declaration');
      expect(errors.length).toBe(0);
    });
    it('parses $var in stylesheet', () => {
      const { errors } = parse('a { color: $brand-color; }');
      expect(errors.length).toBe(0);
    });
  });

  describe('Ampersand selector', () => {
    it('parses & in nested rule', () => {
      const { errors } = parse('.a { &:hover { color: red; } }');
      expect(errors.length).toBe(0);
    });
    it('parses & alone', () => {
      const { errors } = parse('.a { & { color: red; } }');
      expect(errors.length).toBe(0);
    });
  });

  describe('SCSS relative selectors (nesting)', () => {
    it('parses > combinator at start', () => {
      const { errors } = parse('.parent { > .child { color: red; } }');
      expect(errors.length).toBe(0);
    });
    it('parses + combinator at start', () => {
      const { errors } = parse('.parent { + .sibling { color: red; } }');
      expect(errors.length).toBe(0);
    });
    it('parses nested rulesets', () => {
      const { errors } = parse('.a { .b { color: red; } }');
      expect(errors.length).toBe(0);
    });
    it('parses multi-level nesting', () => {
      const { errors } = parse('.a { .b { .c { color: red; } } }');
      expect(errors.length).toBe(0);
    });
  });

  describe('SCSS at-rules (pass-through)', () => {
    it('parses @use', () => {
      const { errors } = parse('@use "sass:math";');
      expect(errors.length).toBe(0);
    });
    it('parses @mixin block', () => {
      const { errors } = parse('@mixin flex { display: flex; }');
      expect(errors.length).toBe(0);
    });
    it('parses @include', () => {
      const { errors } = parse('a { @include flex; }');
      expect(errors.length).toBe(0);
    });
    it('parses @if block', () => {
      const { errors } = parse('@if true { a { color: red; } }');
      expect(errors.length).toBe(0);
    });
    it('parses variable + nested rule', () => {
      const { errors } = parse('.a { $x: 1; .b { color: $x; } }');
      expect(errors.length).toBe(0);
    });
  });
});
