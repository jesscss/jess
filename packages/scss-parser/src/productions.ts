import { productions as cssProductions } from '@jesscss/css-parser';
import type { AltContext, RuleContext } from '@jesscss/css-parser';
import type { IToken } from 'chevrotain';
import { Lexer } from 'chevrotain';
import { createLexerDefinition } from '@jesscss/css-parser';
import { ScssActionsParser, type TokenMap as ScssTokenMap } from './scssActionsParser.js';
import { scssFragments, scssTokens } from './scssTokens.js';
import {
  Any,
  AtRule,
  Ampersand,
  BasicSelector,
  Block,
  Call,
  ComplexSelector,
  CompoundSelector,
  Collection,
  Condition,
  CustomDeclaration,
  Declaration,
  Extend,
  Interpolated,
  INTERPOLATION_PLACEHOLDER,
  type AssignmentType,
  Each,
  Expression,
  Func,
  F_VISIBLE,
  For,
  If,
  type IfBranch,
  JsImport,
  List,
  Log,
  Mixin,
  Nil,
  Node as JessNode,
  Paren,
  Quoted,
  Range,
  Reference,
  Rest,
  Rules,
  Sequence,
  StyleImport,
  VarDeclaration,
  While,
  type Rules as RulesType,
  type LocationInfo,
  type Node,
  type Selector,
  type SimpleSelector,
  isNode
} from '@jesscss/core';

type InterpolationMatch = { start: number; end: number; content: string };

function findScssInterpolations(value: string): InterpolationMatch[] {
  const matches: InterpolationMatch[] = [];
  let i = 0;
  while (i < value.length) {
    if (value[i] === '#' && value[i + 1] === '{') {
      const start = i;
      i += 2; // skip #{
      let braceCount = 1;
      const contentStart = i;
      while (i < value.length && braceCount > 0) {
        const ch = value[i]!;
        if (ch === '{') {braceCount++;}
        else if (ch === '}') {braceCount--;}
        i++;
      }
      if (braceCount === 0) {
        matches.push({ start, end: i, content: value.slice(contentStart, i - 1) });
      }
    } else {
      i++;
    }
  }
  return matches;
}

let interpolationParser:
  | {
    lexer: Lexer;
    parser: ScssActionsParser;
  }
    | undefined;

function getInterpolationParser(): { lexer: Lexer; parser: ScssActionsParser } {
  if (interpolationParser) {return interpolationParser;}
  const { lexer, T } = createLexerDefinition(scssFragments(), scssTokens());
  const chevLexer = new Lexer(lexer, {
    ensureOptimizations: true,
    // Keep consistent with Parser wrapper defaults.
    skipValidations: process.env.TEST !== 'true'
  });
  const parser = new ScssActionsParser(lexer, T as any, {
    skipValidations: process.env.TEST !== 'true'
  });
  interpolationParser = { lexer: chevLexer, parser };
  return interpolationParser;
}

function parseInterpolationExpression(expr: string): Node {
  const { lexer, parser } = getInterpolationParser();
  const lexed = lexer.tokenize(expr);
  parser.input = lexed.tokens;
  // Parse as a value sequence (expression-ish).
  return parser.valueSequence({} as any) as unknown as Node;
}

function processScssStringInterpolation(
  value: string,
  location: LocationInfo,
  context: any
): Any | Interpolated {
  const matches = findScssInterpolations(value);
  if (matches.length === 0) {
    return new Any(value, { role: 'any' }, location, context);
  }

  const replacements: Node[] = [];
  let source = value;
  let offset = 0;

  for (const match of matches) {
    const adjustedStart = match.start - offset;
    const adjustedEnd = match.end - offset;
    const before = source.slice(0, adjustedStart);
    const after = source.slice(adjustedEnd);
    source = before + INTERPOLATION_PLACEHOLDER + after;
    offset += (match.end - match.start) - INTERPOLATION_PLACEHOLDER.length;

    const parsed = parseInterpolationExpression(match.content.trim());
    replacements.push(parsed);
  }

  return new Interpolated({ source, replacements }, { role: 'any' }, location, context);
}

/**
 * SCSS-specific production overrides.
 *
 * This milestone focuses on:
 * - Sass map literals: `(\"k\": v, ...)` → `Collection`
 * - `map-get()` and `map.get()` → `Reference` lookup chains
 */

function unwrapSingleSequence(n: Node): Node {
  if (isNode(n, 'Sequence') && (n as Sequence).value.length === 1) {
    return (n as Sequence).value[0]!;
  }
  return n;
}

function toDeclKey(node: Node): string {
  // Quoted.valueOf() returns an unquoted string
  const key = node.valueOf();
  return String(key);
}

function isValidIdentifierKey(key: string): boolean {
  return /^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(key);
}

function desugarMapLookup(
  parser: ScssActionsParser,
  call: Call
): Node {
  const name = call.value.name;
  if (typeof name !== 'string') {
    return call;
  }
  if (name !== 'map-get' && name !== 'map.get') {
    return call;
  }

  const argsList = call.value.args;
  const args = isNode(argsList, 'List') ? (argsList as List).value : [];
  if (args.length < 2) {
    return call;
  }

  const mapExpr = unwrapSingleSequence(args[0] as Node);
  const keyArgs = args.slice(1).map(a => unwrapSingleSequence(a as Node));

  // Reference.target only supports Reference or Call today; keep conservative.
  const initialTarget: Reference | Call | undefined =
    isNode(mapExpr, 'Reference')
? (mapExpr as Reference)
      : isNode(mapExpr, 'Call')
? (mapExpr as Call)
        : undefined;

  if (!initialTarget) {
    return call;
  }

  const callLoc: LocationInfo | undefined = Array.isArray(call.location) && call.location.length === 6
    ? (call.location as LocationInfo)
    : undefined;

  let currentTarget: Reference | Call = initialTarget;
  for (const keyNode of keyArgs) {
    // Prefer turning quoted keys into plain identifier keys where possible.
    const keyStr = toDeclKey(keyNode);
    const useDeclaration = isValidIdentifierKey(keyStr);
    const ref = new Reference(
      { target: currentTarget, key: useDeclaration ? keyStr : keyNode },
      { type: useDeclaration ? 'declaration' : 'index' },
      callLoc,
      parser.context
    );
    currentTarget = ref;
  }

  return currentTarget;
}

function makeNamespacedReference(
  parser: ScssActionsParser,
  parts: string[],
  finalType: 'variable' | 'function' | 'mixin' | 'mixin-ruleset'
): Reference {
  // Namespace root: treat like a variable.
  let current: Reference = new Reference(parts[0]!, { type: 'variable' }, undefined, parser.context);
  for (let i = 1; i < parts.length; i++) {
    const isFinal = i === parts.length - 1;
    const type = isFinal ? finalType : 'index';
    current = new Reference(
      { target: current, key: parts[i]! },
      { type },
      undefined,
      parser.context
    );
  }
  return current;
}

function desugarNamespacedCall(parser: ScssActionsParser, call: Call): Call {
  const { name } = call.value;
  if (typeof name !== 'string') {return call;}
  if (!name.includes('.')) {return call;}
  // Preserve special-casing for map.get() which has additional semantics elsewhere.
  if (name === 'map.get') {return call;}
  const parts = name.split('.').filter(Boolean);
  if (parts.length < 2) {return call;}
  const ref = makeNamespacedReference(parser, parts, 'function');
  return new Call({ name: ref, args: call.value.args }, call.options, call.location, parser.context);
}

function looksLikeMapLiteral(la: (k: number) => IToken, T: ScssTokenMap): boolean {
  // Heuristic: scan until matching RParen (no nesting awareness yet) and look for a Colon.
  // This is conservative: it only claims "map" if there is an obvious "key: value".
  let depth = 0;
  for (let i = 1; i < 50; i++) {
    const tok = la(i);
    if (tok.tokenType === T.LParen) {depth++;}
    if (tok.tokenType === T.RParen) {
      if (depth === 0) {return false;}
      depth--;
      if (depth === 0) {return false;}
    }
    if (tok.tokenType === T.Colon && depth === 1) {
      return true;
    }
    if (tok.tokenType.name === 'EOF') {
      return false;
    }
  }
  return false;
}

/**
 * SCSS control-flow condition parsing (parse-only).
 *
 * Jess requires comparisons to be represented as a `Condition` node. Sass uses `==`,
 * but Jess uses `=`. We normalize `==` to `=`.
 *
 * This rule is intentionally conservative: it only parses a single comparison of the form:
 * `<valueSequence> (==|=|!=|>=|<=|>|<) <valueSequence>`
 * and otherwise falls back to a single valueSequence wrapped in a Sequence.
 */
/**
 * Top-level SCSS condition parser (similar to Less's guard).
 * Returns a Paren(Condition(...)) node (or nested Conditions for and/or).
 * The Sequence wrapper is added in scssIfAtRule/scssWhileAtRule.
 */
export function scssCondition(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    ctx.allowComma = true;
    const guardNode = $.SUBRULE($.scssGuardOr, { ARGS: [ctx] }) as unknown as Node;
    // The guardNode is already wrapped in Paren by scssGuardInParens
    return guardNode;
  };
}

function looksLikeScssComparison(la: (k: number) => IToken, T: ScssTokenMap): boolean {
  // Heuristic: in a top-level guard segment, if we can see a comparison operator
  // before a hard boundary, prefer parsing as `scssComparison` instead of a plain value.
  for (let i = 1; i < 30; i++) {
    const tok = la(i);
    const tt = tok.tokenType;
    if (
      tt === T.LCurly
      || tt === T.RCurly
      || tt === T.RParen
      || tt === T.And
      || tt === T.Or
      || tt === T.Comma
      || tt === T.Semi
      || tt.name === 'EOF'
    ) {
      return false;
    }
    if (
      tt === T.NotEq
      || tt === T.EqEq
      || tt === T.Eq
      || tt === T.Gt
      || tt === T.GtEq
      || tt === T.Lt
      || tt === T.LtEq
    ) {
      return true;
    }
  }
  return false;
}

/**
 * 'or' expression (similar to Less's guardOr).
 * Allows comma-separated conditions like historical media queries.
 */
export function scssGuardOr(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    let left = $.SUBRULE($.scssGuardAnd, { ARGS: [ctx] }) as unknown as Node;
    let right: Node | undefined;
    $.MANY({
      GATE: () => {
        const next = $.LA(1).tokenType;
        return (ctx.allowComma && next === T.Comma) || next === T.Or;
      },
      DEF: () => {
        /**
         * Nest expressions within expressions for correct
         * order of operations.
         */
        $.OR([
          { ALT: () => $.CONSUME(T.Comma) },
          { ALT: () => $.CONSUME(T.Or) }
        ]);
        right = $.SUBRULE2($.scssGuardAnd, { ARGS: [ctx] }) as unknown as Node;
        if (!RECORDING_PHASE) {
          let location = $.endRule();
          $.startRule();
          left = new Condition(
            [$.wrap(left, true), 'or', $.wrap(right!)],
            undefined,
            location,
            this.context
          );
        }
      }
    });
    if (!RECORDING_PHASE) {
      $.endRule();
    }
    return left;
  };
}

/**
 * 'and' expression (similar to Less's guardAnd).
 */
export function scssGuardAnd(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    let left: Node | undefined;
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.MANY_SEP({
      SEP: T.And,
      DEF: () => {
        let not: IToken | undefined;
        $.OPTION(() => (not = $.CONSUME(T.Not)));
        let allowComma = ctx.allowComma;
        ctx.allowComma = false;
        let right = $.SUBRULE($.scssGuardInParens, { ARGS: [ctx] }) as unknown as Node;
        ctx.allowComma = allowComma;
        if (!RECORDING_PHASE && not) {
          let [,,, endOffset, endLine, endColumn] = right.location!;
          let [startOffset, startLine, startColumn] = $.getLocationInfo(not);
          right = new Condition(
            [right],
            { negate: true },
            [startOffset, startLine, startColumn, endOffset, endLine, endColumn],
            this.context
          );
        }
        if (!left) {
          left = right;
          return;
        }
        if (!RECORDING_PHASE) {
          left = new Condition(
            [$.wrap(left, true), 'and', $.wrap(right)],
            undefined,
            $.getLocationFromNodes([left, right]),
            this.context
          );
        }
      }
    });
    return left!;
  };
}

/**
 * Guard in parentheses (similar to Less's guardInParens).
 * Always wraps in Paren node for consistency with Less.
 */
