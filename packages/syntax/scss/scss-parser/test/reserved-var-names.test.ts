import { describe, expect, it } from 'vitest';
import { parse } from '@jesscss/scss-parser';

/**
 * A fixed set of `$`-names is RESERVED: the control-flow keywords and the
 * `@content` protocol name. Declaring one as a variable (`$content:`, `$for:`, …)
 * is a parse error, so `content` etc. are true keywords rather than user
 * variables. The guard is a `not(...)` lookahead applied ONLY at the
 * `VariableDeclaration` head — the shared `$name` sigil (`scssVarSigilName`)
 * stays untouched, so a `$content` reference, a `@each $content in …` loop
 * binding, a `@mixin m($content)` parameter, and a `module.$content` access all
 * still parse. Names are case-sensitive: only the exact lowercase spellings are
 * reserved.
 *
 * Sibling of the jess-parser `reserved-var-names.test.ts`; both `$` dialects
 * enforce the same reserved set.
 */
const RESERVED = ['content', 'for', 'if', 'else', 'each', 'while'];

describe('reserved $-names (scss)', () => {
  it('rejects every reserved name as a declaration', () => {
    for (const name of RESERVED) {
      expect(() => parse(`a { $${name}: red; }`), `$${name}:`).toThrow();
    }
  });

  it('rejects a reserved declaration at top level and with a modifier', () => {
    expect(() => parse('$content: red;')).toThrow();
    expect(() => parse('$content: red !default;')).toThrow();
    expect(() => parse('$content: red !global;')).toThrow();
  });

  it('allows non-reserved names, including reserved-name prefixes and other casings', () => {
    expect(() => parse('a { $foo: red; }')).not.toThrow();
    expect(() => parse('a { $contents: red; }')).not.toThrow();
    expect(() => parse('a { $Content: red; }')).not.toThrow();
    expect(() => parse('a { $forEach: red; }')).not.toThrow();
    // `return` is NOT reserved — `$return` is the standard Sass return-accumulator
    // (Bootstrap/Foundation declare `$return: ()`), so it stays a legal variable.
    expect(() => parse('a { $return: red; }')).not.toThrow();
    expect(() => parse('$return: () !default;')).not.toThrow();
  });

  it('leaves reserved words untouched outside declaration position', () => {
    // reference read
    expect(() => parse('a { color: $content; }')).not.toThrow();
    // each loop binding is a reserved name — still a binding, not a declaration
    expect(() => parse('@each $content in 1, 2, 3 { a { width: $content; } }')).not.toThrow();
    // mixin parameter
    expect(() => parse('@mixin m($content) { a { color: $content; } }')).not.toThrow();
    // control-flow at-rules
    expect(() => parse('@if true { a { color: red; } }')).not.toThrow();
    expect(() => parse('@for $i from 1 through 3 { a { color: red; } }')).not.toThrow();
    expect(() => parse('@function f() { @return 1; }')).not.toThrow();
  });
});
