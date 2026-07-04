/**
 * Smoke tests for the Parseman-based JessGrammar — NOT part of the main
 * test suite. Run to validate the new grammar against basic Jess/SCSS/CSS
 * features before wiring it in as the default parser.
 */
import { describe, it, expect } from 'vitest';
import { parseJessFn } from '../src/grammar.js';

function parse(input: string, rule = 'stylesheet') {
  return parseJessFn(input, rule);
}

describe('JessGrammar (Parséman) — basic smoke tests', () => {
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
  });

  describe('SCSS features inherited', () => {
    it('parses // line comments', () => {
      const { errors } = parse('// a comment\na { color: red; }');
      expect(errors.length).toBe(0);
    });
    it('parses $var declaration', () => {
      const { errors } = parse('$color: red;');
      expect(errors.length).toBe(0);
    });
    it('parses $var reference in value', () => {
      const { errors } = parse('a { color: $primary; }');
      expect(errors.length).toBe(0);
    });
    it('parses $var with !default', () => {
      const { errors } = parse('$x: 10px !default;');
      expect(errors.length).toBe(0);
    });
    it('parses nested ruleset', () => {
      const { errors } = parse('.a { .b { color: red; } }');
      expect(errors.length).toBe(0);
    });
    it('parses & ampersand', () => {
      const { errors } = parse('.a { &:hover { color: red; } }');
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
  });

  describe('Jess-specific at-rules (pass-through)', () => {
    it('parses @-compose', () => {
      const { errors } = parse('@-compose "other.jess";');
      expect(errors.length).toBe(0);
    });
    it('parses @-from', () => {
      const { errors } = parse('@-from "tokens.jess" import (colors);');
      expect(errors.length).toBe(0);
    });
    it('parses @-export block', () => {
      const { errors } = parse('@-export { $primary: blue; }');
      expect(errors.length).toBe(0);
    });
  });
});
