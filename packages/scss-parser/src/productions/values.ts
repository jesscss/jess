// Value-related production rules for ScssRecursiveParser
// Converted from Chevrotain-based productions.ts
import type { RuleContext, TokenMap } from '../scssRecursiveParser.js';
import type { IToken } from '@jesscss/parser';
import { NoViableAltException } from 'chevrotain';
import { productions as cssProductions } from '@jesscss/css-parser';
import {
  Any,
  Call,
  Collection,
  Declaration,
  CustomDeclaration,
  Expression,
  Interpolated,
  INTERPOLATION_PLACEHOLDER,
  type LocationInfo,
  type Node,
  List,
  Nil,
  Paren,
  Rest,
  Quoted,
  Reference,
  type Selector,
  SelectorCapture,
  Sequence,
  VarDeclaration,
  isNode,
  N,
  Node as JessNode
} from '@jesscss/core';
import {
  desugarMapLookup,
  desugarNamespacedCall,
  looksLikeMapLiteral,
  makeNamespacedReference,
  parseSelectorListExpression,
  processScssStringInterpolation,
  toDeclKey,
  toNameInterpolationReplacement
} from './helpers.js';

/** Use `any` for `this` to avoid structural incompatibility */
type P = any;

type Alt = Array<{ ALT: () => any; GATE?: () => boolean }>;
type AltContext = (ctx?: RuleContext) => Alt;

// Save reference to CSS prototype functionCall
const cssFunctionCall = cssProductions.functionCall;
const cssDeclaration = cssProductions.declaration;

function saveValueDiagnostic($: P, token: IToken | undefined, location: LocationInfo | undefined, message: string): void {
  const err: NoViableAltException & {
    startLine?: number;
    startColumn?: number;
    endLine?: number;
    endColumn?: number;
    offset?: number;
    length?: number;
    location?: LocationInfo;
  } = new NoViableAltException(
    message,
    token ?? $.LA(1),
    $.LA(0)
  ) as NoViableAltException & {
    startLine?: number;
    startColumn?: number;
    endLine?: number;
    endColumn?: number;
    offset?: number;
    length?: number;
    location?: LocationInfo;
  };
  if (location) {
    err.startLine = location[1];
    err.startColumn = location[2];
    err.endLine = location[4];
    err.endColumn = location[5];
    err.offset = location[0];
    err.length = Math.max(1, (location[3] - location[0]) + 1);
    err.location = location;
  }
  $.SAVE_ERROR(err);
}

function consumeScssVarFlags($: P) {
  let sawDefault = false;
  let sawGlobal = false;

  if ($.RECORDING_PHASE) {
    $.MANY(() => {
      $.OR2([
        { ALT: () => $.CONSUME($.T.SassDefault) },
        { ALT: () => $.CONSUME($.T.SassGlobal) }
      ]);
    });
    return { sawDefault, sawGlobal };
  }

  while ($.isType($.T.SassDefault) || $.isType($.T.SassGlobal)) {
    if ($.isType($.T.SassDefault)) {
      $.CONSUME($.T.SassDefault);
      sawDefault = true;
    } else {
      $.CONSUME($.T.SassGlobal);
      sawGlobal = true;
    }
  }

  return { sawDefault, sawGlobal };
}

export function scssNestedPropertyCollection(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();
    $.CONSUME($.T.LCurly);

    const decls: Declaration[] = [];

    $.MANY({
      GATE: () => $.LA(1).tokenType !== $.T.RCurly && $.LA(1).tokenType.name !== 'EOF',
      DEF: () => {
        if ($.LA(1).tokenType === $.T.Semi) {
          $.CONSUME($.T.Semi);
          return;
        }

        const decl = $.SUBRULE($.declaration, { ARGS: [ctx] }) as unknown as Node;
        if (!$.RECORDING_PHASE && isNode(decl, N.Declaration) && !isNode(decl, N.VarDeclaration)) {
          decls.push(decl as Declaration);
        }

        $.OPTION(() => {
          $.CONSUME2($.T.Semi);
        });
      }
    });

    $.CONSUME($.T.RCurly);

    const location = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }

    return new Collection(decls, undefined, location, $.context);
  };
}

