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
import { ScssParser } from './scssParser.js';
import { registerScssIslandProviders } from './island-providers.js';
import { scssProfile } from './structural-profile.js';

/** Parses SCSS into the shared scanner-first structural document. */
export function parseScssStructure(
  filePath: string,
  source: string,
  options?: ParseStructureOptions
): StructuralDocument {
  return parseStructure(new SourceText(source, filePath), scssProfile, options);
}

/** Creates a demand-driven SCSS island materialization plan for a source file. */
export function scssIslandParsePlan(
  filePath: string,
  source: string,
  registry: IslandParserRegistry = new IslandParserRegistry(),
  parser: ScssParser = new ScssParser()
): IslandParsePlan {
  const document = parseScssStructure(filePath, source);
  registerScssIslandProviders(registry, parser);
  return new IslandParsePlan(document, registry);
}
