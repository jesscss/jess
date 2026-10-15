import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from '@typescript/typescript6';
import { describe, expect, it } from 'vitest';

const AST_DIR = fileURLToPath(new URL('..', import.meta.url));

/*
 * The serializer is `serialize.ts` plus, once it is split, every module under
 * `serialize/`. Every count below reads both, so moving code into the directory
 * neither hides it from these gates nor counts it twice.
 */
function serializerFiles(): string[] {
  const dir = join(AST_DIR, 'serialize');
  const nested = existsSync(dir)
    ? readdirSync(dir, { recursive: true, encoding: 'utf8' })
        .filter(entry => entry.endsWith('.ts') && !entry.includes('__tests__'))
        .sort()
        .map(entry => join(dir, entry))
    : [];
  return [join(AST_DIR, 'serialize.ts'), ...nested];
}

const SOURCES = serializerFiles().map(file => ({ file, text: readFileSync(file, 'utf8') }));
const SOURCE = SOURCES.map(s => s.text).join('\n');

/*
 * Every counter in this file is a CEILING: a count may fall, never rise. Lower
 * the ceiling in the change that lowers the count. Raising one is a reviewed
 * edit to this file, and the commit message says why.
 */
function occurrences(pattern: RegExp): number {
  return [...SOURCE.matchAll(pattern)].length;
}

/*
 * The statement kinds a body holds and no value position can: the `Statement`
 * union of `nodes.ts` minus its `ValueNode` union. Read from the source so a new
 * statement kind is seen without editing this test.
 */
