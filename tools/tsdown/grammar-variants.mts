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
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
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
  external?: readonly (string | RegExp)[];
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
    external: [GRAMMAR_SPECIFIER, ...options.external ?? []],
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

/*
 * The interpreter twin of every variant lives under `grammar/interpreter/`, so
 * `./grammar/<variant>` and `./grammar/interpreter/<variant>` name the same
 * grammar run by the two engines.
 */
const INTERPRETER_DIR = 'grammar/interpreter';

/*
 * A dialect grammar composes over a sibling parser's grammar export
 * (`@jesscss/css-parser/grammar/base`). The interpreter twin must compose over the
 * sibling's interpreter twin too, or half of it would run as a compiled table.
 */
const SIBLING_GRAMMAR = /^(@jesscss\/[\w-]+-parser\/grammar)(\/[\w/-]+)?$/;

function interpreterPaths(shared: readonly string[], extension: '.js' | '.cjs') {
  const sharedPath = sharedPaths(shared, extension);
  return (id: string): string => {
    const match = SIBLING_GRAMMAR.exec(id);
    return match ? `${match[1]}/interpreter${match[2] ?? ''}` : sharedPath(id);
  };
}

/*
 * Grammar sources import their combinators `with { type: 'macro' }`. Without the
 * parseman plugin nothing consumes that attribute, and Node rejects an import
 * whose `type` it does not know, so the interpreter build strips it and the
 * import stays an ordinary runtime import of `parseman`.
 */
const MACRO_ATTRIBUTE = /\s+with\s*\{\s*type:\s*['"]macro['"]\s*\}/g;

/*
 * `@jesscss/parser-shared` publishes only macro-compiled recognition grammars,
 * which every parser composes into its own. The interpreter twin bundles that
 * package's source instead, so no compiled table reaches the interpreter graph.
 */
const PARSER_SHARED = /^@jesscss\/parser-shared\/([\w-]+)$/;

/*
 * The package directory, found the way Node would find it from the importing
 * module. Not relative to this file: on Node < 22.18 tsdown bundles the config
 * before loading it, which rewrites `import.meta.url` to the package's config.
 * The exports map exposes only `lib/`, so `require.resolve` cannot name `src/`.
 */
function parserSharedDir(importer: string): string {
  const lookup = createRequire(importer).resolve.paths('@jesscss/parser-shared') ?? [];
  const found = lookup.map(dir => join(dir, '@jesscss/parser-shared')).find(dir => existsSync(dir));
  if (found === undefined) {
    throw new Error(`@jesscss/parser-shared is not resolvable from ${importer}`);
  }
  return found;
}

const interpreterPlugin = {
  name: 'jess:grammar-interpreter',
  resolveId: {
    order: 'pre' as const,
    handler(source: string, importer: string | undefined) {
      const match = PARSER_SHARED.exec(source);
      return match && importer !== undefined
        ? join(parserSharedDir(importer), 'src', `${match[1]}.ts`)
        : null;
    }
  },
  transform(code: string) {
    const stripped = code.replace(MACRO_ATTRIBUTE, '');
    return stripped === code ? null : stripped;
  }
};

/*
 * A grammar source declares all four variants at top level, each a
 * `compose()`/`composeLeaf()` call. The macro replaces those initializers with
 * table literals, but here they stay calls, so a variant entry that exports one
 * grammar would still create the other three on import. Declaring the two pure
 * lets rolldown drop the unexported ones. `rules()` is deliberately NOT listed:
 * dropping the recognition maps no variant composes changes the Less AST
 * (`interpreter-parity.test.ts` fails), so its calls are not side-effect free.
 */
const INTERPRETER_TREESHAKE = { manualPureFunctions: ['compose', 'composeLeaf'] };

function interpreterExternal(patterns: readonly (string | RegExp)[]) {
  return (id: string): boolean => !PARSER_SHARED.test(id)
    && patterns.some(pattern => typeof pattern === 'string' ? pattern === id : pattern.test(id));
}

/**
 * One single-entry build per grammar variant, so no variant can pull another,
 * plus the same entry built again without `plugins` (the parseman macro) as
 * its interpreter twin: the combinator graph ships as-is and runs on
 * parseman's interpreter.
 */
export function grammarVariantBuilds(options: {
  dir?: string;
  /*
   * Extra single-export entries built alongside the four variants, both
   * compiled and as interpreter twins. css adds `base`, its compose base, so a
   * dialect composing onto it never loads css's own parse grammar.
   */
  extraEntries?: readonly string[];
  shared?: readonly string[];
  plugins?: PluginList;
  external?: readonly (string | RegExp)[];
}) {
  const dir = options.dir ?? './src/grammar';
  const shared = options.shared ?? [];
  const extraExternal = options.external ?? [];
  const externalPatterns = [...shared.length > 0 ? [sharedSpecifier(shared)] : [], ...extraExternal];
  const external = externalPatterns.length > 0 ? { external: externalPatterns } : {};
  const variants = [...GRAMMAR_VARIANTS, ...options.extraEntries ?? []];
  const compiled = variants.map(variant => {
    return {
      ...BASE,
      entry: { [`grammar/${variant}`]: `${dir}/${variant}.ts` },
      clean: false,
      ...external,
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
  const interpreter = variants.map(variant => {
    return {
      ...BASE,
      entry: { [`${INTERPRETER_DIR}/${variant}`]: `${dir}/${variant}.ts` },
      clean: false,
      external: interpreterExternal(externalPatterns),
      treeshake: INTERPRETER_TREESHAKE,
      plugins: [interpreterPlugin],
      outputOptions(outputOptions: Record<string, unknown>, format: string) {
        const next = {
          ...outputOptions,
          chunkFileNames: nestSharedChunks(outputOptions.chunkFileNames as never),
          paths: interpreterPaths(shared, format === 'cjs' ? '.cjs' : '.js')
        };
        return format === 'cjs' ? { ...next, exports: 'named' } : next;
      }
    };
  });
  return [...compiled, ...interpreter];
}
