import { describe, it, expect } from 'vitest';
import { Compiler } from '../src/index.js';

/**
 * Placeholder selectors, end to end.
 *
 * SCSS spells one `%name`; `.jess` spells it `\\name` and SCSS LOWERS to that,
 * so both dialects reduce to the same node and extend across each other. Two
 * backslashes because `\\` is the CSS escape for a literal `\` (css-syntax-3
 * 4.3.7): the result is a well-formed identifier that no element type can match
 * (selectors-4 5.1), so a placeholder is inert BY CONSTRUCTION. Suppression
 * exists to match dart-sass's output, not to make the selector safe.
 *
 * Every expectation below was taken from dart-sass 1.101.0 on the same source.
 */
const render = (src: string, extension = '.scss') =>
  new Compiler().renderString(src, { extension });

describe('placeholder selectors', () => {
  it('emits nothing on its own', async () => {
    expect(await render('%ph { color: red; }\n')).toBe('');
  });

  it('emits only the extender when extended', async () => {
    // dart-sass: `.a { color: red; }` -- the `%ph` branch never appears.
    expect(await render('%ph { color: red; }\n.a { @extend %ph; }\n'))
      .toBe('.a {\n  color: red;\n}\n');
  });

  it('drops only the placeholder BRANCH of a selector list, keeping its siblings', async () => {
    /*
     * The case that proves suppression is per-BRANCH, not per-rule, and the
     * reason `Ruleset.reference` could not carry it: a whole-rule flag would
     * drop `.a` too. dart-sass: `.a { color: red; }`.
     */
    expect(await render('%ph, .a { color: red; }\n')).toBe('.a {\n  color: red;\n}\n');
  });

  it('suppresses a placeholder branch in nested output', async () => {
    // Nested output is the v5 default and takes a different emit path from the
    // flattened one, so it needs its own coverage.
    expect(await render('.o { %ph { color: red; } }\n')).toBe('');
  });

  it('round-trips the `.jess` `\\\\name` spelling through $extend', async () => {
    expect(await render('\\\\ph { color: red; }\n.a { $extend \\\\ph; }\n', '.jess'))
      .toBe('.a {\n  color: red;\n}\n');
  });

  it('accepts a placeholder $extend target under the default policy', async () => {
    // `allowExtendSelectors` defaults to class-only for `$apply`, but a
    // placeholder is the one purpose-built extend target, so it is admitted by
    // default rather than being the shape you had to opt into.
    await expect(render('\\\\ph { color: red; }\n.a { $extend \\\\ph; }\n', '.jess'))
      .resolves.toBeTypeOf('string');
  });

  it('parses `@extend ... !optional` and records it', async () => {
    // A missing target is currently silent for BOTH spellings, so this matches
    // dart-sass while plain `@extend` does not yet (dart-sass errors). The
    // authored flag is recorded so that diagnostic is an engine change alone.
    expect(await render('.a { @extend %missing !optional; }\n')).toBe('');
  });
});