export function scssIdentValue(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();
    const ident = $.CONSUME($.T.Ident) as unknown as IToken;

    let kind: 'ruleset' | 'module-var' | 'module-fn' | undefined;
    let member: IToken | undefined;
    let dollarVariable: IToken | undefined;
    let dotName: IToken | undefined;
    let args: List | undefined;

    $.OPTION({
      GATE: () =>
        $.LA(1).tokenType === $.T.Unknown
        && $.LA(1).image === '.'
        && $.LA(2).tokenType === $.T.Unknown
        && $.LA(2).image === '\\'
        && ($.LA(3).tokenType === $.T.HashName || $.LA(3).tokenType === $.T.DotName)
        && $.LA(4).tokenType === $.T.LParen,
      DEF: () => {
        kind = 'ruleset';
        $.CONSUME($.T.Unknown);
        $.CONSUME2($.T.Unknown);
        member = $.OR([
          { ALT: () => $.CONSUME($.T.HashName) },
          { ALT: () => $.CONSUME($.T.DotName) }
        ]) as unknown as IToken;
        $.CONSUME($.T.LParen);
        $.OPTION2(() => (args = $.SUBRULE($.functionCallArgs, { ARGS: [ctx] }) as unknown as List));
        $.CONSUME($.T.RParen);
      }
    });

    $.OPTION2({
      GATE: () =>
        $.LA(1).tokenType === $.T.Unknown
        && $.LA(1).image === '.'
        && $.LA(2).tokenType === $.T.DollarVariable,
      DEF: () => {
        kind = 'module-var';
        $.CONSUME3($.T.Unknown);
        dollarVariable = $.CONSUME($.T.DollarVariable);
      }
    });

    $.OPTION3({
      GATE: () =>
        $.LA(1).tokenType === $.T.DotName
        && $.LA(2).tokenType === $.T.LParen,
      DEF: () => {
        kind = 'module-fn';
        dotName = $.CONSUME2($.T.DotName) as unknown as IToken;
        $.CONSUME2($.T.LParen);
        $.OPTION4(() => (args = $.SUBRULE2($.functionCallArgs, { ARGS: [ctx] }) as unknown as List));
        $.CONSUME2($.T.RParen);
      }
    });

    const loc = $.endRule();
    if ($.RECORDING_PHASE) {
      return ident;
    }

    if (kind === 'ruleset') {
      const key = member!.image.slice(1);
      const ref = makeNamespacedReference($, [ident.image, key], 'mixin-ruleset');
      const call = new Call({ name: ref, args }, undefined, loc, $.context);
      return new Expression(call, undefined, loc, $.context);
    }

    if (kind === 'module-var') {
      const key = dollarVariable!.image.slice(1);
      const nsRef = new Reference(ident.image, { type: 'variable' }, loc, $.context);
      return new Reference({ target: nsRef, key }, { type: 'variable' }, loc, $.context);
    }

    if (kind === 'module-fn') {
      const fnName = `${ident.image}.${dotName!.image.slice(1)}`;
      const call = new Call({ name: fnName, args }, undefined, loc, $.context);
      const mapped = desugarMapLookup($, call);
      if (isNode(mapped, N.Reference)) {
        return new Expression(mapped as unknown as Node, undefined, loc, $.context);
      }
      const maybe = desugarNamespacedCall($, mapped as Call);
      return new Expression(maybe, undefined, loc, $.context);
    }

    return ident;
  };
}

