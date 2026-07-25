import { describe, expect, it } from 'vitest';

/**
 * Regression guard for grammar `compose()` integrity across the css -> less -> scss
 * chain. parseman's `compose()` runs when the composed grammar module is imported;
 * if any rule (`Call`, `functionCallArgs`, a call-argument arm, …) references a rule
 * name that is NOT in the composed set, `compose()` throws
 * `compose: rule "X" references missing rule "Y"` or degrades to the runtime
 * interpreter with a "falling back to runtime" warning. A cross-grammar rule rename
 * (e.g. renaming the CST detached-ruleset block rule the scss delta references)
 * reintroduces exactly this class of break, and a stale incremental build can hide it.
 *
 * This test forces a fresh compose (via import), fails on any missing-rule / fallback
 * diagnostic, and pins the specific rules whose cross-grammar reference must resolve.
 */
describe('SCSS CST grammar compose integrity', () => {
  it('composes css -> less -> scss with every referenced rule resolved (no missing-rule fallback)', async () => {
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
      // Importing runs parseman's runtime compose(); a missing rule throws here.
      const mod = await import('../src/grammar.js') as { scssGrammar: Record<string, unknown> };
      grammar = mod.scssGrammar;
    } finally {
      console.warn = origWarn;
      console.error = origError;
    }

    const issues = captured.filter(message =>
      /compose\b|missing rule|references missing|falling back to runtime/i.test(message));
    expect(issues, `compose() emitted missing-rule / runtime-fallback diagnostics:\n${issues.join('\n')}`).toEqual([]);

    /*
     * The composed set must expose the rules whose cross-grammar reference broke when
     * the CST detached-ruleset block rule was renamed. `Call` / `functionCallArgs`
     * (scss delta) reference the less-owned `DetachedRuleset` block and the
     * `AnonymousMixinDefinition` mixin form; all four must be present.
     */
    for (const rule of ['Call', 'functionCallArgs', 'DetachedRuleset', 'AnonymousMixinDefinition']) {
      expect(Object.hasOwn(grammar, rule), `composed SCSS grammar is missing rule "${rule}"`).toBe(true);
    }
  });
});
