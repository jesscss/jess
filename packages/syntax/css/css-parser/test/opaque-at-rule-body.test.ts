/**
 * The unknown at-rule body is a simple block, and this is what pins it there.
 *
 * css-syntax-3 §5.4.2 "consume an at-rule" hands a `{` to §5.4.8 "consume a
 * simple block", so the block's SYNTACTIC shape — balanced braces, with
 * strings, comments and escapes inert — is spec-defined. What the spec declines
 * to define is the SEMANTIC reading: *"This specification places no limits on
 * what an at-rule's block may contain. Individual at-rules must define whether
 * they accept a block, and if so, how to parse it."* No spec defines one for an
 * unknown at-rule, so the grammar recognises the braces and asserts no meaning:
 * a nested `{ … }` is an `OpaqueGroup`, never a rule, and `a: b` inside it is
 * text, never a declaration.
 *
 * ## Why a reference implementation, and not the byte-identity oracle
 *
 * `test/byte-identity.test.ts` is the strongest instrument in this package and
 * it is BLIND to this production: deleting the `OpaqueComment` arm outright —
 * which truncates `@foo { a: b; /⁠* } *⁠/ c }` at the comment — leaves all six
 * of its assertions green, because its real-world corpus contains no unknown
 * at-rule with a comment in its body. Quoting it here would be a null result.
 *
 * So the instrument is `oldScanEnd` below: an independent re-implementation of
 * the FLAT capture this production replaced — `scanTo('}', { skip: [
 * blockComment, escape, doubleQuoted, singleQuoted, balanced('{','}') ] })`,
 * `packages/parser-shared/src/opaque-at-rule.ts`. It is written from that
 * algorithm rather than from the grammar, so agreement is evidence that the
 * structured capture recognises the same byte language rather than evidence
 * that two spellings of one mistake agree.
 *
 * Its own controls: removing the `OpaqueComment` arm moves 2 of these cases,
 * removing `OpaqueGroup` moves 5. A green run here is a green run over a corpus
 * this file counts and asserts non-empty.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '../src/index.js';
import { parseCssCst } from '../src/cst.js';

/** The replaced flat capture: scan from `i` to the first top-level `}`. */
function oldScanEnd(src: string, i: number): number {
  let depth = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '\\' && i + 1 < src.length && !'\n\r\f'.includes(src[i + 1]!)) {
      i += 2;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? i + 1 : end + 2;
      continue;
    }
    if (c === '"' || c === '\'') {
      let j = i + 1;
      let closed = false;
      while (j < src.length) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === c) {
          closed = true;
          break;
        }
        j++;
      }
      i = closed ? j + 1 : i + 1;
      continue;
    }
    if (c === '{') {
      depth++;
      i++;
      continue;
    }
    if (c === '}') {
      if (depth === 0) {
        return i;
      }
      depth--;
      i++;
      continue;
    }
    i++;
  }
  return -1;
}

function firstOpaqueRawBody(node: unknown): string | null {
  if (node === null || typeof node !== 'object') {
    return null;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = firstOpaqueRawBody(child);
      if (found !== null) {
        return found;
      }
    }
    return null;
  }
  const record = node as Record<string, unknown>;
  if (record['type'] === 'OpaqueAtRuleBlock') {
    return record['rawBody'] as string;
  }
  return firstOpaqueRawBody(record['rules']);
}

/* Every case opens exactly one unknown at-rule at the first `{`. */
const CASES = [
  '@foo { .a { b: c } }',
  '@foo {}',
  '@foo { }',
  '@foo { a: b }',
  '@foo { a: b; /* } */ c: "}" }',
  '@foo { c: \'}\' }',
  '@foo { a: b\\}c }',
  '@foo { /* unterminated',
  '@foo { a: " }',
  '@foo { a: \' }',
  '@foo { a: fn(}) }',
  '@foo { x[}] }',
  '@foo { { { } } }',
  '@foo { a: b } }',
  '@foo bar baz { .a { b: c } }',
  '@foo (x) { @bar { @baz { q } } }',
  '@foo { a: url(//h/a;b) }',
  '@foo { a: 1/2 }',
  '@foo { a: b/*c*/d }',
  '@foo { \n\t a : b ; \n }',
  '@foo { --x: }',
  '@foo { @media all { .a { b: c } } }',
  '@foo { "\\}" }',
  '@foo { a: "\\"}" }',
  '@foo { é: é }',
  '@foo { a: "\u{1f600}" }',
  '@foo{}',
  '@-vendor-thing { }',
  '@foo { a: b; }',
  '@foo { ; }',
  '@foo { a { b }',
  '@foo { {',
  '@foo { a: b',
  '@foo { "unterminated }',
  '@foo { /* c */ }',
  '@foo { }}',
  '@foo { a}b }'
] as const;

describe('unknown at-rule body: a simple block, not a rule list', () => {
  it('recognises the same byte language the flat capture did', () => {
    let compared = 0;
    for (const src of CASES) {
      const open = src.indexOf('{');
      const end = oldScanEnd(src, open + 1);
      const expected = end === -1 ? null : src.slice(open + 1, end);
      const shouldParse = expected !== null && src.slice(end + 1).trim() === '';

      let rawBody: string | null = null;
      let parsed = true;
      try {
        rawBody = firstOpaqueRawBody(parse(src));
      } catch {
        parsed = false;
      }

      expect(parsed, `acceptance changed for ${JSON.stringify(src)}`).toBe(shouldParse);
      if (parsed) {
        compared++;
        expect(rawBody, `body bytes changed for ${JSON.stringify(src)}`).toBe(expected);
      }
    }

    /* Control 0 — a green run over an empty corpus looks like a green run. */
    expect(compared).toBeGreaterThan(20);
  });

  it('gives the CST an interior: groups, strings and comments carry spans', () => {
    const src = '@foo { .a { b: c } /* x */ d: "e}f" }';
    const result = parseCssCst(src);
    expect(result.ok).toBe(true);

    const found: Array<[string, string]> = [];
    const visit = (node: { _tag: string; grammarType?: string; span: { start: number; end: number }; rules: readonly unknown[] }): void => {
      if (node._tag !== 'node') {
        return;
      }
      if (node.grammarType !== undefined && node.grammarType.startsWith('Opaque')) {
        found.push([node.grammarType, src.slice(node.span.start, node.span.end)]);
      }
      node.rules.forEach(child => visit(child as typeof node));
    };
    visit(result.tree as unknown as Parameters<typeof visit>[0]);

    expect(found).toEqual([
      ['OpaqueAtRuleBlock', src],
      ['OpaqueAtPrelude', ''],
      ['OpaqueBody', ' .a { b: c } /* x */ d: "e}f" '],
      ['OpaqueGroup', '{ b: c }'],
      ['OpaqueComment', '/* x */'],
      ['OpaqueString', '"e}f"']
    ]);
  });

  it('asserts no semantics: the nested block is a group, never a rule', () => {
    const tree = parse('@foo { .a { b: c } }');
    expect(tree.rules).toHaveLength(1);
    expect(tree.rules[0]!.type).toBe('OpaqueAtRuleBlock');
    expect(firstOpaqueRawBody(tree)).toBe(' .a { b: c } ');
  });
});
