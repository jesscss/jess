/**
 * Jess language token definitions.
 *
 * Extends SCSS tokens with Jess-specific additions:
 * - `JessIf`       `$if`  keyword (longer_alt: DollarVariable)
 * - `JessElse`     `$else` keyword (longer_alt: DollarVariable)
 * - `JessFor`      `$for`  keyword (longer_alt: DollarVariable)
 * - `JessWhile`    `$while` keyword (longer_alt: DollarVariable)
 * - `JessDollar`   lone `$` for mixin-call operator (`$ > name()`)
 * - `DollarParen`  `$(` for expression context
 * - `DollarCaret`  `$^` for linear-variable access (`$^color`)
 * Dashed at-rules (`@-compose`, `@-from`, `@-export`) are
 * lexed as ordinary `AtKeyword` tokens; the parser dispatches on `.image`.
 */
import {
  scssFragments,
  scssTokens,
  type ScssTokenType
} from '@jesscss/scss-parser';
import { type RawModeConfig, type RawToken } from '@jesscss/css-parser';
import type { WritableDeep } from 'type-fest';

function $preBuildFragments() {
  return scssFragments() as unknown as string[][];
}

function $preBuildTokens() {
  const tokens = scssTokens() as unknown as {
    modes: Record<string, WritableDeep<RawToken[]>>;
    defaultMode: 'Default';
  };

  /**
   * `createLexerDefinition` prepends each token via `unshift`, so the raw
   * array order is REVERSED in the final Chevrotain lexer.  Tokens at LATER
   * raw indices end up at EARLIER lexer positions → HIGHER matching priority.
   *
   * Chevrotain uses FIRST-MATCH (not longest-match) within a start-char group,
   * so priority order matters whenever two tokens can both match the same input.
   *
   * Required priority (high → low) for `$`-prefix tokens:
   *   JessIf/JessElse/JessFor/JessWhile  (handle $if, $else, …)
   *   DollarParen / DollarCaret          (handle $(, $^)
   *   DollarVariable                     (handles $ident)
   *   JessDollar                         (lone $ — last resort)
   *
   * Keyword tokens (`JessIf` etc.) also declare `longer_alt: 'DollarVariable'`
   * so that `$ifoo` (where DollarVariable matches longer) falls back to
   * DollarVariable.  `longer_alt` is resolved at token-creation time, so these
   * tokens must come AFTER DollarVariable in the raw array (T['DollarVariable']
   * must already exist when they are processed).
   *
   * JessDollar has no `longer_alt` and must sit BEFORE DollarVariable in the
   * raw array so that it ends up at LOWER priority in the lexer.
   */

  /** Inserted BEFORE DollarVariable → lower lexer priority than DollarVariable. */
  const beforeDollarVariable = [
    /** Lone `$` — mixin-call operator. Must lose to DollarVariable for `$ident`. */
    { name: 'JessDollar', pattern: /\$/, start_chars_hint: ['$'] }
  ] as const satisfies ReadonlyArray<WritableDeep<RawToken>>;

  /** Inserted AFTER DollarVariable → higher lexer priority than DollarVariable. */
  const afterDollarVariable = [
    /** `$(` — starts a Jess expression context. */
    { name: 'DollarParen',  pattern: /\$\(/, start_chars_hint: ['$'], categories: ['BlockMarker'] },
    /** `$^` — linear-variable access / assignment. */
    { name: 'DollarCaret',  pattern: /\$\^/, start_chars_hint: ['$'], categories: ['BlockMarker'] },
    /**
     * Keyword tokens — `longer_alt: 'DollarVariable'` ensures `$ifoo` stays
     * as DollarVariable while exact `$if` becomes JessIf.
     * They must come after DollarVariable so `T['DollarVariable']` exists.
     */
    { name: 'JessIf',    pattern: /\$if/,    longer_alt: 'DollarVariable', start_chars_hint: ['$'] },
    { name: 'JessElse',  pattern: /\$else/,  longer_alt: 'DollarVariable', start_chars_hint: ['$'] },
    { name: 'JessFor',   pattern: /\$for/,   longer_alt: 'DollarVariable', start_chars_hint: ['$'] },
    { name: 'JessWhile', pattern: /\$while/, longer_alt: 'DollarVariable', start_chars_hint: ['$'] }
  ] as const satisfies ReadonlyArray<WritableDeep<RawToken>>;

  let defaultTokens = tokens.modes.Default!;
  for (let i = 0; i < defaultTokens.length; i++) {
    if (defaultTokens[i]!.name === 'DollarVariable') {
      defaultTokens = [
        ...defaultTokens.slice(0, i),
        ...beforeDollarVariable,
        defaultTokens[i]!,
        ...afterDollarVariable,
        ...defaultTokens.slice(i + 1)
      ];
      tokens.modes.Default = defaultTokens;
      break;
    }
  }

  return tokens;
}

export const Fragments = $preBuildFragments();
export const Tokens = $preBuildTokens();

export type JessExtraTokenType =
  | 'JessIf'
  | 'JessElse'
  | 'JessFor'
  | 'JessWhile'
  | 'DollarParen'
  | 'DollarCaret'
  | 'JessDollar';

export type JessTokenType = ScssTokenType | JessExtraTokenType;

export const jessFragments = () => Fragments as unknown as ReadonlyArray<Readonly<[string, string]>>;
export const jessTokens = () => Tokens as unknown as RawModeConfig;