export function functionCallArgs(this: P, T: TokenMap) {
  const $ = this;

  const parseCallArgument = (ctx: RuleContext = {}) => {
    $.startRule();

    let node: Node;
    if (
      $.LA(1).tokenType === $.T.DollarVariable
      && $.isTypeAt(2, $.T.Assign)
    ) {
      const dv = $.CONSUME($.T.DollarVariable) as unknown as IToken;
      $.CONSUME($.T.Assign);
      const value = $.SUBRULE($.valueSequence, { ARGS: [ctx] }) as unknown as Node;
      const location = $.endRule();
      if ($.RECORDING_PHASE) {
        return;
      }
      const name = new Any(dv.image.slice(1), { role: 'property' }, $.getLocationInfo(dv), $.context);
      return new VarDeclaration({ name, value }, undefined, location, $.context);
    }

    node = $.SUBRULE2($.valueSequence, { ARGS: [ctx] }) as unknown as Node;
    $.OPTION({
      GATE: () => $.LA(1).tokenType === $.T.Ellipsis,
      DEF: () => {
        const ellipsis = $.CONSUME($.T.Ellipsis);
        if (!$.RECORDING_PHASE) {
          node = new Rest(node, undefined, $.getLocationFromNodes([node, ellipsis]), $.context);
        }
      }
    });

    const location = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }
    return node ?? new Nil(undefined, undefined, location, $.context);
  };

  return (ctx: RuleContext = {}) => {
    $.startRule();

    let node = parseCallArgument(ctx) as unknown as Node;
    let commaNodes: Node[] | undefined;
    let semiNodes: Node[] | undefined;
    let isSemiList = false;

    if (!$.RECORDING_PHASE) {
      commaNodes = [$.wrap(node, true)];
      semiNodes = [];
    }

    $.MANY(() => {
      if ($.RECORDING_PHASE) {
        $.OR([
          {
            ALT: () => {
              $.CONSUME($.T.Comma);
              $.OPTION2(() => {
                parseCallArgument(ctx);
              });
            }
          },
          {
            ALT: () => {
              $.CONSUME($.T.Semi);
              $.SUBRULE($.valueList, { ARGS: [ctx] });
            }
          }
        ]);
        return;
      }

      if (!isSemiList && $.isType($.T.Comma)) {
        $.CONSUME($.T.Comma);
        if ($.LA(1).tokenType === $.T.RParen) {
          return;
        }
        node = parseCallArgument(ctx) as unknown as Node;
        commaNodes!.push($.wrap(node, true));
        return;
      }

      isSemiList = true;
      $.CONSUME($.T.Semi);
      if (commaNodes!.length > 1) {
        semiNodes!.push(new List(commaNodes!, undefined, $.getLocationFromNodes(commaNodes!)!, $.context));
      } else {
        semiNodes!.push(commaNodes![0]!);
      }
      node = $.SUBRULE($.valueList, { ARGS: [ctx] }) as unknown as Node;
      semiNodes!.push($.wrap(node, true));
    });

    const location = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }

    const nodes = isSemiList ? semiNodes! : commaNodes!;
    return new List(nodes, isSemiList ? { sep: ';' } : undefined, location, $.context);
  };
}

export function parenValue(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();
    $.CONSUME($.T.LParen);

    let value: Node | undefined;
    $.OPTION({
      GATE: () => $.LA(1).tokenType !== $.T.RParen,
      DEF: () => {
        value = $.SUBRULE($.valueList, { ARGS: [{ ...ctx, inner: true }] }) as unknown as Node;
      }
    });

    $.CONSUME($.T.RParen);
    const location = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }

    return new Paren(value, { delimiter: 'paren' }, location, $.context);
  };
}

export function squareValue(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();
    $.CONSUME($.T.LSquare);

    let value: Node | undefined;
    $.OPTION({
      GATE: () => $.LA(1).tokenType !== $.T.RSquare,
      DEF: () => {
        value = $.SUBRULE($.valueList, { ARGS: [{ ...ctx, inner: true }] }) as unknown as Node;
      }
    });

    $.CONSUME($.T.RSquare);
    const location = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }

    const delimiter = (
      isNode(value, N.Any)
      && value.options?.role === 'ident'
    ) ? 'square' : 'paren';

    return new Paren(value, { delimiter }, location, $.context);
  };
}

