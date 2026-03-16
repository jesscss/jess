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
  // Jess line comment
  fragments.unshift(['lineComment', '\\/\\/[^\\n\\r]*']);
  // Jess interpolation: $(expr)
  fragments.push(['interpolated', '\\$\\{(?:[^}]*)\\}']);

  return fragments;
}

type CssTokenModes = ReturnType<typeof rawCssTokens>['modes'];

function $preBuildTokens() {
  /**
   * Creates a type from the CSS mode and adds Jess tokens
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
       * Jess interpolation start in selectors: $(expr)
       */
      {
        name: 'InterpolationStart',
        pattern: /\$\(/,
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
       * Jess control flow keywords (must come before Dollar token so they match first):
       * $if, $else, $while, $for
       */
      {
        name: 'IfKeyword',
        pattern: /\$if/,
        longer_alt: 'PlainIdent'
      },
      {
        name: 'ElseKeyword',
        pattern: /\$else/,
        longer_alt: 'PlainIdent'
      },
      {
        name: 'WhileKeyword',
        pattern: /\$while/,
        longer_alt: 'PlainIdent'
      },
      {
        name: 'ForKeyword',
        pattern: /\$for/,
        longer_alt: 'PlainIdent'
      },
      // Note: import and as keywords are handled in productions, not as separate tokens
      // They're just regular PlainIdent tokens that we check for in the parser
    ],
    /**
     * Insert Dollar token ($) - this is a separate token in Jess.
     * $var is parsed as $ + var (two tokens), except for keywords like $if.
     */
    Tilde: [
      {
        name: 'Dollar',
        pattern: /\$/,
        categories: ['BlockMarker']
      }
    ],
    /**
     * Jess at-rules: @-compose, @-from, @-export
     */
    AtImport: [
      {
        name: 'AtCompose',
        pattern: /@-compose/,
        longer_alt: 'AtKeyword',
        categories: ['BlockMarker', 'AtName']
      },
      {
        name: 'AtFrom',
        pattern: /@-from/,
        longer_alt: 'AtKeyword',
        categories: ['BlockMarker', 'AtName']
      },
      {
        name: 'AtExport',
        pattern: /@-export/,
        longer_alt: 'AtKeyword',
        categories: ['BlockMarker', 'AtName']
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

/**
 * Token names introduced by Jess merges.
 */
export type JessExtraTokenType =
  | 'LineComment'
  | 'Ellipsis'
  | 'Dollar'
  | 'InterpolationStart'
  | 'IfKeyword'
  | 'ElseKeyword'
  | 'WhileKeyword'
  | 'ForKeyword'
  | 'AtCompose'
  | 'AtFrom'
  | 'AtExport';

export type JessTokenType = TokenNames<TokenModes[keyof TokenModes]> | JessExtraTokenType;

export const jessFragments = () => Fragments as unknown as ReadonlyArray<Readonly<[string, string]>>;
export const jessTokens = () => Tokens as unknown as RawModeConfig;
