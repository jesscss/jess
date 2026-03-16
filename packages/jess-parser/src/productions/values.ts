import type { JessRuleContext as RuleContext } from '../jessRecursiveParser.js';
import type { IToken } from '@jesscss/parser';
import { ScssRecursiveParser } from '@jesscss/scss-parser';
import {
  Call,
  Expression,
  List,
  Reference,
  type Node
} from '@jesscss/core';

/** Use `any` for `this` to avoid structural incompatibility */
type P = any;

type AltContext = (ctx?: RuleContext) => Array<{ ALT: () => any; GATE?: () => boolean }>;

const scssValue = ScssRecursiveParser.prototype.value as Function;

/**
 * `$(expr)` → Expression node (serializes as `$(...)`)
 * Uses mathSum to handle arithmetic like `$(1 + 1)`.
 */
export function jessParenExpression(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();

  $.CONSUME($.T.DollarParen); // $( — paren is part of the token
  const inner = $.mathSum(ctx) as unknown as Node;
  $.CONSUME($.T.RParen);

  const loc = $.endRule();
  return new Expression(inner, undefined, loc, $.context);
}

/**
 * `$var` with optional accessor chain `.prop`, `[idx]`, `.method(args)`.
 * Returns a Reference for plain `$var` or a nested Reference/Call for chains.
 */
export function jessVarWithAccessors(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();

  const dvTok = $.CONSUME($.T.DollarVariable) as unknown as IToken;
  const dvLoc = $.getLocationInfo(dvTok);
  let node: Node = new Reference(dvTok.image.slice(1), { type: 'variable' }, dvLoc, $.context);

  // Accessor chain — no whitespace allowed between parts
  while ($.noSep() && ($.LA(1).tokenType === $.T.DotName || $.LA(1).tokenType === $.T.LSquare)) {
    if ($.LA(1).tokenType === $.T.DotName) {
      const dotTok = $.CONSUME($.T.DotName) as unknown as IToken;
      const propName = dotTok.image.slice(1); // strip leading '.'
      const propLoc = $.getLocationInfo(dotTok);

      if ($.noSep() && $.LA(1).tokenType === $.T.LParen) {
        // Method call: `.method(args)`
        $.startRule();
        $.CONSUME($.T.LParen);
        const args: Node[] = [];
        $.OPTION(() => {
          $.AT_LEAST_ONE_SEP({
            SEP: $.T.Comma,
            DEF: () => {
              args.push($.valueList(ctx) as unknown as Node);
            }
          });
        });
        $.CONSUME($.T.RParen);
        const callLoc = $.endRule();
        const propRef = new Reference(
          { target: node as any, key: propName },
          { type: 'property' },
          propLoc,
          $.context
        );
        node = new Call({ name: propRef, args: new List(args) }, undefined, callLoc, $.context);
      } else {
        // Property access: `node.prop`
        node = new Reference(
          { target: node as any, key: propName },
          { type: 'property' },
          propLoc,
          $.context
        );
      }
    } else {
      // Index access: `[idx]`
      $.startRule();
      $.CONSUME($.T.LSquare);
      const idx = $.valueList(ctx) as unknown as Node;
      $.CONSUME($.T.RSquare);
      const idxLoc = $.endRule();
      node = new Reference(
        { target: node as any, key: idx as any },
        { type: 'index' },
        idxLoc,
        $.context
      );
    }
  }

  $.endRule();
  return $.wrap(node);
}

/**
 * Override SCSS `value` to add Jess-specific alternatives before SCSS defaults.
 *
 * - `$(expr)` → Expression
 * - `$var.prop` / `$var[idx]` / `$var.method(args)` → Reference/Call chain
 */
export function value(this: P, ctx: RuleContext = {}, valueAlt?: AltContext) {
  const $ = this;

  // Jess: $(expr)
  if ($.LA(1).tokenType === $.T.DollarParen) {
    return $.jessParenExpression(ctx);
  }

  // Jess: $var with immediate accessor (no whitespace)
  if (
    $.LA(1).tokenType === $.T.DollarVariable
    && $.noSep(1)
    && ($.LA(2).tokenType === $.T.DotName || $.LA(2).tokenType === $.T.LSquare)
  ) {
    return $.jessVarWithAccessors(ctx);
  }

  // Fall through to SCSS (handles plain $var, maps, interpolation, ident, etc.)
  return scssValue.call($, ctx, valueAlt);
}