export function scssGuardInParens(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  return (ctx: RuleContext) => {
    $.startRule();
    // Like Less: handle parenthesized content, or fall through to comparison
    // For non-parenthesized content, try comparison first (it will fail if there's no operator), then fall back to value
    let node = $.OR([
      {
        ALT: () => {
          $.CONSUME(T.LParen);
          let innerNode = $.SUBRULE($.scssGuardInner, { ARGS: [ctx] }) as unknown as Node;
          $.CONSUME(T.RParen);
          return innerNode;
        }
      },
      {
        // Try comparison first - it requires an operator, so it will fail if there isn't one
        GATE: () => looksLikeScssComparison(k => $.LA(k), T),
        ALT: () => {
          return $.SUBRULE($.scssComparison, { ARGS: [ctx] });
        }
      },
      {
        // Fallback: just a value (no comparison operator)
        ALT: () => {
          return $.SUBRULE($.value, { ARGS: [ctx] });
        }
      }
    ]);

    if (!$.RECORDING_PHASE) {
      node = $.wrap(node, 'both');
      return new Paren(node, undefined, $.endRule(), this.context);
    }
  };
}

/**
 * The inner content of a guard inside parentheses (similar to Less's guardInner).
 */
export function scssGuardInner(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) =>
    $.OR([
      { ALT: () => $.SUBRULE($.scssComparison, { ARGS: [ctx] }) },
      {
        GATE: () => {
          let tokenType = $.LA(1).tokenType;
          return tokenType !== T.Not;
        },
        ALT: () => $.SUBRULE($.value, { ARGS: [ctx] })
      },
      {
        ALT: () => $.SUBRULE($.scssGuardOr, { ARGS: [ctx] })
      }
    ]);
}

/**
 * Comparison expression (similar to Less's comparison).
 * Parses comparisons like $a == $b, $a != $b, $a > 10, etc.
 */
export function scssComparison(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  let opAlt = [
    { ALT: () => $.CONSUME(T.NotEq) }, // != (SCSS-specific token)
    { ALT: () => $.CONSUME(T.EqEq) }, // == (SCSS-specific token, normalized to =)
    { ALT: () => $.CONSUME(T.Eq) }, // =
    { ALT: () => $.CONSUME(T.Gt) }, // >
    { ALT: () => $.CONSUME(T.GtEq) }, // >=
    { ALT: () => $.CONSUME(T.Lt) }, // <
    { ALT: () => $.CONSUME(T.LtEq) } // <=
  ];

  return (ctx: RuleContext = {}) => {
    // Use valueList like Less does - it should stop at comparison operators
    // valueList naturally stops when value can't parse the next token (like == or !=)
    let left = $.SUBRULE($.valueList, { ARGS: [ctx] }) as unknown as Node;
    let op: IToken;
    let right: Node;
    let wasNotEqual = false;

    // Parse comparison operator (always required, like Less)
    op = $.OR(opAlt);
    right = $.SUBRULE2($.valueList, { ARGS: [ctx] }) as unknown as Node;

    if (!$.RECORDING_PHASE) {
      let opStr = op.image;
      // Check for != (tokenized as NotEq)
      if (op.tokenType.name === 'NotEq') {
        wasNotEqual = true;
        opStr = '=';
      } else if (opStr === '==') {
        // Normalize == to =
        opStr = '=';
      }
      const cond = new Condition(
        [$.wrap(left, true), opStr as any, $.wrap(right)],
        wasNotEqual ? { negate: true } : undefined,
        $.getLocationFromNodes([left, right]),
        this.context
      );
      return cond;
    }
    // During recording phase, we still need to consume all tokens
    // Return a dummy value - Chevrotain will track the token consumption
    return left;
  };
}

export function value(this: ScssActionsParser, T: ScssTokenMap, valueAlt?: AltContext) {
  const $ = this;

  valueAlt ??= (ctx: RuleContext = {}) => [
    {
      GATE: () => $.LA(1).tokenType === T.LParen && looksLikeMapLiteral(i => $.LA(i), T),
      ALT: () => $.SUBRULE($.scssMapLiteral, { ARGS: [ctx] })
    },
    {
      // SCSS interpolation in values: `#{$expr}`
      GATE: () => $.LA(1).tokenType === T.InterpolationStart,
      ALT: () => {
        const RECORDING_PHASE = $.RECORDING_PHASE;
        $.startRule();
        $.CONSUME(T.InterpolationStart);
        const expr = $.SUBRULE($.valueSequence, { ARGS: [ctx] }) as unknown as Node;
        $.CONSUME2(T.RCurly);
        if (!RECORDING_PHASE) {
          const loc = $.endRule();
          return new Interpolated(
            { source: INTERPOLATION_PLACEHOLDER, replacements: [expr] },
            { role: 'any' },
            loc,
            $.context
          );
        }
      }
    },
    {
      // Escaped SCSS module-qualified mixin "ruleset" call in value position:
      // `ns.\#foo(...)` or `ns.\.foo(...)`
      //
      // Tokenizes as: (PlainIdent/Ident) + Unknown('.') + Unknown('\\') + (HashName | DotName) + LParen ...
      GATE: () =>
        ($.LA(1).tokenType === T.Ident || $.LA(1).tokenType === T.PlainIdent)
        && $.LA(2).tokenType === T.Unknown
        && $.LA(2).image === '.'
        && $.LA(3).tokenType === T.Unknown
        && $.LA(3).image === '\\'
        && ($.LA(4).tokenType === T.HashName || $.LA(4).tokenType === T.DotName)
        && $.LA(5).tokenType === T.LParen,
      ALT: () => {
        const RECORDING_PHASE = $.RECORDING_PHASE;
        $.startRule();
        const nsTok = $.OR4([
          { GATE: () => $.LA(1).tokenType === T.Ident, ALT: () => $.CONSUME4(T.Ident) },
          { ALT: () => $.CONSUME3(T.PlainIdent) }
        ]) as unknown as IToken;
        $.CONSUME2(T.Unknown); // '.'
        $.CONSUME3(T.Unknown); // '\'
        const member = $.OR5([
          { GATE: () => $.LA(1).tokenType === T.HashName, ALT: () => $.CONSUME(T.HashName) },
          { ALT: () => $.CONSUME2(T.DotName) }
        ]) as unknown as IToken;
        $.CONSUME2(T.LParen);
        let args: List | undefined;
        $.OPTION5(() => (args = $.SUBRULE2($.functionCallArgs, { ARGS: [ctx] })));
        $.CONSUME2(T.RParen);
        if (!RECORDING_PHASE) {
          const loc = $.endRule();
          const key = member.image.slice(1);
          const ref = makeNamespacedReference($, [nsTok.image, key], 'mixin-ruleset');
          const call = new Call({ name: ref, args }, undefined, loc, $.context);
          return new Expression(call, undefined, loc, $.context);
        }
      }
    },
    {
      // SCSS module-member variable: `ns.$var`
      GATE: () =>
        ($.LA(1).tokenType === T.Ident || $.LA(1).tokenType === T.PlainIdent)
        && $.LA(2).tokenType === T.Unknown
        && $.LA(2).image === '.'
        && $.LA(3).tokenType === T.DollarVariable,
      ALT: () => {
        const RECORDING_PHASE = $.RECORDING_PHASE;
        $.startRule();
        const nsTok = $.OR2([
          { GATE: () => $.LA(1).tokenType === T.Ident, ALT: () => $.CONSUME2(T.Ident) },
          { ALT: () => $.CONSUME(T.PlainIdent) }
        ]) as unknown as IToken;
        $.CONSUME(T.Unknown); // '.'
        const dv = $.CONSUME2(T.DollarVariable);
        if (!RECORDING_PHASE) {
          const loc = $.endRule();
          const ns = nsTok.image;
          const key = dv.image.slice(1);
          const nsRef = new Reference(ns, { type: 'variable' }, loc, $.context);
          const ref = new Reference({ target: nsRef, key }, { type: 'variable' }, loc, $.context);
          return new Expression(ref, undefined, loc, $.context);
        }
      }
    },
    {
      // SCSS module-qualified function call in value position: `ns.fn(...)`
      // Tokenizes as: PlainIdent/Ident + DotName(".fn") + LParen ...
      GATE: () =>
        ($.LA(1).tokenType === T.Ident || $.LA(1).tokenType === T.PlainIdent)
        && $.LA(2).tokenType === T.DotName
        && $.LA(3).tokenType === T.LParen,
      ALT: () => {
        const RECORDING_PHASE = $.RECORDING_PHASE;
        $.startRule();
        const nsTok = $.OR3([
          { GATE: () => $.LA(1).tokenType === T.Ident, ALT: () => $.CONSUME3(T.Ident) },
          { ALT: () => $.CONSUME2(T.PlainIdent) }
        ]) as unknown as IToken;
        const dot = $.CONSUME(T.DotName); // ".fn"
        $.CONSUME(T.LParen);
        let args: List | undefined;
        $.OPTION2(() => (args = $.SUBRULE($.functionCallArgs, { ARGS: [ctx] })));
        $.CONSUME(T.RParen);
        if (!RECORDING_PHASE) {
          const loc = $.endRule();
          const fnName = `${nsTok.image}.${dot.image.slice(1)}`;
          const call = new Call({ name: fnName, args }, undefined, loc, $.context);
          const maybe = desugarNamespacedCall($, call);
          return new Expression(maybe, undefined, loc, $.context);
        }
      }
    },
    { ALT: () => $.SUBRULE($.functionCall, { ARGS: [ctx] }) },
    { ALT: () => $.CONSUME(T.DollarVariable) },
    { ALT: () => $.CONSUME(T.Ident) },
    { ALT: () => $.CONSUME(T.Dimension) },
    { ALT: () => $.CONSUME(T.Number) },
    { ALT: () => $.CONSUME(T.Color) },
    { ALT: () => $.CONSUME(T.UnicodeRange) },
    { ALT: () => $.SUBRULE($.string, { ARGS: [ctx] }) },
    { ALT: () => $.SUBRULE($.squareValue, { ARGS: [ctx] }) },
    {
      GATE: () => $.legacyMode,
      ALT: () => $.CONSUME(T.LegacyMSFilter)
    }
  ];

  return (ctx: RuleContext = {}) => {
    $.startRule();
    let node = $.OR(valueAlt!(ctx)) as unknown as Node | IToken;
    let additionalValue: Node | undefined;
    $.OPTION(() => {
      $.CONSUME(T.Slash);
      additionalValue = $.SUBRULE2($.value, { ARGS: [ctx] });
    });
    if (!$.RECORDING_PHASE) {
      const location = $.endRule();
      // Match CSS parser behavior: convert raw tokens into Nodes.
      if (!(node instanceof JessNode)) {
        node = $.processValueToken(node as IToken, ctx);
      }
      if (additionalValue) {
        return $.wrap(new List([$.wrap(node, true), additionalValue], { sep: '/' }, location, $.context));
      }
      return $.wrap(node);
    }
  };
}

/**
 * Override CSS functionCall to desugar module-qualified calls like `ns.fn(...)`.
 * We return an Expression(Call(Reference(ns.fn))) to match Less-style outer wrapping.
 */
export function functionCall(this: ScssActionsParser, T: ScssTokenMap, alt?: AltContext) {
  const $ = this;
  const base = cssProductions.functionCall.call(this, T, alt);
  return (ctx: RuleContext = {}) => {
    const node = base(ctx) as unknown as Call;
    if ($.RECORDING_PHASE) {return node;}
    if (!isNode(node, 'Call')) {return node as unknown as any;}

    // First, keep existing Sass map.get() desugaring behavior.
    const mapped = desugarMapLookup(this, node);
    if (isNode(mapped, 'Reference')) {
      return mapped as unknown as any;
    }
    const call = mapped as Call;

    const maybe = desugarNamespacedCall(this, call);
    if (maybe !== call) {
      const loc: LocationInfo | undefined = Array.isArray(maybe.location) && maybe.location.length === 6
        ? (maybe.location as LocationInfo)
        : undefined;
      // Namespaced call: emit as Expression so it serializes like `$ns.func(...)`.
      return new Expression(maybe, undefined, loc, $.context);
    }

    // Plain Sass/Less-style function call: `foo(...)`
    // Parse as Call(name: Reference(type='function', fallbackValue: true)) so evaluation tries function registry,
    // but still serializes safely if unresolved.
    if (typeof call.value.name === 'string') {
      const loc: LocationInfo | undefined = Array.isArray(call.location) && call.location.length === 6
        ? (call.location as LocationInfo)
        : undefined;
      const ref = new Reference(
        { key: call.value.name },
        { type: 'function', fallbackValue: true },
        loc,
        $.context
      );
      // Sass/Less plain function calls are not optional/silent-fail calls (no `?(` output).
      // Keep other call options if present, but drop `silentFail` coming from CSS fallback behavior.
      const { silentFail: silentFailIgnored, ...rest } = call.options ?? {};
      void silentFailIgnored;
      const nextOptions = Object.keys(rest).length > 0 ? rest : undefined;
      return new Call({ name: ref, args: call.value.args }, nextOptions, loc, $.context);
    }
    return call;
  };
}

