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
    const dispatchers = [
      ['walkBody', /function walkBody\(/u],
      ['emitNestedBody', /function emitNestedBody\(/u]
    ].filter(([, pattern]) => pattern.test(SOURCE)).map(([name]) => name);

    expect(dispatchers).toEqual(['walkBody', 'emitNestedBody']);
  });

  it('names every output-setting read that can select evaluation behavior', () => {
    expect(occurrences(/\be\.collapse\b/gu)).toBe(2);
    expect(SOURCE).toContain(
      'if (!e.collapse && e.referenceImportDepth === 0 && !hasDynamicImportTarget)'
    );
    expect(SOURCE).toContain('function emitNestedRuleGuarded(');
    expect(SOURCE).toContain('  if (!e.collapse) {');
  });

  it('pins the leaf-shape and pending-comment debt removed by slice 1', () => {
    expect(occurrences(/new WeakMap<Leaf\[\], string\[\]>\(\)/gu)).toBe(1);
    expect(occurrences(/pendingLeafBlockComments\.(?:get|set|delete)\(/gu)).toBe(8);
    expect(occurrences(/\.\.\.\(imp \? \{ important: true \} : \{\}\)/gu)).toBe(3);
    expect(occurrences(/\.\.\.\(applyExpansion \? \{ fromApply: true \} : \{\}\)/gu)).toBe(2);
  });
});
