import {
  EmbeddedActionsParser,
  type IParserConfig,
  type TokenVocabulary,
  type IToken,
  type SubruleMethodOpts,
  EOF
  // type IOrAlt,
  // type OrMethodOpts
} from 'chevrotain';

// Chevrotain does not export this type publicly, and TS "bundler" resolution
// disallows deep imports into package internals. This is the minimal shape we need.
type ParserMethodInternal<ARGS extends any[] = any[], R = any> =
  ((...args: ARGS) => R) & { ruleName: string };

import {
  TreeContext,
  type LocationInfo
} from '@jesscss/core';

/** Apply this label to tokens you wish to skip during parsing consideration */
export const SKIPPED_LABEL = 'Skipped';
/** The name of the whitespace token */
export const WS_NAME = 'WS';

// const { isArray } = Array

/**
 * @note copied from 'chevrotain/src/parse/grammar/keys'
 * We have to copy these because they aren't exported
 */
export const BITS_FOR_OCCURRENCE_IDX = 8;
export const OR_IDX = 1 << BITS_FOR_OCCURRENCE_IDX;
export const OPTION_IDX = 2 << BITS_FOR_OCCURRENCE_IDX;

/**
 * A parser that can make decisions based on whitespace,
 * yet doesn't _require_ parsing whitespace in the main
 * token stream.
 */
export class AdvancedActionsParser extends EmbeddedActionsParser {
  /** Indexed by the startOffset of the next token it precedes */
  preSkippedTokenMap!: Map<number, IToken[]>;
  postSkippedTokenMap!: Map<number, IToken[]>;
  /** Boolean flag for used in post node */
  usedSkippedTokens!: Set<IToken[]>;

  _context: TreeContext | undefined;
  locationStack: LocationInfo[] = [];
  // captureStack: number[]
  originalInput!: IToken[];

  /** Exposed from Chevrotain */
  declare currIdx: number;

  get context() {
    return (this._context ??= new TreeContext());
  }

  set context(c: TreeContext) {
    this._context = c;
  }

  declare subruleInternal: <ARGS extends unknown[], R>(
    ruleToCall: ParserMethodInternal<ARGS, R>,
    idx: number,
    options?: SubruleMethodOpts<ARGS>
  ) => R;

  declare getKeyForAutomaticLookahead: (
    dslMethodIdx: number,
    occurrence: number,
  ) => number;

  declare raiseNoAltException: (
    occurrence: number,
    errMsgTypes: string | undefined,
  ) => never;

  declare getLaFuncFromCache: (key: number) => (...args: any[]) => any;

  constructor(tokenVocabulary: TokenVocabulary, config: IParserConfig) {
    super(tokenVocabulary, config);
    if (!config.skipValidations) {
      this.subruleInternal = this._subruleInternal.bind(this);
    }
  }

  /** Separate skipped tokens into a new map */
  set input(value: IToken[]) {
    const preSkippedTokenMap = this.preSkippedTokenMap = new Map<number, IToken[]>();
    const postSkippedTokenMap = this.postSkippedTokenMap = new Map<number, IToken[]>();
    const inputTokens: IToken[] = [];
    let valueLength = value.length;
    let prevToken: IToken | undefined;
    const isSkippedToken = (t?: IToken) => {
      if (!t) {
        return false;
      }
      const name = t.tokenType.name;
      return t.tokenType.LABEL === SKIPPED_LABEL || name === WS_NAME || /Comment/i.test(name);
    };
    for (let i = 0; i < valueLength; i++) {
      const token = value[i]!;
      let nextToken: IToken | undefined = undefined;
      /** Find the next non-skipped token; if none found, leave as undefined */
      for (let j = i + 1; j < valueLength; j++) {
        const candidate = value[j]!;
        if (!isSkippedToken(candidate)) {
          nextToken = candidate;
          break;
        }
      }
      const beforeIndex = nextToken?.startOffset ?? Infinity;
      const tokName = token.tokenType.name;
      const currIsSkipped = isSkippedToken(token);
      // removed diagnostics
      if (currIsSkipped) {
        let tokens = preSkippedTokenMap.get(beforeIndex);
        if (tokens) {
          tokens.push(token);
        } else {
          tokens = [token];
          preSkippedTokenMap.set(beforeIndex, tokens);
        }
        if (prevToken) {
          postSkippedTokenMap.set(prevToken.endOffset!, tokens);
        }
      } else {
        prevToken = token;
        inputTokens.push(token);
      }
    }
    this.usedSkippedTokens = new Set();
    // removed diagnostics
    this.originalInput = value;
    super.input = inputTokens;
  }

