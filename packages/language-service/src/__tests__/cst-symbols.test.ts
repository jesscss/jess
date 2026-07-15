import { describe, it, expect } from 'vitest';
import { Position, type Range } from 'vscode-languageserver-types';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createEngine } from '../engine.js';

// Symbol resolution (definition / references / rename) is grounded in the
// tolerant, incremental CST (Option B), so it keeps working on half-typed or
// otherwise invalid documents where the eval AST would yield nothing. These
// tests pin that tolerance: each fixture is deliberately broken past the symbol
// of interest, yet navigation and rename still resolve it.

function doc(languageId: string, content: string): TextDocument {
  return TextDocument.create(`file:///tol.${languageId}`, languageId, 1, content);
}

// Apply a WorkspaceEdit's edits for one uri to `text` (right-to-left so earlier
// offsets stay valid).
function applyEdits(text: string, uri: string, edit: { changes?: Record<string, Array<{ range: Range; newText: string }>> } | null): string {
  const d = TextDocument.create(uri, 'less', 1, text);
  const edits = edit?.changes?.[uri] ?? [];
  const sorted = [...edits].sort((a, b) => d.offsetAt(b.range.start) - d.offsetAt(a.range.start));
  let out = text;
  for (const e of sorted) {
    out = out.slice(0, d.offsetAt(e.range.start)) + e.newText + out.slice(d.offsetAt(e.range.end));
  }
  return out;
}

describe('CST symbol tolerance', () => {
  it('finds a Less variable definition when a later block is broken', () => {
    const engine = createEngine();
    // The trailing `.broken {{` never closes — a hard parse error for the AST.
    const d = doc('less', '@primary: red;\na { color: @primary; }\n.broken {{');
    engine.open(d.uri, d.languageId, d.version, d.getText());

    const def = engine.findDefinition(d.uri, Position.create(1, 14));
    expect(def).not.toBeNull();
    expect(def?.uri).toBe(d.uri);
    expect(def?.range.start.line).toBe(0);
  });

  it('finds a Less variable definition on a half-typed (unclosed) reference', () => {
    const engine = createEngine();
    // No closing `;` / `}` after the reference.
    const d = doc('less', '@primary: red;\na { color: @primary');
    engine.open(d.uri, d.languageId, d.version, d.getText());

    const def = engine.findDefinition(d.uri, Position.create(1, 14));
    expect(def).not.toBeNull();
    expect(def?.range.start.line).toBe(0);
  });

  it('finds references from the declaration despite trailing garbage', () => {
    const engine = createEngine();
    const d = doc('less', '@primary: red;\na { color: @primary; }\nb { background: @primary; }\n.broken {{');
    engine.open(d.uri, d.languageId, d.version, d.getText());

    // Cursor on the declaration name (`@primary` -> column 2 is inside `primary`).
    const refs = engine.findReferences(d.uri, Position.create(0, 2));
    // declaration + 2 references, all resolved off the tolerant CST.
    expect(refs.length).toBeGreaterThanOrEqual(3);
  });

  it('renames a Less variable on a document with an unterminated tail block', () => {
    const engine = createEngine();
    const src = '@primary: red;\na { color: @primary; }\n.x {';
    const d = doc('less', src);
    engine.open(d.uri, d.languageId, d.version, d.getText());

    const edit = engine.rename(d.uri, Position.create(1, 14), 'brand');
    expect(edit).not.toBeNull();
    const result = applyEdits(src, d.uri, edit);
    expect(result).toContain('@brand: red;');
    expect(result).toContain('color: @brand;');
    expect(result).not.toContain('@primary');
  });

  it('prepareRename yields the bare identifier on a broken document', () => {
    const engine = createEngine();
    const d = doc('less', '@primary: red;\na { color: @primary; }\n.broken {{');
    engine.open(d.uri, d.languageId, d.version, d.getText());

    const prep = engine.prepareRename(d.uri, Position.create(1, 14));
    expect(prep).not.toBeNull();
    expect(prep?.placeholder).toBe('primary');
  });

  it('finds an SCSS variable definition when a later block is broken', () => {
    const engine = createEngine();
    const d = doc('scss', '$primary: red;\na { color: $primary; }\n.broken {{');
    engine.open(d.uri, d.languageId, d.version, d.getText());

    const def = engine.findDefinition(d.uri, Position.create(1, 14));
    expect(def).not.toBeNull();
    expect(def?.range.start.line).toBe(0);
  });
});

// SCSS `@mixin foo` / `@include foo` / `@function bar` are distinct grammarTypes
// (`ScssMixin` / `ScssInclude` / `ScssFunction`) from the Less mixin nodes. These
// pin that every CST navigation feature now resolves them (regression: the CST
// migration only knew the Less `MixinCall`/`MixinOrQualifiedRule` shapes, so every
// SCSS mixin was invisible to definition / references / rename / prepareRename).
describe('CST symbols resolve SCSS mixins (@mixin / @include)', () => {
  const src = '@mixin foo($a) { color: $a; }\n.x { @include foo(red); }\n.y { @include foo(blue); }';
  // Offset of the FIRST `@include foo` name and the `@mixin foo` def name.
  const includeFooCol = '.x { @include '.length; // start of `foo` on line 1

  it('go-to-definition on an @include resolves the @mixin definition', () => {
    const engine = createEngine();
    const d = doc('scss', src);
    engine.open(d.uri, d.languageId, d.version, d.getText());

    const def = engine.findDefinition(d.uri, Position.create(1, includeFooCol + 1));
    expect(def).not.toBeNull();
    expect(def?.range.start.line).toBe(0);
  });

  it('find-references from the @mixin definition returns the def + both @include calls', () => {
    const engine = createEngine();
    const d = doc('scss', src);
    engine.open(d.uri, d.languageId, d.version, d.getText());

    // Cursor on the `foo` of `@mixin foo` (line 0, after `@mixin `).
    const refs = engine.findReferences(d.uri, Position.create(0, '@mixin fo'.length));
    expect(refs.length).toBeGreaterThanOrEqual(3);
  });

  it('rename rewrites the @mixin name and every @include call', () => {
    const engine = createEngine();
    const d = doc('scss', src);
    engine.open(d.uri, d.languageId, d.version, d.getText());

    const edit = engine.rename(d.uri, Position.create(1, includeFooCol + 1), 'bar');
    expect(edit).not.toBeNull();
    const result = applyEdits(src, d.uri, edit);
    expect(result).toContain('@mixin bar($a)');
    expect(result).toContain('@include bar(red)');
    expect(result).toContain('@include bar(blue)');
    expect(result).not.toContain('foo');
  });

  it('prepareRename on an @include yields the bare mixin name', () => {
    const engine = createEngine();
    const d = doc('scss', src);
    engine.open(d.uri, d.languageId, d.version, d.getText());

    const prep = engine.prepareRename(d.uri, Position.create(1, includeFooCol + 1));
    expect(prep).not.toBeNull();
    expect(prep?.placeholder).toBe('foo');
  });
});
