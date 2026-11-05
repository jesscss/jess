import { expect, it } from 'vitest';
import { collectTolerantDiagnostics } from '../src/index.js';

const placements = (source: string) => collectTolerantDiagnostics({ source, language: 'scss' }).diagnostics
  .filter(diagnostic => diagnostic.code === 'parse/return-placement')
  .map(({ phase, defaultSeverity, line, column }) => ({ phase, defaultSeverity, line, column }));

/* The editor twin of the compiler's `parse/return-placement`, at the statement (ledger P45). */
it.each([
  ['a rule', '.a {\n  @return 1;\n}', 2, 3],
  ['a mixin', '@mixin m {\n  @return 1;\n}', 2, 3],
  ['a root @each', '@each $i in 1 2 {\n  @return $i;\n}', 2, 3],
  ['an @each in a function', '@function f($l) {\n  @each $i in $l {\n    @return $i;\n  }\n}', 3, 5],
  ['a rule in an @if in a function', '@function f() {\n  @if true {\n    .a {\n      @return 1;\n    }\n  }\n}', 4, 7]
])('scss: %s', (_label, source, line, column) => {
  expect(placements(source)).toEqual([{ phase: 'parse', defaultSeverity: 'error', line, column }]);
});

it('reads a @return in a function body and through its @if and @else', () => {
  expect(placements('@function f($a) {\n  @if $a { @return 1; } @else if $b { @return 2; } @else { @if $c { @return 3; } }\n  @return 4;\n}')).toEqual([]);
});
