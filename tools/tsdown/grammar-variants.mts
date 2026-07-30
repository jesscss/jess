/**
 * Shared tsdown shape for the four `*-parser` packages.
 *
 * Every dialect compiles the same grammar factory four ways — AST or CST, with
 * or without line/column tracking — and each compiled artifact is a standalone
 * multi-megabyte table. Building all four as entries of one build makes
 * rolldown hoist them into a shared chunk that every entry then imports, so a
 * consumer that wants one variant loads all four. Building each variant as its
 * own single-entry build keeps them physically separate: `lib/grammar/ast.js`
 * contains the AST table and nothing else.
 *
 * All four packages must emit the identical layout, so the entry list and
 * output options live here rather than in each package's config.
 */

/** Variant subpath -> source module, relative to a package's grammar directory. */
import { nestSharedChunks } from './chunk-names.mts';

export const GRAMMAR_VARIANTS = ['ast', 'ast/positions', 'cst', 'cst/positions'] as const;

export type GrammarVariant = (typeof GRAMMAR_VARIANTS)[number];

type PluginList = readonly unknown[];

const BASE = {
  format: ['esm', 'cjs'] as const,
  dts: true,
  outDir: './lib',
  platform: 'node' as const,
  fixedExtension: false,
  hash: false,
  deps: { onlyBundle: false }
};

/*
 * The entry build leaves `./grammar/<variant>.js` as an external relative
 * import so `lib/index.js` points at the sibling variant file instead of
 * inlining a second copy of the table. CommonJS output has to re-point those
 * specifiers at the `.cjs` siblings, which is what `paths` does below.
 */
const GRAMMAR_SPECIFIER = /^\.{1,2}\/grammar\/[\w/-]+\.js$/;

/*
 * Rolldown hands `paths` the unresolved specifier, which is relative to the
 * source module rather than to the emitted file, and differs between formats.
 * Both `index` and `cst` are emitted at the root of `lib/`, so every variant
 * reference normalizes to `./grammar/<variant>` with the format's extension.
 */
const GRAMMAR_TAIL = /(?:^|\/)grammar\/([\w/-]+)\.js$/;

function grammarPaths(extension: '.js' | '.cjs') {
  return (id: string): string => {
    const match = GRAMMAR_TAIL.exec(id);
    return match ? `./grammar/${match[1]}${extension}` : id;
  };
}

/*
 * Modules that both the entry build and a variant build reach have to be
 * emitted once and shared, not bundled into each. Duplicating one produces two
 * copies of whatever it declares, and a class declared twice fails `instanceof`
 * across the boundary — which is exactly how the Less parse-error classes broke
 * when the variants were first split out. Each shared module becomes its own
 * entry in the entry build and stays external everywhere else.
 */
function sharedSpecifier(shared: readonly string[]): RegExp {
  return new RegExp(`(?:^|/)(${shared.join('|')})\\.js$`);
}

/*
 * Rolldown re-relativizes whatever `paths` returns against the emitted chunk,
 * so the mapping names the module as if it sat beside `lib/` and lets rolldown
 * add the `../` hops for however deep the variant is nested.
 */
function sharedPaths(shared: readonly string[], extension: '.js' | '.cjs') {
  const pattern = sharedSpecifier(shared);
  return (id: string): string => {
    const match = pattern.exec(id);
    return match ? `./${match[1]}${extension}` : id;
  };
}

/** The `index` / `cst` build: public API surface, grammar variants left external. */
export function parserEntryBuild(options: {
  entry: Record<string, string>;
  shared?: readonly string[];
  srcDir?: string;
  plugins?: PluginList;
}) {
  const srcDir = options.srcDir ?? './src';
  const sharedEntries = Object.fromEntries(
    (options.shared ?? []).map(name => [name, `${srcDir}/${name}.ts`])
  );
  return {
    ...BASE,
    entry: { ...options.entry, ...sharedEntries },
    /*
     * tsdown runs the configs in this array concurrently, so a `clean` on any
     * one of them races the others and can delete output a sibling build has
     * already written. Each package's `compile` script removes `lib/` once,
     * up front, instead.
     */
    clean: false,
    external: [GRAMMAR_SPECIFIER],
    plugins: options.plugins ?? [],
    outputOptions(outputOptions: Record<string, unknown>, format: string) {
      const next = {
        ...outputOptions,
        chunkFileNames: nestSharedChunks(outputOptions.chunkFileNames as never),
        paths: grammarPaths(format === 'cjs' ? '.cjs' : '.js')
      };
      return format === 'cjs' ? { ...next, exports: 'named' } : next;
    }
  };
}

/** One single-entry build per grammar variant, so no variant can pull another. */
export function grammarVariantBuilds(options: {
  dir?: string;
  shared?: readonly string[];
  plugins?: PluginList;
}) {
  const dir = options.dir ?? './src/grammar';
  const shared = options.shared ?? [];
  return GRAMMAR_VARIANTS.map(variant => {
    return {
      ...BASE,
      entry: { [`grammar/${variant}`]: `${dir}/${variant}.ts` },
      clean: false,
      ...shared.length > 0 ? { external: [sharedSpecifier(shared)] } : {},
      plugins: options.plugins ?? [],
      outputOptions(outputOptions: Record<string, unknown>, format: string) {
        const next = {
          ...outputOptions,
          chunkFileNames: nestSharedChunks(outputOptions.chunkFileNames as never),
          ...shared.length > 0
            ? { paths: sharedPaths(shared, format === 'cjs' ? '.cjs' : '.js') }
            : {}
        };
        return format === 'cjs' ? { ...next, exports: 'named' } : next;
      }
    };
  });
}