/**
 * Override CSS `value` to add SCSS interpolation, map literals, and
 * module-qualified references.
 */
export function value(this: P, T: TokenMap, valueAlt?: AltContext) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    valueAlt ??= (ctx: RuleContext = {}) => [
    {
      GATE: () => $.LA(1).tokenType === $.T.LParen && looksLikeMapLiteral($, $.T),
      ALT: () => $.SUBRULE($.scssMapLiteral, { ARGS: [ctx] })
    },
    {
      GATE: () => $.LA(1).tokenType === $.T.LParen,
      ALT: () => $.SUBRULE($.parenValue, { ARGS: [ctx] })
    },
    {
      // SCSS interpolation in values: `#{$expr}`
      GATE: () => $.LA(1).tokenType === $.T.InterpolationStart,
      ALT: () => {
        $.startRule();
        $.CONSUME($.T.InterpolationStart);
        const expr = $.SUBRULE($.valueSequence, { ARGS: [ctx] }) as unknown as Node;
        $.CONSUME($.T.RCurly);
        const loc = $.endRule();
        return new Interpolated(
          { source: INTERPOLATION_PLACEHOLDER, replacements: [expr] },
          { role: 'any' },
          loc,
          $.context
        );
      }
    },
    {
      GATE: () => $.isTypeAt(1, $.T.FunctionStart),
      ALT: () => $.SUBRULE($.functionCall, { ARGS: [ctx] })
    },
    { GATE: () => $.LA(1).tokenType === $.T.DollarVariable, ALT: () => $.CONSUME($.T.DollarVariable) },
    {
      GATE: () => $.isTypeAt(1, $.T.Ident) || $.LA(1).tokenType === $.T.PlainIdent,
      ALT: () => $.SUBRULE($.scssIdentValue, { ARGS: [ctx] })
    },
    { GATE: () => $.isTypeAt(1, $.T.Dimension), ALT: () => $.CONSUME($.T.Dimension) },
    { GATE: () => $.isTypeAt(1, $.T.Number), ALT: () => $.CONSUME($.T.Number) },
    { GATE: () => $.LA(1).tokenType === $.T.Color, ALT: () => $.CONSUME($.T.Color) },
    { GATE: () => $.LA(1).tokenType === $.T.UnicodeRange, ALT: () => $.CONSUME($.T.UnicodeRange) },
    {
      GATE: () => $.LA(1).tokenType === $.T.SingleQuoteStart || $.LA(1).tokenType === $.T.DoubleQuoteStart,
      ALT: () => $.SUBRULE($.string, { ARGS: [ctx] })
    },
    { GATE: () => $.LA(1).tokenType === $.T.LSquare, ALT: () => $.SUBRULE($.squareValue, { ARGS: [ctx] }) },
    {
      GATE: () => $.legacyMode,
      ALT: () => $.CONSUME($.T.LegacyMSFilter)
    }
  ];

    $.startRule();
    let node = $.OR(valueAlt!(ctx)) as unknown as Node | IToken;
    let additionalValue: Node | undefined;
    $.OPTION(() => {
      $.CONSUME($.T.Slash);
      additionalValue = $.SUBRULE($.value, { ARGS: [ctx] }) as unknown as Node;
    });
    const location = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }
    // Match CSS parser behavior: convert raw tokens into Nodes.
    if (!(node instanceof JessNode)) {
      node = $.processValueToken(node as IToken, ctx);
    }
    if (additionalValue) {
      return $.wrap(new List([$.wrap(node, true), additionalValue], { sep: '/' }, location, $.context));
    }
    return $.wrap(node);
  };
}

