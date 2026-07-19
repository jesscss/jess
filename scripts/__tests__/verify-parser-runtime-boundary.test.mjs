import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  scanParserSource,
  validateInventory
} from '../verify-parser-runtime-boundary.mjs';

function inventoryFor(findings) {
  const groups = new Map();
  for (const finding of findings) {
    const key = `${finding.file}\0${finding.kind}\0${finding.fingerprint}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      groups.set(key, {
        file: finding.file,
        kind: finding.kind,
        fingerprint: finding.fingerprint,
        count: 1,
        retirement: 'Move this source recognition into Parseman grammar.'
      });
    }
  }
  return { version: 1, debt: [...groups.values()] };
}

describe('parser runtime boundary', () => {
  it('allows only direct Parseman regex() grammar declarations', () => {
    assert.deepEqual(scanParserSource('/tmp/grammar.ts', 'const word = regex(/[a-z]+/);'), []);
    const findings = scanParserSource('/tmp/builders.ts', 'const word = /[a-z]+/;');
    assert.deepEqual(findings.map(finding => finding.kind), ['regex-literal']);
  });

  it('detects runtime regex construction and handwritten character recognition', () => {
    const findings = scanParserSource('/tmp/builders.ts', [
      'const dynamic = new RegExp(pattern);',
      'source.charCodeAt(0);',
      'source.codePointAt(0);',
      'pattern.exec(source);',
      'source.match(pattern);'
    ].join('\n'));
    assert.deepEqual(findings.map(finding => finding.kind), [
      'regexp-constructor', 'runtime-charCodeAt', 'runtime-codePointAt', 'runtime-exec', 'runtime-match'
    ]);
  });

  it('detects every parser entrypoint call, including calls in a parser driver', () => {
    assert.deepEqual(
      scanParserSource('/tmp/scss-selector-validate.ts', 'parseScssFn(text, "SelectorList");').map(finding => finding.kind),
      ['reparse-entrypoint']
    );
    assert.deepEqual(
      scanParserSource('/tmp/functional-parser.ts', 'parseCssFn(text);').map(finding => finding.kind),
      ['reparse-entrypoint']
    );
  });

  it('makes every existing exception exact and rejects an added recognizer', () => {
    const known = scanParserSource('/tmp/builders.ts', 'source.charCodeAt(0);');
    const inventory = inventoryFor(known);
    assert.deepEqual(validateInventory(inventory, known), []);
    assert.match(validateInventory(inventory, scanParserSource('/tmp/builders.ts', 'source.charCodeAt(0); source.charCodeAt(0);')).join('\n'), /Debt count changed/);
    assert.match(validateInventory(inventory, scanParserSource('/tmp/builders.ts', 'source.charCodeAt(1);')).join('\n'), /New handwritten parser recognizer/);
  });
});
