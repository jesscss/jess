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
import { JessParser } from './jessParser.js';
import { registerJessIslandProviders } from './island-providers.js';
import { jessProfile } from './structural-profile.js';

/** Parses Jess into the shared scanner-first structural document. */
export function parseJessStructure(
  filePath: string,
  source: string,
  options?: ParseStructureOptions
): StructuralDocument {
  return parseStructure(new SourceText(source, { filePath }), jessProfile, options);
}

/** Creates a demand-driven Jess island materialization plan for a source file. */
export function jessIslandParsePlan(
  filePath: string,
  source: string,
  registry: IslandParserRegistry = new IslandParserRegistry(),
  parser: JessParser = new JessParser()
): IslandParsePlan {
  const document = parseJessStructure(filePath, source);
  registerJessIslandProviders(registry, parser);
  return new IslandParsePlan(document, registry);
}
