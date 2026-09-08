import { describe, expect, it } from 'vitest';
import { parse } from '@jesscss/jess-parser';

/**
 * A fixed set of `$`-names is RESERVED: the control-flow keywords and the
 * `@content` protocol name. Declaring one as a variable (`$content:`, `$for:`, …)
 * is a parse error, which is what makes `content` etc. true keywords rather than
 * user variables — the fact R16's block-less `@content` behavior relies on. The
 * guard lives at the assignment head (`assignHead`), so it covers the ordinary
 * and the block-valued declaration, both `$name` and `$^name`, and every
 * operator (`:`, `:=`, `::=`, `?:`). It is a `not(...)` lookahead at the name
 * position, so a reserved word ANYWHERE ELSE — a `$content()` call, a `$content`
 * reference, a `$if (...)`/`$for(...)`/`$while (...)` statement head — is
 * untouched. Names are case-sensitive: only the exact lowercase spellings are
 * reserved.
 *
 * Replicated as the scss-parser sibling (`reserved-var-names.test.ts`); both `$`
 * dialects enforce the same reserved set.
 */
const RESERVED = ['content', 'for', 'if', 'else', 'each', 'while', 'return'];

describe('reserved $-names (jess)', () => {
  it('rejects every reserved name as a `:` declaration', () => {
    for (const name of RESERVED) {
      expect(() => parse(`a { $${name}: red; }`), `$${name}:`).toThrow();
    }
  });

  it('rejects a reserved name under the scope sigil and every operator', () => {
    expect(() => parse('a { $^content: red; }')).toThrow();
    expect(() => parse('a { $content := red; }')).toThrow();
    expect(() => parse('a { $content ::= red; }')).toThrow();
    expect(() => parse('a { $content ?: red; }')).toThrow();
    expect(() => parse('a { $content: { color: red; } }')).toThrow();
  });

  it('allows non-reserved names, including reserved-name prefixes and other casings', () => {
    expect(() => parse('a { $foo: red; }')).not.toThrow();
    expect(() => parse('a { $contents: red; }')).not.toThrow();
    expect(() => parse('a { $Content: red; }')).not.toThrow();
    expect(() => parse('a { $forEach: red; }')).not.toThrow();
  });

  it('leaves reserved words untouched outside declaration position', () => {
    // reference read
    expect(() => parse('a { color: $content; }')).not.toThrow();
    // function call
    expect(() => parse('a { color: $content(); }')).not.toThrow();
    // control-flow statement heads
    expect(() => parse('$if (true) { a { color: red; } }')).not.toThrow();
    expect(() => parse('$for($i of 1 to 3) { a { width: $i; } }')).not.toThrow();
    expect(() => parse('$while (false) { a { color: red; } }')).not.toThrow();
  });
});
