import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Compiler } from '../src/index.js';
import { outputDiagnostics } from '../src/diagnostics.js';
import type { ErrorDiagnostic, WarningDiagnostic } from '@jesscss/core';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';

describe('Diagnostic Output', () => {
  it('should output errors using CodeDebug', async () => {
    const compiler = new Compiler();
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      await compiler.compile('test/fixtures/invalid.less');
    } catch (e) {
      // Expected to throw
    }

    // Check that stderr was written to (diagnostics should have been output)
    expect(stderrSpy).toHaveBeenCalled();

    stderrSpy.mockRestore();
  });

  it('should format diagnostics correctly', () => {
    const error: ErrorDiagnostic = {
      code: 'parse/unexpected-token',
      phase: 'parse',
      message: 'Test error',
      reason: 'This is a test',
      fix: 'Fix the test',
      filePath: '/test/file.less',
      line: 5,
      column: 10,
      lines: {
        4: 'line before',
        5: 'error line here',
        6: 'line after'
      }
    };

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    outputDiagnostics([error], [], { breakOnError: false });

    // Should have written to stderr (errors go to stderr)
    expect(stdoutSpy).not.toHaveBeenCalled();

    stdoutSpy.mockRestore();
  });
});

describe('Eval error source location', () => {
  function evalCompiler() {
    return new Compiler({
      output: { collapseNesting: true },
      compile: {
        plugins: [lessPlugin(), lessCompatPlugin()],
        functionMode: 'error',
        unitMode: 'strict'
      }
    });
  }

  it('points an undefined-mixin-call error at the call site, not 1:1', async () => {
    const source = [
      '.a {',
      '  color: red;',
      '}',
      '.missing-mixin();'
    ].join('\n');

    const result = await evalCompiler().renderToResult(
      { source, filePath: '/proj/detached.less' },
      { suppressWarnings: true }
    );

    expect(result.errors).toHaveLength(1);
    const err = result.errors[0]!;
    expect(err.phase).toBe('resolve');
    expect(err.line).toBe(4);
    expect(err.column).toBe(1);
    expect(err.lines?.[4]).toContain('.missing-mixin');
  });

  it('points an undefined-variable error at the reference, not 1:1', async () => {
    const source = [
      '.a {',
      '  width: @nope;',
      '}'
    ].join('\n');

    const result = await evalCompiler().renderToResult(
      { source, filePath: '/proj/undef.less' },
      { suppressWarnings: true }
    );

    expect(result.errors).toHaveLength(1);
    const err = result.errors[0]!;
    // `@nope` sits at line 2, column 10.
    expect(err.line).toBe(2);
    expect(err.column).toBe(10);
    expect(err.lines?.[2]).toContain('@nope');
  });

  it('keeps an undefined-variable diagnostic precise through the public file route', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-ast-diagnostic-'));
    const filePath = path.join(dir, 'undef.less');
    fs.writeFileSync(filePath, '.a {\n  width: @nope;\n}\n');
    try {
      const result = await evalCompiler().safeRender(filePath, { suppressWarnings: true });
      expect(result.errors).toHaveLength(1);
      const err = result.errors[0]!;
      expect(err.phase).toBe('resolve');
      expect(err.filePath).toBe(filePath);
      expect(err.line).toBe(2);
      expect(err.column).toBe(10);
      expect(err.lines?.[2]).toContain('@nope');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Public parser diagnostic provenance', () => {
  const cases = [
    { dialect: 'Less', extension: '.less', source: '.ok { color: red; }\n!broken' },
    { dialect: 'SCSS', extension: '.scss', source: '.ok { color: red; }\n!broken' },
    { dialect: 'Jess', extension: '.jess', source: '.ok { color: red; }\n!broken' }
  ] as const;

  for (const testCase of cases) {
    it(`${testCase.dialect} retains source provenance through the public compiler route`, async () => {
      const filePath = `/proj/invalid${testCase.extension}`;
      const result = await new Compiler().renderToResult(
        { source: testCase.source, filePath, extension: testCase.extension },
        { suppressWarnings: true }
      );

      const diagnostic = result.errors[0]!;
      expect(diagnostic).toMatchObject({
        code: 'parse/syntax-error',
        phase: 'parse',
        filePath,
        line: 2,
        column: 1,
        file: { source: testCase.source }
      });
      expect(diagnostic.lines?.[2]).toBe('!broken');
    });
  }

  it('renders the Less 5 charset policy with path, source excerpt, and caret', async () => {
    const source = '@Eight: 8;\n@charset "UTF-@{Eight}";';
    const filePath = '/proj/charset.less';
    const captured = await captureAsync(() => new Compiler().renderToResult(
      { source, filePath, extension: '.less' }
    ));

    expect(captured.value.errors[0]).toMatchObject({
      code: 'parse/dynamic-charset',
      filePath,
      line: 2,
      column: 1
    });
    expect(captured.err).toContain('charset.less');
    expect(captured.err).toContain('@charset "UTF-@{Eight}";');
    // linecraft renders the source caret as its vertical marker glyph.
    expect(captured.err).toContain('╿');
  });

  it('uses the imported file as the parse diagnostic source', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-import-parse-diagnostic-'));
    const entry = path.join(dir, 'entry.less');
    const imported = path.join(dir, 'broken.less');
    fs.writeFileSync(entry, '@import "./broken.less";\n');
    fs.writeFileSync(imported, '.ok { color: red; }\n!broken');
    try {
      const result = await new Compiler().safeRender(entry, { suppressWarnings: true });
      const diagnostic = result.errors[0]!;
      expect(diagnostic).toMatchObject({
        code: 'parse/syntax-error',
        filePath: imported,
        line: 2,
        column: 1,
        file: { source: '.ok { color: red; }\n!broken' }
      });
      expect(diagnostic.lines?.[2]).toBe('!broken');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** Captures everything written to stdout + stderr while `fn` runs. */
function capture(fn: () => void): { out: string; err: string } {
  const out: string[] = [];
  const err: string[] = [];
  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    out.push(String(chunk));
    return true;
  });
  const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    err.push(String(chunk));
    return true;
  });
  try {
    fn();
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
  return { out: out.join(''), err: err.join('') };
}

async function captureAsync<T>(fn: () => Promise<T>): Promise<{ value: T; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    out.push(String(chunk));
    return true;
  });
  const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    err.push(String(chunk));
    return true;
  });
  try {
    return { value: await fn(), out: out.join(''), err: err.join('') };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
}

