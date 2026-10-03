/**
 * The private module paths a dialect plugin provides — `#less`, `#sass/math` —
 * each an alias of a package module the plugin itself depends on.
 *
 * The plugin passes a `require` anchored at its OWN location, so a private path
 * resolves to the plugin's dependency whatever the user's project installs. The
 * plugin is then the module's one resolver, loader and trust owner: it claims
 * the resolved FILE (Context's `canImportModule`), so the package spelling
 * (`@jesscss/fns/less`) that node resolution reaches through the same file loads
 * the same instance, trusted the same way.
 *
 * No `node:module` import here: the loader is the plugin's, injected.
 */
export class ProvidedModules {
  readonly #aliases: ReadonlyMap<string, string>;
  readonly #packageModules: ReadonlySet<string>;
  #files: Set<string> | undefined;

  /** `aliases` pairs each private path with the package module it names. */
  constructor(
    aliases: ReadonlyArray<readonly [alias: string, packageModule: string]>,
    private readonly load: NodeJS.Require
  ) {
    this.#aliases = new Map(aliases);
    this.#packageModules = new Set(this.#aliases.values());
  }

  /**
   * The file a candidate names when it is one of this plugin's aliases, else
   * `null`. The dialect that resolves first joins a bare specifier onto the
   * importing directory (`/dir/#less`), and may expand it into partial / index
   * spellings (`#sass/_math.scss`), so both are recovered here.
   *
   * The same holds for a package module's own spelling: once a dialect has
   * joined `@jesscss/fns/less` onto the importing directory, node resolution
   * can no longer reach it, so the provider recovers it as the module it
   * provides. A package spelling left bare stays an ordinary package.
   */
  resolve(candidate: string): string | null {
    const specifier = recoverSpecifier(candidate);
    const target = this.#aliases.get(specifier)
      ?? (specifier !== candidate && this.#packageModules.has(specifier) ? specifier : undefined);
    if (target === undefined) {
      return null;
    }
    return this.load.resolve(target);
  }

  /** Whether this plugin provides — and therefore trusts — the resolved module file. */
  owns(file: string): boolean {
    return this.files().has(file);
  }

  /** Load a provided module with the plugin's own loader. */
  import(file: string): Promise<Record<string, unknown>> {
    const module: unknown = this.load(file);
    if (typeof module !== 'object' || module === null) {
      return Promise.reject(new TypeError(`Module "${file}" did not export an object.`));
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- a required CommonJS module object; its members are converted by the module binder.
    return Promise.resolve(module as Record<string, unknown>);
  }

  private files(): Set<string> {
    return this.#files ??= new Set([...this.#aliases.values()].map(target => this.load.resolve(target)));
  }
}

/** Recover a `#…` alias or `@…` package spelling from a candidate a dialect joined or expanded. */
function recoverSpecifier(candidate: string): string {
  const normalized = candidate.replace(/\\/g, '/');
  const marker = Math.max(normalized.lastIndexOf('/#'), normalized.lastIndexOf('/@'));
  const expanded = marker >= 0 ? normalized.slice(marker + 1) : normalized;
  const segments = expanded.split('/');
  const last = segments.length - 1;
  if (last > 0) {
    segments[last] = segments[last]!.replace(/\.(?:s[ac]ss|less)$/i, '').replace(/^_/, '');
    if (segments[last] === 'index') {
      segments.pop();
    }
  }
  return segments.join('/');
}
