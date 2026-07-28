import { describe, expect, it } from 'vitest';
import { createToken, createTokenInstance, NoViableAltException } from 'chevrotain';
import {
  getErrorFromParser,
  makeJessErrorFromDiagnostic,
  parserDiagnostic,
  toDiagnostic,
  type ErrorDiagnostic
} from '../jess-error.js';

describe('JessError diagnostics', () => {
  it('does not inherit from JavaScript Error or capture a stack', () => {
    const error = makeJessErrorFromDiagnostic({
      code: 'parse/syntax-error',
      phase: 'parse',
      message: 'Syntax error',
      reason: 'Expected value.',
      fix: 'Add a value.',
      line: 1,
      column: 1
    });

    expect(error).not.toBeInstanceOf(Error);
    expect('stack' in error).toBe(false);
  });

  it('falls back to parse/syntax-error for unknown diagnostic codes', () => {
    const error = makeJessErrorFromDiagnostic({
      code: 'plugin/custom-error',
      phase: 'plugin',
      message: 'Custom plugin error',
      reason: 'The plugin returned a non-core diagnostic code.',
      fix: 'Use a core diagnostic code when throwing JessError.',
      line: 2,
      column: 4
    });

    expect(error.code).toBe('parse/syntax-error');
    expect(error.phase).toBe('plugin');
    expect(error.message).toBe('Custom plugin error');
  });

  it('preserves known diagnostic codes', () => {
    const error = makeJessErrorFromDiagnostic({
      code: 'parse/unexpected-token',
      phase: 'parse',
      message: 'Unexpected token',
      reason: 'Token "}" is not valid here.',
      fix: 'Remove the unexpected token.',
      line: 1,
      column: 8
    });

    expect(error.code).toBe('parse/unexpected-token');
    expect(error.reason).toBe('Token "}" is not valid here.');
    expect(error.fix).toBe('Remove the unexpected token.');
  });

  it('preserves source location metadata from diagnostics', () => {
    const diagnostic: ErrorDiagnostic = {
      code: 'parse/syntax-error',
      phase: 'parse',
      message: 'Syntax error',
      reason: 'Expected value.',
      fix: 'Add a value.',
      file: {
        name: 'input.less',
        path: '/tmp',
        fullPath: '/tmp/input.less',
        source: '.a {\n  color: ;\n}'
      },
      filePath: '/tmp/input.less',
      line: 2,
      column: 10,
      endLine: 2,
      endColumn: 11,
      errors: [],
      lexerErrors: []
    };

    const error = makeJessErrorFromDiagnostic(diagnostic);

    expect(error.fileObj?.fullPath).toBe('/tmp/input.less');
    expect(error.filePath).toBe('/tmp/input.less');
    expect(error.source).toBe('.a {\n  color: ;\n}');
    expect(error.line).toBe(2);
    expect(error.column).toBe(10);
    expect(error.endLine).toBe(2);
    expect(error.endColumn).toBe(11);
    expect(error.errors).toBe(diagnostic.errors);
    expect(error.lexerErrors).toBe(diagnostic.lexerErrors);

    expect(toDiagnostic(error)).toMatchObject({
      endLine: 2,
      endColumn: 11
    });
  });

  it('normalizes non-finite Chevrotain parse positions before diagnostics', () => {
    const tokenType = createToken({ name: 'SyntheticEof', pattern: /./u });
    const token = createTokenInstance(
      tokenType,
      '',
      Number.NaN,
      Number.NaN,
      Number.NaN,
      Number.NaN,
      Number.NaN,
      Number.NaN
    );
    const parseError = new NoViableAltException('Expecting token but found EOF', token, token);

    const diagnostic = toDiagnostic(getErrorFromParser(
      [parseError],
      undefined,
      'virtual.jess',
      '.a {\n  color: blue;\n'
    ));

    expect(diagnostic).toMatchObject({
      code: 'parse/unexpected-syntax',
      phase: 'parse',
      filePath: 'virtual.jess',
      line: 1,
      column: 1
    });
    expect(Number.isFinite(diagnostic.line)).toBe(true);
    expect(Number.isFinite(diagnostic.column)).toBe(true);
  });

  it('summarizes value-production expected sets without leaking parser internals', () => {
    const source = '.entry {\n  value: .bad;\n}';
    const error = {
      code: 'parse/syntax-error',
      offset: source.indexOf('.bad'),
      expected: [
        '"\\""',
        'CssSyntaxNumber',
        'CssSyntaxDimensionUnit',
        'LessSyntaxKeyword',
        '/-?[_a-zA-Z\\u0080-\\uffff][-_a-zA-Z0-9\\u0080-\\uffff]*/',
        'not(peek)'
      ]
    };

    const diagnostic = parserDiagnostic({
      dialect: 'Less',
      error,
      filePath: 'entry.less',
      source
    });

    expect(diagnostic).toMatchObject({
      code: 'parse/invalid-value',
      phase: 'parse',
      message: 'Invalid value.',
      reason: 'Less expected a value here, but this token cannot start one.',
      fix: 'Rewrite this position as a valid value or move the syntax into a statement position.',
      line: 2,
      column: 10
    });
    expect(diagnostic.reason).not.toContain('CssSyntaxNumber');
    expect(diagnostic.reason).not.toContain('not(peek)');
  });

  it('deduplicates expected tokens before summarizing parser diagnostics', () => {
    const source = '@unknown url( {\n  width: 20px;\n}';
    const diagnostic = parserDiagnostic({
      dialect: 'Less',
      error: {
        code: 'parse/syntax-error',
        offset: source.indexOf('url'),
        expected: ['";"', '";"']
      },
      filePath: 'entry.less',
      source
    });

    expect(diagnostic).toMatchObject({
      code: 'parse/syntax-error',
      phase: 'parse',
      message: 'Missing semicolon.',
      reason: 'Less expected \';\' before this token.',
      fix: 'Add the missing \';\' or rewrite the statement.',
      line: 1,
      column: 10
    });
    expect(diagnostic.message).not.toContain('Expected:');
    expect(diagnostic.reason).not.toContain('";", ";"');
  });
});
