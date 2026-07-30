import { describe, expect, it } from 'vitest';
import { collectTolerantDiagnostics, LINT_CODES } from '../src/index.js';

describe('collectTolerantDiagnostics', () => {
  it('reports CST-grounded lint findings with parser-captured source positions', () => {
    const result = collectTolerantDiagnostics({
      source: '.a {\n  colr: red;\n  width: 0px;\n}',
      language: 'css',
      filePath: '/tmp/input.css'
    });

    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toContain(LINT_CODES.unknownProperties);
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toContain(LINT_CODES.zeroUnits);
    expect(result.diagnostics.every(diagnostic => diagnostic.filePath === '/tmp/input.css')).toBe(true);
    expect(result.diagnostics.find(diagnostic => diagnostic.code === LINT_CODES.unknownProperties)).toMatchObject({
      line: 2,
      column: 3
    });
    expect(result.diagnostics.find(diagnostic => diagnostic.code === LINT_CODES.zeroUnits)).toMatchObject({
      line: 3,
      column: 10
    });
  });

  it('uses caller-provided CSS metadata for known properties', () => {
    const result = collectTolerantDiagnostics({
      source: '.a { colr: red; }',
      language: 'css',
      metadata: {
        isKnownProperty: name => name === 'colr'
      }
    });

    expect(result.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.unknownProperties)).toBe(false);
  });

  it('recognizes lint-relevant nodes from direct SCSS and Jess grammars', () => {
    const scss = collectTolerantDiagnostics({
      source: '.a { .b {} }',
      language: 'scss'
    });
    const jess = collectTolerantDiagnostics({
      source: '.a { colr: red; width: 0px; }',
      language: 'jess'
    });

    expect(scss.diagnostics.map(diagnostic => diagnostic.code)).toContain(LINT_CODES.emptyRules);
    expect(jess.diagnostics.map(diagnostic => diagnostic.code)).toContain(LINT_CODES.unknownProperties);
    expect(jess.diagnostics.map(diagnostic => diagnostic.code)).toContain(LINT_CODES.zeroUnits);
  });

  it('keeps invalid hex-color diagnostics tolerant when the declaration node is not produced', () => {
    const result = collectTolerantDiagnostics({
      source: '#abcde { color: red; }\n.a { color: #12345; }',
      language: 'css'
    });
    const hexDiagnostics = result.diagnostics.filter(diagnostic => diagnostic.code === LINT_CODES.hexColorLength);

    expect(hexDiagnostics).toHaveLength(1);
    expect(hexDiagnostics[0]?.start).toBe('#abcde { color: red; }\n.a { color: '.length);
  });
});
