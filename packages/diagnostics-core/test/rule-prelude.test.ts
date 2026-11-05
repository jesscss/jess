import { expect, it } from 'vitest';
import { collectTolerantDiagnostics } from '../src/index.js';

/* The editor twin of the compiler's `parse/invalid-rule-prelude`, at the prelude (ledger P45). */
it.each([
  ['a declaration with no `;` before a rule', 'a { b: c; }\n.a {\n  font:bold 12px serif\n  .title { color: red; }\n}\n', 3, 3],
  ['a selector pseudo that holds no selector', 'a { b: c; }\n.d {\n  x:not(1) .b { e: f; }\n}\n', 3, 4]
])('scss: %s', (_label, source, line, column) => {
  const reported = collectTolerantDiagnostics({ source, language: 'scss' }).diagnostics
    .filter(diagnostic => diagnostic.code === 'parse/invalid-rule-prelude')
    .map(({ phase, defaultSeverity, message, line, column }) => ({ phase, defaultSeverity, message, line, column }));
  expect(reported).toEqual([
    { phase: 'parse', defaultSeverity: 'error', message: 'This rule\'s prelude is not a selector', line, column }
  ]);
});

it('scss: one report for a prelude that also holds a pseudo no argument rule reads, as the compile gives', () => {
  const reported = collectTolerantDiagnostics({ source: 'x:not(1) 1px { e: f; }', language: 'scss' }).diagnostics
    .filter(diagnostic => diagnostic.code === 'parse/invalid-rule-prelude');
  expect(reported.map(({ line, column }) => [line, column])).toEqual([[1, 1]]);
});
