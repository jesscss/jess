import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Convert `name: any('X'[, {..}])` and `name: new Any('X'[, ...])` to a bare
// string/template literal `name: 'X'`. Scoped to explicitly listed files so we
// never touch `value:` positions or node types whose name is intentionally a Node.
const files = [
  'packages/core/src/tree/__tests__/at-rule.test.ts',
  'packages/core/src/tree/__tests__/extend-roots.test.ts',
  'packages/core/src/tree/__tests__/extend-eval-integration.test.ts',
  'packages/core/src/tree/__tests__/nesting-collapse.test.ts',
  'packages/core/src/tree/__tests__/ruleset.test.ts',
  'packages/core/src/tree/__tests__/rules.test.ts',
  'packages/core/src/tree/__tests__/func.test.ts',
  'packages/core/src/tree/__tests__/declaration.test.ts',
  'packages/core/src/tree/__tests__/at-rule-statement.test.ts',
  'packages/core/src/tree/__tests__/node-render-buffer.test.ts',
  'packages/core/src/tree/__tests__/import-style.test.ts',
  'packages/core/src/tree/__tests__/reference.test.ts',
  'packages/core/src/tree/__tests__/mixin.test.ts',
  'packages/core/test/helpers.ts',
  'packages/core/test/at-rule-statement.test.ts',
  'packages/core/test/at-rule-basic.test.ts'
];

// A quoted string literal: '...', "...", or `...` (no nested same-quote / no interpolation braces).
const STR = String.raw`(['"\`][^'"\`]*['"\`])`;

// name: any('X')  or  name: any('X', { ... })   (single-level options object)
const anyCall = new RegExp(String.raw`name:\s*any\(\s*${STR}\s*(?:,\s*\{[^{}]*\})?\s*\)`, 'g');
// name: new Any('X', ...anything without a nested close-paren...)
const newAny = new RegExp(String.raw`name:\s*new Any\(\s*${STR}\s*(?:,[^)]*)?\)`, 'g');

let total = 0;
for (const rel of files) {
  const path = resolve(process.cwd(), rel);
  let src;
  try {
    src = readFileSync(path, 'utf8');
  } catch {
    console.warn('skip (missing):', rel);
    continue;
  }
  let count = 0;
  src = src.replace(anyCall, (_m, str) => { count++; return `name: ${str}`; });
  src = src.replace(newAny, (_m, str) => { count++; return `name: ${str}`; });
  if (count > 0) {
    writeFileSync(path, src);
    total += count;
    console.log(`${count}\t${rel}`);
  }
}
console.log('TOTAL replacements:', total);
