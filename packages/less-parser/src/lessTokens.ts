import {
  rawCssFragments,
  rawCssTokens,
  LexerType,
  groupCapture,
  type RawModeConfig,
  type RawTokenConfig,
  type RawToken,
  type TokenNames,
  type CssTokenType,
  SKIPPED_LABEL
} from '@jesscss/css-parser';
import { AMPERSAND_TEMPLATE_CONTENTS_REGEX } from '@jesscss/core';

type IMerges = Partial<Record<CssTokenType, RawTokenConfig>>;

/**
 * Less-specific token names introduced by merges below
 *
 * @todo - Can't we infer this from the tokens?
 */
export type LessExtraTokenType =
  | 'Ellipsis'
  | 'AtKeywordLessExtension'
  | 'Interpolated'
  | 'LineComment'
  | 'PlusAssign'
  | 'UnderscoreAssign'
  | 'AnonMixinStart'
  | 'GtEqAlias'
  | 'LtEqAlias'
  | 'Extend'
  | 'AmpersandExtend'
  | 'AmpersandLParen'
  | 'AmpersandTemplateContents'
  | 'AmpersandTemplateEnd'
  | 'AllFlag'
  | 'When'
  | 'WhenFunctionStart'
  | 'VarOrProp'
  | 'NestedReference'
  | 'PropertyReference'
  | 'Percent'
  | 'FormatFunction'
  | 'IfFunction'
  | 'BooleanFunction'
  | 'DefaultGuardIdent'
  | 'DefaultGuardFunc'
  | 'JavaScript'
  | 'InterpolatedIdent'
  | 'InterpolatedCustomProperty'
  | 'InterpolatedSelector';

function $preBuildFragments() {
  const fragments = rawCssFragments() as unknown as string[][];
  fragments.unshift(['lineComment', '\\/\\/[^\\n\\r]*']);
  fragments.push(['interpolated', '[@$]\\{(?:{{nmchar}}*)\\}']);

  return fragments;
}

