import { describe, expect, it } from 'vitest';

/**
 * Regression guard for the Jess CST grammar `compose()` (css -> jess). See the
 * scss-parser counterpart for the rationale: a cross-grammar rule reference that
 * points at a missing rule name makes parseman's `compose()` throw
 * `compose: rule "X" references missing rule "Y"` or fall back to the runtime
 * interpreter — and a stale incremental build can mask it. Importing the composed
 * grammar forces a fresh compose and surfaces any such break.
 */
describe('Jess CST grammar compose integrity', () => {
  it('composes css -> jess with every referenced rule resolved and no Less grammar leakage', async () => {
    const captured: string[] = [];
    const origWarn = console.warn;
    const origError = console.error;
    const record = (...args: unknown[]): void => {
      captured.push(args.map(String).join(' '));
    };
    console.warn = record;
    console.error = record;

    let grammar: Record<string, unknown>;
    try {
      const mod = await import('../src/grammar.js') as { jessGrammar: Record<string, unknown> };
      grammar = mod.jessGrammar;
    } finally {
      console.warn = origWarn;
      console.error = origError;
    }

    const issues = captured.filter(message =>
      /compose\b|missing rule|references missing|falling back to runtime/i.test(message));
    expect(issues, `compose() emitted missing-rule / runtime-fallback diagnostics:\n${issues.join('\n')}`).toEqual([]);

    expect(Object.keys(grammar).length, 'composed Jess grammar has no rules').toBeGreaterThan(0);

    for (const rule of ['DetachedRuleset', 'AnonymousMixinDefinition', 'ExtendStatement', 'EachFor', 'VariableCall']) {
      expect(Object.hasOwn(grammar, rule), `Less-only rule "${rule}" leaked into Jess grammar`).toBe(false);
    }
    const leaked = Object.keys(grammar).filter(rule => rule.startsWith('DirectLess'));
    expect(leaked, `Less-prefixed rules leaked into Jess grammar:\n${leaked.join('\n')}`).toEqual([]);
  });
});
