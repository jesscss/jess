/**
 * Smoke tests for the Parseman-based LessGrammar — NOT part of the main
 * test suite. Run to validate the new grammar against basic features before
 * wiring it in as the default parser.
 */
import { describe, it, expect } from 'vitest';
import { LessGrammar } from '../src/parseman/grammar.js';

const g = new LessGrammar();

function parse(input: string, rule: string = 'Stylesheet') {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return g.parse(rule as any, input);
}

describe('LessGrammar (Parséman) — basic smoke tests', () => {
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
    it('parses Declaration', () => {
      const { errors } = parse('color: red', 'Declaration');
      expect(errors.length).toBe(0);
    });
    it('parses CustomDeclaration', () => {
      const { errors } = parse('--custom: value', 'anyDeclaration');
      expect(errors.length).toBe(0);
    });
  });

  describe('Less variable declarations', () => {
    it('parses @var: value;', () => {
      const { errors } = parse('@color: red;');
      expect(errors.length).toBe(0);
    });
    it('parses variable in ruleset', () => {
      const { errors } = parse('.a { @local: 1px; color: @local; }');
      expect(errors.length).toBe(0);
    });
    it('variable has VarDeclaration type', () => {
      const { errors, tree } = parse('@color: red;');
      expect(errors.length).toBe(0);
      expect(tree?.type).toBe('Rules');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      expect((tree as any)?.rules?.[0]?.type).toBe('VarDeclaration');
    });
  });

  describe('Less variable references', () => {
    it('parses @var as Reference', () => {
      const { errors, tree } = parse('color: @var', 'Declaration');
      expect(errors.length).toBe(0);
    });
    it('parses @p[accessor]', () => {
      const { errors } = parse('color: @p[accessor]', 'Declaration');
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

  describe('Less relative selectors', () => {
    it('parses > combinator at start', () => {
      const { errors } = parse('.parent { > .child { color: red; } }');
      expect(errors.length).toBe(0);
    });
    it('parses + combinator at start', () => {
      const { errors } = parse('.parent { + .sibling { color: red; } }');
      expect(errors.length).toBe(0);
    });
    it('parses ~ combinator at start', () => {
      const { errors } = parse('.parent { ~ .sibling { color: red; } }');
      expect(errors.length).toBe(0);
    });
  });

  describe('Less property merge operators', () => {
    it('parses +: (comma merge)', () => {
      const { errors, tree } = parse('src+: url(foo)', 'Declaration');
      expect(errors.length).toBe(0);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      expect((tree as any)?.options?.assign).toBe('+,:');
    });
    it('parses +_: (space merge)', () => {
      const { errors, tree } = parse('src+_: format("woff")', 'Declaration');
      expect(errors.length).toBe(0);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      expect((tree as any)?.options?.assign).toBe('+_:');
    });
  });

  describe('Less nesting', () => {
    it('parses nested rulesets', () => {
      const { errors } = parse('.a { .b { color: red; } }');
      expect(errors.length).toBe(0);
    });
    it('parses multi-level nesting', () => {
      const { errors } = parse('.a { .b { .c { color: red; } } }');
      expect(errors.length).toBe(0);
    });
    it('parses variable + nested rule', () => {
      const { errors } = parse('.a { @x: 1; .b { color: @x; } }');
      expect(errors.length).toBe(0);
    });
  });

  describe('Less expressions (no errors)', () => {
    it('parses arithmetic in value', () => {
      const { errors } = parse('width: 10px + 5px', 'Declaration');
      expect(errors.length).toBe(0);
    });
    it('parses subtraction', () => {
      const { errors } = parse('width: 10px - 5px', 'Declaration');
      expect(errors.length).toBe(0);
    });
    it('parses multiplication', () => {
      const { errors } = parse('width: 10px * 2', 'Declaration');
      expect(errors.length).toBe(0);
    });
    it('parses @var + @var', () => {
      const { errors } = parse('width: @a + @b', 'Declaration');
      expect(errors.length).toBe(0);
    });
  });
});