/**
 * SCSS: extend selectors to support Sass placeholder selectors (`%foo`).
 *
 * We tokenize `%foo` as `PlaceholderSelector` and parse it as a basic selector `\\foo`
 * (so it can't collide with normal `.foo` / `#foo` selectors).
 */
export function simpleSelector(this: ScssActionsParser, T: ScssTokenMap, selectorAlt?: AltContext) {
  const $ = this;
  selectorAlt ??= (ctx: RuleContext = {}) => [
    { ALT: () => $.CONSUME(T.Ident) },
    { GATE: () => !!ctx.inner, ALT: () => $.CONSUME(T.Ampersand) },
    { ALT: () => $.SUBRULE($.classSelector, { ARGS: [ctx] }) },
    { ALT: () => $.SUBRULE($.idSelector, { ARGS: [ctx] }) },
    // Placeholder selector: `%foo`
    { ALT: () => $.CONSUME(T.PlaceholderSelector) },
    { ALT: () => $.CONSUME(T.Star) },
    { ALT: () => $.SUBRULE($.pseudoSelector, { ARGS: [ctx] }) },
    { ALT: () => $.SUBRULE($.attributeSelector, { ARGS: [ctx] }) },
    { ALT: () => $.CONSUME(T.DimensionInt) },
    { ALT: () => $.CONSUME(T.DimensionNum) }
  ];

  return (ctx: RuleContext = {}) => {
    const selector = $.OR(selectorAlt!(ctx));
    if (!$.RECORDING_PHASE) {
      if ($.isToken(selector)) {
        if (selector.tokenType.name === 'Ampersand') {
          return new Ampersand(undefined, undefined, $.getLocationInfo(selector), $.context);
        }
        if (selector.tokenType.name === 'PlaceholderSelector') {
          const name = `\\${selector.image.slice(1)}`;
          return new BasicSelector(name, undefined, $.getLocationInfo(selector), $.context);
        }
        return new BasicSelector(selector.image, undefined, $.getLocationInfo(selector), $.context);
      }
      return selector as unknown as JessNode;
    }
  };
}

/**
 * Override CSS `main` to allow root-level SCSS variable declarations (`$x: ...;`).
 */
export function main(this: ScssActionsParser, T: ScssTokenMap, alt?: AltContext) {
  const $ = this;
  alt ??= (ctx: RuleContext = {}) => [
    // Allow root-level SCSS variable declarations ($x: ...)
    { ALT: () => $.SUBRULE($.declaration, { ARGS: [ctx] }) },
    { ALT: () => $.SUBRULE2($.qualifiedRule) },
    { ALT: () => $.SUBRULE3($.atRule) },
    // Allow stray semicolons at root.
    { ALT: () => $.CONSUME2(T.Semi) }
  ];

  return cssProductions.main.call(this, T, alt as any);
}

/**
 * Override CSS `compoundSelector` to support SCSS interpolation `#{ ... }` inside selectors.
 *
 * Example: `.foo-#{$bar}` becomes an `Interpolated` selector value.
 */
export function compoundSelector(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    let selectors: SimpleSelector[] = [];
    let source = '';
    const replacements: Node[] = [];

    const appendTokenSpan = (startTokenOffset: number, endTokenOffset: number) => {
      const origTokens = ($ as any).originalInput as IToken[];
      let out = '';
      for (const tok of origTokens) {
        if (tok.startOffset < startTokenOffset) {continue;}
        if (tok.startOffset > endTokenOffset) {break;}
        out += tok.image;
      }
      source += out;
    };

    // First atom is required.
    $.OR([
      {
        GATE: () => $.LA(1).tokenType === T.InterpolationStart,
        ALT: () => {
          $.CONSUME(T.InterpolationStart);
          const expr = $.SUBRULE($.valueSequence, { ARGS: [ctx] }) as unknown as Node;
          $.CONSUME(T.RCurly);
          if (!RECORDING_PHASE) {
            source += INTERPOLATION_PLACEHOLDER;
            replacements.push(expr);
          }
        }
      },
      {
        ALT: () => {
          let startTokenOffset = 0;
          if (!RECORDING_PHASE) {startTokenOffset = $.LA(1).startOffset;}
          const sel = $.SUBRULE2($.simpleSelector, { ARGS: [ctx] }) as unknown as SimpleSelector;
          if (!RECORDING_PHASE) {
            const endTokenOffset = $.LA(-1).startOffset;
            selectors.push(sel);
            appendTokenSpan(startTokenOffset, endTokenOffset);
          }
        }
      }
    ]);

    // Additional atoms only when there's no whitespace.
    $.MANY({
      GATE: () => !$.hasWS(),
      DEF: () => {
        $.OR2([
          {
            GATE: () => $.LA(1).tokenType === T.InterpolationStart,
            ALT: () => {
              $.CONSUME2(T.InterpolationStart);
              const expr = $.SUBRULE3($.valueSequence, { ARGS: [ctx] }) as unknown as Node;
              $.CONSUME2(T.RCurly);
              if (!RECORDING_PHASE) {
                source += INTERPOLATION_PLACEHOLDER;
                replacements.push(expr);
              }
            }
          },
          {
            ALT: () => {
              let startTokenOffset = 0;
              if (!RECORDING_PHASE) {startTokenOffset = $.LA(1).startOffset;}
              const sel = $.SUBRULE4($.simpleSelector, { ARGS: [ctx] }) as unknown as SimpleSelector;
              if (!RECORDING_PHASE) {
                const endTokenOffset = $.LA(-1).startOffset;
                selectors.push(sel);
                appendTokenSpan(startTokenOffset, endTokenOffset);
              }
            }
          }
        ]);
      }
    });

    if (!RECORDING_PHASE) {
      const location = $.endRule();
      if (replacements.length > 0) {
        return new Interpolated({ source, replacements }, { role: 'ident' }, location, $.context);
      }
      if (selectors.length === 1) {return selectors[0]!;}
      return new CompoundSelector(selectors, undefined, location, $.context);
    }
  };
}

/**
 * Override CSS `string` to support SCSS interpolation `#{ ... }` inside quoted strings.
 */
export function string(this: ScssActionsParser, T: ScssTokenMap, stringAlt?: AltContext) {
  const $ = this;

  stringAlt ??= (ctx: RuleContext = {}) => [
    {
      ALT: () => {
        const RECORDING_PHASE = $.RECORDING_PHASE;
        $.startRule();
        const quote = $.CONSUME(T.SingleQuoteStart);

        let contents: IToken | undefined;
        $.OPTION(() => contents = $.CONSUME(T.SingleQuoteStringContents));

        $.CONSUME(T.SingleQuoteEnd);
        if (!RECORDING_PHASE) {
          const location = $.endRule();
          const raw = contents?.image ?? '';
          const inner = processScssStringInterpolation(raw, location, $.context);
          return new Quoted(inner as any, { quote: quote.image as '"' | '\'' }, location, $.context);
        }
      }
    },
    {
      ALT: () => {
        const RECORDING_PHASE = $.RECORDING_PHASE;
        $.startRule();
        const quote = $.CONSUME2(T.DoubleQuoteStart);

        let contents: IToken | undefined;
        $.OPTION2(() => contents = $.CONSUME2(T.DoubleQuoteStringContents));

        $.CONSUME(T.DoubleQuoteEnd);
        if (!RECORDING_PHASE) {
          const location = $.endRule();
          const raw = contents?.image ?? '';
          const inner = processScssStringInterpolation(raw, location, $.context);
          return new Quoted(inner as any, { quote: quote.image as '"' | '\'' }, location, $.context);
        }
      }
    }
  ];

  return (ctx: RuleContext = {}) => $.OR(stringAlt!(ctx));
}

/**
 * Parses a Sass map literal: `(\"k\": v, ...)` into a Jess `Collection`.
 * (Only the map form is supported in this milestone; list literals come later.)
 */
export function scssMapLiteral(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    $.startRule();
    $.CONSUME(T.LParen);

    const decls: Declaration[] = [];

    $.OPTION({
      GATE: () => $.LA(1).tokenType !== T.RParen,
      DEF: () => {
        $.AT_LEAST_ONE_SEP({
          SEP: T.Comma,
          DEF: () => {
            const keyNode = $.SUBRULE($.value, { ARGS: [ctx] });
            $.CONSUME(T.Colon);
            const valueNode = $.SUBRULE($.valueSequence, { ARGS: [ctx] });

            if (!$.RECORDING_PHASE) {
              const keyStr = toDeclKey(keyNode);
              const declName = new Any(keyStr, { role: 'property' });
              const decl = new Declaration(
                { name: declName, value: valueNode },
                undefined,
                $.getLocationFromNodes([keyNode, valueNode]),
                $.context
              );
              decls.push(decl);
            }
          }
        });
      }
    });

    $.CONSUME(T.RParen);

    if (!$.RECORDING_PHASE) {
      const location = $.endRule();
      const coll = new Collection(decls, undefined, location, $.context);
      return $.wrap(coll);
    }
  };
}

function isScriptUsePath(path: string): boolean {
  return path.endsWith('.js') || path.endsWith('.ts') || path.endsWith('.json');
}

function quotedLike(original: Quoted, nextValue: string, context: ScssActionsParser['context']): Quoted {
  const quote = original.options?.quote ?? '"';
  const escaped = original.options?.escaped;
  const loc: LocationInfo | undefined = Array.isArray(original.location) && original.location.length === 6
    ? (original.location as LocationInfo)
    : undefined;
  return new Quoted(new Any(nextValue, { role: 'any' }), { quote, escaped }, loc, context);
}

function defaultNamespaceFromPath(path: string): string | undefined {
  // 'sass:map' -> 'map'
  if (path.startsWith('sass:')) {
    const name = path.slice('sass:'.length);
    return name.split('/').filter(Boolean).pop();
  }
  const base = path.split('/').filter(Boolean).pop();
  if (!base) {return undefined;}
  const noExt = base.replace(/\.(scss|sass|css|jess|js|ts|json)$/i, '');
  return noExt || undefined;
}

/**
 * SCSS: `@use` → `StyleImport(type='compose')` for stylesheets,
 * and `JsImport` for script paths. `sass:*` built-ins are rewritten
 * to `#sass/*` and imported as `JsImport`.
 */
export function scssUseAtRule(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    $.CONSUME(T.AtKeyword); // '@use'

    const pathNode = $.SUBRULE($.string, { ARGS: [ctx] }) as unknown as Quoted;
    const rawPath = pathNode.valueOf();

    let namespace: string | undefined;

    // optional "as <ident|*>"
    $.OPTION({
      GATE: () => $.LA(1).image === 'as',
      DEF: () => {
        $.CONSUME(T.Ident);
        $.OR([
          { ALT: () => (namespace = $.CONSUME2(T.Ident).image) },
          { ALT: () => {
 $.CONSUME(T.Star); namespace = '*'; 
} }
        ]);
      }
    });

    // optional "with (...)"
    let withRules: Collection | undefined;
    $.OPTION2({
      GATE: () => $.LA(1).image === 'with',
      DEF: () => {
        $.CONSUME3(T.Ident);
        withRules = $.SUBRULE($.scssWithConfig, { ARGS: [ctx] }) as unknown as Collection;
      }
    });

    $.CONSUME(T.Semi);

    if (!RECORDING_PHASE) {
      const loc = $.endRule();

      // Built-in sass modules: @use "sass:map" -> @-use "#sass/map"
      if (rawPath.startsWith('sass:')) {
        const mod = rawPath.slice('sass:'.length);
        const rewritten = `#sass/${mod}`;
        const q = quotedLike(pathNode, rewritten, $.context);
        return new JsImport({ path: q }, { namespace: namespace ?? defaultNamespaceFromPath(rawPath) }, loc, $.context);
      }

      if (isScriptUsePath(rawPath)) {
        return new JsImport({ path: pathNode }, { namespace: namespace ?? defaultNamespaceFromPath(rawPath) }, loc, $.context);
      }

      const imp = new StyleImport(
        {
          path: pathNode,
          with: withRules ? { node: withRules, type: 'set' } : undefined
        },
        {
          type: 'compose',
          namespace,
          importOptions: {}
        },
        loc,
        $.context
      );
      return imp;
    }
  };
}

