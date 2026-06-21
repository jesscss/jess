import {
  SourceText,
  parseStructure,
  type ParseStructureOptions
} from '@jesscss/parser';
import type { StructuralDocument } from '@jesscss/parser/structure/index';
import {
  IslandParsePlan,
  IslandParserRegistry
} from '@jesscss/parser/services/index';
import { CssParser } from './cssParser.js';
import { registerCssIslandProviders } from './island-providers.js';
import { cssProfile } from './structural-profile.js';

/**
 * Parses CSS into the shared scanner-first structural document.
 *
 * This is intentionally not the compiler AST parser. It returns structural
 * nodes, diagnostics, trivia, and raw islands that may later be materialized by
 * CSS island providers.
 */
export function parseCssStructure(
  filePath: string,
  source: string,
  options?: ParseStructureOptions
): StructuralDocument {
  return parseStructure(new SourceText(source, { filePath }), cssProfile, options);
}

/**
 * Creates a demand-driven CSS island materialization plan for a source file.
 */
export function cssIslandParsePlan(
  filePath: string,
  source: string,
  registry: IslandParserRegistry = new IslandParserRegistry(),
  parser: CssParser = new CssParser()
): IslandParsePlan {
  const document = parseCssStructure(filePath, source);
  registerCssIslandProviders(registry, parser);
  return new IslandParsePlan(document, registry);
}
