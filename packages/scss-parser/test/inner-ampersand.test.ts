/**
 * `&` (the SCSS parent selector) is valid ONLY inside a rule block (nested),
 * never at top level — dart-sass rejects a bare top-level `&`.
 *
 * SCSS re-derives Less's `simpleSelector` with the `&` (LessAmpersand) arm gated
 * on the dynamic `inner` flag that the rule-body `declarationList` installs via
 * `withCtx`:
 *   - top-level `& { … }` is REJECTED
 *   - nested `& { … }` / `&:hover` is ACCEPTED at any depth
 *
 * Mirrors jess-parser's inner-ampersand.test.ts (jess is a compose leaf; SCSS is
 * too). The oracle block pins the incremental context mechanism.
 */
import { describe, test, expect } from 'vitest';
import { parseScssFn } from '../src/jess.js';
import { parseDocCst } from '@jesscss/css-parser/cst';
import { scssGrammar } from '../src/grammar.js';

const parseDoc = (src: string) => parseDocCst(scssGrammar as Record<string, unknown>, src, 'Stylesheet');
type Doc = ReturnType<typeof parseDoc>;
function proj(n: unknown): unknown {
  const c = n as { type?: string; _tag?: string; value?: unknown; children?: readonly unknown[] } | null;
  if (c == null || typeof c !== 'object') return c;
  return {
    t: c.type ?? c._tag,
    v: typeof c.value === 'string' ? c.value : undefined,
    kids: Array.isArray(c.children) ? c.children.map(proj) : undefined,
  };
}
const oracle = (doc: Doc, fresh: Doc, label: string) => {
  expect(proj(doc.tree), `tree mismatch: ${label}`).toEqual(proj(fresh.tree));
  expect(doc.unconsumedFrom, `unconsumedFrom mismatch: ${label}`).toBe(fresh.unconsumedFrom);
};

describe('scss `&` nesting-context gating', () => {
  // RED-first: top-level `&` must be REJECTED (was accepted before the gate).
  test('rejects top-level `& { … }`', () => {
    expect(parseScssFn('& { color: red }').errors.length).toBeGreaterThanOrEqual(1);
  });
  test('rejects a top-level `&` after a valid rule', () => {
    expect(parseScssFn('.a { color: red } & { color: blue }').errors.length).toBeGreaterThanOrEqual(1);
  });

  // Nested `&` accepted at any depth.
  test('accepts nested `& { … }`', () => {
    expect(parseScssFn('.a { & { color: red } }').errors).toHaveLength(0);
  });
  test('accepts nested `&:hover { … }`', () => {
    expect(parseScssFn('.a { &:hover { color: red } }').errors).toHaveLength(0);
  });
  test('accepts `& .b { … }` nested', () => {
    expect(parseScssFn('.a { & .b { color: red } }').errors).toHaveLength(0);
  });
  test('accepts deeply nested `&`', () => {
    expect(parseScssFn('.a { & { .b { & { color: red } } } }').errors).toHaveLength(0);
  });
  test('`&` inside a nested at-rule body is accepted (dynamic inner)', () => {
    expect(parseScssFn('.a { @media screen { & { color: red } } }').errors).toHaveLength(0);
  });

  test('valid non-`&` SCSS still parses clean', () => {
    expect(parseScssFn('$v: 1; .a { color: red; b: 2; }').errors).toHaveLength(0);
  });
});

describe('scss `&` gating — incremental edits preserve inner context (oracle)', () => {
  function drive(src0: string, edits: Array<[number, number, string]>) {
    let doc = parseDoc(src0);
    let text = src0;
    for (const [from, to, repl] of edits) {
      doc = doc.edit(from, to, repl);
      text = text.slice(0, from) + repl + text.slice(to);
      oracle(doc, parseDoc(text), JSON.stringify(text));
    }
    return doc;
  }

  test('ident → `&` inside a nested block stays valid', () => {
    drive('.a{b{}}', [[3, 4, '&']]);
    expect(parseScssFn('.a{&{}}').errors).toHaveLength(0);
  });
  test('top-level ident → `&` becomes rejected after the edit', () => {
    const doc = drive('.a{}', [[0, 2, '&']]);
    expect(doc.unconsumedFrom).toBe(0);
  });
  test('a run of context-flipping edits keeps tracking the full parse', () => {
    drive('.a{b{}}', [
      [3, 4, '&'],      // .a{&{}}
      [6, 6, 'c{}'],    // .a{&{}c{}}
      [3, 4, 'x'],      // .a{x{}c{}}
      [0, 2, '&'],      // &{x{}c{}} rejected at 0
    ]);
  });
});