/**
 * SCSS: `@forward` → `StyleImport(type='compose')` with `(forward)` semantics:
 * - forward: true (not visible locally; available downstream)
 * - (compose is protected by default unless `mutable: true`)
 *
 * Full show/hide/as parsing is deferred; we currently ignore extra prelude tokens.
 */
export function scssForwardAtRule(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    const atKeyword = $.CONSUME(T.AtKeyword) as unknown as IToken; // '@forward'

    const pathNode = $.SUBRULE($.string, { ARGS: [ctx] }) as unknown as Quoted;

    const isWithConfigStart = () => $.LA(1).image === 'with' && $.LA(2).tokenType === T.LParen;

    // optional "as <prefix>-*"
    // NOTE: this is parsed inside the prelude loop below (instead of OPTION),
    // to avoid Chevrotain ambiguous-alternative warnings (take vs skip).
    let forwardAsPrefix: string | undefined;

    // optional "show ..." or "hide ..." (parse-only; store raw list)
    let forwardShow: string[] | undefined;
    let forwardHide: string[] | undefined;
    let forwardListMode: 'show' | 'hide' | undefined;
    $.MANY2({
      // Stop before `with (...)` so the OPTION below stays unambiguous.
      GATE: () => $.LA(1).tokenType !== T.Semi && !isWithConfigStart(),
      DEF: () => {
        const la = $.LA(1);
        // optional "as <prefix>-*"
        if ((la.tokenType === T.Ident || la.tokenType === T.PlainIdent) && la.image === 'as') {
          // "as" may be Ident or PlainIdent depending on token mode.
          if ($.LA(1).tokenType === T.Ident) {
            $.CONSUME2(T.Ident);
          } else {
            $.CONSUME2(T.PlainIdent);
          }

          // The prefix is typically tokenized as a single ident/plainident (often including the trailing '-').
          const tok = ($.LA(1).tokenType === T.Ident)
            ? ($.CONSUME3(T.Ident) as unknown as IToken)
            : ($.CONSUME3(T.PlainIdent) as unknown as IToken);

          // If the `*` was split into its own token, consume it (and optional '-' if present as Unknown).
          if (
            ($.LA(1).tokenType === T.Unknown && $.LA(1).image === '-' && $.LA(2).tokenType === T.Star)
            || $.LA(1).tokenType === T.Star
          ) {
            if ($.LA(1).tokenType === T.Unknown && $.LA(1).image === '-') {
              $.CONSUME(T.Unknown);
            }
            $.CONSUME(T.Star);
          }

          if (!RECORDING_PHASE) {
            // Most lexing paths will give us `bar-*` as a single token.
            // If not, we still capture the prefix portion and ignore the `*`.
            const raw = tok.image;
            if (raw.endsWith('-*')) {
              forwardAsPrefix = raw.slice(0, -1); // "bar-"
            } else if (raw.endsWith('*')) {
              forwardAsPrefix = raw.slice(0, -1);
            } else {
              forwardAsPrefix = raw;
            }
          }
          return;
        }
        // Skip commas inside lists.
        if (la.tokenType === T.Comma) {
          $.CONSUME(T.Comma);
          return;
        }
        // Start of a show/hide list.
        if ((la.tokenType === T.Ident || la.tokenType === T.PlainIdent) && (la.image === 'show' || la.image === 'hide')) {
          const kw = ($.LA(1).tokenType === T.Ident)
            ? ($.CONSUME5(T.Ident) as unknown as IToken)
            : ($.CONSUME5(T.PlainIdent) as unknown as IToken);
          forwardListMode = kw.image === 'hide' ? 'hide' : 'show';
          if (!RECORDING_PHASE) {
            if (forwardListMode === 'show') {forwardShow = [];}
            else {forwardHide = [];}
          }
          return;
        }
        // Consume list members when we're in a show/hide list.
        if (forwardListMode) {
          const t = ($.LA(1).tokenType === T.DollarVariable)
            ? ($.CONSUME6(T.DollarVariable) as unknown as IToken)
            : (
                $.LA(1).tokenType === T.Ident
                  ? ($.CONSUME6(T.Ident) as unknown as IToken)
                  : ($.CONSUME6(T.PlainIdent) as unknown as IToken)
              );
          if (!RECORDING_PHASE) {
            (forwardListMode === 'show' ? forwardShow : forwardHide)!.push(t.image);
          }
          return;
        }
        // Otherwise, consume generic prelude tokens we don't handle yet.
        $.SUBRULE($.anyOuterValue, { ARGS: [ctx] });
      }
    });

    // optional "with (...)"
    let withRules: Collection | undefined;
    $.OPTION({
      // Tight gate to avoid Chevrotain ambiguity warnings.
      // Note: "with" may be tokenized as PlainIdent depending on mode/categories.
      GATE: () => isWithConfigStart(),
      DEF: () => {
        // "with" may be Ident or PlainIdent depending on token mode.
        $.OR1([
          { GATE: () => $.LA(1).tokenType === T.Ident, ALT: () => $.CONSUME(T.Ident) },
          { ALT: () => $.CONSUME(T.PlainIdent) }
        ]);
        withRules = $.SUBRULE($.scssWithConfig, { ARGS: [ctx] }) as unknown as Collection;
      }
    });

    $.CONSUME(T.Semi);

    if (!RECORDING_PHASE) {
      const loc = $.endRule();

      // Emit warnings for unsupported @forward features
      if (forwardAsPrefix) {
        $.warnings.push({
          message: '@forward with "as <prefix>-*" prefixing is not supported in Jess and will never be. Use explicit namespacing instead (e.g., @-compose "theme" as theme; then access as $theme.colors).',
          token: atKeyword,
          deprecation: undefined
        });
      }
      if (forwardShow || forwardHide) {
        $.warnings.push({
          message: '@forward with "show"/"hide" lists is not supported in Jess and will never be. Visibility control is the module\'s responsibility, not the forwarding module\'s. Use rulesVisibility options within the module itself.',
          token: atKeyword,
          deprecation: undefined
        });
      }

      return new StyleImport(
        { path: pathNode, with: withRules ? { node: withRules, type: 'set' } : undefined },
        {
          type: 'compose',
          importOptions: {
            forward: true,
            forwardAsPrefix,
            forwardShow,
            forwardHide
          }
        },
        loc,
        $.context
      );
    }
  };
}

/**
 * SCSS: `@extend <selector-list> [!optional];`
 *
 * We parse it into Jess `Extend` nodes (Sass default flag = All).
 * `!optional` is accepted (so sass-spec parses) but ignored in evaluation.
 */
export function scssExtendAtRule(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    $.CONSUME(T.AtKeyword); // '@extend'

    let target = $.SUBRULE($.selectorList, { ARGS: [ctx] }) as unknown as Node;

    // Accept (but ignore) any trailing bits like `!optional`
    $.MANY({
      GATE: () => $.LA(1).tokenType !== T.Semi && $.LA(1).tokenType.name !== 'EOF',
      DEF: () => {
        $.SUBRULE($.anyOuterValue, { ARGS: [ctx] });
      }
    });

    $.CONSUME(T.Semi);
    if (!RECORDING_PHASE) {
      const loc = $.endRule();

      // Sass module system: placeholders are not namespaced, but they can come from upstream modules.
      // For placeholder targets (tokenized as `\\foo`), we set `allNamespaces: true` so extend lookup
      // searches all file roots, regardless of namespace scoping.
      const isPlaceholderTarget = (sel: Selector): boolean => {
        if (sel instanceof BasicSelector && typeof sel.value === 'string') {
          return sel.value.startsWith('\\');
        }
        if (sel instanceof ComplexSelector && sel.value.length === 1) {
          const only = sel.value[0];
          return only instanceof BasicSelector && typeof only.value === 'string' && only.value.startsWith('\\');
        }
        return false;
      };
      const namespace = isPlaceholderTarget(target as unknown as Selector) ? '*' : undefined;

      return new Extend(
        { target: target as unknown as Selector, flag: 0, namespace },
        undefined,
        loc,
        $.context
      );
    }
  };
}

/**
 * Parses Sass `with (...)` config into a Rules node of VarDeclarations.
 */
export function scssWithConfig(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    $.CONSUME(T.LParen);

    let decls: VarDeclaration[] | undefined;
    if (!RECORDING_PHASE) {decls = [];}

    $.OPTION(() => {
      $.AT_LEAST_ONE_SEP({
        SEP: T.Comma,
        DEF: () => {
          const dv = $.CONSUME(T.DollarVariable);
          $.CONSUME(T.Assign);
          const value = $.SUBRULE($.valueSequence, { ARGS: [ctx] });
          // Sass config vars can include flags like `!default` and `!global`.
          // Mirror SCSS variable declaration behavior so these semantics survive into core.
          let sawDefault = false;
          let sawGlobal = false;
          $.MANY(() => {
            $.OR([
              { ALT: () => {
 $.CONSUME(T.SassDefault); sawDefault = true; 
} },
              { ALT: () => {
 $.CONSUME(T.SassGlobal); sawGlobal = true; 
} }
            ]);
          });
          if (!RECORDING_PHASE) {
            const name = new Any(dv.image.slice(1), { role: 'property' });
            decls!.push(
              new VarDeclaration(
                { name, value },
                {
                  // In Jess, `?:` is the "default assignment" operator (SCSS `!default`).
                  assign: (sawDefault ? '?:' : ':') as AssignmentType,
                  // In core, `setDefined` models SCSS `!global` / Jess `^$var:`
                  setDefined: sawGlobal
                },
                $.getLocationInfo(dv),
                $.context
              )
            );
          }
        }
      });
    });

    $.CONSUME(T.RParen);
    if (!RECORDING_PHASE) {
      const loc = $.endRule();
      return new Collection(decls ?? [], undefined, loc, $.context) as unknown as RulesType;
    }
  };
}

/**
 * SCSS: `@content` → `$content()` (Expression(Call(Reference('content'))))
 */
export function scssContentAtRule(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    $.CONSUME(T.AtKeyword); // assumed '@content' (dispatched by unknownAtRule)
    let args: List | undefined;
    $.OPTION(() => {
      $.CONSUME(T.LParen);
      $.OPTION2(() => (args = $.SUBRULE($.functionCallArgs, { ARGS: [ctx] })));
      $.CONSUME(T.RParen);
    });
    $.OPTION3(() => $.CONSUME(T.Semi));

    if (!RECORDING_PHASE) {
      const loc = $.endRule();
      const ref = new Reference({ key: 'content' }, { type: 'variable' }, loc, $.context);
      const call = new Call({ name: ref, args }, undefined, loc, $.context);
      return new Expression(call, undefined, loc, $.context);
    }
  };
}

/**
 * SCSS: `@include name(args...)` → mixin call (Call(Reference(type='mixin'))).
 *
 * Note: content blocks are parsed as a named argument `$content: <mixin>`
 * (parse-only). The evaluation semantics for binding it to the call scope
 * are implemented later.
 */
