import {
  IslandParsePlan,
  IslandParserRegistry,
  SourceText,
  parseStructure,
  type ParseStructureOptions,
  type StructuralDocument
} from '@jesscss/parser';
import { LessParser } from './lessParser.js';
import { registerLessIslandProviders } from './island-providers.js';
import type { LessParserConfig } from './lessRecursiveParser.js';
import { lessProfile } from './structural-profile.js';

/** Parses Less into the shared scanner-first structural document. */
export function parseLessStructure(
  filePath: string,
  source: string,
  options?: ParseStructureOptions
): StructuralDocument {
  return parseStructure(new SourceText(source, { filePath }), lessProfile, options);
}

/** Creates a demand-driven Less island materialization plan for a source file. */
export function lessIslandParsePlan(
  filePath: string,
  source: string,
  config: LessParserConfig = {},
  registry: IslandParserRegistry = new IslandParserRegistry(),
  parser: LessParser = new LessParser(config)
): IslandParsePlan {
  const document = parseLessStructure(filePath, source);
  registerLessIslandProviders(registry, config, parser);
  return new IslandParsePlan(document, registry);
}
