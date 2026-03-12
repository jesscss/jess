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
  valueAlt ??= (ctx: RuleContext = {}) => [
    {
      GATE: () => this.la(1).tokenType === this.T.LParen && looksLikeMapLiteral(this, this.T),
      ALT: () => this.scssMapLiteral(ctx)
    },
    {
      // SCSS interpolation in values: `#{$expr}`
      GATE: () => this.la(1).tokenType === this.T.InterpolationStart,
      ALT: () => {
        this.startRule();
        this.consume(this.T.InterpolationStart);
        const expr = this.valueSequence(ctx) as unknown as Node;
        this.consume(this.T.RCurly);
        const loc = this.endRule();
        return new Interpolated(
          { source: INTERPOLATION_PLACEHOLDER, replacements: [expr] },
          { role: 'any' },
          loc,
          this.context
        );
      }
    },
    {
      // Escaped SCSS module-qualified mixin "ruleset" call in value position:
      // `ns.\#foo(...)` or `ns.\.foo(...)`
      //
      // Tokenizes as: (PlainIdent/Ident) + Unknown('.') + Unknown('\\') + (HashName | DotName) + LParen ...
      GATE: () =>
        (this.la(1).tokenType === this.T.Ident || this.la(1).tokenType === this.T.PlainIdent)
        && this.la(2).tokenType === this.T.Unknown
        && this.la(2).image === '.'
        && this.la(3).tokenType === this.T.Unknown
        && this.la(3).image === '\\'
        && (this.la(4).tokenType === this.T.HashName || this.la(4).tokenType === this.T.DotName)
        && this.la(5).tokenType === this.T.LParen,
      ALT: () => {
        this.startRule();
        const nsTok = this.or([
          { GATE: () => this.la(1).tokenType === this.T.Ident, ALT: () => this.consume(this.T.Ident) },
          { ALT: () => this.consume(this.T.PlainIdent) }
        ]) as unknown as IToken;
        this.consume(this.T.Unknown); // '.'
        this.consume(this.T.Unknown); // '\'
        const member = this.or([
          { GATE: () => this.la(1).tokenType === this.T.HashName, ALT: () => this.consume(this.T.HashName) },
          { ALT: () => this.consume(this.T.DotName) }
        ]) as unknown as IToken;
        this.consume(this.T.LParen);
        let args: List | undefined;
        this.option(() => (args = this.functionCallArgs(ctx)));
        this.consume(this.T.RParen);
        const loc = this.endRule();
        const key = member.image.slice(1);
        const ref = makeNamespacedReference(this, [nsTok.image, key], 'mixin-ruleset');
        const call = new Call({ name: ref, args }, undefined, loc, this.context);
        return new Expression(call, undefined, loc, this.context);
      }
    },
    {
      // SCSS module-member variable: `ns.$var`
      GATE: () =>
        (this.la(1).tokenType === this.T.Ident || this.la(1).tokenType === this.T.PlainIdent)
        && this.la(2).tokenType === this.T.Unknown
        && this.la(2).image === '.'
        && this.la(3).tokenType === this.T.DollarVariable,
      ALT: () => {
        this.startRule();
        const nsTok = this.or([
          { GATE: () => this.la(1).tokenType === this.T.Ident, ALT: () => this.consume(this.T.Ident) },
          { ALT: () => this.consume(this.T.PlainIdent) }
        ]) as unknown as IToken;
        this.consume(this.T.Unknown); // '.'
        const dv = this.consume(this.T.DollarVariable);
        const loc = this.endRule();
        const ns = nsTok.image;
        const key = dv.image.slice(1);
        const nsRef = new Reference(ns, { type: 'variable' }, loc, this.context);
        const ref = new Reference({ target: nsRef, key }, { type: 'variable' }, loc, this.context);
        return ref;
      }
    },
    {
      // SCSS module-qualified function call in value position: `ns.fn(...)`
      // Tokenizes as: PlainIdent/Ident + DotName(".fn") + LParen ...
      GATE: () =>
        (this.la(1).tokenType === this.T.Ident || this.la(1).tokenType === this.T.PlainIdent)
        && this.la(2).tokenType === this.T.DotName
        && this.la(3).tokenType === this.T.LParen,
      ALT: () => {
        this.startRule();
        const nsTok = this.or([
          { GATE: () => this.la(1).tokenType === this.T.Ident, ALT: () => this.consume(this.T.Ident) },
          { ALT: () => this.consume(this.T.PlainIdent) }
        ]) as unknown as IToken;
        const dot = this.consume(this.T.DotName); // ".fn"
        this.consume(this.T.LParen);
        let args: List | undefined;
        this.option(() => (args = this.functionCallArgs(ctx)));
        this.consume(this.T.RParen);
        const loc = this.endRule();
        const fnName = `${nsTok.image}.${dot.image.slice(1)}`;
        const call = new Call({ name: fnName, args }, undefined, loc, this.context);
        const maybe = desugarNamespacedCall(this, call);
        return new Expression(maybe, undefined, loc, this.context);
      }
    },
    { ALT: () => this.functionCall(ctx) },
    { ALT: () => this.consume(this.T.DollarVariable) },
    { ALT: () => this.consume(this.T.Ident) },
    { ALT: () => this.consume(this.T.Dimension) },
    { ALT: () => this.consume(this.T.Number) },
    { ALT: () => this.consume(this.T.Color) },
    { ALT: () => this.consume(this.T.UnicodeRange) },
    { ALT: () => this.string(ctx) },
    { ALT: () => this.squareValue(ctx) },
    {
      GATE: () => this.legacyMode,
      ALT: () => this.consume(this.T.LegacyMSFilter)
    }
  ];

  this.startRule();
  let node = this.or(valueAlt!(ctx)) as unknown as Node | IToken;
  let additionalValue: Node | undefined;
  this.option(() => {
    this.consume(this.T.Slash);
    additionalValue = this.value(ctx);
  });
  const location = this.endRule();
  // Match CSS parser behavior: convert raw tokens into Nodes.
  if (!(node instanceof JessNode)) {
    node = this.processValueToken(node as IToken, ctx);
  }
  if (additionalValue) {
    return this.wrap(new List([this.wrap(node, true), additionalValue], { sep: '/' }, location, this.context));
  }
  return this.wrap(node);
}