const OSC8 = '\x1b]8;;';

function warn(
  code: string,
  message: string,
  opts: { filePath?: string; line?: number; column?: number; sourceLine?: string } = {}
): WarningDiagnostic {
  const line = opts.line ?? 3;
  const filePath = 'filePath' in opts ? opts.filePath : '/proj/src/styles.less';
  const lines = opts.sourceLine !== undefined && filePath
    ? { [line - 1]: 'before', [line]: opts.sourceLine, [line + 1]: 'after' }
    : undefined;
  return {
    code,
    phase: 'eval',
    message,
    reason: 'r',
    fix: 'f',
    filePath,
    line: filePath ? line : 0,
    column: opts.column ?? 2,
    lines
  };
}

function err(
  code: string,
  message: string,
  opts: { filePath?: string; line?: number; sourceLine?: string } = {}
): ErrorDiagnostic {
  const line = opts.line ?? 4;
  const filePath = opts.filePath ?? '/proj/src/styles.less';
  return {
    code,
    phase: 'parse',
    message,
    reason: 'r',
    fix: 'f',
    filePath,
    line,
    column: 3,
    lines: {
      [line - 1]: 'above',
      [line]: opts.sourceLine ?? 'ERR_SOURCE_LINE',
      [line + 1]: 'below'
    }
  };
}

