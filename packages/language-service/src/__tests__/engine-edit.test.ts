import { describe, it, expect } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position, Range } from 'vscode-languageserver-types';
import type { CssCstChild } from '@jesscss/css-parser';
import { createEngine } from '../engine.js';

/**
 * Parseman `.edit()` dogfood — prove the incremental document sync in the engine
 * (Step 2) matches a from-scratch parse. The engine holds a `ParseDoc` per
 * document (the CST sync layer of the dual-tree design) and edits it in place on
 * every content change; these tests are the oracle that the incrementally-synced
 * state never diverges from a full reparse, and that observable features
 * (diagnostics / symbols) agree with a freshly-opened engine.
 */

/** Structural CST key (type + relative span + children; leaves by value + span).
 * `ParseDoc.tree` uses parent-relative spans; comparing two relative trees is a
 * valid structural-equality oracle (both are the same deterministic projection). */
function cstKey(node: CssCstChild | null): unknown {
  if (node == null) {
    return null;
  }
  if (node._tag === 'leaf') {
    return { l: node.value, s: node.span.start, e: node.span.end };
  }
  if (node._tag === 'error') {
    return { err: node.type, s: node.span.start, e: node.span.end, c: node.children.map(cstKey) };
  }
  return { t: node.type, s: node.span.start, e: node.span.end, c: node.children.map(cstKey) };
}

type Lang = 'css' | 'less' | 'scss';

function uriFor(lang: Lang): string {
  return `file:///edit-test.${lang}`;
}

