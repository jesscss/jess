import {
  createParserDiagnostic,
  providerKey,
  type IslandExecutionContext,
  type IslandParserRegistry,
  type IslandParseResult,
  type StructuralNode
} from '@jesscss/parser';
import { JessParser, type JessRules } from './jessParser.js';

/** Compiler-visible result shapes that Jess providers can materialize. */
export type JessIslandTargetShape =
  | 'jess-condition'
  | 'jess-module-at-rule'
  | 'jess-selector'
  | 'jess-value';

/**
 * Registers Jess island materializers for a structural parse plan.
 *
 * This package owns Jess grammar callbacks; `@jesscss/parser` owns only
 * request identity, caching, counters, and structural slices.
 */
export function registerJessIslandProviders(
  registry: IslandParserRegistry,
  parser = new JessParser()
): void {
  registry.register(providerKey('jess', 'selector', 'jess-selector'), context =>
    parseJessIsland(context, parser, 'selectorList')
  );
  registry.register(providerKey('jess', 'declaration-value', 'jess-value'), context =>
    parseJessIsland(context, parser, 'valueList')
  );
  registry.register(providerKey('jess', 'variable-reference', 'jess-value'), context =>
    parseJessIsland(context, parser, 'valueList')
  );
  registry.register(providerKey('jess', 'interpolation', 'jess-value'), context =>
    parseJessIsland(context, parser, 'valueList')
  );
  registry.register(providerKey('jess', 'control-condition', 'jess-condition'), context =>
    parseJessControlConditionIsland(context, parser)
  );
  registry.register(providerKey('jess', 'at-rule-prelude', 'jess-module-at-rule'), context =>
    parseJessModuleAtRuleIsland(context, parser)
  );
}

/** Parses exactly one Jess island using an existing Jess parser rule. */
export function parseJessIsland(
  context: IslandExecutionContext,
  parser: JessParser,
  rule: JessRules
): IslandParseResult {
  const source = context.document.source.slice(context.island.start, context.island.end);
  return parseJessSource(context, parser, rule, source);
}

function parseJessControlConditionIsland(
  context: IslandExecutionContext,
  parser: JessParser
): IslandParseResult {
  const source = context.document.source.slice(context.island.start, context.island.end);
  const condition = stripJessControlKeyword(source);
  return parseJessSource(context, parser, 'jessConditionInParens', condition);
}

function parseJessModuleAtRuleIsland(
  context: IslandExecutionContext,
  parser: JessParser
): IslandParseResult {
  const source = ensureSemicolon(jessModuleAtRuleStatementSource(context));
  if (source.startsWith('@-compose')) {
    return parseJessSource(context, parser, 'jessComposeAtRule', source);
  }
  if (source.startsWith('@-from')) {
    return parseJessSource(context, parser, 'jessFromAtRule', source);
  }
  if (source.startsWith('@-export')) {
    return parseJessSource(context, parser, 'jessExportAtRule', source);
  }
  return {
    fallbackFullTree: true,
    diagnostics: [
      createParserDiagnostic({
        code: 'jess-module-at-rule-unsupported',
        message: 'Unsupported Jess module at-rule island.',
        start: context.island.start,
        end: context.island.end,
        context: 'jess-module-at-rule'
      })
    ]
  };
}

function jessModuleAtRuleStatementSource(context: IslandExecutionContext): string {
  const islandText = context.document.source.slice(context.island.start, context.island.end).trimStart();
  const owner = context.island.owner;
  if (isStatementWithName(owner)) {
    const name = context.document.source.slice(owner.nameStart, owner.nameEnd).trim();
    if (name.startsWith('@-')) {
      return `${name} ${islandText}`;
    }
  }
  return islandText;
}

function isStatementWithName(
  node: StructuralNode
): node is StructuralNode & { nameStart: number; nameEnd: number } {
  return 'nameStart' in node && 'nameEnd' in node;
}

function parseJessSource(
  context: IslandExecutionContext,
  parser: JessParser,
  rule: JessRules,
  source: string
): IslandParseResult {
  const result = parser.parse(source, rule);
  return {
    value: result.tree,
    diagnostics: [
      ...context.diagnostics,
      ...result.errors.map(error =>
        createParserDiagnostic({
          code: 'jess-island-parse-error',
          message: error.message,
          start: context.island.start,
          end: context.island.end,
          context: rule
        })
      )
    ]
  };
}

function stripJessControlKeyword(source: string): string {
  return source.replace(/^\$(if|else\s+if|while)\s*/, '');
}

function ensureSemicolon(source: string): string {
  return source.endsWith(';') ? source : `${source};`;
}