/**
 * Override CSS functionCall to desugar module-qualified calls like `ns.fn(...)`.
 * We return an Expression(Call(Reference(ns.fn))) to match Less-style outer wrapping.
 */
export function functionCall(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const node = cssFunctionCall.call($, $.T)(ctx) as unknown as Call;

    if ($.RECORDING_PHASE) {
      return node as unknown as any;
    }

    if (!isNode(node, N.Call)) {
      return node as unknown as any;
    }

  // First, keep existing Sass map.get() desugaring behavior.
  const mapped = desugarMapLookup($, node);
  if (isNode(mapped, N.Reference)) {
    return mapped as unknown as any;
  }
  const call = mapped as Call;

    if (typeof call.name === 'string' && call.name === 'selector.parse') {
      const args = isNode(call.args, N.List) ? (call.args as List).value : [];
      const firstArg = args[0];
      const loc: LocationInfo | undefined = Array.isArray(call.location) && call.location.length === 6
        ? (call.location as LocationInfo)
        : undefined;
      if (!firstArg || !isNode(firstArg, N.Quoted) || !isNode((firstArg as Quoted).value, N.Any)) {
        saveValueDiagnostic($, undefined, firstArg?.location as LocationInfo | undefined ?? loc, 'selector.parse() requires a quoted selector string literal.');
        return call;
      }
      const selectorText = String((firstArg as Quoted).value.valueOf());
      let selector: Selector;
      try {
        selector = parseSelectorListExpression(selectorText);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        saveValueDiagnostic($, undefined, firstArg.location as LocationInfo | undefined ?? loc, `selector.parse() failed: ${message}`);
        return call;
      }
      return new SelectorCapture(selector, undefined, loc, $.context);
    }

    const maybe = desugarNamespacedCall($, call);
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
    if (typeof call.name === 'string') {
      const loc: LocationInfo | undefined = Array.isArray(call.location) && call.location.length === 6
        ? (call.location as LocationInfo)
        : undefined;
      const ref = new Reference(
        { key: call.name },
        { type: 'function', fallbackValue: true },
        loc,
        $.context
      );
      // Sass/Less plain function calls are not optional/silent-fail calls (no `?(` output).
      // Keep other call options if present, but drop `silentFail` coming from CSS fallback behavior.
      const { silentFail: silentFailIgnored, ...rest } = call.options ?? {};
      void silentFailIgnored;
      const nextOptions = Object.keys(rest).length > 0 ? rest : undefined;
      return new Call({ name: ref, args: call.args }, nextOptions, loc, $.context);
    }
    return call;
  };
}

/**
 * Override CSS `string` to add SCSS string interpolation support.
 */
export function string(this: P, T: TokenMap, stringAlt?: AltContext) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const parseSingleQuoted = () => {
      $.startRule();
      const quote = $.CONSUME($.T.SingleQuoteStart);

      let contents: IToken | undefined;
      if ($.RECORDING_PHASE) {
        $.OPTION(() => (contents = $.CONSUME($.T.SingleQuoteStringContents)));
      } else if ($.isType($.T.SingleQuoteStringContents)) {
        contents = $.CONSUME($.T.SingleQuoteStringContents) as unknown as IToken;
      }

      $.CONSUME($.T.SingleQuoteEnd);
      const location = $.endRule();
      if ($.RECORDING_PHASE) {
        return;
      }
      const raw = contents?.image ?? '';
      const inner = processScssStringInterpolation(raw, location, $.context);
      return new Quoted(inner as any, { quote: quote.image as '"' | '\'' }, location, $.context);
    };

    const parseDoubleQuoted = () => {
      $.startRule();
      const quote = $.CONSUME($.T.DoubleQuoteStart);

      let contents: IToken | undefined;
      if ($.RECORDING_PHASE) {
        $.OPTION(() => (contents = $.CONSUME($.T.DoubleQuoteStringContents)));
      } else if ($.isType($.T.DoubleQuoteStringContents)) {
        contents = $.CONSUME($.T.DoubleQuoteStringContents) as unknown as IToken;
      }

      $.CONSUME($.T.DoubleQuoteEnd);
      const location = $.endRule();
      if ($.RECORDING_PHASE) {
        return;
      }
      const raw = contents?.image ?? '';
      const inner = processScssStringInterpolation(raw, location, $.context);
      return new Quoted(inner as any, { quote: quote.image as '"' | '\'' }, location, $.context);
    };

    if ($.RECORDING_PHASE) {
      $.OR([
        { ALT: () => parseSingleQuoted() },
        { ALT: () => parseDoubleQuoted() }
      ]);
      return;
    }

    if ($.LA(1).tokenType === $.T.SingleQuoteStart) {
      return parseSingleQuoted();
    }
    return parseDoubleQuoted();
  };
}