describe('Diagnostic display tiers', () => {
  it('defaults: a warning renders as a single line with an OSC-8 link, no frame', () => {
    const { out } = capture(() =>
      outputDiagnostics([], [warn('eval/deprecated', 'used foo', { sourceLine: 'WARN_SRC' })], {
        breakOnError: false
      })
    );
    expect(out).toContain(OSC8);
    expect(out).toContain('eval/deprecated');
    expect(out).toContain('used foo');
    expect(out).not.toContain('WARN_SRC'); // no code frame
    expect(out.trimEnd().split('\n')).toHaveLength(1);
  });

  it('defaults: an error renders as a code frame', () => {
    const { err: stderr } = capture(() =>
      outputDiagnostics([err('parse/syntax-error', 'boom', { sourceLine: 'ERR_SRC' })], [], {
        breakOnError: false
      })
    );
    expect(stderr).toContain('ERR_SRC'); // code frame includes the source line
  });

  it('warnings: \'summary\' collapses to one line per code with count + files', () => {
    const warnings = [
      warn('extend/not-found', 'a missing', { filePath: '/proj/a.less' }),
      warn('extend/not-found', 'b missing', { filePath: '/proj/b.less' })
    ];
    const { out } = capture(() =>
      outputDiagnostics([], warnings, { breakOnError: false, warnings: 'summary' })
    );
    expect(out.trimEnd().split('\n')).toHaveLength(1);
    expect(out).toContain('extend/not-found');
    expect(out).toContain('2×');
    expect(out).toContain('a.less');
    expect(out).toContain('b.less');
    expect(out).not.toContain(OSC8);
  });

  it('warnings: { display: \'frame\' } frames warnings', () => {
    const { out } = capture(() =>
      outputDiagnostics([], [warn('eval/deprecated', 'x', { sourceLine: 'W_FRAME_SRC' })], {
        breakOnError: false,
        warnings: { display: 'frame' }
      })
    );
    expect(out).toContain('W_FRAME_SRC');
  });

  it('errors: \'line\' compacts errors to one line with a link', () => {
    const { err: stderr } = capture(() =>
      outputDiagnostics([err('parse/syntax-error', 'boom', { sourceLine: 'ERR_SRC' })], [], {
        breakOnError: false,
        errors: 'line'
      })
    );
    expect(stderr).toContain(OSC8);
    expect(stderr).not.toContain('ERR_SRC');
    expect(stderr.trimEnd().split('\n')).toHaveLength(1);
  });

  it('category override promotes a chosen code to frame even as a warning', () => {
    const { out } = capture(() =>
      outputDiagnostics(
        [],
        [warn('selector/comma-list-interpolation', 'list in selector', { sourceLine: 'OVERRIDE_SRC' })],
        { breakOnError: false }
      )
    );
    // Default warning tier is line, but this code is pinned to frame.
    expect(out).toContain('OVERRIDE_SRC');
  });

  it('first-vs-repeat: first frame-tier site frames, later sites drop to line', () => {
    const warnings = [
      warn('eval/deprecated', 'first', { line: 3, sourceLine: 'FIRST_SRC' }),
      warn('eval/deprecated', 'second', { line: 9, sourceLine: 'SECOND_SRC' })
    ];
    const { out } = capture(() =>
      outputDiagnostics([], warnings, { breakOnError: false, warnings: { display: 'frame' } })
    );
    expect(out).toContain('FIRST_SRC'); // first site framed
    expect(out).not.toContain('SECOND_SRC'); // second site demoted to line
    expect(out).toContain(OSC8); // ...which carries a link
  });

  it('no-location diagnostic renders a one-liner with no link and no frame', () => {
    const noLoc: WarningDiagnostic = {
      code: 'extend/not-found',
      phase: 'extend',
      message: '199 warnings suppressed',
      reason: '',
      fix: '',
      line: 0,
      column: 0
    };
    const { out } = capture(() =>
      outputDiagnostics([], [noLoc], { breakOnError: false })
    );
    expect(out).toContain('extend/not-found');
    expect(out).toContain('199 warnings suppressed');
    expect(out).not.toContain(OSC8);
    expect(out.trimEnd().split('\n')).toHaveLength(1);
  });

  it('verbose promotes: a default-line warning becomes a frame', () => {
    const { out } = capture(() =>
      outputDiagnostics([], [warn('eval/deprecated', 'x', { sourceLine: 'VERBOSE_SRC' })], {
        breakOnError: false,
        verbose: true
      })
    );
    expect(out).toContain('VERBOSE_SRC');
  });

  it('back-compat: suppressWarnings silences warning output', () => {
    const { out } = capture(() =>
      outputDiagnostics([], [warn('eval/deprecated', 'x')], {
        breakOnError: false,
        suppressWarnings: true
      })
    );
    expect(out).toBe('');
  });
});
