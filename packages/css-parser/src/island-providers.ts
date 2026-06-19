import {
  createParserDiagnostic,
  providerKey,
  type IslandExecutionContext,
  type IslandParserRegistry,
  type IslandParseResult
} from '@jesscss/parser';
import { CssParser, type CssRules } from './cssParser.js';

/**
 * Compiler-visible result shapes that CSS providers can materialize.
 *
 * The shared parser treats target shapes as opaque cache-key strings; this
 * union documents the shapes owned by `@jesscss/css-parser`.
 */
export type CssIslandTargetShape =
  | 'css-selector'
  | 'css-value'
  | 'css-prelude';

/**
 * Registers CSS island materializers for a structural parse plan.
 *
 * The shared `@jesscss/parser` package owns request identity, slicing, caching,
 * and counters. This package owns only the grammar callbacks that turn a
 * requested CSS island into the existing compiler-visible CSS AST nodes.
 */
export function registerCssIslandProviders(
  registry: IslandParserRegistry,
  parser = new CssParser()
): void {
  registry.register(providerKey('css', 'selector', 'css-selector'), context =>
    parseCssIsland(context, parser, 'selectorList')
  );
  registry.register(providerKey('css', 'declaration-value', 'css-value'), context =>
    parseCssIsland(context, parser, 'valueList')
  );
  registry.register(providerKey('css', 'at-rule-prelude', 'css-prelude'), context =>
    parseCssIsland(context, parser, 'valueList')
  );
}

/**
 * Parses exactly one structural island with an existing CSS parser rule.
 *
 * Diagnostics are mapped back onto the original island range. The source slice
 * is intentionally local to the requested island so provider execution cannot
 * silently materialize sibling selectors, declarations, or preludes.
 */
export function parseCssIsland(
  context: IslandExecutionContext,
  parser: CssParser,
  rule: CssRules
): IslandParseResult {
  const source = context.document.source.slice(context.island.start, context.island.end);
  const result = parser.parse(source, rule);

  return {
    value: result.tree,
    diagnostics: [
      ...context.diagnostics,
      ...result.errors.map(error =>
        createParserDiagnostic({
          code: 'css-island-parse-error',
          message: error.message,
          start: context.island.start,
          end: context.island.end,
          context: rule
        })
      )
    ]
  };
}
