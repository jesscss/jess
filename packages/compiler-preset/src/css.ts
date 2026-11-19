import { AbstractPlugin, type ISafeParseResult, parserDiagnostic } from '@jesscss/core';
import { parseRecovering } from '@jesscss/css-parser';

/**
 * Plain `.css` input: parsed by the CSS grammar and rendered through the same
 * output options as every other dialect (`collapseNesting`, `compress`, source
 * maps). CSS has nothing to evaluate, so there is no value evaluator: values
 * are written as authored.
 *
 * Its own entry (`@jesscss/compiler-preset/css`), so loading the preset does not
 * load the CSS grammar; the default stack imports it when a `.css` document is
 * parsed.
 */
export class CssPlugin extends AbstractPlugin {
  name = 'css';
  supportedExtensions = ['.css'];

  safeParse(filePath: string, source: string): ISafeParseResult {
    try {
      const { document, recovered } = parseRecovering(source);
      return { document, errors: recovered.map(error => parserDiagnostic({ dialect: 'CSS', error, filePath, source })), warnings: [] };
    } catch (error) {
      return { errors: [parserDiagnostic({ dialect: 'CSS', error, filePath, source })], warnings: [] };
    }
  }
}