function $preBuildTokens() {
  /**
   * Creates a type from the CSS mode and adds Less tokens
   */
  type Modes<T> = any;

  type InferMergeTypes = {
    modes: any;
    defaultMode: 'Default';
  };

  const tokens = rawCssTokens() as unknown as InferMergeTypes;

  /**
   * Keyed by what to insert after
   *
   * @todo - Move merge utility to css-parser
  */
  const merges = {
    Assign: [
      {
        name: 'Ellipsis',
        pattern: /\.\.\./,
        categories: ['BlockMarker']
      },
      /**
       * Less's historical parser unfortunately allows
       * at-keywords that are not valid in CSS. One is
       * that Less allows at-keywords to begin with numbers.
       * Another is that it allows an at-rule that only
       * contains a single dash. So we capture this as
       * a separate token.
       *
       * We also do this later in the token stack so that we
       * don't accidentally grab something like
       * @-webkit-keyframes while looking for @-.
       */
      {
        name: 'AtKeywordLessExtension',
        pattern: '@(?:-|\\d(?:{{nmchar}})*)',
        categories: ['BlockMarker', 'AtName']
      }
    ],
    PlainIdent: [
      { name: 'Interpolated', pattern: LexerType.NA },
      {
        name: 'LineComment',
        pattern: '{{lineComment}}',
        label: SKIPPED_LABEL
      },
      { name: 'PlusAssign', pattern: '\\+{{whitespace}}*:', categories: ['BlockMarker', 'Assign'] },
      {
        name: 'UnderscoreAssign',
        pattern: '\\+{{whitespace}}*_{{whitespace}}*:',
        categories: ['BlockMarker', 'Assign']
      },
      { name: 'AnonMixinStart', pattern: /[.#]\(/, categories: ['BlockMarker'] },
      { name: 'GtEqAlias', pattern: /=>/, categories: ['CompareOperator'] },
      { name: 'LtEqAlias', pattern: /=</, categories: ['CompareOperator'] },
      {
        name: 'Extend',
        pattern: /:extend\(/,
        categories: ['BlockMarker']
      },
      {
        name: 'VarOrProp',
        pattern: LexerType.NA
      },
      {
        name: 'NestedReference',
        pattern: ['([@$]+{{ident}}?){2,}', groupCapture],
        start_chars_hint: ['@', '$'],
        categories: ['VarOrProp'],
        line_breaks: true
      },
      {
        name: 'PropertyReference',
        pattern: '\\${{ident}}',
        categories: ['VarOrProp']
      },
      /** Can be used in unit function or mod operation */
      {
        name: 'Percent',
        pattern: /%/
      },
      {
        name: 'DefaultGuardIdent',
        pattern: /default/,
        longer_alt: 'PlainIdent',
        categories: ['Ident']
      },
      {
        name: 'DefaultGuardFunc',
        pattern: /default(?:\(\))/
      }
    ],
    Ampersand: [
      {
        name: 'AmpersandExtend',
        pattern: /&:extend\(/,
        categories: ['BlockMarker']
      },
      {
        name: 'AmpersandLParen',
        pattern: /&\(/,
        push_mode: 'AmpersandTemplate',
        categories: ['Selector', 'NestedRuleStart', 'BlockMarker']
      },
      {
        name: 'AllFlag',
        pattern: /!all/,
        categories: ['BlockMarker']
      }
    ],
    UrlStart: [
      /**
       * Keywords that we don't identify as idents
       * should be manually added to other places where an ident is valid.
       */
      {
        name: 'When',
        pattern: /when/i,
        longer_alt: 'PlainIdent',
        categories: ['BlockMarker']
      },
      {
        name: 'FormatFunction',
        pattern: /%\(/,
        categories: ['BlockMarker', 'FunctionStart']
      },
      {
        name: 'IfFunction',
        pattern: /if\(/,
        categories: ['BlockMarker', 'FunctionStart']
      },
      {
        name: 'BooleanFunction',
        pattern: /boolean\(/,
        categories: ['BlockMarker', 'FunctionStart']
      },
      {
        name: 'JavaScript',
        pattern: /~?`[^`]*`/,
        line_breaks: true
      }
    ],
    /**
     * These need to be after any keywords, so that
     * keywords with a longer_alt of `PlainIdent`
     * aren't captured first.
     */
    Signed: [
      {
        name: 'InterpolatedIdent',
        /**
         * Must contain one `@{}`
         * It's too expensive for Chevrotain to capture groups here,
         * so we'll extract the interpolated values later.
         */
        pattern: '(?:{{ident}}|-)?{{interpolated}}(?:{{interpolated}}|{{nmchar}})*',
        categories: ['Interpolated', 'Selector', 'Ident']
      },
      {
        name: 'InterpolatedCustomProperty',
        /**
         * Must contain one `@{}`
         * It's too expensive for Chevrotain to capture groups here,
         * so we'll extract the interpolated values later.
         */
        pattern: '--{{ident}}?{{interpolated}}(?:{{interpolated}}|{{nmchar}})*',
        categories: ['Interpolated']
      },
      /**
     * Unfortunately, there's grammatical ambiguity between
     * interpolated props and a naked interpolated selector name,
     * making this awkward token necessary.
     */
      {
        name: 'InterpolatedSelector',
        pattern: ['[.#]{{ident}}?{{interpolated}}(?:{{interpolated}}|{{nmchar}})*', groupCapture],
        categories: ['Interpolated', 'Selector'],
        start_chars_hint: ['.', '#'],
        line_breaks: true
      }
    ]
  } as const satisfies IMerges;

  let defaultTokens = (tokens.modes.Default as unknown as Readonly<RawToken[]>).slice() as RawToken[];

  let tokenLength = defaultTokens.length;
  for (let i = 0; i < tokenLength; i++) {
    let token: RawToken = defaultTokens[i]!;

    const { name } = token;
    const copyToken = () => {
      token = structuredClone(token) as RawToken;
    };

    let alterations = true;

    switch (name) {
      /**
       * Less / Sass Ampersand is slightly different
       * from CSS Nesting in that it concatenates, so we
       * need to gobble up the rest of the identifier
       * if present.
       */
      case 'Ampersand':
        copyToken();
        /**
         * Captures not just ampersands, but "ampersand merges", where
         * the intent of the author was to merge the parent selector with a token
         * suffix or prefix.
         *
         * e.g.
         *   1. &-foo
         *   2. &(foo)
         *   3. &1
         *   4. .foo-&
         */
        token.pattern = '(?:[.#](?:{{ident}}-)?&|&){{nmchar}}*';
        token.start_chars_hint = ['&', '.', '#'];
        break;
      case 'DotName':
      case 'HashName':
        copyToken();
        token.longer_alt = 'Ampersand';
        break;
      case 'Divide':
        copyToken();
        token.pattern = /\.?\//;
        break;
      case 'SingleQuoteStart':
        copyToken();
        token.pattern = /~?'/;
        break;
      case 'DoubleQuoteStart':
        copyToken();
        token.pattern = /~?"/;
        break;
      default:
        alterations = false;
    }
    if (alterations) {
      defaultTokens[i] = token;
    }
    // @ts-expect-error - Suppress index warning
    const merge = merges[name];
    if (merge) {
      /** Insert after current token */
      defaultTokens = defaultTokens.slice(0, i + 1).concat(merge, defaultTokens.slice(i + 1));
      (tokens.modes.Default as unknown as RawToken[]) = defaultTokens;
      const mergeLength = merge.length;
      tokenLength += mergeLength;
      i += mergeLength;
    }
  }
  tokens.modes.AmpersandTemplate = [
    {
      name: 'AmpersandTemplateEnd',
      pattern: /\)/,
      pop_mode: true,
      categories: ['FunctionLikeEnd']
    },
    {
      name: 'AmpersandTemplateContents',
      /**
       * Template-ish raw text until `)` or a quote. Quotes are tokenized
       * separately so `&('')` can be handled like `url(...)`.
       *
       * We intentionally do not accept arbitrary plain identifiers here:
       * Less templates are selector-ish fragments or explicit `&` insertion
       * patterns, not free-form identifiers like `nil`.
       */
      pattern: AMPERSAND_TEMPLATE_CONTENTS_REGEX,
      categories: ['Selector']
    },
    'SingleQuoteStart',
    'DoubleQuoteStart',
    'WS'
  ] as any;
  return tokens;
}

export const Fragments = $preBuildFragments!();
export const Tokens = $preBuildTokens!();

type ReturnTokens = ReturnType<typeof $preBuildTokens>;
type TokenModes = ReturnTokens['modes'];

export type LessTokenType = TokenNames<TokenModes[keyof TokenModes]>;

export const lessFragments = () => Fragments as unknown as ReadonlyArray<Readonly<[string, string]>>;
export const lessTokens = () => Tokens as unknown as RawModeConfig;
