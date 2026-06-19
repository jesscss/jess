import {
  createParserDiagnostic,
  providerKey,
  type IslandExecutionContext,
  type IslandParserRegistry,
  type IslandParseResult,
  type ParserConfigKey
} from '@jesscss/parser';
import { LessParser, type LessRules } from './lessParser.js';
import type { LessParserConfig } from './lessRecursiveParser.js';

/**
 * Compiler-visible result shapes that Less providers can materialize.
 *
 * These names participate in island cache keys. Keep them tied to grammar
 * entrypoints and parser options that change the promoted AST shape.
 */
export type LessIslandTargetShape =
  | 'less-guard'
  | 'less-media-prelude'
  | 'less-mixin'
  | 'less-selector'
  | 'less-value';

/**
 * Registers Less island materializers for a structural parse plan.
 *
 * Parser config participates in the provider key because Less parse shape can
 * change with options such as math mode, leaky rules, and expression wrapping.
 * The caller may pass an existing parser instance so plugin activation can
 * reuse the parser it already owns for `safeParse`.
 */
export function registerLessIslandProviders(
  registry: IslandParserRegistry,
  config: LessParserConfig = {},
  parser = new LessParser(config)
): void {
  const configKey = lessParserConfigKey(config);

  registry.register(providerKey('less', 'selector', 'less-selector', configKey), context =>
    parseLessIsland(context, parser, 'selectorList')
  );
  registry.register(providerKey('less', 'extend-candidate', 'less-selector', configKey), context =>
    parseLessWrappedIsland(context, parser, 'qualifiedRule', source => `${source} {}`)
  );
  registry.register(providerKey('less', 'declaration-value', 'less-value', configKey), context =>
    parseLessIsland(context, parser, 'valueList')
  );
  registry.register(providerKey('less', 'variable-reference', 'less-value', configKey), context =>
    parseLessIsland(context, parser, 'valueList')
  );
  registry.register(providerKey('less', 'mixin-definition', 'less-mixin', configKey), context =>
    parseLessIsland(context, parser, 'selectorList')
  );
  registry.register(providerKey('less', 'mixin-call', 'less-mixin', configKey), context =>
    parseLessIsland(context, parser, 'valueReference')
  );
  registry.register(providerKey('less', 'at-rule-prelude', 'less-media-prelude', configKey), context =>
    parseLessIsland(context, parser, 'mediaQuery')
  );
}

/**
 * Parses one Less island by slicing the structural document at the requested
 * range and invoking a narrow Less parser rule.
 */
export function parseLessIsland(
  context: IslandExecutionContext,
  parser: LessParser,
  rule: LessRules
): IslandParseResult {
  const source = context.document.source.slice(context.island.start, context.island.end);
  return parseLessSource(context, parser, rule, source);
}

/**
 * Parses an island that needs surrounding syntactic context to preserve the
 * existing Less AST contract.
 *
 * For example, `.foo:extend(.bar)` only produces `Extend` nodes when parsed as
 * a qualified rule header, so the provider wraps that header with an empty body
 * while keeping diagnostics attached to the original island range.
 */
export function parseLessWrappedIsland(
  context: IslandExecutionContext,
  parser: LessParser,
  rule: LessRules,
  wrapSource: (source: string) => string
): IslandParseResult {
  const source = context.document.source.slice(context.island.start, context.island.end);
  return parseLessSource(context, parser, rule, wrapSource(source));
}

function parseLessSource(
  context: IslandExecutionContext,
  parser: LessParser,
  rule: LessRules,
  source: string
): IslandParseResult {
  const result = parser.parse(source, rule);
  return {
    value: result.tree,
    diagnostics: [
      ...context.diagnostics,
      ...result.errors.map(error =>
        createParserDiagnostic({
          code: 'less-island-parse-error',
          message: error.message,
          start: context.island.start,
          end: context.island.end,
          context: rule
        })
      )
    ]
  };
}

/**
 * Normalizes Less parser options into a stable provider cache key.
 *
 * Keep this key in sync with options that can change promoted AST shape; adding
 * irrelevant options would reduce cache reuse without improving correctness.
 */
export function lessParserConfigKey(config: LessParserConfig): ParserConfigKey {
  return {
    leakyRules: config.leakyRules ?? true,
    looseMode: config.looseMode ?? true,
    mathMode: config.mathMode ?? 'parens-division',
    wrapOuterExpressions: config.wrapOuterExpressions ?? true
  };
}
