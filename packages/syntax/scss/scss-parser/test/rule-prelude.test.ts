import { describe, expect, it } from 'vitest';
import { parseRecovering } from '@jesscss/scss-parser';

/**
 * A declaration with no `;` before a nested rule, whose value no selector can hold,
 * and a percentage or a length where a selector goes. The block makes each a rule, so
 * it parses and the error sits on the prelude (ledger P45).
 */
describe('SCSS rule whose prelude no selector reads', () => {
  it.each([
    ['a length', '.a {\n  font:bold 12px serif\n  .title { color: red; }\n}\n.z { b: c; }', 'font:bold 12px serif\n  .title'],
    ['a string', '.a {\n  font-family:Arial "Helvetica Neue"\n  .title { color: red; }\n}\n.z { b: c; }', 'font-family:Arial "Helvetica Neue"\n  .title'],
    ['a list that a selector stops in', '.a {\n  transition:opacity, 1s\n  .title { color: red; }\n}\n.z { b: c; }', 'transition:opacity, 1s\n  .title'],
    ['a priority', '.a {\n  color:blue !important\n  .title { color: red; }\n}\n.z { b: c; }', 'color:blue !important\n  .title']
  ])('%s', (_label, source, prelude) => {
    const { document, recovered } = parseRecovering(source);
    expect(recovered.map(error => [error.code, source.slice(error.offset, error.endOffset)])).toEqual([['parse/invalid-rule-prelude', prelude]]);
    expect(document).toMatchObject({
      rules: [
        { rules: [{ type: 'Ruleset', rules: [{ type: 'Declaration', name: 'color' }] }] },
        { type: 'Ruleset', rules: [{ type: 'Declaration', name: 'b' }] }
      ]
    });
  });

  it('reports at a pseudo no argument rule reads, when its statement then stops', () => {
    expect(() => parseRecovering('a { b:not(1) .c; }')).toThrow(expect.objectContaining({ code: 'parse/invalid-rule-prelude', offset: 5 }));
  });

  it('holds at the root', () => {
    expect(parseRecovering('1px .title { color: red; }').recovered.map(error => error.code)).toEqual(['parse/invalid-rule-prelude']);
  });

  it('holds interpolation in the rest', () => {
    const source = '.a { font:bold 12px #{$family} .title#{$n} { color: red; } }';
    const [error] = parseRecovering(source).recovered;
    expect(error === undefined ? undefined : source.slice(error.offset, error.endOffset)).toBe('font:bold 12px #{$family} .title#{$n}');
  });

  it.each([
    ['x:not(1) .b'],
    ['x:not("s")'],
    ['x:has(1) .b'],
    ['x:nth-child() .b'],
    ['x:not() .b'],
    ['x:has() .b'],
    ['x:lang()'],
    ['x:dir()'],
    ['x:global()'],
    ['x:nth-of-type()']
  ])('reports a known pseudo no argument rule reads, in %s, and the document goes on', (prelude) => {
    const { document, recovered } = parseRecovering(`.a {\n  ${prelude} { c: d }\n}\n.z { b: c; }`);
    expect(recovered.map(error => error.code)).toEqual(['parse/invalid-rule-prelude']);
    expect(document).toMatchObject({ rules: [{ type: 'Ruleset' }, { type: 'Ruleset', rules: [{ type: 'Declaration', name: 'b' }] }] });
  });

  /* Pinned so a change shows, not as a requirement: these belong to jess#592. */
  it.each([
    ['no block', '.a { font:bold 12px .title; }'],
    ['no block before the close', '.a { font:bold 12px .title }'],
    ['an unterminated string', '.a { font:bold 12px "a { color: red; } }'],
    ['an at-rule at the start', '.a { @ { color: red; } }']
  ])('PINNED DEFECT: rejects %s', (_label, source) => {
    expect(() => parseRecovering(source)).toThrow();
  });
});