export function scssIncludeAtRule(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    $.CONSUME(T.AtKeyword); // assumed '@include' (dispatched by unknownAtRule)

    let mixinKey: string | Interpolated | undefined;
    let mixinNameRef: Reference | undefined;
    let nameHasOpenParen = false;
    $.OR([
      {
        // Interpolated mixin name: `@include #{$mixin}(...);` or `@include foo-#{$bar}(...);`
        GATE: () => $.LA(1).tokenType === T.InterpolationStart || $.LA(2).tokenType === T.InterpolationStart,
        ALT: () => {
          let source = '';
          const replacements: Node[] = [];
          let startTok: IToken | undefined;

          $.AT_LEAST_ONE({
            DEF: () => {
              $.OR2([
                {
                  GATE: () => $.LA(1).tokenType === T.InterpolationStart,
                  ALT: () => {
                    const istart = $.CONSUME(T.InterpolationStart);
                    startTok ??= istart;
                    const expr = $.SUBRULE($.valueSequence, { ARGS: [ctx] }) as unknown as Node;
                    $.CONSUME2(T.RCurly);
                    if (!RECORDING_PHASE) {
                      source += INTERPOLATION_PLACEHOLDER;
                      replacements.push(expr);
                    }
                  }
                },
                {
                  ALT: () => {
                    const ident = $.CONSUME(T.Ident);
                    startTok ??= ident;
                    if (!RECORDING_PHASE) {
                      source += ident.image;
                    }
                  }
                }
              ]);
            }
          });

          if (!RECORDING_PHASE) {
            const loc = startTok ? $.getLocationInfo(startTok) : $.getLocationInfo($.LA(-1));
            mixinKey = new Interpolated({ source, replacements }, { role: 'ident' }, loc, $.context);
          }
        }
      },
      {
        // Mixin call where lexer tokenizes `name(` as a single token.
        // e.g. `@include wrap(red);` may arrive as FunctionStart("wrap(") + ...
        GATE: () => $.LA(1).tokenType === T.FunctionStart || $.LA(1).tokenType === T.GenericFunctionStart,
        ALT: () => {
          const nameTok = $.OR7([
            { GATE: () => $.LA(1).tokenType === T.FunctionStart, ALT: () => $.CONSUME9(T.FunctionStart) },
            { ALT: () => $.CONSUME9(T.GenericFunctionStart) }
          ]) as unknown as IToken;
          if (!RECORDING_PHASE) {
            mixinKey = nameTok.image.slice(0, -1);
            nameHasOpenParen = true;
          }
        }
      },
      {
        // SCSS module-qualified mixin call: `@include ns.foo(...)`
        // Tokenizes as: Ident + DotName(".foo")
        GATE: () =>
          ($.LA(1).tokenType === T.Ident || $.LA(1).tokenType === T.PlainIdent)
          && $.LA(2).tokenType === T.DotName,
        ALT: () => {
          const ns = $.OR3([
            { GATE: () => $.LA(1).tokenType === T.Ident, ALT: () => $.CONSUME2(T.Ident) },
            { ALT: () => $.CONSUME5(T.PlainIdent) }
          ]) as unknown as IToken;
          const dot = $.CONSUME(T.DotName); // ".foo"
          if (!RECORDING_PHASE) {
            const key = dot.image.slice(1);
            mixinNameRef = makeNamespacedReference($, [ns.image, key], 'mixin');
          }
        }
      },
      {
        // Escaped module-qualified mixin "ruleset" reference: `@include ns.\#foo(...)` or `@include ns.\.foo(...)`
        // Note: there is no standalone dot token; the '.' is tokenized as Unknown when not part of DotName.
        GATE: () =>
          ($.LA(1).tokenType === T.Ident || $.LA(1).tokenType === T.PlainIdent)
          && $.LA(2).tokenType === T.Unknown
          && $.LA(2).image === '.'
          && $.LA(3).tokenType === T.Unknown
          && $.LA(3).image === '\\'
          && ($.LA(4).tokenType === T.HashName || $.LA(4).tokenType === T.DotName),
        ALT: () => {
          const ns = $.OR4([
            { GATE: () => $.LA(1).tokenType === T.Ident, ALT: () => $.CONSUME3(T.Ident) },
            { ALT: () => $.CONSUME6(T.PlainIdent) }
          ]) as unknown as IToken;
          $.CONSUME2(T.Unknown); // '.'
          $.CONSUME3(T.Unknown); // '\'
          const member = $.OR5([
            { GATE: () => $.LA(1).tokenType === T.HashName, ALT: () => $.CONSUME(T.HashName) },
            { ALT: () => $.CONSUME2(T.DotName) }
          ]) as unknown as IToken;
          if (!RECORDING_PHASE) {
            const key = member.image.slice(1);
            mixinNameRef = makeNamespacedReference($, [ns.image, key], 'mixin-ruleset');
          }
        }
      },
      {
        ALT: () => {
          const ident = $.OR6([
            { GATE: () => $.LA(1).tokenType === T.Ident, ALT: () => $.CONSUME4(T.Ident) },
            { ALT: () => $.CONSUME8(T.PlainIdent) }
          ]) as unknown as IToken;
          if (!RECORDING_PHASE) {
            // Some lexer paths produce `PlainIdent` tokens that can include an immediately-following `(`,
            // e.g. "wrap(" rather than "wrap" + LParen. Normalize that here.
            if (ident.image.endsWith('(')) {
              mixinKey = ident.image.slice(0, -1);
              nameHasOpenParen = true;
            } else {
              mixinKey = ident.image;
            }
          }
        }
      }
    ]);

    let args: List | undefined;
    if (nameHasOpenParen) {
      // We already consumed the `(` as part of the name token (FunctionStart/GenericFunctionStart).
      $.OPTION2(() => (args = $.SUBRULE($.functionCallArgs, { ARGS: [ctx] })));
      $.CONSUME3(T.RParen);
    } else {
      $.OPTION(() => {
        $.CONSUME(T.LParen);
        $.OPTION2(() => (args = $.SUBRULE($.functionCallArgs, { ARGS: [ctx] })));
        $.CONSUME(T.RParen);
      });
    }

    // Optional content block
    let contentRules: RulesType | undefined;
    let usingParams: List | undefined;

    // SCSS: `@include foo() using ($x, $y) { ... }`
    $.OPTION3({
      GATE: () => $.LA(1).image === 'using',
      DEF: () => {
        $.CONSUME7(T.Ident); // using
        // Sass `using(...)` parameters are just variable names.
        // Represent them as VarDeclaration(paramVar=true, value=Nil()) so they print as `$x`
        // (no `: <default>`), matching Jess' `@($x, $y) { ... }` syntax.
        $.CONSUME2(T.LParen);
        let p: JessNode[] | undefined;
        if (!RECORDING_PHASE) {p = [];}
        $.OPTION7(() => {
          $.AT_LEAST_ONE_SEP({
            SEP: T.Comma,
            DEF: () => {
              const dv = $.CONSUME(T.DollarVariable);
              if (!RECORDING_PHASE) {
                const paramName = new Any(dv.image.slice(1), { role: 'property' }, $.getLocationInfo(dv), $.context);
                p!.push(
                  new VarDeclaration(
                    { name: paramName, value: new Nil() },
                    { paramVar: true },
                    $.getLocationInfo(dv),
                    $.context
                  )
                );
              }
            }
          });
        });
        $.CONSUME2(T.RParen);
        if (!RECORDING_PHASE) {
          usingParams = new List(p ?? [], undefined, $.getLocationInfo($.LA(-1)), $.context);
        }
      }
    });

    $.OPTION5(() => {
      $.CONSUME(T.LCurly);
      contentRules = $.SUBRULE($.atRuleBody, { ARGS: [{ ...ctx, inner: true }] }) as unknown as RulesType;
      $.CONSUME3(T.RCurly);
    });

    // Require semicolon only when present (SCSS requires it if no block; we enforce later)
    $.OPTION6({ GATE: () => $.LA(1).tokenType === T.Semi, DEF: () => $.CONSUME(T.Semi) });

    if (!RECORDING_PHASE) {
      const loc = $.endRule();
      const mixinRef = mixinNameRef ?? new Reference(
        { key: mixinKey! },
        { type: 'mixin', role: 'name' },
        loc,
        $.context
      );

      // If we have a content block, store it on the Call itself (for serialization and future semantics).
      let contentNode: Node | undefined;
      if (contentRules) {
        const contentMixin = new Mixin(
          { rules: contentRules, params: usingParams },
          undefined,
          loc,
          $.context
        );
        // This is an inline/anonymous mixin literal, so it must be visible when serialized.
        contentMixin.addFlags(F_VISIBLE);
        contentNode = contentMixin;
      }

      const call = new Call({ name: mixinRef, args, contentNode }, undefined, loc, $.context);
      // SCSS `@include` is a statement; serialize as Jess mixin injection using `$ > ...`.
      return new Expression(call, undefined, loc, $.context);
    }
  };
}

function makePublicDirectiveRules(rules: any) {
  rules.options.rulesVisibility ??= {};
  rules.options.rulesVisibility.Declaration = 'public';
  rules.options.rulesVisibility.Ruleset = 'public';
  rules.options.rulesVisibility.VarDeclaration = 'public';
  rules.options.rulesVisibility.Mixin = 'public';
}

export function scssIfAtRule(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    $.CONSUME(T.AtKeyword); // assumed '@if' (dispatched by unknownAtRule)

    // Parse the condition - returns Paren(Condition(...)) or nested Conditions
    const cond = $.SUBRULE($.scssCondition, { ARGS: [ctx] }) as unknown as Node | undefined;

    $.CONSUME(T.LCurly);
    const rules = $.SUBRULE($.atRuleBody, { ARGS: [{ ...ctx, inner: !!ctx.inner }] });
    $.CONSUME(T.RCurly);

    if (!RECORDING_PHASE) {
      makePublicDirectiveRules(rules);
    }

    const branches: IfBranch[] = !RECORDING_PHASE ? [{ condition: cond, rules }] : [];

    // Consume chained @else / @else if
    $.MANY2({
      GATE: () => $.LA(1).image === '@else',
      DEF: () => {
        $.CONSUME2(T.AtKeyword); // @else

        let elseCond: Node | undefined;

        // @else if ...
        $.OPTION4({
          GATE: () => $.LA(1).image === 'if',
          DEF: () => {
            $.CONSUME3(T.Ident); // if (token category)

            elseCond = $.SUBRULE2($.scssCondition, { ARGS: [ctx] }) as unknown as Node;
          }
        });

        $.CONSUME2(T.LCurly);
        const elseRules = $.SUBRULE2($.atRuleBody, { ARGS: [{ ...ctx, inner: !!ctx.inner }] });
        $.CONSUME2(T.RCurly);
        if (!RECORDING_PHASE) {
          makePublicDirectiveRules(elseRules);
          branches.push({ condition: elseCond, rules: elseRules });
        }
      }
    });

    if (!RECORDING_PHASE) {
      const loc = $.endRule();
      return new If({ branches }, undefined, loc, $.context);
    }
  };
}

export function scssForAtRule(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    $.CONSUME(T.AtKeyword); // assumed '@for'

    // Sass: `@for $i from <start> (to|through) <end> { ... }`
    // Normalize to Jess `$for` range header:
    //   `$for ($i of <Range>) { ... }`
    // Where Range serializes as:
    // - `start to end` (through)
    // - `start to <end` (to)
    const dv = $.CONSUME(T.DollarVariable);

    // consume `from` keyword (token type can vary by mode/categories)
    if ($.LA(1).image !== 'from') {
      // Trigger a useful parse error if we don't see `from`.
      $.CONSUME3(T.PlainIdent);
    } else if ($.LA(1).tokenType === T.PlainIdent) {
      $.CONSUME3(T.PlainIdent);
    } else {
      $.CONSUME3(T.Ident);
    }

    // Parse start expression until we hit `to`/`through`
    const startNodes: Node[] = RECORDING_PHASE ? ([] as unknown as Node[]) : [];
    $.AT_LEAST_ONE({
      GATE: () => {
        const la = $.LA(1);
        // Stop before `to`/`through` regardless of token type.
        return !(la.image === 'to' || la.image === 'through');
      },
      DEF: () => {
        const n = $.SUBRULE($.anyOuterValue, { ARGS: [ctx] }) as unknown as Node;
        if (!RECORDING_PHASE) {startNodes.push($.wrap(n, 'both'));}
      }
    });

    // consume `to` / `through`
    let kw: IToken;
    if ($.LA(1).image !== 'to' && $.LA(1).image !== 'through') {
      // Trigger a useful parse error if we don't see `to|through`.
      kw = $.CONSUME4(T.PlainIdent) as unknown as IToken;
    } else if ($.LA(1).tokenType === T.PlainIdent) {
      kw = $.CONSUME4(T.PlainIdent) as unknown as IToken;
    } else {
      kw = $.CONSUME4(T.Ident) as unknown as IToken;
    }
    const includeEnd = kw.image === 'through';

    // Parse end expression until `{` (or EOF)
    const endNodes: Node[] = RECORDING_PHASE ? ([] as unknown as Node[]) : [];
    $.AT_LEAST_ONE2({
      GATE: () => $.LA(1).tokenType !== T.LCurly && $.LA(1).tokenType.name !== 'EOF',
      DEF: () => {
        const n = $.SUBRULE2($.anyOuterValue, { ARGS: [ctx] }) as unknown as Node;
        if (!RECORDING_PHASE) {endNodes.push($.wrap(n, 'both'));}
      }
    });

    const header = !RECORDING_PHASE
      ? (() => {
          const name = new Any(dv.image.slice(1), { role: 'property' }, $.getLocationInfo(dv), $.context);
          const varDecl = new VarDeclaration({ name, value: new Nil() }, { paramVar: true }, $.getLocationInfo(dv), $.context);

          const startExpr = startNodes.length === 1
            ? startNodes[0]!
            : new Sequence(startNodes, undefined, $.getLocationFromNodes(startNodes), $.context);
          const endExpr = endNodes.length === 1
            ? endNodes[0]!
            : new Sequence(endNodes, undefined, $.getLocationFromNodes(endNodes), $.context);

          const rangeNode = new Range(
            { start: startExpr, end: endExpr },
            { includeStart: true, includeEnd },
            $.getLocationFromNodes([startExpr, endExpr]),
            $.context
          );

          const ofNode = new Any('of', { role: 'any' }, $.getLocationInfo(dv), $.context);
          const inner = new Sequence([varDecl, ofNode, rangeNode], undefined, $.getLocationFromNodes([varDecl, rangeNode]), $.context);
          const paren = new Paren(inner, undefined, $.getLocationFromNodes([varDecl, rangeNode]), $.context);
          return new Sequence([paren], undefined, $.getLocationFromNodes([paren]), $.context);
        })()
      : undefined;

    $.CONSUME(T.LCurly);
    const rules = $.SUBRULE($.atRuleBody, { ARGS: [{ ...ctx, inner: !!ctx.inner }] });
    $.CONSUME(T.RCurly);
    if (!RECORDING_PHASE) {
      makePublicDirectiveRules(rules);
      const loc = $.endRule();
      return new For({ header: header!, rules }, undefined, loc, $.context);
    }
  };
}

