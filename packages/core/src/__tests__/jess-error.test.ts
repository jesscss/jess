import { describe, expect, it } from 'vitest';
import { createToken, createTokenInstance, NoViableAltException } from 'chevrotain';
import {
  getErrorFromParser,
  makeJessErrorFromDiagnostic,
  toDiagnostic,
  type ErrorDiagnostic
} from '../jess-error.js';

describe('JessError diagnostics', () => {
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
});
