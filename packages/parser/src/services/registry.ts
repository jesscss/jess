import type {
  IslandParserProvider,
  IslandProviderKey,
  ParserConfigKey
} from './types.js';
import { providerKeyString } from './keys.js';

/**
 * Registry of island parser providers keyed by language and target shape.
 *
 * The registry owns activation-time wiring only; parse plans own request
 * deduplication, execution caches, and counters.
 */
export class IslandParserRegistry {
  #providers = new Map<string, IslandParserProvider>();

  /**
   * Registers one provider for an exact language/island/target/config key.
   *
   * Later registrations for the same key replace earlier ones, allowing plugin
   * layers to override package defaults deliberately.
   */
  register<T>(
    key: IslandProviderKey,
    provider: IslandParserProvider<T>
  ): void {
    this.#providers.set(providerKeyString(key), provider as IslandParserProvider);
  }

  /** Returns the provider for an exact key without falling back to siblings. */
  get(key: IslandProviderKey): IslandParserProvider | undefined {
    return this.#providers.get(providerKeyString(key));
  }

  /** Tests whether a provider is available for an exact key. */
  has(key: IslandProviderKey): boolean {
    return this.#providers.has(providerKeyString(key));
  }
}

/** Builds a provider key without requiring callers to spell object fields. */
export function providerKey(
  language: string,
  islandKind: IslandProviderKey['islandKind'],
  targetShape: string,
  parserConfigKey?: ParserConfigKey
): IslandProviderKey {
  return { language, islandKind, targetShape, parserConfigKey };
}