export function scssEachAtRule(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    $.CONSUME(T.AtKeyword); // assumed '@each'

    // Sass: `@each $a[, $b ...] in <expr> { ... }`
    // Normalize to Jess `$for` shape (JS-like):
    // - single var: `($item of <expr>)`
    // - destructure: `([$one, $two] of <expr>)`
    const vars: VarDeclaration[] = RECORDING_PHASE ? ([] as unknown as VarDeclaration[]) : [];

    // One or more `$var` separated by commas.
    do {
      const dv = vars.length === 0 ? $.CONSUME(T.DollarVariable) : $.CONSUME2(T.DollarVariable);
      if (!RECORDING_PHASE) {
        const name = new Any(dv.image.slice(1), { role: 'property' }, $.getLocationInfo(dv), $.context);
        // Param-like var decl (prints `$name` with no `: <value>`).
        vars.push(new VarDeclaration({ name, value: new Nil() }, { paramVar: true }, $.getLocationInfo(dv), $.context));
      }
      if ($.LA(1).tokenType === T.Comma) {
        $.CONSUME(T.Comma);
      } else {
        break;
      }
    } while (true);

    // consume `in` keyword (Ident or PlainIdent depending on token mode)
    if ($.LA(1).tokenType === T.Ident) {
      $.CONSUME(T.Ident);
    } else {
      $.CONSUME(T.PlainIdent);
    }

    // Parse the iterable expression as a value sequence (stops before `{` naturally).
    const rawExpr = $.SUBRULE($.valueSequence, { ARGS: [ctx] }) as unknown as Node;

    const header = !RECORDING_PHASE
      ? (() => {
          const pattern: Node =
          vars.length > 1
            ? new Block(
              new List(vars, { sep: ',' }, $.getLocationFromNodes(vars), $.context),
              { type: 'square' },
              $.getLocationFromNodes(vars),
              $.context
            )
            : vars[0]!;

          const expr = isNode(rawExpr, 'Expression')
            ? rawExpr
            : (() => {
                const innerExpr = $.wrap(rawExpr, 'both');
                // Prevent `$` + leading-space output like `$ list`.
                innerExpr.pre = 0;
                return new Expression(innerExpr, undefined, $.getLocationFromNodes([rawExpr]), $.context);
              })();
          const ofNode = new Any('of', { role: 'any' }, $.getLocationFromNodes([pattern]), $.context);
          const inner = new Sequence([pattern, ofNode, expr], undefined, $.getLocationFromNodes([pattern, rawExpr]), $.context);
          const paren = new Paren(inner, undefined, $.getLocationFromNodes([pattern, rawExpr]), $.context);
          return new Sequence([paren], undefined, $.getLocationFromNodes([paren]), $.context);
        })()
      : undefined;

    $.CONSUME(T.LCurly);
    const rules = $.SUBRULE($.atRuleBody, { ARGS: [{ ...ctx, inner: !!ctx.inner }] });
    $.CONSUME(T.RCurly);
    if (!RECORDING_PHASE) {
      makePublicDirectiveRules(rules);
      const loc = $.endRule();
      return new For({ header: header!, rules }, undefined, loc, $.context);
    }
  };
}

export function scssWhileAtRule(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    $.CONSUME(T.AtKeyword); // assumed '@while'

    const condition = $.SUBRULE($.scssCondition, { ARGS: [ctx] }) as unknown as Node | undefined;

    $.CONSUME(T.LCurly);
    const rules = $.SUBRULE($.atRuleBody, { ARGS: [{ ...ctx, inner: !!ctx.inner }] });
    $.CONSUME(T.RCurly);
    if (!RECORDING_PHASE) {
      makePublicDirectiveRules(rules);
      const loc = $.endRule();
      return new While({ condition: condition!, rules }, undefined, loc, $.context);
    }
  };
}

export function scssMixinAtRule(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    $.CONSUME(T.AtKeyword); // assumed '@mixin' (dispatched by unknownAtRule)
    let nameTok: any;
    let nameNode: Any<'name'> | Interpolated<'name'> | undefined;
    let hasParamsFromStart = false;

    const looksLikeInterpolatedMixinName = () => {
      for (let i = 1; i < 64; i++) {
        const tok = $.LA(i);
        if (tok.tokenType === T.LParen || tok.tokenType === T.LCurly || tok.tokenType.name === 'EOF') {return false;}
        if (tok.tokenType === T.InterpolationStart) {return true;}
      }
      return false;
    };

    $.OR([
      {
        // Interpolated mixin name: `@mixin foo-#{$bar} { ... }` or `@mixin #{$name}() { ... }`
        GATE: () => looksLikeInterpolatedMixinName(),
        ALT: () => {
          let source = '';
          const replacements: Node[] = [];
          let startTok: IToken | undefined;

          $.AT_LEAST_ONE({
            DEF: () => {
              $.OR3([
                {
                  GATE: () => $.LA(1).tokenType === T.InterpolationStart,
                  ALT: () => {
                    const istart = $.CONSUME(T.InterpolationStart);
                    startTok ??= istart;
                    const expr = $.SUBRULE($.valueSequence, { ARGS: [ctx] }) as unknown as Node;
                    $.CONSUME2(T.RCurly);
                    if (!RECORDING_PHASE) {
                      source += INTERPOLATION_PLACEHOLDER;
                      replacements.push(expr);
                    }
                  }
                },
                {
                  ALT: () => {
                    const ident = $.CONSUME(T.Ident);
                    startTok ??= ident;
                    if (!RECORDING_PHASE) {source += ident.image;}
                  }
                }
              ]);
            }
          });

          if (!RECORDING_PHASE) {
            const loc = startTok ? $.getLocationInfo(startTok) : $.getLocationInfo($.LA(-1));
            nameNode = new Interpolated({ source, replacements }, { role: 'name' }, loc, $.context);
          }
        }
      },
      {
        GATE: () => $.LA(1).tokenType === T.FunctionStart,
        ALT: () => {
          nameTok = $.CONSUME2(T.FunctionStart);
          hasParamsFromStart = true;
        }
      },
      {
        GATE: () => $.LA(1).tokenType === T.GenericFunctionStart,
        ALT: () => {
          nameTok = $.CONSUME3(T.GenericFunctionStart);
          hasParamsFromStart = true;
        }
      },
      { ALT: () => nameTok = $.CONSUME4(T.Ident) }
    ]);

    let params: List | undefined;
    $.OR2([
      {
        GATE: () => hasParamsFromStart,
        ALT: () => {
          params = $.SUBRULE($.scssMixinParamsAfterFunctionStart, { ARGS: [ctx] });
        }
      },
      {
        GATE: () => $.LA(1).tokenType === T.LParen,
        ALT: () => {
          params = $.SUBRULE($.scssMixinParams, { ARGS: [ctx] });
        }
      },
      { ALT: () => {} }
    ]);

    $.CONSUME(T.LCurly);
    const rules = $.SUBRULE($.declarationList, { ARGS: [{ ...ctx, inner: true }] });
    $.CONSUME(T.RCurly);

    if (!RECORDING_PHASE) {
      // Sass-style: inner vars/mixins should not be publicly visible by default.
      rules.options.rulesVisibility ??= {};
      rules.options.rulesVisibility.VarDeclaration ??= 'private';
      rules.options.rulesVisibility.Mixin ??= 'private';

      const loc = $.endRule();

      const finalNameNode = nameNode ?? (() => {
        const mixinName = (nameTok.tokenType === T.FunctionStart || nameTok.tokenType === T.GenericFunctionStart)
          ? String(nameTok.image).slice(0, -1)
          : String(nameTok.image);
        return new Any(mixinName, { role: 'name' }, $.getLocationInfo(nameTok), $.context);
      })();

      return new Mixin(
        { name: finalNameNode, params, rules },
        undefined,
        loc,
        $.context
      );
    }
  };
}

export function scssMixinParams(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    $.CONSUME(T.LParen);
    let params: Node[] | undefined;
    if (!RECORDING_PHASE) {params = [];}

    $.OPTION(() => {
      $.AT_LEAST_ONE_SEP({
        SEP: T.Comma,
        DEF: () => {
          const p = $.SUBRULE($.scssMixinParam, { ARGS: [ctx] }) as unknown as Node;
          if (!RECORDING_PHASE) {
            params!.push(p);
          }
        }
      });
    });

    $.CONSUME(T.RParen);
    if (!RECORDING_PHASE) {
      const loc = $.endRule();
      return new List(params ?? [], undefined, loc, $.context);
    }
  };
}

export function scssMixinParamsAfterFunctionStart(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    let params: Node[] | undefined;
    if (!RECORDING_PHASE) {params = [];}

    $.OPTION(() => {
      $.AT_LEAST_ONE_SEP({
        SEP: T.Comma,
        DEF: () => {
          const p = $.SUBRULE($.scssMixinParam, { ARGS: [ctx] }) as unknown as Node;
          if (!RECORDING_PHASE) {
            params!.push(p);
          }
        }
      });
    });

    $.CONSUME(T.RParen);
    if (!RECORDING_PHASE) {
      const loc = $.endRule();
      return new List(params ?? [], undefined, loc, $.context);
    }
  };
}

export function scssMixinParam(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    let node: Node | undefined;
    $.OR([
      // ...$rest
      {
        GATE: () => $.LA(1).tokenType?.name === 'Ellipsis' || $.LA(1).image === '...',
        ALT: () => {
          $.CONSUME(T.Ellipsis);
          const dv = $.CONSUME(T.DollarVariable);
          if (!RECORDING_PHASE) {
            node = new Rest(dv.image.slice(1), undefined, $.getLocationInfo(dv), $.context);
          }
        }
      },
      {
        ALT: () => {
          const dv = $.CONSUME2(T.DollarVariable);
          let defaultValue: Node | undefined;
          $.OPTION(() => {
            // In SCSS, default params use `:`, which is tokenized as `Assign` in this lexer setup.
            $.CONSUME(T.Assign);
            defaultValue = $.SUBRULE($.valueSequence, { ARGS: [ctx] });
          });
          if (!RECORDING_PHASE) {
            if (defaultValue) {
              const paramName = new Any(dv.image.slice(1), { role: 'property' });
              node = new VarDeclaration(
                { name: paramName, value: defaultValue },
                { paramVar: true },
                $.getLocationInfo(dv),
                $.context
              );
            } else {
              node = new Any(dv.image.slice(1), { role: 'property' }, $.getLocationInfo(dv), $.context);
            }
          }
        }
      }
    ]);

    if (!RECORDING_PHASE) {
      $.endRule();
      return node!;
    }
  };
}

