// Value-related production rules for ScssRecursiveParser
// Converted from Chevrotain-based productions.ts
import type { RuleContext } from '../scssRecursiveParser.js';
import type { IToken } from '@jesscss/parser-runtime';
import { CssRecursiveParser } from '@jesscss/css-parser';
import {
  Any,
  Call,
  Collection,
  CustomDeclaration,
  Declaration,
  Expression,
  Interpolated,
  INTERPOLATION_PLACEHOLDER,
  type AssignmentType,
  type LocationInfo,
  type Node,
  List,
  Quoted,
  Reference,
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
const cssFunctionCall = CssRecursiveParser.prototype.functionCall;

/**
 * Override CSS `value` to add SCSS interpolation, map literals, and
 * module-qualified references.
 */
export function value(this: P, ctx: RuleContext = {}, valueAlt?: AltContext) {
  const $ = this;
  valueAlt ??= (ctx: RuleContext = {}) => [
    {
      GATE: () => $.LA(1).tokenType === $.T.LParen && looksLikeMapLiteral($, $.T),
      ALT: () => $.scssMapLiteral(ctx)
    },
    {
      // SCSS interpolation in values: `#{$expr}`
      GATE: () => $.LA(1).tokenType === $.T.InterpolationStart,
      ALT: () => {
        $.startRule();
        $.CONSUME($.T.InterpolationStart);
        const expr = $.valueSequence(ctx) as unknown as Node;
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
      // Escaped SCSS module-qualified mixin "ruleset" call in value position:
      // `ns.\#foo(...)` or `ns.\.foo(...)`
      //
      // Tokenizes as: (PlainIdent/Ident) + Unknown('.') + Unknown('\\') + (HashName | DotName) + LParen ...
      GATE: () =>
        ($.LA(1).tokenType === $.T.Ident || $.LA(1).tokenType === $.T.PlainIdent)
        && $.LA(2).tokenType === $.T.Unknown
        && $.LA(2).image === '.'
        && $.LA(3).tokenType === $.T.Unknown
        && $.LA(3).image === '\\'
        && ($.LA(4).tokenType === $.T.HashName || $.LA(4).tokenType === $.T.DotName)
        && $.LA(5).tokenType === $.T.LParen,
      ALT: () => {
        $.startRule();
        const nsTok = $.OR([
          { GATE: () => $.LA(1).tokenType === $.T.Ident, ALT: () => $.CONSUME($.T.Ident) },
          { ALT: () => $.CONSUME($.T.PlainIdent) }
        ]) as unknown as IToken;
        $.CONSUME($.T.Unknown); // '.'
        $.CONSUME($.T.Unknown); // '\'
        const member = $.OR([
          { GATE: () => $.LA(1).tokenType === $.T.HashName, ALT: () => $.CONSUME($.T.HashName) },
          { ALT: () => $.CONSUME($.T.DotName) }
        ]) as unknown as IToken;
        $.CONSUME($.T.LParen);
        let args: List | undefined;
        $.OPTION(() => (args = $.functionCallArgs(ctx)));
        $.CONSUME($.T.RParen);
        const loc = $.endRule();
        const key = member.image.slice(1);
        const ref = makeNamespacedReference($, [nsTok.image, key], 'mixin-ruleset');
        const call = new Call({ name: ref, args }, undefined, loc, $.context);
        return new Expression(call, undefined, loc, $.context);
      }
    },
    {
      // SCSS module-member variable: `ns.$var`
      GATE: () =>
        ($.LA(1).tokenType === $.T.Ident || $.LA(1).tokenType === $.T.PlainIdent)
        && $.LA(2).tokenType === $.T.Unknown
        && $.LA(2).image === '.'
        && $.LA(3).tokenType === $.T.DollarVariable,
      ALT: () => {
        $.startRule();
        const nsTok = $.OR([
          { GATE: () => $.LA(1).tokenType === $.T.Ident, ALT: () => $.CONSUME($.T.Ident) },
          { ALT: () => $.CONSUME($.T.PlainIdent) }
        ]) as unknown as IToken;
        $.CONSUME($.T.Unknown); // '.'
        const dv = $.CONSUME($.T.DollarVariable);
        const loc = $.endRule();
        const ns = nsTok.image;
        const key = dv.image.slice(1);
        const nsRef = new Reference(ns, { type: 'variable' }, loc, $.context);
        const ref = new Reference({ target: nsRef, key }, { type: 'variable' }, loc, $.context);
        return ref;
      }
    },
    {
      // SCSS module-qualified function call in value position: `ns.fn(...)`
      // Tokenizes as: PlainIdent/Ident + DotName(".fn") + LParen ...
      GATE: () =>
        ($.LA(1).tokenType === $.T.Ident || $.LA(1).tokenType === $.T.PlainIdent)
        && $.LA(2).tokenType === $.T.DotName
        && $.LA(3).tokenType === $.T.LParen,
      ALT: () => {
        $.startRule();
        const nsTok = $.OR([
          { GATE: () => $.LA(1).tokenType === $.T.Ident, ALT: () => $.CONSUME($.T.Ident) },
          { ALT: () => $.CONSUME($.T.PlainIdent) }
        ]) as unknown as IToken;
        const dot = $.CONSUME($.T.DotName); // ".fn"
        $.CONSUME($.T.LParen);
        let args: List | undefined;
        $.OPTION(() => (args = $.functionCallArgs(ctx)));
        $.CONSUME($.T.RParen);
        const loc = $.endRule();
        const fnName = `${nsTok.image}.${dot.image.slice(1)}`;
        const call = new Call({ name: fnName, args }, undefined, loc, $.context);
        const mapped = desugarMapLookup($, call);
        if (isNode(mapped, N.Reference)) {
          return new Expression(mapped as unknown as Node, undefined, loc, $.context);
        }
        const maybe = desugarNamespacedCall($, mapped as Call);
        return new Expression(maybe, undefined, loc, $.context);
      }
    },
    { ALT: () => $.functionCall(ctx) },
    { ALT: () => $.CONSUME($.T.DollarVariable) },
    { ALT: () => $.CONSUME($.T.Ident) },
    { ALT: () => $.CONSUME($.T.Dimension) },
    { ALT: () => $.CONSUME($.T.Number) },
    { ALT: () => $.CONSUME($.T.Color) },
    { ALT: () => $.CONSUME($.T.UnicodeRange) },
    { ALT: () => $.string(ctx) },
    { ALT: () => $.squareValue(ctx) },
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
    additionalValue = $.value(ctx);
  });
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

/**
 * Override CSS functionCall to desugar module-qualified calls like `ns.fn(...)`.
 * We return an Expression(Call(Reference(ns.fn))) to match Less-style outer wrapping.
 */
export function functionCall(this: P, ctx: RuleContext = {}) {
  const $ = this;
  const node = cssFunctionCall.call($, ctx) as unknown as Call;

  if (!isNode(node, N.Call)) {
    return node as unknown as any;
  }

  // First, keep existing Sass map.get() desugaring behavior.
  const mapped = desugarMapLookup($, node);
  if (isNode(mapped, N.Reference)) {
    return mapped as unknown as any;
  }
  const call = mapped as Call;

  if (typeof call.data.name === 'string' && call.data.name === 'selector.parse') {
    const args = isNode(call.data.args, N.List) ? call.data.args.data : [];
    const firstArg = args[0];
    const loc: LocationInfo | undefined = Array.isArray(call.location) && call.location.length === 6
      ? (call.location as LocationInfo)
      : undefined;
    if (!firstArg || !isNode(firstArg, N.Quoted) || !isNode(firstArg.data, N.Any)) {
      throw new SyntaxError('selector.parse() requires a quoted selector string literal.');
    }
    const selectorText = String(firstArg.data.valueOf());
    const selector = parseSelectorListExpression(selectorText);
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
  if (typeof call.data.name === 'string') {
    const loc: LocationInfo | undefined = Array.isArray(call.location) && call.location.length === 6
      ? (call.location as LocationInfo)
      : undefined;
    const ref = new Reference(
      { key: call.data.name },
      { type: 'function', fallbackValue: true },
      loc,
      $.context
    );
    // Sass/Less plain function calls are not optional/silent-fail calls (no `?(` output).
    // Keep other call options if present, but drop `silentFail` coming from CSS fallback behavior.
    const { silentFail: silentFailIgnored, ...rest } = call.options ?? {};
    void silentFailIgnored;
    const nextOptions = Object.keys(rest).length > 0 ? rest : undefined;
    return new Call({ name: ref, args: call.data.args }, nextOptions, loc, $.context);
  }
  return call;
}

/**
 * Override CSS `string` to add SCSS string interpolation support.
 */
export function string(this: P, ctx: RuleContext = {}, stringAlt?: AltContext) {
  const $ = this;
  stringAlt ??= (ctx: RuleContext = {}) => [
    {
      ALT: () => {
        $.startRule();
        const quote = $.CONSUME($.T.SingleQuoteStart);

        let contents: IToken | undefined;
        $.OPTION(() => (contents = $.CONSUME($.T.SingleQuoteStringContents)));

        $.CONSUME($.T.SingleQuoteEnd);
        const location = $.endRule();
        const raw = contents?.image ?? '';
        const inner = processScssStringInterpolation(raw, location, $.context);
        return new Quoted(inner as any, { quote: quote.image as '"' | '\'' }, location, $.context);
      }
    },
    {
      ALT: () => {
        $.startRule();
        const quote = $.CONSUME($.T.DoubleQuoteStart);

        let contents: IToken | undefined;
        $.OPTION(() => (contents = $.CONSUME($.T.DoubleQuoteStringContents)));

        $.CONSUME($.T.DoubleQuoteEnd);
        const location = $.endRule();
        const raw = contents?.image ?? '';
        const inner = processScssStringInterpolation(raw, location, $.context);
        return new Quoted(inner as any, { quote: quote.image as '"' | '\'' }, location, $.context);
      }
    }
  ];

  return $.OR(stringAlt!(ctx));
}

/**
 * Parses a Sass map literal: `("k": v, ...)` into a Jess `Collection`.
 * (Only the map form is supported in this milestone; list literals come later.)
 */
export function scssMapLiteral(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  $.CONSUME($.T.LParen);

  const decls: Declaration[] = [];

  if ($.LA(1).tokenType !== $.T.RParen) {
    $.OPTION(() => {
      $.AT_LEAST_ONE_SEP({
        SEP: $.T.Comma,
        DEF: () => {
          const keyNode = $.value(ctx);
          $.CONSUME($.T.Colon);
          const valueNode = $.valueSequence(ctx);

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
  const coll = new Collection(decls, undefined, location, $.context);
  return $.wrap(coll);
}

/**
 * Override CSS `declaration` to add:
 *  - `$var: ...` SCSS variable declarations
 *  - Interpolated declaration names: `foo-#{$bar}: ...`
 */
export function declaration(this: P, ctx: RuleContext = {}, alt?: AltContext) {
  const $ = this;
  // Inline the CSS declaration production (rather than calling it) so we can
  // add `$var: ...` without Chevrotain "numerical suffix" conflicts.

  const looksLikeInterpolatedDeclName = () => {
    // Look ahead until ':' and see if we encounter `#{`.
    // This keeps the fast path for normal CSS declarations.
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

  alt ??= (ctx: RuleContext = {}) => [
    {
      // SCSS variable declaration: `$x: ... [!default] [!global]`
      GATE: () => $.LA(1).tokenType === $.T.DollarVariable,
      ALT: () => {
        const dv = $.CONSUME($.T.DollarVariable);
        const assign = $.CONSUME($.T.Assign);
        const value = $.valueList(ctx);

        let sawDefault = false;
        let sawGlobal = false;
        $.MANY(() => {
          $.OR([
            { ALT: () => {
              $.CONSUME($.T.SassDefault);
              sawDefault = true;
            } },
            { ALT: () => {
              $.CONSUME($.T.SassGlobal);
              sawGlobal = true;
            } }
          ]);
        });

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
    },
    {
      // SCSS interpolated declaration name: `foo-#{$bar}: ...`, `#{$prop}: ...`, `--x-#{$y}: ...`
      GATE: () => (
        (
          $.LA(1).tokenType === $.T.Ident
          || $.LA(1).tokenType === $.T.CustomProperty
          || ($.legacyMode && $.LA(1).tokenType === $.T.LegacyPropIdent)
          || $.LA(1).tokenType === $.T.InterpolationStart
        )
        && looksLikeInterpolatedDeclName()
      ),
      ALT: () => {
        let source = '';
        const replacements: Node[] = [];

        $.AT_LEAST_ONE({
          DEF: () => {
            $.OR([
              {
                GATE: () => $.LA(1).tokenType === $.T.InterpolationStart,
                ALT: () => {
                  $.CONSUME($.T.InterpolationStart);
                  const expr = $.valueSequence(ctx) as unknown as Node;
                  $.CONSUME($.T.RCurly);
                  source += INTERPOLATION_PLACEHOLDER;
                  replacements.push(toNameInterpolationReplacement($, expr, $.getLocationFromNodes([expr])));
                }
              },
              {
                ALT: () => {
                  const tok = $.OR([
                    { ALT: () => $.CONSUME($.T.Ident) },
                    { ALT: () => $.CONSUME($.T.CustomProperty) },
                    {
                      GATE: () => $.legacyMode,
                      ALT: () => $.CONSUME($.T.LegacyPropIdent)
                    }
                  ]) as unknown as IToken;
                  source += tok.image;
                }
              }
            ]);
          }
        });

        const assign = $.CONSUME($.T.Assign);
        const value = $.valueList(ctx);
        let important: IToken | undefined;
        $.OPTION(() => {
          important = $.CONSUME($.T.Important);
        });

        const nameNode = $.wrap(
          new Interpolated({ source, replacements }, { role: 'property' }, $.getLocationFromNodes(replacements), $.context),
          true
        );
        return [nameNode, assign, value, important] as const;
      }
    },
    {
      ALT: () => {
        let name!: IToken;
        $.OR([
          { ALT: () => (name = $.CONSUME($.T.Ident)) },
          {
            GATE: () => $.legacyMode,
            ALT: () => (name = $.CONSUME($.T.LegacyPropIdent))
          }
        ]);
        const assign = $.CONSUME($.T.Assign);
        const value = $.valueList(ctx);
        let important: IToken | undefined;
        $.OPTION(() => {
          important = $.CONSUME($.T.Important);
        });
        const nameNode = $.wrap(new Any(name.image, { role: 'property' }, $.getLocationInfo(name), $.context), true);
        return [nameNode, assign, value, important] as const;
      }
    },
    {
      ALT: () => {
        const name = $.CONSUME($.T.CustomProperty);
        const assign = $.CONSUME($.T.Assign);
        let nodes: Node[] = [];
        $.startRule();
        $.MANY(() => {
          const val = $.customValue({ ...ctx, inCustomPropertyValue: true });
          nodes.push(val);
        });
        const location = $.endRule();
        const nameNode = $.wrap(new Any(name.image, { role: 'property' }, $.getLocationInfo(name), $.context), true);
        const value = new Sequence(nodes, undefined, location, $.context);
        return [nameNode, assign, value] as const;
      }
    }
  ];

  $.startRule();
  let name: Any<'property'> | Interpolated<'property'> | undefined;
  let assign: IToken | undefined;
  let value: Node | undefined;
  let important: IToken | undefined;
  let kind: 'scss-var' | 'css-decl' | 'css-custom' | undefined;
  let sawDefault = false;
  let sawGlobal = false;

  const picked = $.OR(alt!(ctx) as any);

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
