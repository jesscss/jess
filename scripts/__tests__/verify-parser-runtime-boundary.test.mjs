import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  scanParserSource,
  validateInventory,
  validateInventoryShrink,
  writeInventory
} from '../verify-parser-runtime-boundary.mjs';

function inventoryFor(findings) {
  return {
    version: 2,
    debt: findings.map(finding => ({
      ...finding,
      retirement: 'Move this source recognition into Parseman grammar.'
    }))
  };
}

describe('parser runtime boundary', () => {
  it('allows only Parseman-imported regex() grammar declarations', () => {
    assert.deepEqual(scanParserSource('/tmp/grammar.ts', 'import { regex } from \'parseman\'; const word = regex(/[a-z]+/);'), []);
    assert.deepEqual(scanParserSource('/tmp/grammar.ts', 'import { regex as pmRegex } from \'parseman\'; const word = pmRegex(/[a-z]+/);'), []);
    assert.deepEqual(
      scanParserSource('/tmp/grammar.ts', 'function regex(x) { return x; } const word = regex(/[a-z]+/);').map(finding => finding.kind),
      ['regex-literal']
    );
    assert.deepEqual(
      scanParserSource('/tmp/grammar.ts', 'import { regex } from \'parseman\'; function inner(regex) { return regex(/[a-z]+/); }').map(finding => finding.kind),
      ['regex-literal']
    );
    const findings = scanParserSource('/tmp/builders.ts', 'const word = /[a-z]+/;');
    assert.deepEqual(findings.map(finding => finding.kind), ['regex-literal']);
  });

  it('detects direct, global, and aliased runtime regex construction', () => {
    const findings = scanParserSource('/tmp/builders.ts', [
      'const dynamic = new RegExp(pattern);',
      'const global = new globalThis.RegExp(pattern);',
      'const bracket = new globalThis["RegExp"](pattern);',
      'const R = RegExp; R(pattern);',
      'const GlobalR = globalThis.RegExp; new GlobalR(pattern);',
      'const BoundR = RegExp.bind(null); BoundR(pattern);',
      'const BracketR = globalThis["RegExp"]; new BracketR(pattern);'
    ].join('\n'));
    assert.deepEqual(findings.map(finding => finding.kind), [
      'regexp-constructor', 'regexp-constructor', 'regexp-constructor', 'regexp-constructor',
      'regexp-constructor', 'regexp-constructor', 'regexp-constructor'
    ]);
  });

  it('detects handwritten character recognition, aliases, and source indexing', () => {
    const findings = scanParserSource('/tmp/builders.ts', [
      "const source = 'source'; const pattern = getPattern();",
      'source.charCodeAt(0);',
      'source.codePointAt(0);',
      'pattern.exec(source);',
      'source.match(pattern);',
      'const code = source.charCodeAt; code(0);',
      'const boundCode = source.charCodeAt.bind(source); boundCode(0);',
      'const { charCodeAt } = String.prototype; charCodeAt.call(source, 0);',
      'String.prototype.charCodeAt.call(source, 0);',
      'for (let i = 0; i < source.length; i++) source[i];',
      'const foo = source; foo[i]; foo.indexOf("@{", 0);',
      'const first = source; const second = first; second.startsWith("@{", 0);',
      'source.indexOf("@{", 0);',
      'source.startsWith("@{", 0);'
    ].join('\n'));
    assert.deepEqual(findings.map(finding => finding.kind), [
      'runtime-charCodeAt', 'runtime-codePointAt', 'runtime-exec', 'runtime-match',
      'runtime-charCodeAt', 'runtime-charCodeAt', 'runtime-charCodeAt', 'runtime-charCodeAt', 'runtime-string-index',
      'runtime-string-index', 'runtime-indexOf', 'runtime-startsWith',
      'runtime-indexOf', 'runtime-startsWith'
    ]);
  });

  it('does not mistake AST collection operations for source recognition', () => {
    assert.deepEqual(
      scanParserSource('/tmp/builders.ts', [
        'const head = children.slice(1);',
        'const child = children[i];',
        'const items = children;',
        'items[0]; items.includes(child);',
        'const payload = {}; payload.value = children;',
        'const host = payload; host.value[0];',
        'const { value } = payload; value[0];',
        'const raw = children; raw[0];',
        'const value = children; value[0];',
        'const { value: unknownValue } = getNode(); unknownValue[0];'
      ].join('\n')),
      []
    );
  });

  it('traces declared string and CST-leaf provenance without naming heuristics', () => {
    const findings = scanParserSource('/tmp/builders.ts', [
      'function scan(source: string) { source.indexOf("@{"); }',
      'function scanRaw(raw: string) { raw.startsWith("@"); }',
      'function scanValue(value: string, i: number) { return value[i]; }',
      'const token: { value: string } = getLeaf(); token.value.startsWith("@");',
      'const alias = token.value; alias.includes("@{");',
      'const raw = children; raw[0]; const value = children; value[0];'
    ].join('\n'));
    assert.deepEqual(findings.map(finding => finding.kind), [
      'runtime-indexOf', 'runtime-startsWith', 'runtime-string-index',
      'runtime-startsWith', 'runtime-includes'
    ]);
  });

  it('uses only source syntax, never TypeScript program inference, for required findings', () => {
    const text = [
      'function scan(source: string) { source.indexOf("@{"); }',
      'const token: { value: string } = getLeaf(); token.value.startsWith("@");'
    ].join('\n');
    const expected = scanParserSource('/tmp/builders.ts', text);
    const unavailableChecker = { getTypeAtLocation() { throw new Error('TypeChecker must not run'); } };
    assert.deepEqual(scanParserSource('/tmp/builders.ts', text, undefined, unavailableChecker), expected);
  });

  it('keeps aliases lexical: loop and catch shadows cannot taint parser detection', () => {
    assert.deepEqual(
      scanParserSource('/tmp/builders.ts', [
        'for (const parseLessFn of parsers) parseLessFn(text);',
        'try { work(); } catch (parseScssFn) { parseScssFn(text); }'
      ].join('\n')),
      []
    );
  });

  it('tracks object-held parser aliases and assignment/destructured text aliases', () => {
    const findings = scanParserSource('/tmp/builders.ts', [
      'const host = { again: parseLessFn }; host.again(text);',
      'const { again: destructuredAgain } = host; destructuredAgain(text);',
      "const input = 'source';",
      'let copied; copied = input; copied[0]; copied.includes("@{");',
      'const payload = { source: input }; const { source: destructured } = payload; destructured[0]; destructured.startsWith("@{");',
      'const { includes: hasInterpolation } = input; hasInterpolation("@{");'
    ].join('\n'));
    assert.deepEqual(findings.map(finding => finding.kind), [
      'reparse-entrypoint', 'reparse-entrypoint', 'runtime-string-index', 'runtime-includes',
      'runtime-string-index', 'runtime-startsWith', 'runtime-includes'
    ]);
  });

  it('detects direct, optional, property, and aliased parser entrypoint calls', () => {
    assert.deepEqual(
      scanParserSource('/tmp/scss-selector-validate.ts', 'parseScssFn(text, "SelectorList");').map(finding => finding.kind),
      ['reparse-entrypoint']
    );
    assert.deepEqual(
      scanParserSource('/tmp/scss-selector-validate.ts', [
        'host.parseScssFn(text, "SelectorList");',
        'host?.parseScssFn?.(text, "SelectorList");',
        'const again = parseScssFn; again(text, "SelectorList");',
        'const boundAgain = parseScssFn.bind(null); boundAgain(text, "SelectorList");',
        'const { parseScssFn: destructuredAgain } = host; destructuredAgain(text, "SelectorList");',
        'let parseScssFnLazy; parseScssFnLazy(text, "SelectorList");'
      ].join('\n')).map(finding => finding.kind),
      ['reparse-entrypoint', 'reparse-entrypoint', 'reparse-entrypoint', 'reparse-entrypoint', 'reparse-entrypoint', 'reparse-entrypoint']
    );
  });

  it('records every exception as an exact source site and rejects substitution', () => {
    const known = scanParserSource('/tmp/builders.ts', 'source.charCodeAt(0);');
    const inventory = inventoryFor(known);
    assert.deepEqual(validateInventory(inventory, known), []);
    assert.match(validateInventory(inventory, scanParserSource('/tmp/builders.ts', 'source.charCodeAt(0); source.charCodeAt(0);')).join('\n'), /New handwritten parser recognizer/);
    assert.match(validateInventory(inventory, scanParserSource('/tmp/builders.ts', 'source.charCodeAt(1);')).join('\n'), /New handwritten parser recognizer/);
  });

  it('rejects a moved site even when its scanner snippet is identical', () => {
    const known = scanParserSource('/tmp/builders.ts', 'source.charCodeAt(0);');
    const inventory = inventoryFor(known);
    const moved = scanParserSource('/tmp/builders.ts', '\nsource.charCodeAt(0);');
    const errors = validateInventory(inventory, moved).join('\n');
    assert.match(errors, /Debt inventory is stale/);
    assert.match(errors, /New handwritten parser recognizer/);
  });

  it('requires real raw-source proof for untraced legacy debt and inventory writes', () => {
    const directory = mkdtempSync(join(tmpdir(), 'jess-runtime-boundary-'));
    const sourcePath = join(directory, 'legacy.ts');
    const inventoryPath = join(directory, 'inventory.json');
    const source = 'const legacyScanner = source.charCodeAt(0);\n';
    const start = source.indexOf('source.charCodeAt(0)');
    const end = start + 'source.charCodeAt(0)'.length;
    const snippet = source.slice(start, end);
    const entry = {
      file: 'legacy.ts', line: 1, column: start + 1, start, end,
      kind: 'runtime-charCodeAt', snippet,
      fingerprint: createHash('sha256').update(`runtime-charCodeAt:${snippet}`).digest('hex').slice(0, 16),
      retirement: 'Delete after the provenance walker recognizes this legacy source.', untraced: true
    };
    const inventory = { version: 2, debt: [entry] };
    try {
      writeFileSync(sourcePath, source);
      writeFileSync(inventoryPath, JSON.stringify(inventory));
      assert.deepEqual(validateInventory(inventory, [], { base: directory }), []);
      assert.equal(writeInventory([], { path: inventoryPath, base: directory }).debt.length, 1);
      assert.equal(JSON.parse(readFileSync(inventoryPath, 'utf8')).debt[0].untraced, true);

      writeFileSync(sourcePath, source.replace('charCodeAt', 'codePointAt'));
      assert.match(validateInventory(inventory, [], { base: directory }).join('\n'), /Untraced debt source changed/);
      assert.throws(() => writeInventory([], { path: inventoryPath, base: directory }), /Untraced debt source changed/);

      writeFileSync(sourcePath, source);
      entry.start = source.length;
      entry.end = source.length + 1;
      assert.match(validateInventory(inventory, [], { base: directory }).join('\n'), /span is invalid/);
      entry.start = start;
      entry.end = start;
      assert.match(validateInventory(inventory, [], { base: directory }).join('\n'), /span is invalid/);
      entry.end = end;
      unlinkSync(sourcePath);
      assert.match(validateInventory(inventory, [], { base: directory }).join('\n'), /source is missing/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('permits an inventory rewrite only when it deletes exact prior sites', () => {
    const known = inventoryFor(scanParserSource('/tmp/builders.ts', 'source.charCodeAt(0);'));
    assert.deepEqual(validateInventoryShrink(known.debt, []), []);
    const moved = inventoryFor(scanParserSource('/tmp/builders.ts', '\nsource.charCodeAt(0);'));
    assert.match(validateInventoryShrink(known.debt, moved.debt).join('\n'), /Refusing new, substituted, or moved parser debt/);
  });
});
