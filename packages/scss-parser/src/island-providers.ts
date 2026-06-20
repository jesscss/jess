import {
  createParserDiagnostic,
  providerKey,
  type IslandExecutionContext,
  type IslandParserRegistry,
  type IslandParseResult
} from '@jesscss/parser';
import { ScssParser, type ScssRules } from './scssParser.js';

/** Compiler-visible result shapes that SCSS providers can materialize. */
export type ScssIslandTargetShape =
  | 'scss-condition'
  | 'scss-prelude'
  | 'scss-selector'
  | 'scss-value';

/**
 * Registers SCSS island materializers for a structural parse plan.
 *
 * Providers intentionally parse only the selected island slice. That keeps
 * SCSS profile/service work package-owned without making `@jesscss/parser`
 * know SCSS grammar or materialization policy.
 */
export function registerScssIslandProviders(
  registry: IslandParserRegistry,
  parser = new ScssParser()
): void {
  registry.register(providerKey('scss', 'selector', 'scss-selector'), context =>
    parseScssIsland(context, parser, 'selectorList')
  );
  registry.register(providerKey('scss', 'declaration-value', 'scss-value'), context =>
    parseScssIsland(context, parser, 'valueList')
  );
  registry.register(providerKey('scss', 'variable-reference', 'scss-value'), context =>
    parseScssIsland(context, parser, 'valueList')
  );
  registry.register(providerKey('scss', 'interpolation', 'scss-value'), context =>
    parseScssIsland(context, parser, 'valueList')
  );
  registry.register(providerKey('scss', 'at-rule-prelude', 'scss-prelude'), context =>
    parseScssPreludeIsland(context, parser)
  );
  registry.register(providerKey('scss', 'control-condition', 'scss-condition'), context =>
    parseScssControlConditionIsland(context, parser)
  );
}

/** Parses exactly one SCSS island using an existing SCSS parser rule. */
export function parseScssIsland(
  context: IslandExecutionContext,
  parser: ScssParser,
  rule: ScssRules
): IslandParseResult {
  const source = context.document.source.slice(context.island.start, context.island.end);
  return parseScssSource(context, parser, rule, source);
}

function parseScssPreludeIsland(
  context: IslandExecutionContext,
  parser: ScssParser
): IslandParseResult {
  const source = context.document.source.slice(context.island.start, context.island.end);
  const prelude = stripAtRuleName(source);
  return parseScssSource(context, parser, 'valueList', prelude);
}

function parseScssControlConditionIsland(
  context: IslandExecutionContext,
  parser: ScssParser
): IslandParseResult {
  const source = context.document.source.slice(context.island.start, context.island.end);
  const condition = stripScssControlKeyword(source);
  return parseScssSource(context, parser, 'scssCondition', condition);
}

function parseScssSource(
  context: IslandExecutionContext,
  parser: ScssParser,
  rule: ScssRules,
  source: string
): IslandParseResult {
  const result = parser.parse(source, rule);
  return {
    value: result.tree,
    diagnostics: [
      ...context.diagnostics,
      ...result.errors.map(error =>
        createParserDiagnostic({
          code: 'scss-island-parse-error',
          message: error.message,
          start: context.island.start,
          end: context.island.end,
          context: rule
        })
      )
    ]
  };
}

function stripAtRuleName(source: string): string {
  return source.replace(/^@[-\w]+\s*/, '');
}

function stripScssControlKeyword(source: string): string {
  return source.replace(/^@(if|else\s+if|while)\s+/, '');
}
