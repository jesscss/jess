import { describe, expect, it } from 'vitest';
import { parse } from '@jesscss/css-parser';
import { serialize } from '@jesscss/core';
import type { SerializeOptions } from '@jesscss/core';
import { dimension, queryFeatureContents } from '@jesscss/core/ast';

type ValueEvaluator = NonNullable<SerializeOptions['evaluator']>;

/**
 * `<general-enclosed>` (media-queries-4 §3.1) is syntax a future spec may
 * define; a browser evaluates it as unknown. The parser keeps its structure for
 * tooling, but the emitter prints the group exactly as written: never the
 * prelude normalizer, never an evaluator, never a `url()` transform (ledger N8).
 */
const VERBATIM = [
  /* A normalizer would read `or(` as the `or` combinator and change what the query matches. */
  '@media (foo(x) or(color))',
  '@media (foo(x) url(a/b.png))',
  '@supports (foo(x) url(a/b.png))',
  '@supports (foo(x)   bar  baz)',
  '@supports (foo(x) /* c */ bar)',
  '@supports ( foo( x ) bar )',
  '@media (foo(x): y)',
  '@media (width > 1px) and (foo(x)  bar)',
  '@container (calc(1px + 1px) foo)',
  '@container card (U+0-7F  bar)',

  /* A lone function or unicode-range bound, wherever the feature stands. */
  '@media (foo( x ))',
  '@media (url(a/b.png))',
  '@supports (foo(x)/2)',
  '@container (a) and (foo( x ))',

  /* A function-form general-enclosed read as a template. */
  '@media foo(x:y)',
  '@container ((a) and (foo  bar))',
  '@supports (foo  bar)'
];

async function prelude(source: string, evaluator?: ValueEvaluator): Promise<string> {
  const css = (await serialize(parse(`${source} { a { b: c } }`), evaluator === undefined ? {} : { evaluator })).css;
  return css.slice(0, css.indexOf('{')).trimEnd();
}

/* An evaluator that fails the render if any value inside the prelude reaches it. */
const refusingEvaluator = new Proxy({}, {
  get: () => () => {
    throw new Error('the evaluator was reached');
  }
}) as ValueEvaluator;

describe('general-enclosed is emitted as written and never evaluated', () => {
  for (const source of VERBATIM) {
    it(`emits ${source} as written`, async () => {
      expect(await prelude(source)).toBe(source);
    });

    it(`does not evaluate inside ${source}`, async () => {
      expect(await prelude(source, refusingEvaluator)).toBe(source);
    });
  }

  it('marks only the group whose own contents are general-enclosed; the condition around it is normalized', async () => {
    expect(await prelude('@media ( (foo(x)  bar) )')).toBe('@media ((foo(x)  bar))');
  });

  /* A defined query function is not general-enclosed: bare and parenthesized agree, normalized. */
  it('normalizes a defined style() query the same bare or parenthesized', async () => {
    expect(await prelude('@container style(--x:1)')).toBe('@container style(--x: 1)');
    expect(await prelude('@container (style(--x:1))')).toBe('@container (style(--x: 1))');
  });

  /*
   * Ledger N14: `@supports` still protects a function-form template by its
   * payload shape, as on dev, so a defined `selector()` keeps its spacing
   * there while the query lane normalizes it. A switch of the supports lane to
   * the parser's mark must change this pin deliberately.
   */
  it('keeps a defined selector() as written in @supports and normalizes it in @media', async () => {
    expect(await prelude('@supports selector(a  >  b)')).toBe('@supports selector(a  >  b)');
    expect(await prelude('@media selector(a  >  b)')).toBe('@media selector(a > b)');
  });

  /* Ledger N14, owner-pending: the defined-name exemption is by name in every query prelude. */
  it('exempts a defined condition function by name outside its own at-rule too', async () => {
    expect(await prelude('@media style(--x:1)')).toBe('@media style(--x: 1)');
  });

  it('keeps general-enclosed as written in compressed output', async () => {
    const css = (await serialize(parse('@media (foo(x)   or(color)) and (min-width : 1px) { a { b: c } }'), { compress: true })).css;
    expect(css.slice(0, css.indexOf('{'))).toBe('@media(foo(x)   or(color)) and (min-width:1px)');
  });

  it('refuses a general-enclosed group whose parse state has no input to record', () => {
    expect(() => queryFeatureContents([dimension(1, 'px')], { start: 0, end: 3 }, {})).toThrow(TypeError);
  });

  it('still evaluates a query feature value, so the refusing evaluator is live', async () => {
    await expect(prelude('@media (min-width: foo(1px))', refusingEvaluator)).rejects.toThrow();
  });
});

/*
 * An @container or @supports feature that is not a feature fails softly, so
 * its owner's `Enclosed` fallback reads it as `<general-enclosed>` text: a
 * committing route there would fail the whole stylesheet on valid CSS. Each
 * form below parses on dev and must keep parsing, printed as written.
 */
const SOFT_FAILURES = [
  /* a `not` group whose operand is not a media group */
  '@supports (not (@x) b)',
  '@supports (not (#) b)',
  '@supports (not (@media) or (x))',
  '@supports (a: b) and (not (@x) b)',
  '@supports ((not (@x) b))',
  '@container ((not (@x) b))',

  /* a value-first bound that is not a range */
  '@supports (1px < foo(@x))',
  '@supports (1px < calc(@x))',
  '@supports (1px < var(@x))',
  '@supports (1px foo(@x))',
  '@supports (1px < foo(a !important))',
  '@supports (1px < foo(#))',
  '@supports (1px < foo(a {b}))',
  '@supports (1px < calc(1px+2px))',
  '@container ((1px < foo(@x)))',
  '@container ((1px foo(@x)))',

  /* a function-first bound that is not a range */
  '@supports (foo(x) < bar(@x))',
  '@supports (foo(x) < calc(1px+2px))',
  '@supports (url(a) < foo(@x))',
  '@container ((foo(x) < bar(@x)))',

  /* a bound followed by a comma, then a function that fails */
  '@supports (foo(x), bar(@x))',
  '@supports (url(a), bar(@x))',
  '@supports (u+0-7f, bar(@x))',
  '@supports (calc(1px), foo(@x))'
];

describe('@container and @supports features fail softly to their Enclosed fallback', () => {
  for (const source of SOFT_FAILURES) {
    it(`parses and prints ${source} as written`, async () => {
      const css = (await serialize(parse(`${source} { a { b: c } }`))).css;
      expect(css.startsWith(`${source} {`)).toBe(true);
    });
  }

  it('reads a feature name with a colon and no value as structure', async () => {
    expect(await prelude('@supports (foo: )')).toBe('@supports (foo: )');
    expect(await prelude('@container (foo:)')).toBe('@container (foo:)');
  });

  it('keeps a supports() test with a failing group readable', async () => {
    const css = (await serialize(parse('a { b: if(supports((not (@x) b)): 1); }'))).css;
    expect(css).toBe('a {\n  b: if(supports((not (@x) b)): 1);\n}\n');
  });
});

/* A unicode range at the head of an if-test's contents is one `<urange>` token. */
describe('if-test contents read a unicode range as one token', () => {
  it('prints media(), style() and supports() unicode ranges as written', async () => {
    const css = (await serialize(parse('a { b: media(u+0025) style(u+0025) supports(u+0025) supports(not U+00-ff); }'))).css;
    expect(css).toBe('a {\n  b: media(u+0025) style(u+0025) supports(u+0025) supports(not U+00-ff);\n}\n');
  });
});