function statementOnlyKinds(): ReadonlySet<string> {
  const nodes = ts.createSourceFile('nodes.ts', readFileSync(join(AST_DIR, 'nodes.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
  const members = (alias: string): Set<string> => {
    const decl = nodes.statements.find((st): st is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(st) && st.name.text === alias);
    const names = new Set<string>();
    if (decl && ts.isUnionTypeNode(decl.type)) {
      for (const member of decl.type.types) {
        if (ts.isTypeReferenceNode(member) && ts.isIdentifier(member.typeName)) {
          names.add(member.typeName.text);
        }
      }
    }
    return names;
  };
  const values = members('ValueNode');
  return new Set([...members('Statement')].filter(kind => !values.has(kind)));
}

/* A `case` arm that only computes a value (a classifier such as `placingBody`) is not dispatch. */
function doesWork(node: ts.Node): boolean {
  return ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isAwaitExpression(node)
    || (ts.forEachChild(node, doesWork) ?? false);
}

/*
 * A statement DISPATCHER is a top-level function whose `switch` arms do work
 * (call, construct or await) for at least 4 statement kinds: it evaluates a
 * body's statements one by one. A nested closure counts toward its top-level
 * function. Returns the dispatcher names in source order.
 */
function statementDispatchers(sources: ReadonlyArray<{ file: string; text: string }>, kinds: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const { file, text } of sources) {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    for (const st of sf.statements) {
      const name = ts.isFunctionDeclaration(st)
        ? st.name?.text
        : ts.isVariableStatement(st) ? st.declarationList.declarations[0]?.name.getText(sf) : undefined;
      if (name === undefined) {
        continue;
      }
      const dispatched = new Set<string>();
      const visit = (node: ts.Node): void => {
        if (ts.isCaseBlock(node)) {
          let pending: string[] = [];
          for (const clause of node.clauses) {
            if (ts.isCaseClause(clause) && ts.isStringLiteralLike(clause.expression) && kinds.has(clause.expression.text)) {
              pending.push(clause.expression.text);
            }
            if (clause.statements.length > 0) {
              if (clause.statements.some(doesWork)) {
                pending.forEach(kind => dispatched.add(kind));
              }
              pending = [];
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(st);
      if (dispatched.size >= 4) {
        out.push(name);
      }
    }
  }
  return out;
}

/*
 * A module-global `WeakMap` keyed by a value is a side table every reader of
 * that fact pays a hash lookup for, where a field on the value would be one
 * load (docs/perf/V8-ARCHITECTURE.md, invariants 7 and 11). Counted across
 * every source file of `src/ast/`, not only the serializer: the text-group
 * table that lived in `value-operate.ts` is now the `groups` field of the text
 * values (owner 2026-10-09, ledger J16).
 */
describe('ast/ side-table ratchet', () => {
  it('does not grow the WeakMap side tables of src/ast/', () => {
    let count = 0;
    for (const entry of readdirSync(AST_DIR, { recursive: true, encoding: 'utf8' })) {
      if (entry.endsWith('.ts') && !entry.includes('__tests__')) {
        count += [...readFileSync(join(AST_DIR, entry), 'utf8').matchAll(/new WeakMap/gu)].length;
      }
    }
    expect(count).toBeLessThanOrEqual(16);
  });
});

describe('V19 one-evaluator projection ratchet', () => {
  /*
   * Ledger V19: ONE evaluation walk evaluates a body's statements, for every
   * output projection. Each other dispatcher is a place where a statement can be
   * evaluated differently (a declaration published to the `$prop` timeline in
   * one walk and not in another). These are the dispatchers that remain. The
   * list may only shrink, toward `['walkBody']`: folding one into `walkBody`
   * removes it here, and a new dispatcher fails until it is folded.
   */
  const DISPATCHERS = [
    'writtenBlockBody',
    'emitDocumentStatements',
    'walkBody',
    'walkReferenceAncestorBody',
    'emitAtRuleBody',
    'emitBubbleBody'
  ];

  it('names every statement dispatcher in the serializer', () => {
    const kinds = statementOnlyKinds();
    expect([...kinds]).toEqual(expect.arrayContaining(['Ruleset', 'Declaration', 'MixinCall', 'AtRuleBlock']));
    expect(statementDispatchers(SOURCES, kinds)).toEqual(DISPATCHERS);
  });

  it('the dispatcher detector sees a dispatcher and ignores a classifier', () => {
    const kinds = statementOnlyKinds();
    const probe = (text: string): string[] => statementDispatchers([{ file: 'probe.ts', text }], kinds);
    const arms = ['Ruleset', 'Declaration', 'MixinCall', 'AtRuleBlock'];
    expect(probe(`function walk(n) { const run = () => { switch (n.type) {${arms.map(k => ` case '${k}': go(n); break;`).join('')} } }; }`))
      .toEqual(['walk']);
    expect(probe(`function owns(n) { switch (n.type) {${arms.map(k => ` case '${k}':`).join('')} return true; default: return false; } }`))
      .toEqual([]);
    expect(probe(`function walk(n) { switch (n.type) {${arms.slice(0, 3).map(k => ` case '${k}': go(n); break;`).join('')} } }`))
      .toEqual([]);
  });

  it('routes the nested write projection through the one evaluator via a pure adapter', () => {
    /*
     * `nestedBody` is a calling-convention adapter with NO statement dispatch of
     * its own: it forwards straight to `walkBody`. This proves the nested entry
     * point is not a second dispatcher in disguise.
     */
    expect(SOURCE).toContain('function nestedBody(');
    expect(SOURCE).toMatch(/function nestedBody\([\s\S]*?\n\): MaybePromise<void> \{\n  return walkBody\(/u);
    const nestedBodySource = SOURCE.slice(
      SOURCE.indexOf('function nestedBody('),
      SOURCE.indexOf('function nestedBody(') + 800
    );
    expect(nestedBodySource).not.toContain('switch (node.type)');
  });

  it('names every output-setting read that can select evaluation behavior', () => {
    expect(occurrences(/\be\.collapse\b/gu)).toBeLessThanOrEqual(1);
    expect(SOURCE).toContain(
      'if (!e.collapse && e.referenceImportDepth === 0 && !hasDynamicImportTarget)'
    );
    expect(SOURCE).not.toContain('function emitNestedRuleGuarded(');
  });

  it('keeps one leaf shape and no pending-comment side table', () => {
    expect(occurrences(/new WeakMap<Leaf\[\], string\[\]>\(\)/gu)).toBe(0);
    expect(occurrences(/pendingLeafBlockComments\.(?:get|set|delete)\(/gu)).toBe(0);
    expect(occurrences(/\.\.\.\(imp \? \{ important: true \} : \{\}\)/gu)).toBe(0);
    expect(occurrences(/\.\.\.\(applyExpansion \? \{ fromApply: true \} : \{\}\)/gu)).toBe(0);
    expect(occurrences(/return \{ node, frame, important, leadingBlockComments, fromApply, callBytes \};/gu)).toBeLessThanOrEqual(1);
    expect(occurrences(/place\(\{ node, frame, important, leadingBlockComments: null, fromApply, callBytes: null \}\);/gu)).toBeLessThanOrEqual(2);
    expect(occurrences(/place\(\{ node: part, frame, important, leadingBlockComments: null, fromApply, callBytes: null \}\);/gu)).toBeLessThanOrEqual(1);
    expect(SOURCE).toContain('pendingLeafBlockComments: string[] | null;');
    expect(SOURCE).toContain('pendingLeafBlockCommentOwner: Leaf[] | null;');
  });

  it('does not grow the serializer helper or collection-construction surface', () => {
    expect(occurrences(/^(?:export )?(?:async )?function /gmu)).toBeLessThanOrEqual(617);
    expect(occurrences(/new Map/gu)).toBeLessThanOrEqual(94);
    expect(occurrences(/new Set/gu)).toBeLessThanOrEqual(44);
    expect(occurrences(/new WeakMap/gu)).toBeLessThanOrEqual(11);
    expect(occurrences(/new WeakSet/gu)).toBeLessThanOrEqual(2);
    expect(occurrences(/const group: Leaf\[\] = \[\]/gu)).toBeLessThanOrEqual(9);

    /*
     * The single nested leaf buffer, now owned by the one evaluator and mode-gated
     * so the collapsed projection allocates none.
     */
    expect(occurrences(/const buf: Leaf\[\] = nested \? \(sharedLeaves\?\.leaves \?\? \[\]\) : MOOT_LEAVES/gu)).toBeLessThanOrEqual(1);
    expect(occurrences(/evaluateLeafStatement\(/gu)).toBeLessThanOrEqual(3);
    expect(occurrences(/evaluateSilentStatement\(/gu)).toBeLessThanOrEqual(2);
  });

  it('keeps one evaluator for callable expansion', () => {
    expect(occurrences(/function expandCall\(/gu)).toBeLessThanOrEqual(1);
    expect(occurrences(/function expandApply\(/gu)).toBeLessThanOrEqual(1);
    expect(occurrences(/function expandReferenceCall\(/gu)).toBeLessThanOrEqual(1);
    expect(occurrences(/expandNestedCall\(/gu)).toBe(0);
    expect(occurrences(/expandNestedApply\(/gu)).toBe(0);
    expect(occurrences(/expandNestedReferenceCall\(/gu)).toBe(0);
    expect(occurrences(/CallableBodyWriter/gu)).toBe(0);
    expect(occurrences(/writeCollapsedCallableBody/gu)).toBe(0);
    expect(occurrences(/writeNestedCallableBody/gu)).toBe(0);
    expect(occurrences(/mixinCallHomes/gu)).toBe(0);
    expect(SOURCE).toContain('const aliasWasExcluded = e.excluded.has(alias);');
    expect(SOURCE).toContain('if (!aliasWasExcluded) {\n            e.excluded.delete(alias);\n          }');
  });

  it('keeps one evaluator for control-flow selection and iteration', () => {
    expect(occurrences(/function expandFor\(/gu)).toBeLessThanOrEqual(1);
    expect(occurrences(/function expandNestedFor\(/gu)).toBe(0);
    expect(occurrences(/expandFor\(/gu)).toBeLessThanOrEqual(6);
    expect(occurrences(/expandNestedFor\(/gu)).toBe(0);
    expect(occurrences(/selectIfBodyForRender\(/gu)).toBe(0);

    /* `preselectControlFlow` decides arms through the one condition evaluator, `selectedIfBody` (ruling J2). */
    expect(occurrences(/selectIfBody\(/gu)).toBeLessThanOrEqual(6);
    expect(occurrences(/selectedIfBody\(/gu)).toBeLessThanOrEqual(3);
    expect(occurrences(/runWhile\(/gu)).toBeLessThanOrEqual(6);
  });

  it('keeps one evaluator for containers, at-rules, imports, and hoist placement', () => {
    expect(occurrences(/function expandRule\(/gu)).toBeLessThanOrEqual(1);
    expect(occurrences(/function flatten\(/gu)).toBe(0);
    expect(occurrences(/function emitNestedRule\(/gu)).toBe(0);
    expect(occurrences(/function activateRuleFrame\(/gu)).toBeLessThanOrEqual(1);
    expect(occurrences(/function expandAtRuleBlock\(/gu)).toBeLessThanOrEqual(1);
    expect(occurrences(/function emitAtRuleBlock\(/gu)).toBe(0);
    expect(occurrences(/function emitNestedAtRuleBlock\(/gu)).toBe(0);
    expect(occurrences(/function expandStyleImport\(/gu)).toBeLessThanOrEqual(1);
    expect(occurrences(/function emitStyleImport\(/gu)).toBe(0);
    expect(occurrences(/astExtend\.emit\.nestedHoistPlacements/gu)).toBeLessThanOrEqual(1);
  });
});