/**
 * Override CSS functionCall to desugar module-qualified calls like `ns.fn(...)`.
 * We return an Expression(Call(Reference(ns.fn))) to match Less-style outer wrapping.
 */
export function functionCall(this: P, ctx: RuleContext = {}) {
  const node = cssFunctionCall.call(this, ctx) as unknown as Call;

  if (!isNode(node, N.Call)) {
    return node as unknown as any;
  }

  // First, keep existing Sass map.get() desugaring behavior.
  const mapped = desugarMapLookup(this, node);
  if (isNode(mapped, N.Reference)) {
    return mapped as unknown as any;
  }
  const call = mapped as Call;

  if (typeof call.value.name === 'string' && call.value.name === 'selector.parse') {
    const args = isNode(call.value.args, N.List) ? call.value.args.value : [];
    const firstArg = args[0];
    const loc: LocationInfo | undefined = Array.isArray(call.location) && call.location.length === 6
      ? (call.location as LocationInfo)
      : undefined;
    if (!firstArg || !isNode(firstArg, N.Quoted) || !isNode(firstArg.value, N.Any)) {
      throw new SyntaxError('selector.parse() requires a quoted selector string literal.');
    }
    const selectorText = String(firstArg.value.valueOf());
    const selector = parseSelectorListExpression(selectorText);
    return new SelectorCapture(selector, undefined, loc, this.context);
  }

  const maybe = desugarNamespacedCall(this, call);
  if (maybe !== call) {
    const loc: LocationInfo | undefined = Array.isArray(maybe.location) && maybe.location.length === 6
      ? (maybe.location as LocationInfo)
      : undefined;
    // Namespaced call: emit as Expression so it serializes like `$ns.func(...)`.
    return new Expression(maybe, undefined, loc, this.context);
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
      this.context
    );
    // Sass/Less plain function calls are not optional/silent-fail calls (no `?(` output).
    // Keep other call options if present, but drop `silentFail` coming from CSS fallback behavior.
    const { silentFail: silentFailIgnored, ...rest } = call.options ?? {};
    void silentFailIgnored;
    const nextOptions = Object.keys(rest).length > 0 ? rest : undefined;
    return new Call({ name: ref, args: call.value.args }, nextOptions, loc, this.context);
  }
  return call;
}