export function declaration(this: ScssActionsParser, T: ScssTokenMap, alt?: AltContext) {
  const $ = this;

  // Inline the CSS declaration production (rather than calling it) so we can
  // add `$var: ...` without Chevrotain "numerical suffix" conflicts.
  //
  // Key point: all parsing DSL calls remain reachable during RECORDING_PHASE.

  const looksLikeInterpolatedDeclName = () => {
    // Look ahead until ':' and see if we encounter `#{`.
    // This keeps the fast path for normal CSS declarations.
    for (let i = 1; i < 64; i++) {
      const tok = $.LA(i);
      if (tok.tokenType === T.Assign || tok.tokenType.name === 'EOF') {return false;}
      if (tok.tokenType === T.InterpolationStart) {return true;}
    }
    return false;
  };

  alt ??= (ctx: RuleContext = {}) => [
    {
      // SCSS variable declaration: `$x: ... [!default] [!global]`
      GATE: () => $.LA(1).tokenType === T.DollarVariable,
      ALT: () => {
        const dv = $.CONSUME3(T.DollarVariable);
        const assign = $.CONSUME3(T.Assign);
        const value = $.SUBRULE3($.valueList, { ARGS: [ctx] });

        let sawDefault = false;
        let sawGlobal = false;
        $.MANY2(() => {
          $.OR3([
            { ALT: () => {
 $.CONSUME(T.SassDefault); sawDefault = true; 
} },
            { ALT: () => {
 $.CONSUME(T.SassGlobal); sawGlobal = true; 
} }
          ]);
        });

        if (!$.RECORDING_PHASE) {
          const nameNode = $.wrap(
            new Any(dv.image.slice(1), { role: 'property' }, $.getLocationInfo(dv), $.context),
            true
          );
          return [
            'scss-var',
            nameNode,
            assign,
            value,
            sawDefault,
            sawGlobal
          ] as const;
        }
      }
    },
    {
      // SCSS interpolated declaration name: `foo-#{$bar}: ...`, `#{$prop}: ...`, `--x-#{$y}: ...`
      GATE: () => (
        (
          $.LA(1).tokenType === T.Ident
          || $.LA(1).tokenType === T.CustomProperty
          || ($.legacyMode && $.LA(1).tokenType === T.LegacyPropIdent)
          || $.LA(1).tokenType === T.InterpolationStart
        ) && looksLikeInterpolatedDeclName()
      ),
      ALT: () => {
        const RECORDING_PHASE = $.RECORDING_PHASE;
        let source = '';
        const replacements: Node[] = [];

        $.AT_LEAST_ONE({
          DEF: () => {
            $.OR4([
              {
                GATE: () => $.LA(1).tokenType === T.InterpolationStart,
                ALT: () => {
                  $.CONSUME4(T.InterpolationStart);
                  const expr = $.SUBRULE4($.valueSequence, { ARGS: [ctx] }) as unknown as Node;
                  $.CONSUME4(T.RCurly);
                  if (!RECORDING_PHASE) {
                    source += INTERPOLATION_PLACEHOLDER;
                    replacements.push(expr);
                  }
                }
              },
              {
                ALT: () => {
                  const tok = $.OR5([
                    { ALT: () => $.CONSUME4(T.Ident) },
                    { ALT: () => $.CONSUME4(T.CustomProperty) },
                    {
                      GATE: () => $.legacyMode,
                      ALT: () => $.CONSUME4(T.LegacyPropIdent)
                    }
                  ]) as unknown as IToken;
                  if (!RECORDING_PHASE) {
                    source += tok.image;
                  }
                }
              }
            ]);
          }
        });

        const assign = $.CONSUME4(T.Assign);
        const value = $.SUBRULE5($.valueList, { ARGS: [ctx] });
        let important: IToken | undefined;
        $.OPTION2(() => {
          important = $.CONSUME2(T.Important);
        });

        if (!RECORDING_PHASE) {
          const nameNode = $.wrap(
            new Interpolated({ source, replacements }, { role: 'property' }, $.getLocationFromNodes(replacements), $.context),
            true
          );
          return [nameNode, assign, value, important] as const;
        }
      }
    },
    {
      ALT: () => {
        let name: IToken;
        $.OR2([
          { ALT: () => name = $.CONSUME(T.Ident) },
          {
            GATE: () => $.legacyMode,
            ALT: () => name = $.CONSUME(T.LegacyPropIdent)
          }
        ]);
        const assign = $.CONSUME(T.Assign);
        const value = $.SUBRULE($.valueList, { ARGS: [ctx] });
        let important: IToken | undefined;
        $.OPTION(() => {
          important = $.CONSUME(T.Important);
        });
        if (!$.RECORDING_PHASE) {
          const nameNode = $.wrap(new Any(name!.image, { role: 'property' }, $.getLocationInfo(name!), $.context), true);
          return [nameNode, assign, value, important] as const;
        }
      }
    },
    {
      ALT: () => {
        const RECORDING_PHASE = $.RECORDING_PHASE;
        const name = $.CONSUME(T.CustomProperty);
        const assign = $.CONSUME2(T.Assign);
        let nodes: Node[];
        if (!RECORDING_PHASE) {
          nodes = [];
        }
        $.startRule();
        $.MANY(() => {
          const val = $.SUBRULE2($.customValue, { ARGS: [{ ...ctx, inCustomPropertyValue: true }] });
          if (!RECORDING_PHASE) {
            nodes!.push(val);
          }
        });
        if (!RECORDING_PHASE) {
          const location = $.endRule();
          const nameNode = $.wrap(new Any(name.image, { role: 'property' }, $.getLocationInfo(name), $.context), true);
          const value = new Sequence(nodes!, undefined, location, $.context);
          return [nameNode, assign, value] as const;
        }
      }
    }
  ];

  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    let name: Any<'property'> | Interpolated<'property'> | undefined;
    let assign: IToken | undefined;
    let value: Node | undefined;
    let important: IToken | undefined;
    let kind: 'scss-var' | 'css-decl' | 'css-custom' | undefined;
    let sawDefault = false;
    let sawGlobal = false;

    const picked = $.OR(alt!(ctx) as any);

    if (!RECORDING_PHASE) {
      // scss var alt returns a tagged tuple
      if (Array.isArray(picked) && picked[0] === 'scss-var') {
        kind = 'scss-var';
        [, name, assign, value, sawDefault, sawGlobal] = picked as any;
      } else if (Array.isArray(picked)) {
        // css decl or css custom decl tuple
        if (picked.length === 3) {
          kind = 'css-custom';
          [name, assign, value] = picked as any;
        } else {
          kind = 'css-decl';
          [name, assign, value, important] = picked as any;
        }
      }
    }

    if (!RECORDING_PHASE) {
      const location = $.endRule();

      if (kind === 'scss-var') {
        // Semicolon is consumed by the main production (like Less), not here
        return new VarDeclaration(
          { name: name!, value: $.wrap(value!, 'both') },
          {
            assign: (sawDefault ? '?:' : assign!.image) as AssignmentType,
            setDefined: sawGlobal
          },
          location,
          $.context
        );
      }

      // Match CSS parser behavior: return Declaration / CustomDeclaration.
      const isCustom = String(name!.valueOf()).startsWith('--');
      return new (isCustom ? CustomDeclaration : Declaration)({
        name: name!,
        value: $.wrap(value!, 'both'),
        important: important ? $.wrap(new Any(important.image, { role: 'flag' }, $.getLocationInfo(important), $.context), 'both') : undefined
      }, { assign: assign!.image as AssignmentType }, location, $.context);
    }
  };
}

export function scssMediaPrelude(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    const nodes: Node[] = RECORDING_PHASE ? ([] as unknown as Node[]) : [];

    $.MANY({
      GATE: () => $.LA(1).tokenType !== T.LCurly && $.LA(1).tokenType.name !== 'EOF',
      DEF: () => {
        const n = $.OR([
          {
            GATE: () => $.LA(1).tokenType === T.InterpolationStart,
            ALT: () => {
              $.CONSUME(T.InterpolationStart);
              const expr = $.SUBRULE($.valueSequence, { ARGS: [ctx] }) as unknown as Node;
              $.CONSUME2(T.RCurly);
              if (!RECORDING_PHASE) {
                return new Interpolated(
                  { source: INTERPOLATION_PLACEHOLDER, replacements: [expr] },
                  { role: 'any' },
                  $.getLocationFromNodes([expr]),
                  $.context
                );
              }
            }
          },
          { ALT: () => $.SUBRULE2($.anyOuterValue, { ARGS: [ctx] }) }
        ]) as unknown as Node;

        if (!RECORDING_PHASE) {nodes.push($.wrap(n));}
      }
    });

    if (!RECORDING_PHASE) {
      const loc = $.endRule();
      if (nodes.length === 1) {return nodes[0]!;}
      return new Sequence(nodes, undefined, loc, $.context);
    }
  };
}

export function mediaAtRule(this: ScssActionsParser, T: ScssTokenMap) {
  // Use CSS implementation and inject only the prelude rule.
  return cssProductions.mediaAtRule.call(this, T, 'scssMediaPrelude');
}

export function scssSupportsPrelude(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    const nodes: Node[] = RECORDING_PHASE ? ([] as unknown as Node[]) : [];

    $.MANY({
      GATE: () => $.LA(1).tokenType !== T.LCurly && $.LA(1).tokenType.name !== 'EOF',
      DEF: () => {
        const n = $.OR2([
          {
            GATE: () => $.LA(1).tokenType === T.InterpolationStart,
            ALT: () => {
              $.CONSUME(T.InterpolationStart);
              const expr = $.SUBRULE($.valueSequence, { ARGS: [ctx] }) as unknown as Node;
              $.CONSUME2(T.RCurly);
              if (!RECORDING_PHASE) {
                return new Interpolated(
                  { source: INTERPOLATION_PLACEHOLDER, replacements: [expr] },
                  { role: 'any' },
                  $.getLocationFromNodes([expr]),
                  $.context
                );
              }
            }
          },
          { ALT: () => $.SUBRULE2($.anyOuterValue, { ARGS: [ctx] }) }
        ]) as unknown as Node;

        if (!RECORDING_PHASE) {nodes.push($.wrap(n));}
      }
    });

    if (!RECORDING_PHASE) {
      const loc = $.endRule();
      if (nodes.length === 1) {return nodes[0]!;}
      return new Sequence(nodes, undefined, loc, $.context);
    }
  };
}

export function supportsAtRule(this: ScssActionsParser, T: ScssTokenMap) {
  // Use CSS implementation and inject only the prelude rule.
  return cssProductions.supportsAtRule.call(this, T, 'scssSupportsPrelude');
}

export function scssContainerPrelude(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    const nodes: Node[] = RECORDING_PHASE ? ([] as unknown as Node[]) : [];

    $.MANY({
      GATE: () => $.LA(1).tokenType !== T.LCurly && $.LA(1).tokenType.name !== 'EOF',
      DEF: () => {
        const n = $.OR2([
          {
            GATE: () => $.LA(1).tokenType === T.InterpolationStart,
            ALT: () => {
              $.CONSUME(T.InterpolationStart);
              const expr = $.SUBRULE($.valueSequence, { ARGS: [ctx] }) as unknown as Node;
              $.CONSUME2(T.RCurly);
              if (!RECORDING_PHASE) {
                return new Interpolated(
                  { source: INTERPOLATION_PLACEHOLDER, replacements: [expr] },
                  { role: 'any' },
                  $.getLocationFromNodes([expr]),
                  $.context
                );
              }
            }
          },
          { ALT: () => $.SUBRULE2($.anyOuterValue, { ARGS: [ctx] }) }
        ]) as unknown as Node;

        if (!RECORDING_PHASE) {nodes.push($.wrap(n));}
      }
    });

    if (!RECORDING_PHASE) {
      const loc = $.endRule();
      if (nodes.length === 1) {return nodes[0]!;}
      return new Sequence(nodes, undefined, loc, $.context);
    }
  };
}

export function containerAtRule(this: ScssActionsParser, T: ScssTokenMap) {
  // Use CSS implementation and inject only the prelude rule.
  return cssProductions.containerAtRule.call(this, T, 'scssContainerPrelude');
}

export function scssScopePrelude(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    const nodes: Node[] = RECORDING_PHASE ? ([] as unknown as Node[]) : [];

    $.MANY({
      GATE: () => $.LA(1).tokenType !== T.LCurly && $.LA(1).tokenType.name !== 'EOF',
      DEF: () => {
        const n = $.OR2([
          {
            GATE: () => $.LA(1).tokenType === T.InterpolationStart,
            ALT: () => {
              $.CONSUME(T.InterpolationStart);
              const expr = $.SUBRULE($.valueSequence, { ARGS: [ctx] }) as unknown as Node;
              $.CONSUME2(T.RCurly);
              if (!RECORDING_PHASE) {
                return new Interpolated(
                  { source: INTERPOLATION_PLACEHOLDER, replacements: [expr] },
                  { role: 'any' },
                  $.getLocationFromNodes([expr]),
                  $.context
                );
              }
            }
          },
          { ALT: () => $.SUBRULE2($.anyOuterValue, { ARGS: [ctx] }) }
        ]) as unknown as Node;

        if (!RECORDING_PHASE) {nodes.push($.wrap(n));}
      }
    });

    if (!RECORDING_PHASE) {
      const loc = $.endRule();
      if (nodes.length === 1) {return nodes[0]!;}
      return new Sequence(nodes, undefined, loc, $.context);
    }
  };
}

