/**
 * Corpus 02 — Variables & references.
 *
 *   $name: value;      → VarDeclaration (name has no `$`)
 *   $foo               → Reference (variable)
 *   $foo.bar           → Reference chain (declaration lookup)
 *   $foo[0] / $foo[-1] → Reference (index)
 *   $foo['k']          → Reference (property lookup, Quoted key)
 *   $foo?              → optional reference (fallbackValue)
 *   +: / ?:            → assignment ops on VarDeclaration
 */
import { describe, it, expect } from 'vitest';
import { sourceSpanOf, type Node } from '@jesscss/core';
import { expectAst, expectAstContains, parse } from './_util.js';
import { parseJessFn } from '../../src/functional-parser.js';

/** First `Reference`-typed node found by a pre-order walk. */
function firstReference(root: unknown): Node | undefined {
  const seen = new Set<unknown>();
  const walk = (n: unknown): Node | undefined => {
    if (!n || typeof n !== 'object' || seen.has(n)) {
      return undefined;
    }
    seen.add(n);
    // `type` is a prototype getter on AST nodes — read it prototype-aware (own-only
    // `Object.entries` would miss it); children live in own enumerable props.
    if (Reflect.get(n, 'type') === 'Reference') {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return n as unknown as Node;
    }
    for (const [k, v] of Object.entries(n)) {
      if (k === 'parent') {
        continue;
      }
      const hit = Array.isArray(v) ? v.map(walk).find(Boolean) : walk(v);
      if (hit) {
        return hit;
      }
    }
    return undefined;
  };
  return walk(root);
}

/** Parse a top-level `$name…;` and return the VarDeclaration node's own
 * serialization (a top-level VarDeclaration is invisible in full CSS output). */
function varDeclSyntax(src: string): string {
  const { tree } = parse(src);
  type Serializable = { toTrimmedString(): string };
  type Holder = { rules?: Serializable[]; value?: Serializable[] };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const holder = tree as unknown as Holder;
  const node = holder.rules?.[0] ?? holder.value?.[0];
  return node!.toTrimmedString();
}