  _subruleInternal<ARGS extends unknown[], R>(
    ruleToCall: ParserMethodInternal<ARGS, R>,
    idx: number,
    options?: SubruleMethodOpts<ARGS>
  ): R {
    let name = ruleToCall.ruleName;
    let preLength = this.locationStack.length;
    // @ts-expect-error - This exists
    let result = super.subruleInternal(ruleToCall, idx, options);
    let postLength = this.locationStack.length;
    if (postLength !== preLength) {
      /**
       * In recovery-enabled parses (linting / language services), a rule may
       * throw before reaching its explicit `endRule()` call. That should be a
       * parse error, not a fatal runtime error.
       *
       * Keep the invariant check in non-recovery mode (to catch authoring bugs),
       * but unwind the stack in recovery mode so parsing can continue.
       */
      if ((this as any).recoveryEnabled) {
        while (this.locationStack.length > preLength) {
          this.locationStack.pop();
        }
      } else {
        throw new Error(`Rule ${name} did not call endRule()`);
      }
    }
    return result;
  }

  /**
   * Used in a GATE.
   * Determine if there is white-space before the next token
   */
  hasWS() {
    let startOffset = this.LA(1).startOffset;
    const skipped = this.preSkippedTokenMap.get(startOffset);
    if (!skipped) {
      return false;
    }
    return !!skipped.find(token => token.tokenType.name === WS_NAME);
  }

  /**
   * Used in a GATE.
   * Affirms that there is NOT white space or comment before next token
   */
  noSep(offset: number = 0) {
    let startOffset = this.LA(1 + offset).startOffset;
    return !this.preSkippedTokenMap.get(startOffset);
  }

  protected startRule() {
    if (!this.RECORDING_PHASE) {
      let { startOffset, startLine, startColumn } = this.LA(1);
      let location: LocationInfo = [startOffset, startLine!, startColumn!, NaN, NaN, NaN];
      this.locationStack.push(location);
      return location;
    }
  }

  /** Should only be called when not in recording phase */
  protected endRule() {
    let { endOffset, endLine, endColumn } = this.LA(0);
    let location = this.locationStack.pop()!;
    location[3] = endOffset!;
    location[4] = endLine!;
    location[5] = endColumn!;
    return location;
  }

  /** @note might not need these */
  // protected startCapture() {
  //   if (!this.RECORDING_PHASE) {
  //     let idx = this.currIdx
  //     this.startRule()
  //     this.captureStack.push(idx)
  //   }
  // }

  // protected endCapture(): [string, LocationInfo] {
  //   let location = this.endRule()
  //   let prevIdx = this.captureStack.pop()!
  //   let currIdx = this.currIdx
  //   let input = this.originalInput
  //   let tokenStr = ''
  //   let token: IToken | undefined

  //   for (let i = prevIdx; i <= currIdx; i++) {
  //     token = input[i]!
  //     if (this.preSkippedTokenMap.has(token.startOffset)) {
  //       for (let skipped of this.preSkippedTokenMap.get(token.startOffset)!) {
  //         tokenStr += skipped.image
  //       }
  //     }
  //     tokenStr += token.image
  //   }
  //   if (token && this.postSkippedTokenMap.has(token.endOffset!)) {
  //     for (let skipped of this.postSkippedTokenMap.get(token.endOffset!)!) {
  //       tokenStr += skipped.image
  //     }
  //   }
  //   return [tokenStr, location]
  // }

  protected getLocationInfo(loc: IToken): LocationInfo {
    if (loc.tokenType === EOF) {
      return new Array(6).fill(Infinity) as LocationInfo;
    }
    const {
      startOffset,
      startLine,
      startColumn,
      endOffset,
      endLine,
      endColumn
    } = loc;
    /** Assert that, in our case, tokens will have these properties */
    return [startOffset, startLine!, startColumn!, endOffset!, endLine!, endColumn!];
  }

  protected isToken(node: any): node is IToken {
    return Boolean(node && 'tokenType' in node);
  }
}