export function scopeAtRule(this: ScssActionsParser, T: ScssTokenMap) {
  // Use CSS implementation and inject only the prelude rule.
  return cssProductions.scopeAtRule.call(this, T, 'scssScopePrelude');
}

/**
 * SCSS: allow interpolation inside @layer names (block + statement forms).
 *
 * Example:
 *   @layer foo-#{$bar} { ... }
 *   @layer foo-#{$bar}, baz;
 */
export function layerName(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    let source: string | undefined;
    let replacements: Node[] | undefined;

    const takeIdent = (tok: IToken) => {
      if (!RECORDING_PHASE) {
        (source ??= '');
        source += tok.image;
      }
    };

    const takeInterpolation = (expr: Node) => {
      if (!RECORDING_PHASE) {
        (source ??= '');
        (replacements ??= []);
        source += INTERPOLATION_PLACEHOLDER;
        replacements.push(expr);
      }
    };

    // First segment
    $.OR([
      {
        GATE: () => $.LA(1).tokenType === T.InterpolationStart,
        ALT: () => {
          $.CONSUME(T.InterpolationStart);
          const expr = $.SUBRULE($.valueSequence, { ARGS: [ctx] }) as unknown as Node;
          $.CONSUME2(T.RCurly);
          takeInterpolation(expr);
        }
      },
      {
        ALT: () => {
          const tok = $.OR2([
            { GATE: () => $.LA(1).tokenType === T.Ident, ALT: () => $.CONSUME(T.Ident) },
            { ALT: () => $.CONSUME(T.PlainIdent) }
          ]) as unknown as IToken;
          takeIdent(tok);
        }
      }
    ]);

    // Additional segments with no whitespace (e.g. `foo-#{$bar}`)
    $.MANY({
      GATE: () =>
        !$.hasWS()
        && $.LA(1).tokenType !== T.LCurly
        && $.LA(1).tokenType !== T.Comma
        && $.LA(1).tokenType !== T.Semi
        && $.LA(1).tokenType.name !== 'EOF',
      DEF: () => {
        $.OR3([
          {
            GATE: () => $.LA(1).tokenType === T.InterpolationStart,
            ALT: () => {
              $.CONSUME3(T.InterpolationStart);
              const expr = $.SUBRULE2($.valueSequence, { ARGS: [ctx] }) as unknown as Node;
              $.CONSUME4(T.RCurly);
              takeInterpolation(expr);
            }
          },
          {
            ALT: () => {
              const tok = $.OR4([
                { GATE: () => $.LA(1).tokenType === T.Ident, ALT: () => $.CONSUME2(T.Ident) },
                { ALT: () => $.CONSUME2(T.PlainIdent) }
              ]) as unknown as IToken;
              takeIdent(tok);
            }
          }
        ]);
      }
    });

    if (!RECORDING_PHASE) {
      const loc = $.endRule();
      if (replacements?.length) {
        return new Interpolated({ source: source ?? '', replacements }, { role: 'any' }, loc, $.context);
      }
      return new Any(source ?? '', { role: 'ident' }, loc, $.context);
    }
  };
}

/**
 * Override CSS `unknownAtRule` to special-case Sass directives.
 *
 * We do this (instead of extending `atRule`) because the CSS parser’s
 * lookahead will otherwise choose `unknownAtRule` and skip our custom
 * alternatives.
 */
export function unknownAtRule(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  const baseUnknown = cssProductions.unknownAtRule.call(this, T);

  return (ctx: RuleContext = {}) => {
    const img = $.LA(1).image;
    if (img === '@use') {return $.SUBRULE($.scssUseAtRule, { ARGS: [ctx] });}
    if (img === '@forward') {return $.SUBRULE($.scssForwardAtRule, { ARGS: [ctx] });}
    if (img === '@extend') {return $.SUBRULE($.scssExtendAtRule, { ARGS: [ctx] });}
    if (img === '@content') {return $.SUBRULE($.scssContentAtRule, { ARGS: [ctx] });}
    if (img === '@if') {return $.SUBRULE($.scssIfAtRule, { ARGS: [ctx] });}
    if (img === '@for') {return $.SUBRULE($.scssForAtRule, { ARGS: [ctx] });}
    if (img === '@each') {return $.SUBRULE($.scssEachAtRule, { ARGS: [ctx] });}
    if (img === '@while') {return $.SUBRULE($.scssWhileAtRule, { ARGS: [ctx] });}
    if (img === '@include') {return $.SUBRULE($.scssIncludeAtRule, { ARGS: [ctx] });}
    if (img === '@mixin') {return $.SUBRULE($.scssMixinAtRule, { ARGS: [ctx] });}
    if (img === '@function') {return $.SUBRULE($.scssFunctionAtRule, { ARGS: [ctx] });}
    if (img === '@return') {return $.SUBRULE($.scssReturnAtRule, { ARGS: [ctx] });}
    if (img === '@debug' || img === '@warn' || img === '@error') {return $.SUBRULE($.scssDiagnosticAtRule, { ARGS: [ctx] });}
    if (img === '@at-root') {return $.SUBRULE($.scssAtRootAtRule, { ARGS: [ctx] });}
    return baseUnknown(ctx);
  };
}

/**
 * SCSS: `@return <value>;` → `return: <value>;`
 */
export function scssReturnAtRule(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    $.CONSUME(T.AtKeyword); // '@return'
    // Use valueList to allow expressions like `$a + $b` (Sass return values commonly include operations).
    const value = $.SUBRULE($.valueList, { ARGS: [ctx] }) as unknown as Node;
    $.CONSUME(T.Semi);
    if (!RECORDING_PHASE) {
      const loc = $.endRule();
      const name = new Any('return', { role: 'property' }, loc, $.context);
      return new Declaration({ name, value: $.wrap(value) }, undefined, loc, $.context);
    }
  };
}

/**
 * SCSS: `@function name($a, $b: 1) { ... }`
 *
 * Parsed as a `Func` node with a `body` (Rules) and `params` list, and registered in the function registry.
 * Return value is represented by a `return: <value>;` declaration (see `@return`).
 */
export function scssFunctionAtRule(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    $.CONSUME(T.AtKeyword); // '@function'

    let nameTok: IToken | undefined;
    let params: List | undefined;
    let hasParamsFromStart = false;

    $.OR([
      {
        // function name may be tokenized as a FunctionStart / GenericFunctionStart (`name(`)
        GATE: () => $.LA(1).tokenType === T.FunctionStart,
        ALT: () => {
          nameTok = $.CONSUME(T.FunctionStart) as unknown as IToken;
          hasParamsFromStart = true;
        }
      },
      {
        GATE: () => $.LA(1).tokenType === T.GenericFunctionStart,
        ALT: () => {
          nameTok = $.CONSUME(T.GenericFunctionStart) as unknown as IToken;
          hasParamsFromStart = true;
        }
      },
      {
        ALT: () => {
          nameTok = $.OR2([
            { GATE: () => $.LA(1).tokenType === T.Ident, ALT: () => $.CONSUME2(T.Ident) },
            { ALT: () => $.CONSUME(T.PlainIdent) }
          ]) as unknown as IToken;
        }
      }
    ]);

    $.OR3([
      {
        GATE: () => hasParamsFromStart,
        ALT: () => {
          params = $.SUBRULE($.scssMixinParamsAfterFunctionStart, { ARGS: [ctx] }) as unknown as List;
        }
      },
      {
        GATE: () => $.LA(1).tokenType === T.LParen,
        ALT: () => {
          params = $.SUBRULE2($.scssMixinParams, { ARGS: [ctx] }) as unknown as List;
        }
      },
      { ALT: () => {} }
    ]);

    $.CONSUME(T.LCurly);
    const bodyRules = $.SUBRULE($.declarationList, { ARGS: [{ ...ctx, inner: true }] }) as unknown as Rules;
    $.CONSUME(T.RCurly);

    if (!RECORDING_PHASE) {
      // Keep function body "private-ish" by default, like Sass.
      bodyRules.options.rulesVisibility ??= {};
      bodyRules.options.rulesVisibility.VarDeclaration ??= 'private';
      bodyRules.options.rulesVisibility.Mixin ??= 'private';
      bodyRules.options.rulesVisibility.Ruleset ??= 'private';

      const loc = $.endRule();
      const tok = nameTok ?? $.LA(-1);
      const rawName = hasParamsFromStart ? String(tok.image).slice(0, -1) : String(tok.image);
      const fnName = new Any(rawName, { role: 'name' }, $.getLocationInfo(tok), $.context);
      return new Func(
        { name: fnName, params, body: bodyRules },
        undefined,
        loc,
        $.context
      );
    }
  };
}

/**
 * SCSS: `@debug <expr>;`, `@warn <expr>;`, `@error <expr>;`
 *
 * Parsed as `Log` nodes. These are diagnostic at-rules that output messages during compilation.
 * They serialize to empty strings since they're not supported in Jess syntax.
 */
export function scssDiagnosticAtRule(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    const atKeyword = $.CONSUME(T.AtKeyword) as unknown as IToken; // '@debug', '@warn', or '@error'
    // Parse the diagnostic message as a value sequence (stops at `;` naturally).
    const message = $.SUBRULE($.valueSequence, { ARGS: [ctx] }) as unknown as Node;
    $.CONSUME(T.Semi);
    if (!RECORDING_PHASE) {
      const loc = $.endRule();
      const keywordImage = atKeyword.image;
      // Extract level from @debug, @warn, or @error
      const level = keywordImage.slice(1) as 'debug' | 'warn' | 'error';
      return new Log(
        { level, message: $.wrap(message, 'both') },
        undefined,
        loc,
        $.context
      );
    }
  };
}

/**
 * SCSS: `@at-root [selector] { ... }` or `@at-root (without: media) { ... }`
 *
 * Parsed as `AtRule` nodes. This feature is currently unsupported in Jess.
 * A warning is emitted when this directive is encountered.
 */
export function scssAtRootAtRule(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    const atKeyword = $.CONSUME(T.AtKeyword) as unknown as IToken; // '@at-root'

    // Parse optional selector or control arguments
    let prelude: Node | undefined;
    $.OR([
      {
        // @at-root (without: media) or @at-root (with: rule)
        GATE: () => $.LA(1).tokenType === T.LParen,
        ALT: () => {
          prelude = $.SUBRULE($.valueSequence, { ARGS: [ctx] }) as unknown as Node;
        }
      },
      {
        // @at-root .selector { ... }
        GATE: () => {
          const next = $.LA(1);
          return next.tokenType === T.Ident || next.tokenType === T.PlainIdent 
                 || next.tokenType === T.Dot || next.tokenType === T.Hash
                 || next.tokenType === T.Colon || next.tokenType === T.LBracket;
        },
        ALT: () => {
          // Parse as a selector list (CSS parser method)
          prelude = $.SUBRULE($.selectorList, { ARGS: [ctx] }) as unknown as Node;
        }
      },
      {
        // @at-root { ... } (no prelude)
        ALT: () => {}
      }
    ]);

    $.CONSUME(T.LCurly);
    const rules = $.SUBRULE($.atRuleBody, { ARGS: [{ ...ctx, inner: !!ctx.inner }] });
    $.CONSUME(T.RCurly);

    if (!RECORDING_PHASE) {
      const loc = $.endRule();
      const name = new Any(atKeyword.image, { role: 'atkeyword' }, $.getLocationInfo(atKeyword), $.context);
      const atRule = new AtRule({ name, prelude: prelude ? $.wrap(prelude, 'both') : undefined, rules }, undefined, loc, $.context);

      // Emit warning that @at-root is unsupported (and will never be)
      $.warnings.push({
        message: '@at-root is not supported in Jess and will never be. Write utilities at the top level or use separate files/modules instead. See docs for alternatives.',
        token: atKeyword,
        deprecation: undefined
      });

      return atRule;
    }
  };
}
