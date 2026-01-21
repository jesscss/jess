import {
  rawCssFragments,
  rawCssTokens,
  LexerType,
  type RawModeConfig,
  type RawTokenConfig,
  type RawToken,
  type TokenNames,
  type CssTokenType,
  SKIPPED_LABEL
} from '@jesscss/css-parser';
import type { WritableDeep } from 'type-fest';

type IMerges = Partial<Record<CssTokenType, RawTokenConfig>>;

function $preBuildFragments() {
  const fragments = rawCssFragments() as unknown as string[][];
  // SCSS line comment
  fragments.unshift(['lineComment', '\\/\\/[^\\n\\r]*']);

  return fragments;
}

type CssTokenModes = ReturnType<typeof rawCssTokens>['modes'];

function $preBuildTokens() {
  /**
   * Creates a type from the CSS mode and adds Less tokens
   */
  type Modes<
    T extends CssTokenModes = CssTokenModes,
    U extends typeof merges = typeof merges,
    J extends keyof U = keyof U
  > = {
    [K in keyof T]: K extends 'Default' ? T[K] | U[J] : T[K]
  };

  type InferMergeTypes = {
    modes: Modes;
    defaultMode: 'Default';
  };

  const tokens = rawCssTokens() as unknown as InferMergeTypes;

  /** Keyed by what to insert after */
  const merges = {
    HashName: [
      /**
       * SCSS interpolation start, used in selectors and other contexts.
       *
       * We only introduce a *start* token (`#{`) and reuse `RCurly` (`}`) as the terminator
       * during parsing.
       */
      {
        name: 'InterpolationStart',
        pattern: /#\{/,
        categories: ['BlockMarker']
      }
    ],
    PlainIdent: [
      {
        name: 'LineComment',
        pattern: '{{lineComment}}',
        label: SKIPPED_LABEL
      },
      { name: 'Ellipsis', pattern: /\.\.\./ },
      /**
       * SCSS variable reference token in value position.
       * This is intentionally not used for declarations; productions decide that.
       */
      {
        name: 'DollarVariable',
        pattern: '\\${{ident}}',
        start_chars_hint: ['$']
      },
      /**
       * Sass placeholder selector.
       *
       * Parsed later as selector name `\\foo` to distinguish from normal selectors.
       */
      {
        name: 'PlaceholderSelector',
        pattern: '%{{ident}}',
        categories: ['Selector']
      },
    ],
    Important: [
      /**
       * SCSS != comparison operator.
       * Must come before Important so != matches before !important.
       */
      {
        name: 'NotEq',
        pattern: /!=/,
        categories: ['CompareOperator']
      },
      /**
       * Sass variable flags.
       * Must come after `NotEq` so `!=` wins over `!default`/`!global`.
       */
      {
        name: 'SassDefault',
        pattern: '!(?:{{ws}}|{{comment}})*default',
        categories: ['BlockMarker']
      },
      {
        name: 'SassGlobal',
        pattern: '!(?:{{ws}}|{{comment}})*global',
        categories: ['BlockMarker']
      }
    ],
    /**
     * Insert EqEq (==) before Eq (=) so == matches first.
     */
    Eq: [
      { name: 'EqEq', pattern: /==/, categories: ['CompareOperator'] }
    ],
    /**
     * These need to be after any keywords, so that
     * keywords with a longer_alt of `PlainIdent`
     * aren't captured first.
     */
    Signed: [
      {
        /**
         * Namespaced function call start: `map.get(`
         * Used to desugar `map.get($map, ...)` while keeping lexing non-ambiguous.
         */
        name: 'NamespacedFunctionStart',
        /**
         * IMPORTANT:
         * We intentionally avoid XRegExp fragment substitution here because repeating
         * the same fragment (e.g. {{ident}} twice) can create duplicate named capture
         * groups and throw at lexer construction time.
         *
         * This is a conservative approximation of Sass identifiers, sufficient for
         * `map.get(`-style built-in calls and most module-qualified calls.
         */
        pattern: /[a-zA-Z_-][a-zA-Z0-9_-]*\.[a-zA-Z_-][a-zA-Z0-9_-]*\(/,
        categories: ['BlockMarker', 'FunctionStart']
      }
    ]
  } as const satisfies IMerges;

  const mutableTokens = tokens as unknown as {
    modes: Record<string, WritableDeep<RawToken[]>>;
  };

  let defaultTokens = mutableTokens.modes.Default!;

  let tokenLength = defaultTokens.length;
  for (let i = 0; i < tokenLength; i++) {
    const token: WritableDeep<RawToken> = defaultTokens[i]!;

    const { name } = token;

    // No token alterations yet; SCSS-specific concatenation behavior will be handled in productions.
    const mergesByName = merges as unknown as Record<string, ReadonlyArray<WritableDeep<RawToken>>>;
    const merge = mergesByName[name];
    if (merge) {
      /** Insert after current token */
      defaultTokens = defaultTokens.slice(0, i + 1).concat(merge, defaultTokens.slice(i + 1))
      mutableTokens.modes.Default = defaultTokens;
      const mergeLength = merge.length;
      tokenLength += mergeLength;
      i += mergeLength;
    }
  }

  return tokens;
}

export const Fragments = $preBuildFragments!();
export const Tokens = $preBuildTokens!();

type ReturnTokens = ReturnType<typeof $preBuildTokens>;
type TokenModes = ReturnTokens['modes'];

export type LessTokenType = TokenNames<TokenModes[keyof TokenModes]>;

/**
 * Token names introduced by SCSS merges.
 */
export type ScssExtraTokenType =
  | 'LineComment'
  | 'Ellipsis'
  | 'DollarVariable'
  | 'PlaceholderSelector'
  | 'NamespacedFunctionStart'
  | 'SassDefault'
  | 'SassGlobal'
  | 'InterpolationStart'
  | 'EqEq'
  | 'NotEq';

export type ScssTokenType = TokenNames<TokenModes[keyof TokenModes]> | ScssExtraTokenType;

export const scssFragments = () => Fragments as unknown as ReadonlyArray<Readonly<[string, string]>>;
export const scssTokens = () => Tokens as unknown as RawModeConfig;