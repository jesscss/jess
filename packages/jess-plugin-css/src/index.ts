import {
  AbstractPlugin,
  extractRelevantLines,
  type ErrorDiagnostic,
  type ISafeParseResult,
  type Plugin,
  type SafeParseOptions
} from '@jesscss/core';
import { parse } from '@jesscss/css-parser';

function parseErrorLocation(source: string, error: unknown): { line: number; column: number } {
  const offset = typeof error === 'object' && error !== null && 'offset' in error && typeof error.offset === 'number'
    ? Math.max(0, Math.min(source.length, error.offset))
    : 0;
  const before = source.slice(0, offset);
  return {
    line: before.split('\n').length,
    column: offset - (before.lastIndexOf('\n') + 1) + 1
  };
}

/** Parses `.css` source directly into the canonical AST-v2 `Stylesheet`. */
export class CssPlugin extends AbstractPlugin {
  name = 'css';
  supportedExtensions = ['.css'];

  safeParse(filePath: string, source: string, parseOptions?: SafeParseOptions): ISafeParseResult {
    void parseOptions;
    try {
      return { document: parse(source), errors: [], warnings: [] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const location = parseErrorLocation(source, error);
      return {
        errors: [{
          code: 'parse/syntax-error',
          phase: 'parse',
          message,
          reason: message,
          fix: 'Check the CSS source against the supported grammar.',
          filePath,
          line: location.line,
          column: location.column,
          lines: extractRelevantLines(source, location.line)
        } satisfies ErrorDiagnostic],
        warnings: []
      };
    }
  }
}

const cssPlugin = (() => new CssPlugin()) satisfies Plugin;

export default cssPlugin;