/**
 * Override CSS `string` to add SCSS string interpolation support.
 */
export function string(this: P, ctx: RuleContext = {}, stringAlt?: AltContext) {
  stringAlt ??= (ctx: RuleContext = {}) => [
    {
      ALT: () => {
        this.startRule();
        const quote = this.consume(this.T.SingleQuoteStart);

        let contents: IToken | undefined;
        this.option(() => (contents = this.consume(this.T.SingleQuoteStringContents)));

        this.consume(this.T.SingleQuoteEnd);
        const location = this.endRule();
        const raw = contents?.image ?? '';
        const inner = processScssStringInterpolation(raw, location, this.context);
        return new Quoted(inner as any, { quote: quote.image as '"' | '\'' }, location, this.context);
      }
    },
    {
      ALT: () => {
        this.startRule();
        const quote = this.consume(this.T.DoubleQuoteStart);

        let contents: IToken | undefined;
        this.option(() => (contents = this.consume(this.T.DoubleQuoteStringContents)));

        this.consume(this.T.DoubleQuoteEnd);
        const location = this.endRule();
        const raw = contents?.image ?? '';
        const inner = processScssStringInterpolation(raw, location, this.context);
        return new Quoted(inner as any, { quote: quote.image as '"' | '\'' }, location, this.context);
      }
    }
  ];

  return this.or(stringAlt!(ctx));
}

/**
 * Parses a Sass map literal: `("k": v, ...)` into a Jess `Collection`.
 * (Only the map form is supported in this milestone; list literals come later.)
 */
export function scssMapLiteral(this: P, ctx: RuleContext = {}) {
  this.startRule();
  this.consume(this.T.LParen);

  const decls: Declaration[] = [];

  if (this.la(1).tokenType !== this.T.RParen) {
    this.option(() => {
      this.atLeastOneSep({
        SEP: this.T.Comma,
        DEF: () => {
          const keyNode = this.value(ctx);
          this.consume(this.T.Colon);
          const valueNode = this.valueSequence(ctx);

          const keyStr = toDeclKey(keyNode);
          const declName = new Any(keyStr, { role: 'property' });
          const decl = new Declaration(
            { name: declName, value: valueNode },
            undefined,
            this.getLocationFromNodes([keyNode, valueNode]),
            this.context
          );
          decls.push(decl);
        }
      });
    });
  }

  this.consume(this.T.RParen);

  const location = this.endRule();
  const coll = new Collection(decls, undefined, location, this.context);
  return this.wrap(coll);
}

/**
 * Override CSS `declaration` to add:
 *  - `$var: ...` SCSS variable declarations
 *  - Interpolated declaration names: `foo-#{$bar}: ...`
 */
