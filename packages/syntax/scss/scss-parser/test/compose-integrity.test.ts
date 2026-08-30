import { describe, expect, it } from 'vitest';
import { run } from 'parseman';

import { scssGrammar } from '../src/grammar.js';
import { parseScssCst } from '../src/cst.js';

/**
 * Regression guard for the folded SCSS grammar. Importing the public grammar must
 * not emit a missing-rule or runtime-fallback diagnostic, and the package must
 * not grow a hidden Less-based route while SCSS has its own host-mode grammar.
 */
describe('SCSS grammar compose integrity', () => {
  it('imports the folded grammar with no missing-rule fallback or Less-only leakage', async () => {
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

    for (const rule of ['Stylesheet', 'ValueAtom', 'MixinCallArgument']) {
      expect(Object.hasOwn(grammar, rule), `folded SCSS grammar is missing rule "${rule}"`).toBe(true);
    }
    for (const rule of ['DetachedRuleset', 'AnonymousMixinDefinition', 'ExtendStatement', 'EachFor', 'VarCall', 'VariableCall', 'ImportOption', 'ImportOptions']) {
      expect(Object.hasOwn(grammar, rule), `Less-only rule "${rule}" leaked into SCSS grammar`).toBe(false);
    }
  });

  it('rejects Less-only declarations and rule-body constructs instead of reaching hidden Less routes', () => {
    for (const source of [
      '.a { font+: Arial; }',
      '.a { font+_: Arial; }',
      '.a { .mixin(); }',
      '.a { .mixin(1, 2); }',
      '.a { &:extend(.b all); }',
      '.mixin() { color: red; }',
      '.a { #ns.mixin(); }',
      '@detached: { color: red; };'
    ]) {
      const cst = parseScssCst(source);
      const ast = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });

      expect(cst.errors.length > 0 || cst.unconsumedFrom !== null, source).toBe(true);
      expect(ast.ok && ast.unconsumedFrom === null, source).toBe(false);
    }
  });

  it('keeps Less-looking at-rules on the generic at-rule path, not Less routes', () => {
    for (const [source, shape] of [
      ['@color: red;', {
        rules: [{ type: 'AtRuleStatement', name: '@color', prelude: { type: 'Any', src: ': red' } }]
      }],
      ['.a { @color: red; }', {
        rules: [{ type: 'Ruleset', rules: [{ type: 'AtRuleStatement', name: '@color', prelude: { type: 'Any', src: ': red' } }] }]
      }],
      ['@plugin "x";', {
        rules: [{ type: 'AtRuleStatement', name: '@plugin', prelude: { type: 'Any', src: '"x"' } }]
      }],
      ['.a { @detached(); }', {
        rules: [{ type: 'Ruleset', rules: [{ type: 'AtRuleStatement', name: '@detached', prelude: { type: 'Any', src: '()' } }] }]
      }]
    ] as const) {
      const ast = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });

      expect(ast.ok && ast.unconsumedFrom === null, source).toBe(true);
      if (!ast.ok || ast.unconsumedFrom !== null) {
        continue;
      }
      expect(ast.value, source).toMatchObject(shape);
      expect(JSON.stringify(ast.value), source).not.toContain('VariableDeclaration');
      expect(JSON.stringify(ast.value), source).not.toContain('VariableCall');
      expect(JSON.stringify(ast.value), source).not.toContain('DetachedRuleset');
    }
  });
});
