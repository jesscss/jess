import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { Context } from '../context.js';
import { AbstractPlugin, type ISafeParseResult } from '../plugin.js';
import { stylesheet } from '../ast/nodes.js';
import type { ErrorDiagnostic, WarningDiagnostic } from '../jess-error.js';

/** Serves one in-memory `.jess` file and returns a fixed `safeParse` result for it. */
class FixedParsePlugin extends AbstractPlugin {
  name = 'fixed-parse';
  supportedExtensions = ['.jess'];

  constructor(
    private readonly filePath: string,
    private readonly source: string,
    private readonly parse: (path: string) => ISafeParseResult
  ) {
    super();
  }

  override locate(pathCandidates: string[]): string | null {
    return pathCandidates.includes(this.filePath) ? this.filePath : null;
  }

  override async getSource(): Promise<string> {
    return this.source;
  }

  safeParse(path: string): ISafeParseResult {
    return this.parse(path);
  }
}

/**
 * Loads `fileName` through `Context.getTree` with `breakOnError: false`, the
 * plugin's parser reporting `errors` and `warnings` alongside a document.
 */
async function loadWithDiagnostics(
  fileName: string,
  source: string,
  errors: (path: string) => ErrorDiagnostic[],
  warnings: (path: string) => WarningDiagnostic[] = () => []
): Promise<Context> {
  const filePath = resolve(process.cwd(), fileName);
  const plugin = new FixedParsePlugin(filePath, source, path => ({
    document: stylesheet([]),
    errors: errors(path),
    warnings: warnings(path)
  }));
  const context = new Context({}, [plugin]);
  context.opts.breakOnError = false;
  await context.getTree(fileName, {});
  return context;
}

function unexpectedToken(path: string, line: number, column: number, lines: Record<number, string>): ErrorDiagnostic {
  return {
    code: 'parse/unexpected-token',
    phase: 'parse',
    message: 'Unexpected token',
    reason: 'Token is not valid here.',
    fix: 'Check for a missing quote/comma or wrong operator.',
    filePath: path,
    line,
    column,
    lines
  };
}

describe('Context collects parse diagnostics when breakOnError is false', () => {
  it('collects a parser error instead of throwing', async () => {
    const source = '.invalid { color: red; } missing brace';
    const context = await loadWithDiagnostics('invalid.jess', source, path => [
      unexpectedToken(path, 1, 30, { 1: source })
    ]);

    expect(context.errors).toHaveLength(1);
    expect(context.errors[0]?.code).toBe('parse/unexpected-token');
    expect(context.errors[0]?.line).toBe(1);
    expect(context.errors[0]?.lines?.[1]).toBe(source);
  });

  it('keeps the source lines the parser attached to the error', async () => {
    const source = 'line 1\nline 2\nline 3 with error\nline 4\nline 5';
    const context = await loadWithDiagnostics('multiline.jess', source, path => [
      unexpectedToken(path, 3, 15, { 2: 'line 2', 3: 'line 3 with error', 4: 'line 4' })
    ]);

    expect(context.errors).toHaveLength(1);
    const error = context.errors[0]!;
    expect(error.lines?.[2]).toBe('line 2');
    expect(error.lines?.[3]).toBe('line 3 with error');
    expect(error.lines?.[4]).toBe('line 4');
    expect(error.lines?.[1]).toBeUndefined();
    expect(error.lines?.[5]).toBeUndefined();
  });

  it('keeps an error on the first line without a line before it', async () => {
    const source = 'error on first line\nline 2\nline 3';
    const context = await loadWithDiagnostics('first-line.jess', source, path => [
      unexpectedToken(path, 1, 1, { 1: 'error on first line', 2: 'line 2' })
    ]);

    expect(context.errors).toHaveLength(1);
    const error = context.errors[0]!;
    expect(error.lines?.[1]).toBe('error on first line');
    expect(error.lines?.[2]).toBe('line 2');
    expect(error.lines?.[0]).toBeUndefined();
  });

  it('keeps parser errors and parser warnings in separate lists', async () => {
    const source = 'invalid syntax';
    const context = await loadWithDiagnostics(
      'mixed.jess',
      source,
      path => [unexpectedToken(path, 1, 1, { 1: source })],
      path => [{
        code: 'resolve/unused-variable',
        phase: 'resolve',
        message: 'Unused variable',
        reason: '"unused" is declared but its value is never used.',
        fix: 'Remove it or prefix with "_" to silence.',
        filePath: path,
        line: 1,
        column: 1,
        lines: { 1: source }
      }]
    );

    expect(context.errors).toHaveLength(1);
    expect(context.warnings).toHaveLength(1);
    expect(context.errors[0]?.code).toBe('parse/unexpected-token');
    expect(context.warnings[0]?.code).toBe('resolve/unused-variable');
  });
});
