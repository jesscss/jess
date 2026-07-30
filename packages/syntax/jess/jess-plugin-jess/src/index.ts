import {
  AbstractPlugin,
  parserDiagnostic,
  type ISafeParseResult,
  type Plugin,
  type SafeParseOptions
} from '@jesscss/core';
import { parse, type JessParseOptions } from '@jesscss/jess-parser';

function parseOptionsFromSafeParse(options?: SafeParseOptions): JessParseOptions {
  const compilerOptions = options?.compilerOptions;
  return {
    ...(options?.trackLines !== undefined
      ? { trackLines: options.trackLines }
      : {}),
    ...(compilerOptions?.allowApplySelectors !== undefined
      ? { allowApplySelectors: compilerOptions.allowApplySelectors }
      : {}),
    ...(compilerOptions?.allowExtendSelectors !== undefined
      ? { allowExtendSelectors: compilerOptions.allowExtendSelectors }
      : {})
  };
}

/** Parses `.jess` source into the canonical AST-v2 `Stylesheet` document. */
export class JessPlugin extends AbstractPlugin {
  name = 'jess';
  supportedExtensions = ['.jess'];
  safeParse(filePath: string, source: string, parseOptions?: SafeParseOptions): ISafeParseResult {
    try {
      return { document: parse(source, parseOptionsFromSafeParse(parseOptions)), errors: [], warnings: [] };
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
