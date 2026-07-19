import { describe, expect, it } from 'vitest';
import {
  scanParserSource,
  validateInventory
} from '../verify-parser-runtime-boundary.mjs';

function inventoryFor(findings: ReturnType<typeof scanParserSource>) {
  const groups = new Map<string, {
    file: string;
    kind: string;
    fingerprint: string;
    count: number;
    retirement: string;
  }>();
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
    expect(scanParserSource('/tmp/grammar.ts', 'const word = regex(/[a-z]+/);')).toEqual([]);

    const findings = scanParserSource('/tmp/builders.ts', 'const word = /[a-z]+/;');
    expect(findings.map(finding => finding.kind)).toEqual(['regex-literal']);
  });

  it('detects runtime regex construction and handwritten character recognition', () => {
    const findings = scanParserSource('/tmp/builders.ts', [
      'const dynamic = new RegExp(pattern);',
      'source.charCodeAt(0);',
      'source.codePointAt(0);',
      'pattern.exec(source);',
      'source.match(pattern);'
    ].join('\n'));

    expect(findings.map(finding => finding.kind)).toEqual([
      'regexp-constructor',
      'runtime-charCodeAt',
      'runtime-codePointAt',
      'runtime-exec',
      'runtime-match'
    ]);
  });

  it('detects every parser entrypoint call, including calls in a parser driver', () => {
    const findings = scanParserSource('/tmp/scss-selector-validate.ts', 'parseScssFn(text, "SelectorList");');
    expect(findings.map(finding => finding.kind)).toEqual(['reparse-entrypoint']);

    const driverFindings = scanParserSource('/tmp/functional-parser.ts', 'parseCssFn(text);');
    expect(driverFindings.map(finding => finding.kind)).toEqual(['reparse-entrypoint']);
  });

  it('makes every existing exception exact and rejects an added recognizer', () => {
    const known = scanParserSource('/tmp/builders.ts', 'source.charCodeAt(0);');
    const inventory = inventoryFor(known);
    expect(validateInventory(inventory, known)).toEqual([]);

    const duplicated = scanParserSource('/tmp/builders.ts', 'source.charCodeAt(0); source.charCodeAt(0);');
    expect(validateInventory(inventory, duplicated).join('\n')).toContain('Debt count changed');

    const changed = scanParserSource('/tmp/builders.ts', 'source.charCodeAt(1);');
    expect(validateInventory(inventory, changed).join('\n')).toContain('New handwritten parser recognizer');
  });
});
