import type { LanguageProfile } from '../profiles/index.js';
import type { ParseStructureInput, ParseStructureOptions, StructuralDocument } from '../structure/index.js';
import { parseStructure } from '../structure/index.js';
import { IslandParsePlan } from './island-parse-plan.js';
import { IslandParserRegistry } from './registry.js';

/**
 * Activation record for a language profile and its optional island providers.
 *
 * Extension matching selects the structural profile first; provider setup runs
 * only when a caller asks for a parse plan.
 */
export type LanguageActivation = {
  name: string;
  profile: LanguageProfile;
  supportedExtensions: readonly string[];
  configureIslandProviders?(registry: IslandParserRegistry): void;
};

/** Registry for language activation by name or file extension. */
export class LanguageActivationRegistry {
  #byName = new Map<string, LanguageActivation>();
  #byExtension = new Map<string, LanguageActivation>();

  register(activation: LanguageActivation): void {
    this.#byName.set(activation.name, activation);
    for (const extension of activation.supportedExtensions) {
      this.#byExtension.set(normalizeExtension(extension), activation);
    }
  }

  getByName(name: string): LanguageActivation | undefined {
    return this.#byName.get(name);
  }

  getByExtension(extension: string): LanguageActivation | undefined {
    return this.#byExtension.get(normalizeExtension(extension));
  }

  parseStructureForExtension(
    extension: string,
    input: ParseStructureInput,
    options?: ParseStructureOptions
  ): StructuralDocument | undefined {
    const activation = this.getByExtension(extension);
    return activation ? parseStructure(input, activation.profile, options) : undefined;
  }

  createIslandParsePlanForExtension(
    extension: string,
    document: StructuralDocument,
    registry = new IslandParserRegistry()
  ): IslandParsePlan | undefined {
    const activation = this.getByExtension(extension);
    if (!activation) {
      return undefined;
    }

    activation.configureIslandProviders?.(registry);
    return new IslandParsePlan(document, registry);
  }
}

/** Normalizes extensions for activation lookup, accepting `.css` or `css`. */
export function normalizeExtension(extension: string): string {
  return extension.startsWith('.') ? extension.slice(1) : extension;
}
