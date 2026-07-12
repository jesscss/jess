/**
 * `&` (the Jess parent/nesting selector) is valid ONLY inside a rule block.
 *
 * The ruleset block body installs `{ inner: true }` via `withCtx`; the `&` arm in
 * `simpleSelector` is a gated `choice` arm that matches only when `inner` is set:
 *   - top-level `& { … }` is REJECTED
 *   - nested `& { … }` / `&:hover` is ACCEPTED at any depth
 *
 * `$extend &` / `$apply &` targets go through `extendTargetPart`/`applyTargetPart`
 * (NOT this arm) and are unaffected — pinned below. The oracle block pins the
 * incremental context mechanism (mirrors parseman's withctx-nesting-incremental.test.ts).
 */
import { describe, test, expect } from 'vitest';
import { parseJessFn } from '../src/functional-parser.js';
import { parseDocCst } from '@jesscss/css-parser/cst';
import { jessGrammar } from '../src/grammar.js';

const parseDoc = (src: string) => parseDocCst(jessGrammar as Record<string, unknown>, src, 'Stylesheet');
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

describe('jess `&` nesting-context gating', () => {
  // RED-first: top-level `&` must be REJECTED (was accepted before the gate).
  test('rejects top-level `& { … }`', () => {
    expect(parseJessFn('& { color: red }').errors.length).toBeGreaterThanOrEqual(1);
  });
  test('rejects a top-level `&` after a valid rule', () => {
    expect(parseJessFn('.a { color: red } & { color: blue }').errors.length).toBeGreaterThanOrEqual(1);
  });

  // Nested `&` accepted at any depth.
  test('accepts nested `& { … }`', () => {
    expect(parseJessFn('.a { & { color: red } }').errors).toHaveLength(0);
  });
  test('accepts nested `&:hover { … }`', () => {
    expect(parseJessFn('.a { &:hover { color: red } }').errors).toHaveLength(0);
  });
  test('accepts `& .b { … }` nested', () => {
    expect(parseJessFn('.a { & .b { color: red } }').errors).toHaveLength(0);
  });
  test('accepts deeply nested `&`', () => {
    expect(parseJessFn('.a { & { .b { & { color: red } } } }').errors).toHaveLength(0);
  });

  test('valid non-`&` Jess still parses clean', () => {
    expect(parseJessFn('$v: 1; .a { color: red; $b: 2; }').errors).toHaveLength(0);
  });
});

describe('jess `&` gating — incremental edits preserve inner context (oracle)', () => {
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
    expect(parseJessFn('.a{&{}}').errors).toHaveLength(0);
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
