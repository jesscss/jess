import { expect, it } from 'vitest';
import { collectTolerantDiagnostics } from '../src/index.js';

/* The editor twin of the compiler's `parse/at-root-placement`, at the at-rule (ledger P45). */
it.each([
  ['a selector prelude', 'a { b: c; }\n.d {\n  @at-root .x .y { e: f; }\n}\n'],
  ['a bare block', 'a { b: c; }\n.d {\n  @at-root { e: f; }\n}\n'],
  ['a filter', 'a { b: c; }\n.d {\n  @at-root (with: media) { e: f; }\n}\n']
])('scss: %s', (_label, source) => {
  const reported = collectTolerantDiagnostics({ source, language: 'scss' }).diagnostics
    .filter(diagnostic => diagnostic.code === 'parse/at-root-placement')
    .map(({ phase, defaultSeverity, message, line, column }) => ({ phase, defaultSeverity, message, line, column }));
  expect(reported).toEqual([
    { phase: 'parse', defaultSeverity: 'error', message: '`@at-root` is not supported', line: 3, column: 3 }
  ]);
});
