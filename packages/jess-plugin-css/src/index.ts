import {
  AbstractPlugin,
  parserDiagnostic,
  type ISafeParseResult,
  type Plugin,
  type SafeParseOptions
} from '@jesscss/core';
import { parse } from '@jesscss/css-parser';

/** Parses `.css` source directly into the canonical AST-v2 `Stylesheet`. */
export class CssPlugin extends AbstractPlugin {
  name = 'css';
  supportedExtensions = ['.css'];

  safeParse(filePath: string, source: string, parseOptions?: SafeParseOptions): ISafeParseResult {
    void parseOptions;
    try {
      return { document: parse(source), errors: [], warnings: [] };
    } catch (error) {
      return {
        errors: [parserDiagnostic({ dialect: 'CSS', error, filePath, source })],
        warnings: []
      };
    }
  }
}

const cssPlugin = (() => new CssPlugin()) satisfies Plugin;

export default cssPlugin;
