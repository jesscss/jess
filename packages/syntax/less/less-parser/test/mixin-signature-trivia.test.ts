import { describe, expect, it } from 'vitest';
import { makeLessRegistry } from '@jesscss/fns';
import { buildEvaluator } from '../../../../core/src/ast/evaluator.js';
import { triviaMapOf } from '../../../../core/src/ast/provenance.js';
import { serialize } from '../../../../core/src/ast/serialize.js';
import { parse } from '@jesscss/less-parser';

describe('Less mixin signature trivia', () => {
  it('accepts a terminal bare call and preserves body comments through evaluation', () => {
    const source = '.m(/* signature */) { /* body */ color: red; } .x { .m() } .y { color: blue; }';
    const document = parse(source);
    const comments = triviaMapOf(document)
      ?.commentRuns()
      .map(run => source.slice(run.start, run.end));
    const css = serialize(document, {
      evaluator: buildEvaluator(makeLessRegistry())
    }).css;

    expect(comments).toEqual(expect.arrayContaining(['/* signature */']));
    expect(comments?.some(comment => comment.includes('/* body */'))).toBe(true);
    expect(css).toContain('/* body */');
    expect(css).toContain('.y {\n  color: blue;\n}');
  });
});
