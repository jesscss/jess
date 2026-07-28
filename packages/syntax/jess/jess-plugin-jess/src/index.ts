import {
  AbstractPlugin,
  parserDiagnostic,
  type ISafeParseResult,
  type Plugin,
  type SafeParseOptions
} from '@jesscss/core';
import { parse } from '@jesscss/jess-parser';

/** Parses `.jess` source into the canonical AST-v2 `Stylesheet` document. */
export class JessPlugin extends AbstractPlugin {
  name = 'jess';
  supportedExtensions = ['.jess'];
  safeParse(filePath: string, source: string, parseOptions?: SafeParseOptions): ISafeParseResult {
    void parseOptions;
    try {
      return { document: parse(source), errors: [], warnings: [] };
    } catch (error) {
      return {
        errors: [parserDiagnostic({ dialect: 'Jess', error, filePath, source })],
        warnings: []
      };
    }
  }
}

const jessPlugin = (() => new JessPlugin()) satisfies Plugin;

export default jessPlugin;
