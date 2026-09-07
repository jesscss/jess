import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SERIALIZE_PATH = fileURLToPath(new URL('../serialize.ts', import.meta.url));
const SOURCE = readFileSync(SERIALIZE_PATH, 'utf8');

function occurrences(pattern: RegExp): number {
  return [...SOURCE.matchAll(pattern)].length;
}

describe('V19 one-evaluator projection ratchet', () => {
  it('names every statement evaluator that still dispatches a body', () => {
    /*
     * V19 slice 5: the second body dispatcher (`emitNestedBody`) is deleted; the
     * one evaluator `walkBody` drives both write projections. The removed pattern
     * stays listed so a re-introduced nested dispatcher fails this gate.
     */
    const dispatchers = ([
      ['walkBody', /function walkBody\(/u],
      ['emitNestedBody', /function emitNestedBody\(/u]
    ] as const).filter(([, pattern]) => pattern.test(SOURCE)).map(([name]) => name);

    expect(dispatchers).toEqual(['walkBody']);
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
    expect(occurrences(/\be\.collapse\b/gu)).toBe(1);
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
    expect(occurrences(/return \{ node, frame, important, leadingBlockComments, fromApply \};/gu)).toBe(1);
    expect(occurrences(/place\(\{ node, frame, important, leadingBlockComments: null, fromApply \}\);/gu)).toBe(2);
    expect(occurrences(/place\(\{ node: part, frame, important, leadingBlockComments: null, fromApply \}\);/gu)).toBe(1);
    expect(SOURCE).toContain('pendingLeafBlockComments: string[] | null;');
    expect(SOURCE).toContain('pendingLeafBlockCommentOwner: Leaf[] | null;');
  });

  it('does not grow the serializer helper or collection-construction surface', () => {
    expect(occurrences(/^function |^async function /gmu)).toBe(421);
    expect(occurrences(/new Map/gu)).toBe(58);
    expect(occurrences(/new Set/gu)).toBe(34);
    expect(occurrences(/new WeakMap/gu)).toBe(5);
    expect(occurrences(/const group: Leaf\[\] = \[\]/gu)).toBe(9);

    /*
     * The single nested leaf buffer, now owned by the one evaluator and mode-gated
     * so the collapsed projection allocates none.
     */
    expect(occurrences(/const buf: Leaf\[\] = nested \? \(sharedLeaves\?\.leaves \?\? \[\]\) : MOOT_LEAVES/gu)).toBe(1);
    expect(occurrences(/evaluateLeafStatement\(/gu)).toBe(3);
    expect(occurrences(/evaluateSilentStatement\(/gu)).toBe(5);
  });

  it('keeps one evaluator for callable expansion', () => {
    expect(occurrences(/function expandCall\(/gu)).toBe(1);
    expect(occurrences(/function expandApply\(/gu)).toBe(1);
    expect(occurrences(/function expandReferenceCall\(/gu)).toBe(1);
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
    expect(occurrences(/function expandFor\(/gu)).toBe(1);
    expect(occurrences(/function expandNestedFor\(/gu)).toBe(0);
    expect(occurrences(/expandFor\(/gu)).toBe(6);
    expect(occurrences(/expandNestedFor\(/gu)).toBe(0);
    expect(occurrences(/selectIfBodyForRender\(/gu)).toBe(0);
    expect(occurrences(/selectIfBody\(/gu)).toBe(6);
    expect(occurrences(/runWhile\(/gu)).toBe(6);
  });

  it('keeps one evaluator for containers, at-rules, imports, and hoist placement', () => {
    expect(occurrences(/function expandRule\(/gu)).toBe(1);
    expect(occurrences(/function flatten\(/gu)).toBe(0);
    expect(occurrences(/function emitNestedRule\(/gu)).toBe(0);
    expect(occurrences(/function activateRuleFrame\(/gu)).toBe(1);
    expect(occurrences(/function expandAtRuleBlock\(/gu)).toBe(1);
    expect(occurrences(/function emitAtRuleBlock\(/gu)).toBe(0);
    expect(occurrences(/function emitNestedAtRuleBlock\(/gu)).toBe(0);
    expect(occurrences(/function expandStyleImport\(/gu)).toBe(1);
    expect(occurrences(/function emitStyleImport\(/gu)).toBe(0);
    expect(occurrences(/astExtend\.emit\.nestedHoistPlacements/gu)).toBe(1);
  });
});