describe('Parseman .edit() incremental sync — equivalence oracle', () => {
  /*
   * Each case: initial source + a sequence of single-range edits expressed as
   * (from, to, replacement) byte offsets against the CURRENT text.
   */
  const cases: Record<Lang, { initial: string; edits: Array<[number, number, string]> }> = {
    css: {
      initial: 'a { color: red; }\n.b { width: 10px; }\n',
      edits: [
        [11, 14, 'blue'],                 // red -> blue
        [0, 0, '/* head */\n'],            // prepend a comment
        [-1, -1, '.c { height: 5px; }\n'] // append (sentinel -1 => end)
      ]
    },
    less: {
      initial: '@c: red;\n.a { color: @c; }\n.b { width: 10px; }\n',
      edits: [
        [-1, -1, '.mix() { margin: 0; }\n'],
        [0, 8, '@c: green;'],
        [-1, -1, '.d { .mix(); }\n']
      ]
    },
    scss: {
      initial: '$c: red;\n.a { color: $c; }\n.b { width: 10px; }\n',
      edits: [
        [-1, -1, '@mixin m { padding: 1px; }\n'],
        [0, 8, '$c: green;'],
        [-1, -1, '.d { @include m; }\n']
      ]
    }
  };

  for (const lang of ['css', 'less', 'scss'] as const) {
    it(`[${lang}] change() (diff-driven .edit()) tracks full reparse across a sequence`, () => {
      const { initial, edits } = cases[lang];
      const engine = createEngine();
      const uri = uriFor(lang);
      engine.open(uri, lang, 1, initial);

      let text = initial;
      let version = 1;
      for (const [from0, to0, repl] of edits) {
        const from = from0 < 0 ? text.length : from0;
        const to = to0 < 0 ? text.length : to0;
        text = text.slice(0, from) + repl + text.slice(to);
        version++;

        /*
         * Full-text change notification — the engine recovers the minimal edit and
         * drives ParseDoc.edit() under the hood.
         */
        engine.change(uri, version, text);
      }

      /*
       * Oracle 1: the incrementally-synced CST equals a from-scratch parse of the
       * final text (compare against a fresh engine opened on that exact text).
       */
      const fresh = createEngine();
      fresh.open(uri, lang, 1, text);
      expect(cstKey(engine._debugState(uri).cstTree)).toEqual(cstKey(fresh._debugState(uri).cstTree));

      // Oracle 2: observable features agree with the fresh engine.
      expect(engine.getDiagnostics(uri)).toEqual(fresh.getDiagnostics(uri));
      expect(engine.getDocumentSymbols(uri)).toEqual(fresh.getDocumentSymbols(uri));

      // The incremental path was actually taken (not a full-rebuild fallback).
      expect(engine._debugState(uri).editApplied).toBeGreaterThan(0);
    });

    it(`[${lang}] edit() (LSP incremental ranges) tracks full reparse`, () => {
      const { initial, edits } = cases[lang];
      const engine = createEngine();
      const uri = uriFor(lang);
      engine.open(uri, lang, 1, initial);

      let text = initial;
      let version = 1;
      for (const [from0, to0, repl] of edits) {
        const from = from0 < 0 ? text.length : from0;
        const to = to0 < 0 ? text.length : to0;
        const doc = TextDocument.create(uri, lang, version, text);
        const range = Range.create(doc.positionAt(from), doc.positionAt(to));
        text = text.slice(0, from) + repl + text.slice(to);
        version++;
        engine.edit(uri, version, [{ range, text: repl }]);
      }

      const fresh = createEngine();
      fresh.open(uri, lang, 1, text);
      expect(cstKey(engine._debugState(uri).cstTree)).toEqual(cstKey(fresh._debugState(uri).cstTree));
      expect(engine.getDiagnostics(uri)).toEqual(fresh.getDiagnostics(uri));
      expect(engine.getDocumentSymbols(uri)).toEqual(fresh.getDocumentSymbols(uri));
      expect(engine._debugState(uri).editApplied).toBeGreaterThan(0);
    });
  }

  it('multi-range edit() batches fall back to a correct full rebuild', () => {
    const engine = createEngine();
    const uri = uriFor('scss');
    const initial = '$c: red;\n.a { color: $c; }\n';
    engine.open(uri, 'scss', 1, initial);

    const doc = TextDocument.create(uri, 'scss', 1, initial);

    // Two disjoint ranges in one notification — not expressible as one .edit().
    const c1 = { range: Range.create(doc.positionAt(4), doc.positionAt(7)), text: 'green' };
    const c2 = { range: Range.create(doc.positionAt(0), doc.positionAt(0)), text: '// top\n' };
    engine.edit(uri, 2, [c2, c1]);

    const finalText = TextDocument.update(doc, [c2, c1], 2).getText();
    const fresh = createEngine();
    fresh.open(uri, 'scss', 1, finalText);
    expect(cstKey(engine._debugState(uri).cstTree)).toEqual(cstKey(fresh._debugState(uri).cstTree));
    expect(engine.getDiagnostics(uri)).toEqual(fresh.getDiagnostics(uri));
    expect(engine._debugState(uri).fullRebuild).toBeGreaterThan(0);
  });

  it('rename multi-site edits re-sync incrementally via .edit() and match a full reparse', () => {
    /*
     * Dogfood: a rename touches N sites; feeding each site back through the LSP
     * incremental `edit()` entry drives ParseDoc.edit() once per site. The oracle
     * is that the incrementally-synced CST (and observable analysis) after the
     * whole multi-site rename equals a from-scratch parse of the renamed text.
     */
    const engine = createEngine();
    const uri = uriFor('less');
    const initial = '@primary: red;\n.a { color: @primary; }\n.b { border-color: @primary; }\n';
    engine.open(uri, 'less', 1, initial);

    const editApplied0 = engine._debugState(uri).editApplied;

    // Rename `@primary` -> `@brand` from a reference site.
    const workspaceEdit = engine.rename(uri, Position.create(1, 14), 'brand');
    expect(workspaceEdit).not.toBeNull();
    const changes = workspaceEdit?.changes?.[uri] ?? [];
    expect(changes.length).toBe(3);

    /*
     * Offsets in `changes` are against `initial`. Apply right-to-left so each
     * higher-offset edit does not invalidate the lower-offset ranges still pending.
     */
    const refDoc = TextDocument.create(uri, 'less', 1, initial);
    const ordered = [...changes].sort((a, b) => refDoc.offsetAt(b.range.start) - refDoc.offsetAt(a.range.start));

    let expected = initial;
    let version = 1;
    for (const e of ordered) {
      const from = refDoc.offsetAt(e.range.start);
      const to = refDoc.offsetAt(e.range.end);
      expected = expected.slice(0, from) + e.newText + expected.slice(to);
      version++;
      engine.edit(uri, version, [{ range: e.range, text: e.newText }]);
    }

    expect(expected).toBe('@brand: red;\n.a { color: @brand; }\n.b { border-color: @brand; }\n');

    // Each of the 3 sites took the incremental `.edit()` path (no full rebuild).
    expect(engine._debugState(uri).editApplied - editApplied0).toBe(3);

    // Oracle: incremental CST + observable analysis equal a fresh parse.
    const fresh = createEngine();
    fresh.open(uri, 'less', 1, expected);
    expect(cstKey(engine._debugState(uri).cstTree)).toEqual(cstKey(fresh._debugState(uri).cstTree));
    expect(engine.getDiagnostics(uri)).toEqual(fresh.getDiagnostics(uri));
    expect(engine.getDocumentSymbols(uri)).toEqual(fresh.getDocumentSymbols(uri));

    // The renamed symbol is fully re-resolved: no undefined-variable diagnostics.
    expect(engine.getDiagnostics(uri).filter(d => d.code === 'var/undefined')).toHaveLength(0);
  });

  it('does not crash on malformed incremental input (css/less/scss)', () => {
    for (const lang of ['css', 'less', 'scss'] as const) {
      const engine = createEngine();
      const uri = uriFor(lang);
      engine.open(uri, lang, 1, 'a { color: red; }\n');

      /*
       * A sequence that passes through several malformed intermediate states:
       * unbalanced brace, unterminated comment, stray tokens.
       */
      const badEdits: Array<[number, number, string]> = [
        [17, 17, '\n.b { '],        // open a block, never close
        [-1, -1, 'color: ;;; )'],   // stray/invalid value tokens
        [-1, -1, '\n/* unterminated'],
        [0, 0, '@@@ '],             // garbage at the top
        [-1, -1, ' }']              // partial recovery
      ];
      let text = 'a { color: red; }\n';
      let version = 1;
      for (const [from0, to0, repl] of badEdits) {
        const from = from0 < 0 ? text.length : from0;
        const to = to0 < 0 ? text.length : to0;
        text = text.slice(0, from) + repl + text.slice(to);
        version++;
        expect(() => engine.change(uri, version, text)).not.toThrow();

        // Every query still works and never throws.
        expect(() => engine.getDiagnostics(uri)).not.toThrow();
        expect(() => engine.getDocumentSymbols(uri)).not.toThrow();
      }

      // Even after the malformed run, the incremental CST still matches a fresh parse.
      const fresh = createEngine();
      fresh.open(uri, lang, 1, text);
      expect(cstKey(engine._debugState(uri).cstTree)).toEqual(cstKey(fresh._debugState(uri).cstTree));
    }
  });
});
