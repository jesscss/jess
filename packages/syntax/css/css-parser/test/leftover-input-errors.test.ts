/*
 * The leftover-input error path.
 *
 * `run()` reports `unconsumedFrom` separately from `ok`, and the two describe
 * different author-facing problems: text left over *after* a complete
 * stylesheet, versus a first token that was never recognised. These tests pin
 * that the parser keeps them apart and localises both.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@jesscss/css-parser';
import { parse as parseWithPositions } from '@jesscss/css-parser/positions';
import type { CssParseError } from '@jesscss/css-parser';
import { sourceSpanOf } from '@jesscss/core/ast';

const AFTER_COMPLETE = '.a { color: red; }\n!broken';
const MALFORMED = '!broken';

/*
 * Matched by `name`, not `instanceof`: the `.` and `./positions` entries are
 * bundled separately and each carries its own copy of the error class, so an
 * identity check would pass for one entry and fail for the other.
 */
function failureOf(source: string, entry: typeof parse = parse): CssParseError {
  try {
    entry(source);
  } catch (error) {
    expect((error as Error).name).toBe('CssParseError');
    return error as CssParseError;
  }
  throw new Error(`Expected ${JSON.stringify(source)} to fail to parse.`);
}

describe('CSS leftover-input errors', () => {
  it.each([
    ['offsets-only entry', parse],
    ['line-aware entry', parseWithPositions]
  ])('localises input left over after a complete stylesheet (%s)', (_label, entry) => {
    const failure = failureOf(AFTER_COMPLETE, entry);

    expect(failure.offset).toBe(19);
    expect(failure.line).toBe(2);
    expect(failure.column).toBe(1);
    expect(AFTER_COMPLETE.slice(failure.offset)).toBe('!broken');
    expect(failure.message).toBe('Unexpected CSS input after a complete stylesheet.');
    expect(failure.reason).toContain('complete CSS stylesheet');
    expect(failure.fix).toContain('}');
  });

  it.each([
    ['offsets-only entry', parse],
    ['line-aware entry', parseWithPositions]
  ])('localises a first token that is not CSS at all (%s)', (_label, entry) => {
    const failure = failureOf(MALFORMED, entry);

    expect(failure.offset).toBe(0);
    expect(failure.line).toBe(1);
    expect(failure.column).toBe(1);
    expect(failure.message).toBe('Unexpected CSS syntax.');
    expect(failure.reason).toContain('start of a CSS rule');
    expect(failure.fix).toBeTruthy();
  });

  it('does not collapse the two branches into one message', () => {
    const afterComplete = failureOf(AFTER_COMPLETE);
    const malformed = failureOf(MALFORMED);

    expect(afterComplete.message).not.toBe(malformed.message);
    expect(afterComplete.reason).not.toBe(malformed.reason);
    expect(afterComplete.fix).not.toBe(malformed.fix);
  });

  it('reaches the leftover branch through an unbalanced closing brace', () => {
    const source = '.a { color: red; }\n}\n.b { color: blue; }';
    const failure = failureOf(source);

    expect(source[failure.offset]).toBe('}');
    expect(failure.line).toBe(2);
    expect(failure.column).toBe(1);
    expect(failure.message).toBe('Unexpected CSS input after a complete stylesheet.');
  });

  it('spans the whole source on a valid parse', () => {
    /*
     * `many()` succeeds on zero matches, so `ok` alone proves nothing about
     * coverage — assert the document span reaches the end of the source.
     */
    const source = '.a { color: red; }';

    expect(sourceSpanOf(parse(source))).toEqual({ start: 0, end: source.length });
  });

  it('counts trailing trivia as consumed rather than left over', () => {
    /*
     * Appending garbage is the coverage proof: the reported offset lands after
     * the trivia, so the trivia was consumed and not merely skipped over.
     */
    for (const source of ['.a { color: red; }\n', '.a { color: red; }   ', '.a { color: red; } /* t */']) {
      expect(() => parse(source)).not.toThrow();

      const failure = failureOf(`${source}!broken`);

      expect(failure.offset).toBe(source.length);
      expect(failure.message).toBe('Unexpected CSS input after a complete stylesheet.');
    }
  });
});
