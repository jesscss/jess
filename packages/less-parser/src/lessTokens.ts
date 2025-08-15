import {
  cssFragmentsRaw,
  cssTokens,
  LexerType,
  groupCapture,
  type RawModeConfig,
  type RawTokenConfig,
  type RawToken,
  type TokenNames,
  type CssTokenType,
  SKIPPED_LABEL
} from '@jesscss/css-parser';

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
  const fragments = cssFragmentsRaw() as string[][];
  fragments.unshift(['lineComment', '\\/\\/[^\\n\\r]*']);
  fragments.push(['interpolated', '[@$]\\{(?:{{nmchar}}*)\\}']);

  return fragments;
}

type CssTokenModes = ReturnType<typeof cssTokens>['modes'];

function $preBuildTokens() {
  /**
   * Creates a type from the CSS mode and adds Less tokens
   */
  type Modes<T> = any;

  type InferMergeTypes = {
    modes: any;
    defaultMode: 'Default';
  };

  const tokens = cssTokens() as unknown as InferMergeTypes;

  /** Keyed by what to insert after */
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
      /**
       * Keywords that we don't identify as idents
       * should be manually added to other places where an ident is valid.
       */
      {
        name: 'WhenFunctionStart',
        pattern: /when\(/,
        categories: ['BlockMarker', 'FunctionStart']
      },
      {
        name: 'When',
        pattern: /when/i,
        longer_alt: 'PlainIdent',
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
    UrlStart: [
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
        pattern: ['[.#]{{interpolated}}', groupCapture],
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
         * e.g. &-foo or &(foo)
         * @note Jess parsing won't absorb the post-ampersand
         * characters, so will properly support the ampersand
         */
        token.pattern = '&(?:\\({{nmchar}}*\\)|{{nmchar}}*)';
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
  return tokens;
}

export const Fragments = $preBuildFragments!();
export const Tokens = $preBuildTokens!();

type ReturnTokens = ReturnType<typeof $preBuildTokens>;
type TokenModes = ReturnTokens['modes'];

export type LessTokenType = TokenNames<TokenModes[keyof TokenModes]>;

export const lessFragments = () => Fragments as unknown as ReadonlyArray<Readonly<[string, string]>>;
export const lessTokens = () => Tokens as unknown as RawModeConfig;