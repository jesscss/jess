/**
 * [tree2-poc] Parallel tree2-native parse front-end — PROOF OF CONCEPT.
 *
 * This is the "actions" layer of a parallel tree2 Less parser: a parseman
 * build host that constructs tree2 nodes DIRECTLY from the grammar's structural
 * `node(type, …)` callbacks, with NO legacy `../tree` AST built and NO bridge
 * walk. It reuses the parseman combinator machinery (`runFunctionalParse` +
 * the existing `lessGrammar` rule structure) but supplies tree2 construction
 * instead of the legacy `buildNode`.
 *
 * Boundary: like the bridge, this front-end file may touch the parser layer and
 * `../tree2`; `tree2/` itself imports nothing from here. It does NOT import the
 * legacy `../tree`.
 *
 * SCOPE: the representative ruleset + static-declaration shape only. It exists to
 * (a) prove byte-identity vs the current parse→legacy→bridge path and (b) let us
 * measure the one-tree front-end against the two-tree one. It is NOT a full
 * grammar; unsupported node types return an inert placeholder (they only ever
 * arise on speculative/backtracked branches for the POC shape, or as value
 * children the Declaration builder re-derives from source and ignores).
 */
import type { FunctionalParseHost } from '@jesscss/css-parser/jess';
import * as t2 from '../tree2/index.js';

/** Inert placeholder for a node type this POC host does not model. */
interface Placeholder { readonly __poc: string; }
function placeholder(type: string): Placeholder { return { __poc: type }; }

/** Static-only value tokenizer (mirrors the bridge's `parseValue` for the
 * `@`-free static case the POC covers). A value carrying `@` is out of POC
 * scope and would route to the same ref/interp logic the bridge already has. */
function pocValue(text: string): t2.ValueNode {
  return t2.word(text);
}

/** Raw value bytes of a `name: value;` declaration from its source span —
 * identical derivation to the bridge's `rawDeclValue`. */
function declParts(src: string, start: number, end: number): { name: string; value: string } {
  const declText = src.slice(start, end);
  const body = declText.replace(/;\s*$/, '');
  const colon = body.indexOf(':');
  const name = body.slice(0, colon).trim();
  const value = body.slice(colon + 1).trim();
  return { name, value };
}

/** Selector bytes of a ruleset head from its first raw child leaf span. */
function selectorText(src: string, children: readonly unknown[], rawChildren: readonly unknown[]): string {
  const first = children[0];
  if (typeof first === 'string') return first.trim();
  // Fall back to the first raw leaf (the `.a` token) span.
  const raw = rawChildren[0] as { span?: { start: number; end: number } } | undefined;
  if (raw?.span) return src.slice(raw.span.start, raw.span.end).trim();
  throw new Error('poc: unrecognized selector shape');
}

export class PocTree2Host implements FunctionalParseHost {
  private _src = '';
  /**
   * The tree2 Root produced by the outermost `Stylesheet` build. Captured here
   * because `runFunctionalParse`'s result coercion recognizes only the LEGACY
   * `Node` type and would otherwise discard a tree2 root. The final parallel
   * parser has its own driver that returns the value directly; the POC reuses
   * the existing driver and reads the root off the host instead.
   */
  root: t2.Root | undefined;

  setSource(s: string): void { this._src = s; this.root = undefined; }
  resetWarnings(): void { /* POC: no warnings */ }
  getWarnings(): Array<{ message: string; deprecation?: string }> { return []; }
  getErrors(): Array<{ message: string; offset?: number; endOffset?: number }> { return []; }
  getLiftedCommentRanges(): ReadonlyArray<readonly [number, number]> { return []; }

  build(
    type: string,
    children: ReadonlyArray<unknown>,
    _fields: unknown,
    span: { start: number; end: number },
    rawChildren: ReadonlyArray<unknown>,
    _triviaLog: readonly number[],
  ): unknown {
    switch (type) {
      case 'Stylesheet': {
        const body = children.filter(isStatement);
        const r = t2.root(body as t2.Statement[]);
        this.root = r;
        return r;
      }
      case 'Ruleset': {
        const sel = selectorText(this._src, children, rawChildren);
        const body = children.filter(isStatement);
        return t2.rule(sel, body as t2.Statement[]);
      }
      case 'Declaration': {
        const { name, value } = declParts(this._src, span.start, span.end);
        return new t2.Declaration(name, pocValue(value));
      }
      default:
        return placeholder(type);
    }
  }
}

/** Only real tree2 nodes count as body statements (placeholders/leaves excluded). */
function isStatement(x: unknown): x is t2.Statement {
  return x instanceof t2.Node;
}
