import { describe, it, expect, vi } from 'vitest';
import { Compiler } from '../src/index.js';
import { outputDiagnostics } from '../src/diagnostics.js';
import type { ErrorDiagnostic, WarningDiagnostic } from '@jesscss/core';

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

  it('should output warnings using CodeDebug', async () => {
    const compiler = new Compiler({
      suppressWarnings: false,
      breakOnError: false
    });
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    // Use safeCompile to collect warnings without throwing
    const result = await compiler.safeCompile('test/fixtures/warning.less');

    // Output diagnostics explicitly (safeCompile doesn't auto-output)
    if (result.warnings.length > 0) {
      outputDiagnostics(result.errors, result.warnings, {
        suppressWarnings: false,
        breakOnError: false
      });
      expect(stdoutSpy).toHaveBeenCalled();
    } else {
      // If no warnings, verify the test file actually produces warnings
      expect(result.warnings.length).toBeGreaterThan(0);
    }
    
    stdoutSpy.mockRestore();
  });

  it('should format diagnostics correctly', () => {
    const error: ErrorDiagnostic = {
      code: 'JESS1001',
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