describe('corpus/variables', () => {
  it('variable declaration (keyword value)', () => {
    expectAst('$color: red;', `
      (Rules
        rules:
          [
            (VarDeclaration
              name: 'color'
              value:
                (Keyword [role=keyword] 'red')
            )
          ]
      )`);
  });

  it('variable declaration (dimension value)', () => {
    expectAstContains('$size: 16px;', `
      (VarDeclaration
        name: 'size'
        value:
          (Dimension
            number: 16
            unit: 'px'
          )
      )`);
  });

  it('no variable `+:` operator — write compound-add explicitly', () => {
    // There is NO Jess VARIABLE `+:` compound-add operator: `$foo +: 1` is not a
    // valid variable assignment and does not parse. (Less PROPERTY `+:` merge is a
    // separate feature on plain Declarations — see NOTES `legacyMerge` design.)
    expect(parseJessFn('$foo +: 1;', 'Stylesheet').errors.length).toBeGreaterThan(0);
    // Variable compound-add is written explicitly as `$foo: $foo + value`. Because
    // the RHS leads with a `$var`, the unwrapped arithmetic applies — `$n + 1`
    // builds an Operation (see corpus 13). No `$(…)` wrapper needed.
    expectAstContains('$n: $n + 1;', `
      (VarDeclaration
        name: 'n'
        value:
          (Operation
            left:
              (Reference
                key: 'n'
              )
            right:
              (Num 1)
          )
      )`);
  });

  it('conditional-assign (default-assignment) $foo?:', () => {
    // Canonical form: `?` glued to the name, directly before the colon (Jess's
    // equivalent of SCSS `!default`, which is NOT Jess).
    expectAstContains('$x?: 1;', `
      (VarDeclaration
          assign: '?:'
        name: 'x'`, { showOptions: true });
    // The VarDeclaration round-trips to the canonical GLUED form (no space before
    // the colon); the spaced authored form NORMALIZES to it too. (A top-level
    // VarDeclaration is invisible in full CSS output, so assert the node's own
    // serialization.)
    expect(varDeclSyntax('$x?: 1;')).toBe('$x?: 1');
    expect(varDeclSyntax('$x ?: 1;')).toBe('$x?: 1');
  });

  it('nearest-outer (non-shadowing) assign := ', () => {
    // `$foo := bar` reassigns the NEAREST enclosing scope that already defines
    // `$foo` (JS-block style), NOT the global binding. It carries a `nearestOuter`
    // marker — DISTINCT from Sass `!global` (core's `setDefined`); the two must not
    // share a flag. `:=` must win over `:` + a `=`-led value (was a mis-parse).
    // Eval (nearest-outer scope-walk) is DEFERRED — currently no eval effect (see
    // NOTES), which is preferable to wrong `!global` eval.
    expectAstContains('$foo := bar;', `
      (VarDeclaration
          nearestOuter: true
        name: 'foo'`, { showOptions: true });
    // Round-trips SPACED — `$foo := bar`. (`:=` is synthesized from nearestOuter in
    // serialization; `assign` stays the default `:`.)
    expect(varDeclSyntax('$foo := bar;')).toBe('$foo := bar');
  });

  it('live-binding assignment $!foo: — parses + warns (eval TODO)', () => {
    // `$!foo: bar` is the live-binding ASSIGNMENT (the `$!` sigil, mirroring the
    // `$!foo` read form). The parser ACCEPTS it (the `!` is stripped from the name
    // and recorded as `liveBinding`), and emits a warning that it is not yet
    // evaluated. Eval ("assign through the live binding") is a TODO (see NOTES).
    expectAstContains('$!foo: bar;', `
      (VarDeclaration
          liveBinding: true
        name: 'foo'`, { showOptions: true });
    // Round-trips WITH the `$!` sigil.
    expect(varDeclSyntax('$!foo: bar;')).toBe('$!foo: bar');
    // A parser warning surfaces on `result.warnings`.
    const warnings = parseJessFn('$!foo: bar;', 'Stylesheet').warnings;
    expect(warnings.some(w => w.deprecation === 'live-binding-assignment')).toBe(true);
  });

  it('variable declaration with !important', () => {
    expectAst('$c: red !important;', `
      (Rules
        rules:
          [
            (VarDeclaration
              name: 'c'
              value:
                (Keyword [role=keyword] 'red')
              important: '!important'
            )
          ]
      )`);
  });

  it('reference in value position', () => {
    expectAst('.a { color: $primary; }', `
      (Rules
        rules:
          [
            (Ruleset
              selector: '.a'
              rules:
                [
                  (Declaration
                    name: 'color'
                    value:
                      (Reference
                        key: 'primary'
                      )
                  )
                ]
            )
          ]
      )`);
  });

  it('AST Reference span excludes the `$` sigil (sigil is expression syntax, CST-only)', () => {
    const src = '.a { color: $primary; }';
    const { tree } = parse(src);
    const ref = firstReference(tree);
    expect(ref).toBeDefined();
    const span = sourceSpanOf(ref!);
    expect(span).toBeTruthy();
    // The span must cover `primary`, NOT `$primary` — the `$` is not stored in the AST.
    expect(src.slice(Number(span!.start), Number(span!.end))).toBe('primary');
  });

  it('dot access (declaration lookup)', () => {
    expectAstContains('.a { color: $theme.primary; }', `
      (Declaration
        name: 'color'
        value:
          (Reference
            target:
              (Reference
                key: 'theme'
              )
            key: 'primary'
          )
      )`);
  });

  it('chained dot access', () => {
    expectAstContains('.a { color: $theme.colors.primary; }', `
      (Reference
        target:
          (Reference
            target:
              (Reference
                key: 'theme'
              )
            key: 'colors'
          )
        key: 'primary'
      )`);
  });

  it('index access', () => {
    expectAstContains('.a { color: $colors[0]; }', `
      (Reference
        target:
          (Reference
            key: 'colors'
          )
        key:
          (Num 0)
      )`);
  });

  it('negative index access', () => {
    expectAstContains('.a { color: $sizes[-1]; }', `
      (Reference
        target:
          (Reference
            key: 'sizes'
          )
        key:
          (Num -1)
      )`);
  });

  it('property lookup with quoted key', () => {
    expectAstContains('.a { color: $c[\'border-color\']; }', `
      (Reference
        target:
          (Reference
            key: 'c'
          )
        key:
          (Quoted
            value: 'border-color'
          )
      )`);
  });

  it('bracket bare ident is a variable lookup ($theme[foo] ≡ $foo on theme)', () => {
    expectAstContains('.a { color: $theme[foo]; }', `
      (Reference
        target:
          (Reference
            key: 'theme'
          )
        key: 'foo'
      )`);
  });

  it('bracket quoted key is a property lookup', () => {
    expectAstContains('.a { color: $theme[\'foo\']; }', `
      (Reference
        target:
          (Reference
            key: 'theme'
          )
        key:
          (Quoted
            value: 'foo'
          )
      )`);
  });

  it('dynamic key access ($base[$key] — the variable value is the key)', () => {
    expectAstContains('.a { color: $theme[$key]; }', `
      (Reference
        target:
          (Reference
            key: 'theme'
          )
        key:
          (Reference
            key: 'key'
          )
      )`);
  });

  it('accessor lookup TYPES: .foo=declaration, [foo]=variable, [\'foo\']=property, [0]/[$k]=index', () => {
    // The key FORM chooses the lookup type; all bracket forms render `[key]`.
    expectAstContains('.a { x: $t.foo; }', '(Reference\n    type: \'declaration\'', { showOptions: true });
    expectAstContains('.a { x: $t[foo]; }', '(Reference\n    type: \'variable\'\n  target:', { showOptions: true });
    expectAstContains('.a { x: $t[\'foo\']; }', '(Reference\n    type: \'property\'\n  target:', { showOptions: true });
    expectAstContains('.a { x: $t[0]; }', '(Reference\n    type: \'index\'', { showOptions: true });
    expectAstContains('.a { x: $t[$k]; }', '(Reference\n    type: \'index\'', { showOptions: true });
  });

  it('live binding ($!foo → readMode snapshot, renders $!foo)', () => {
    expectAstContains('.a { color: $!color; }', `
      (Reference
          type: 'variable'
          readMode: 'snapshot'
        key: 'color'
      )`, { showOptions: true });
  });

  it('optional reference (trailing ?)', () => {
    expectAstContains('.a { color: $maybe?; }', `
      (Reference
          type: 'variable'
          fallbackValue: true
        key: 'maybe'
      )`, { showOptions: true });
  });
});