/**
 * Parses a Sass map literal: `("k": v, ...)` into a Jess `Collection`.
 * (Only the map form is supported in this milestone; list literals come later.)
 */
export function scssMapLiteral(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();
    $.CONSUME($.T.LParen);

  const decls: Declaration[] = [];

  if ($.LA(1).tokenType !== $.T.RParen) {
    $.OPTION(() => {
      $.AT_LEAST_ONE_SEP({
        SEP: $.T.Comma,
        DEF: () => {
          const keyNode = $.SUBRULE($.value, { ARGS: [ctx] }) as unknown as Node;
          $.CONSUME($.T.Colon);
          const valueNode = $.SUBRULE($.valueSequence, { ARGS: [ctx] }) as unknown as Node;

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
      });
    });
  }

    $.CONSUME($.T.RParen);

    const location = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }
    const coll = new Collection(decls, undefined, location, $.context);
    return $.wrap(coll);
  };
}

/**
 * Override CSS `declaration` to add:
 *  - `$var: ...` SCSS variable declarations
 *  - Interpolated declaration names: `foo-#{$bar}: ...`
 */
export function declaration(this: P, T: TokenMap, alt?: AltContext) {
  const $ = this;
  const looksLikeInterpolatedDeclName = () => {
    for (let i = 1; i < 64; i++) {
      const tok = $.LA(i);
      if (tok.tokenType === $.T.Assign || tok.tokenType.name === 'EOF') {
        return false;
      }
      if (tok.tokenType === $.T.InterpolationStart) {
        return true;
      }
    }
    return false;
  };

  const parseVarDeclaration = (ctx: RuleContext = {}) => {
    $.startRule();

    const dv = $.CONSUME($.T.DollarVariable);
    const assign = $.CONSUME($.T.Assign);
    const value = $.SUBRULE($.valueList, { ARGS: [ctx] }) as unknown as Node;

    const { sawDefault, sawGlobal } = consumeScssVarFlags($);

    const location = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }

    const nameNode = $.wrap(
      new Any(dv.image.slice(1), { role: 'property' }, $.getLocationInfo(dv), $.context),
      true
    );

    return new VarDeclaration(
      { name: nameNode, value: $.wrap(value, 'both') },
      { assign: (sawDefault ? '?:' : assign.image) as any, setDefined: sawGlobal },
      location,
      $.context
    );
  };

  const parseInterpolatedDeclaration = (ctx: RuleContext = {}) => {
    $.startRule();

    let source = '';
    const replacements: Node[] = [];

    $.AT_LEAST_ONE({
      DEF: () => {
        if ($.RECORDING_PHASE) {
          $.OR([
            {
              ALT: () => {
                $.CONSUME($.T.InterpolationStart);
                $.SUBRULE($.valueSequence, { ARGS: [ctx] });
                $.CONSUME($.T.RCurly);
              }
            },
            { ALT: () => $.CONSUME($.T.PlainIdent) },
            { ALT: () => $.CONSUME($.T.Ident) },
            { ALT: () => $.CONSUME($.T.CustomProperty) },
            { ALT: () => $.CONSUME($.T.LegacyPropIdent) }
          ]);
          return;
        }

        if ($.LA(1).tokenType === $.T.InterpolationStart) {
          $.CONSUME($.T.InterpolationStart);
          const expr = $.SUBRULE($.valueSequence, { ARGS: [ctx] }) as unknown as Node;
          $.CONSUME($.T.RCurly);
          if (!$.RECORDING_PHASE) {
            source += INTERPOLATION_PLACEHOLDER;
            replacements.push(toNameInterpolationReplacement($, expr, $.getLocationFromNodes([expr])));
          }
          return;
        }

        let tok: IToken;
        if ($.isType($.T.PlainIdent)) {
          tok = $.CONSUME($.T.PlainIdent) as unknown as IToken;
        } else if ($.isType($.T.Ident)) {
          tok = $.CONSUME($.T.Ident) as unknown as IToken;
        } else if ($.isType($.T.CustomProperty)) {
          tok = $.CONSUME($.T.CustomProperty) as unknown as IToken;
        } else {
          tok = $.CONSUME($.T.LegacyPropIdent) as unknown as IToken;
        }
        if (!$.RECORDING_PHASE) {
          source += tok.image;
        }
      }
    });

    const assign = $.CONSUME($.T.Assign);
    let value!: Node;
    if ($.LA(1).tokenType === $.T.LCurly) {
      value = $.SUBRULE($.scssNestedPropertyCollection, { ARGS: [ctx] }) as unknown as Node;
    } else {
      const initialValue = $.SUBRULE($.valueList, { ARGS: [ctx] }) as unknown as Node;
      if ($.LA(1).tokenType === $.T.LCurly) {
        const nested = $.SUBRULE2($.scssNestedPropertyCollection, { ARGS: [ctx] }) as unknown as Node;
        value = new Sequence(
          [$.wrap(initialValue, true, ctx), nested],
          undefined,
          $.getLocationFromNodes([initialValue, nested]),
          $.context
        );
      } else {
        value = initialValue;
      }
    }
    let important: IToken | undefined;
    $.OPTION(() => {
      important = $.CONSUME($.T.Important);
    });

    const location = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }

    const nameNode = $.wrap(
      new Interpolated({ source, replacements }, { role: 'property' }, $.getLocationFromNodes(replacements), $.context),
      true
    );
    const isCustom = nameNode.valueOf().startsWith('--');
    const wrapCtx = isCustom ? { ...ctx, inCustomPropertyValue: true } : ctx;
    const DeclClass = isCustom ? CustomDeclaration : Declaration;
    return new DeclClass({
      name: nameNode,
      value: $.wrap(value, 'both', wrapCtx),
      important: important
        ? $.wrap(new Any(important.image, { role: 'flag' }, $.getLocationInfo(important), $.context), 'both')
        : undefined
    }, { assign: assign.image as any }, location, $.context);
  };

  const parseRegularDeclaration = (ctx: RuleContext = {}) => {
    $.startRule();

    let name!: IToken;
    if ($.isType($.T.PlainIdent)) {
      name = $.CONSUME($.T.PlainIdent) as unknown as IToken;
    } else if ($.isType($.T.Ident)) {
      name = $.CONSUME($.T.Ident) as unknown as IToken;
    } else {
      name = $.CONSUME($.T.LegacyPropIdent) as unknown as IToken;
    }

    const assign = $.CONSUME($.T.Assign);
    let value!: Node;
    if ($.LA(1).tokenType === $.T.LCurly) {
      value = $.SUBRULE3($.scssNestedPropertyCollection, { ARGS: [ctx] }) as unknown as Node;
    } else {
      const initialValue = $.SUBRULE($.valueList, { ARGS: [ctx] }) as unknown as Node;
      if ($.LA(1).tokenType === $.T.LCurly) {
        const nested = $.SUBRULE4($.scssNestedPropertyCollection, { ARGS: [ctx] }) as unknown as Node;
        value = new Sequence(
          [$.wrap(initialValue, true, ctx), nested],
          undefined,
          $.getLocationFromNodes([initialValue, nested]),
          $.context
        );
      } else {
        value = initialValue;
      }
    }
    let important: IToken | undefined;
    $.OPTION(() => {
      important = $.CONSUME($.T.Important);
    });

    const location = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }

    const nameNode = $.wrap(new Any(name.image, { role: 'property' }, $.getLocationInfo(name), $.context), true);
    return new Declaration({
      name: nameNode,
      value: $.wrap(value, 'both', ctx),
      important: important
        ? $.wrap(new Any(important.image, { role: 'flag' }, $.getLocationInfo(important), $.context), 'both')
        : undefined
    }, { assign: assign.image as any }, location, $.context);
  };

  const parseCustomPropertyDeclaration = (ctx: RuleContext = {}) => {
    $.startRule();

    const name = $.CONSUME($.T.CustomProperty);
    const assign = $.CONSUME2($.T.Assign);
    let nodes: Node[] | undefined;
    if (!$.RECORDING_PHASE) {
      nodes = [];
    }
    $.startRule();
    $.MANY(() => {
      const val = $.SUBRULE2($.customValue, { ARGS: [{ ...ctx, inCustomPropertyValue: true }] }) as unknown as Node;
      if (!$.RECORDING_PHASE) {
        nodes!.push(val);
      }
    });

    const valueLocation = $.endRule();
    const location = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }

    const nameNode = $.wrap(new Any(name.image, { role: 'property' }, $.getLocationInfo(name), $.context), true);
    const value = new Sequence(nodes!, undefined, valueLocation, $.context);
    return new CustomDeclaration({
      name: nameNode,
      value: $.wrap(value, 'both', { ...ctx, inCustomPropertyValue: true })
    }, { assign: assign.image as any }, location, $.context);
  };

  return (ctx: RuleContext = {}) => {
    if ($.RECORDING_PHASE) {
      $.OR([
        {
          GATE: () => $.LA(1).tokenType === $.T.DollarVariable,
          ALT: () => parseVarDeclaration(ctx)
        },
        {
          GATE: () => (
            (
              $.LA(1).tokenType === $.T.Ident
              || $.LA(1).tokenType === $.T.PlainIdent
              || $.LA(1).tokenType === $.T.CustomProperty
              || ($.legacyMode && $.LA(1).tokenType === $.T.LegacyPropIdent)
              || $.LA(1).tokenType === $.T.InterpolationStart
            ) && looksLikeInterpolatedDeclName()
          ),
          ALT: () => parseInterpolatedDeclaration(ctx)
        },
        {
          GATE: () => $.LA(1).tokenType === $.T.CustomProperty,
          ALT: () => parseCustomPropertyDeclaration(ctx)
        },
        {
          ALT: () => parseRegularDeclaration(ctx)
        }
      ]);
      return;
    }

    if ($.LA(1).tokenType === $.T.DollarVariable) {
      return parseVarDeclaration(ctx);
    }
    if (
      (
        $.LA(1).tokenType === $.T.Ident
        || $.LA(1).tokenType === $.T.PlainIdent
        || $.LA(1).tokenType === $.T.CustomProperty
        || ($.legacyMode && $.LA(1).tokenType === $.T.LegacyPropIdent)
        || $.LA(1).tokenType === $.T.InterpolationStart
      ) && looksLikeInterpolatedDeclName()
    ) {
      return parseInterpolatedDeclaration(ctx);
    }
    if ($.LA(1).tokenType === $.T.CustomProperty) {
      return parseCustomPropertyDeclaration(ctx);
    }
    return parseRegularDeclaration(ctx);
  };
}
