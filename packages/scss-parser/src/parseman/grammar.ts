/**
 * ScssGrammar — Parséman-based SCSS parser, extending LessGrammar.
 *
 * Adds SCSS-specific grammar on top of Less (which in turn extends CSS):
 *   - Variable declarations: $var: value [!default|!global];  →  VarDeclaration
 *   - Variable references:   $var                             →  Reference
 *   - Line comments:         // ...  (added to rw trivia)
 *
 * Inherits from LessGrammar:
 *   - Nested rulesets, & ampersand, relative selectors
 *   - anyDeclaration entry point
 *   - atRuleBody, declarationList, Stylesheet overrides
 *   - Less merge operators on Declaration (harmless for SCSS)
 *
 * Chevrotain note: in the Chevrotain architecture, ScssRecursiveParser
 * extends CssRecursiveParser independently of LessRecursiveParser.
 * Here we take the Parséman inheritance chain
 * CssParser → LessGrammar → ScssGrammar to maximise code reuse.
 */

import {
  sequence,
  choice,
  optional,
  regex,
  literal
} from 'parseman';
import type { Span } from 'parseman';
import type { CSTLeaf, CSTError } from 'parseman';
import { LessGrammar } from '@jesscss/less-parser';
import { spannedComponents } from '@jesscss/css-parser';

import {
  type Node,
  type LocationInfo,
  Any,
  VarDeclaration, type VarDeclarationOptions,
  Reference
} from '@jesscss/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type JessNode = Node<any, any>;
type Child = JessNode | CSTLeaf | CSTError;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function spanToLocation(span: Span): LocationInfo {
  return [span.start, 0, 0, span.end, 0, 0];
}

function nodeChildren(children: ReadonlyArray<Child>): JessNode[] {
  return children.filter((c): c is JessNode => c._tag === 'node') as JessNode[];
}

// ---------------------------------------------------------------------------
// ScssGrammar
// ---------------------------------------------------------------------------

export class ScssGrammar extends LessGrammar {
  // ── Override rw to include // line comments ───────────────────────────────
  // Must be declared BEFORE _trivia so the field initializer captures this rw.
  rw = regex(/(?:[ \t\n\r\f]+|\/\/[^\n\r]*|\/\*(?:[^*]|\*(?!\/))*\*\/)+/);
  protected override _trivia = this.rw;

  // ── SCSS $variable token ──────────────────────────────────────────────────
  scssVar = regex(/\$-?[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*/);

  // ── VarDeclaration: $color: value [!default|!global]; ────────────────────
  // Overrides LessGrammar.VarDeclaration (which uses g.lessVar).
  VarDeclaration = (g: any) => sequence(
    g.scssVar,
    literal(':'),
    g.valueList,
    optional(choice(literal('!default'), literal('!global'))),
    optional(literal(';'))
  );

  // ── Reference: $var in value positions ───────────────────────────────────
  // Overrides LessGrammar.Reference (which used g.lessVar + optional accessor).
  Reference = (g: any) => g.scssVar;

  // ── buildNode ─────────────────────────────────────────────────────────────
  /* eslint-disable @typescript-eslint/naming-convention */

  protected override buildNode(
    type: string,
    span: Span,
    children: ReadonlyArray<JessNode | CSTLeaf | CSTError>,
    _state: unknown,
    _rawChildren: ReadonlyArray<{ _tag: string }>
  ): JessNode {
    const loc = spanToLocation(span);
    switch (type) {
      case 'VarDeclaration': return this._buildScssVarDeclaration(_rawChildren, loc);
      case 'Reference':      return this._buildScssReference(children, loc);
      default:               return super.buildNode(type, span, children, _state, _rawChildren);
    }
  }

  /* eslint-enable @typescript-eslint/naming-convention */

  // ── Private SCSS AST builders ─────────────────────────────────────────────
  /* eslint-disable @typescript-eslint/no-unsafe-type-assertion */

  private _buildScssVarDeclaration(rawChildren: ReadonlyArray<{ _tag: string }>, loc: LocationInfo) {
    // strings-not-nodes: name is the bare ident ($ stripped); value via the
    // shared CSS string-AST value builder.
    const items = spannedComponents(rawChildren);
    const rawName = typeof items[0]?.comp === 'string' ? items[0]!.comp : '';
    const name = rawName.startsWith('$') ? rawName.slice(1) : rawName;
    const colonIdx = items.findIndex(i => i.comp === ':');
    let end = items.length;
    for (let i = colonIdx + 1; i < items.length; i++) {
      const c = items[i]!.comp;
      if (c === '!' || c === '!default' || c === '!global' || c === ';') { end = i; break; }
    }
    const { value } = this._assembleValue(items.slice(colonIdx + 1, end), loc);
    const hasImportant = items.some(i => i.comp === '!' || i.comp === '!default' || i.comp === '!global');
    return new VarDeclaration(
      { name, value, important: hasImportant || undefined } as any,
      {} as VarDeclarationOptions,
      loc
    );
  }

  private _buildScssReference(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const varName = ls[0]?.value ?? '';
    const key = varName.startsWith('$') ? varName.slice(1) : varName;
    return new Reference(key, { type: 'variable' }, loc);
  }

  /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */
}