export function declaration(this: P, ctx: RuleContext = {}, alt?: AltContext) {
  // Inline the CSS declaration production (rather than calling it) so we can
  // add `$var: ...` without Chevrotain "numerical suffix" conflicts.

  const looksLikeInterpolatedDeclName = () => {
    // Look ahead until ':' and see if we encounter `#{`.
    // This keeps the fast path for normal CSS declarations.
    for (let i = 1; i < 64; i++) {
      const tok = this.la(i);
      if (tok.tokenType === this.T.Assign || tok.tokenType.name === 'EOF') {
        return false;
      }
      if (tok.tokenType === this.T.InterpolationStart) {
        return true;
      }
    }
    return false;
  };

  alt ??= (ctx: RuleContext = {}) => [
    {
      // SCSS variable declaration: `$x: ... [!default] [!global]`
      GATE: () => this.la(1).tokenType === this.T.DollarVariable,
      ALT: () => {
        const dv = this.consume(this.T.DollarVariable);
        const assign = this.consume(this.T.Assign);
        const value = this.valueList(ctx);

        let sawDefault = false;
        let sawGlobal = false;
        this.many(() => {
          this.or([
            { ALT: () => {
              this.consume(this.T.SassDefault);
              sawDefault = true;
            } },
            { ALT: () => {
              this.consume(this.T.SassGlobal);
              sawGlobal = true;
            } }
          ]);
        });

        const nameNode = this.wrap(
          new Any(dv.image.slice(1), { role: 'property' }, this.getLocationInfo(dv), this.context),
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
          this.la(1).tokenType === this.T.Ident
          || this.la(1).tokenType === this.T.CustomProperty
          || (this.legacyMode && this.la(1).tokenType === this.T.LegacyPropIdent)
          || this.la(1).tokenType === this.T.InterpolationStart
        ) && looksLikeInterpolatedDeclName()
      ),
      ALT: () => {
        let source = '';
        const replacements: Node[] = [];

        this.atLeastOne({
          DEF: () => {
            this.or([
              {
                GATE: () => this.la(1).tokenType === this.T.InterpolationStart,
                ALT: () => {
                  this.consume(this.T.InterpolationStart);
                  const expr = this.valueSequence(ctx) as unknown as Node;
                  this.consume(this.T.RCurly);
                  source += INTERPOLATION_PLACEHOLDER;
                  replacements.push(toNameInterpolationReplacement(this, expr, this.getLocationFromNodes([expr])));
                }
              },
              {
                ALT: () => {
                  const tok = this.or([
                    { ALT: () => this.consume(this.T.Ident) },
                    { ALT: () => this.consume(this.T.CustomProperty) },
                    {
                      GATE: () => this.legacyMode,
                      ALT: () => this.consume(this.T.LegacyPropIdent)
                    }
                  ]) as unknown as IToken;
                  source += tok.image;
                }
              }
            ]);
          }
        });

        const assign = this.consume(this.T.Assign);
        const value = this.valueList(ctx);
        let important: IToken | undefined;
        this.option(() => {
          important = this.consume(this.T.Important);
        });

        const nameNode = this.wrap(
          new Interpolated({ source, replacements }, { role: 'property' }, this.getLocationFromNodes(replacements), this.context),
          true
        );
        return [nameNode, assign, value, important] as const;
      }
    },
    {
      ALT: () => {
        let name!: IToken;
        this.or([
          { ALT: () => (name = this.consume(this.T.Ident)) },
          {
            GATE: () => this.legacyMode,
            ALT: () => (name = this.consume(this.T.LegacyPropIdent))
          }
        ]);
        const assign = this.consume(this.T.Assign);
        const value = this.valueList(ctx);
        let important: IToken | undefined;
        this.option(() => {
          important = this.consume(this.T.Important);
        });
        const nameNode = this.wrap(new Any(name.image, { role: 'property' }, this.getLocationInfo(name), this.context), true);
        return [nameNode, assign, value, important] as const;
      }
    },
    {
      ALT: () => {
        const name = this.consume(this.T.CustomProperty);
        const assign = this.consume(this.T.Assign);
        let nodes: Node[] = [];
        this.startRule();
        this.many(() => {
          const val = this.customValue({ ...ctx, inCustomPropertyValue: true });
          nodes.push(val);
        });
        const location = this.endRule();
        const nameNode = this.wrap(new Any(name.image, { role: 'property' }, this.getLocationInfo(name), this.context), true);
        const value = new Sequence(nodes, undefined, location, this.context);
        return [nameNode, assign, value] as const;
      }
    }
  ];

  this.startRule();
  let name: Any<'property'> | Interpolated<'property'> | undefined;
  let assign: IToken | undefined;
  let value: Node | undefined;
  let important: IToken | undefined;
  let kind: 'scss-var' | 'css-decl' | 'css-custom' | undefined;
  let sawDefault = false;
  let sawGlobal = false;

  const picked = this.or(alt!(ctx) as any);

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

  const location = this.endRule();

  if (kind === 'scss-var') {
    // Semicolon is consumed by the main production (like Less), not here
    return new VarDeclaration(
      { name: name!, value: this.wrap(value!, 'both') },
      {
        assign: (sawDefault ? '?:' : assign!.image) as AssignmentType,
        setDefined: sawGlobal
      },
      location,
      this.context
    );
  }

  // Match CSS parser behavior: return Declaration / CustomDeclaration.
  const isCustom = String(name!.valueOf()).startsWith('--');
  return new (isCustom ? CustomDeclaration : Declaration)({
    name: name!,
    value: this.wrap(value!, 'both'),
    important: important ? this.wrap(new Any(important.image, { role: 'flag' }, this.getLocationInfo(important), this.context), 'both') : undefined
  }, { assign: assign!.image as AssignmentType }, location, this.context);
}
