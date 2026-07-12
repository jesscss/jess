// Selector-related production rules for ScssRecursiveParser
// Converted from Chevrotain-based productions.ts

import type { RuleContext } from '../scssRecursiveParser.js';
import type { IToken } from '@jesscss/parser';
import {
  Node,
  Any,
  Ampersand,
  BasicSelector,
  CompoundSelector,
  Interpolated,
  INTERPOLATION_PLACEHOLDER,
  type SimpleSelector
} from '@jesscss/core';

import { toNameInterpolationReplacement } from './helpers.js';

/** Use `any` for `this` to avoid structural incompatibility */
type P = any;

type Alt = Array<{ ALT: () => any; GATE?: () => boolean }>;
type AltContext = (ctx?: RuleContext) => Alt;

/**
 * Override CSS `simpleSelector` to add placeholder selector support (`%foo`).
 */
export function simpleSelector(this: P, ctx: RuleContext = {}, selectorAlt?: AltContext) {
  const $ = this;
  selectorAlt ??= (ctx: RuleContext = {}) => [
    { ALT: () => $.CONSUME($.T.Ident) },
    { GATE: () => !!ctx.inner, ALT: () => $.CONSUME($.T.Ampersand) },
    { ALT: () => $.classSelector(ctx) },
    { ALT: () => $.idSelector(ctx) },
    // Placeholder selector: `%foo`
    { ALT: () => $.CONSUME($.T.PlaceholderSelector) },
    { ALT: () => $.CONSUME($.T.Star) },
    { ALT: () => $.pseudoSelector(ctx) },
    { ALT: () => $.attributeSelector(ctx) },
    { ALT: () => $.CONSUME($.T.DimensionInt) },
    { ALT: () => $.CONSUME($.T.DimensionNum) }
  ];

  const selector = $.OR(selectorAlt(ctx));

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
  return selector as unknown as Node;
}

/**
 * Override CSS `main` to allow root-level SCSS variable declarations (`$x: ...;`).
 */
export function main(this: P, ctx: RuleContext = {}, alt?: AltContext) {
  const $ = this;
  alt ??= (ctx: RuleContext = {}) => [
    // Allow root-level SCSS variable declarations ($x: ...)
    { ALT: () => $.declaration(ctx) },
    { ALT: () => $.qualifiedRule() },
    { ALT: () => $.atRule() },
    // Allow stray semicolons at root.
    { ALT: () => $.CONSUME($.T.Semi) }
  ];

  if (ctx.isRoot) {
    $.resetGeneratedState();
  }

  let rules: Node[] = [];
  let requiredSemi = false;
  let lastRule: Node | undefined;

  $.MANY({
    GATE: () => !requiredSemi || (requiredSemi && (
      $.LA(1).tokenType === $.T.Semi
      || $.LA(0).tokenType === $.T.Semi
    )),
    DEF: () => {
      const localAlt = typeof alt === 'function' ? alt(ctx) : alt!;
      const value = $.OR(localAlt);
      if (!(value instanceof Node)) {
        if (lastRule) {
          lastRule.options.semi = true;
        } else {
          rules.push(new Any(';', { role: 'semi' }, $.getLocationInfo($.LA(1)), $.context));
        }
        return;
      }

      const pending = $.consumePendingNodes();
      if (pending.length) {
        rules.push(...pending);
      }
      requiredSemi = !!value.requiredSemi;
      rules.push(value);
      lastRule = value;
    }
  });

  const withComments = $.getRulesWithComments(rules, $.getLocationInfo($.LA(1)));
  return $.wrap(withComments, true);
}

/**
 * Override CSS `compoundSelector` to support SCSS interpolation `#{ ... }` inside selectors.
 *
 * Example: `.foo-#{$bar}` becomes an `Interpolated` selector value.
 */
export function compoundSelector(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();

  let selectors: SimpleSelector[] = [];
  let source = '';
  const replacements: Node[] = [];

  const appendTokenSpan = (startTokenOffset: number, endTokenOffset: number) => {
    const origTokens = $.originalInput as IToken[];
    let out = '';
    for (const tok of origTokens) {
      if (tok.startOffset < startTokenOffset) {
        continue;
      }
      if (tok.startOffset > endTokenOffset) {
        break;
      }
      out += tok.image;
    }
    source += out;
  };

  // First atom is required.
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
        const startTokenOffset = $.LA(1).startOffset;
        const sel = $.simpleSelector(ctx) as unknown as SimpleSelector;
        const endTokenOffset = $.LA(0).startOffset;
        selectors.push(sel);
        appendTokenSpan(startTokenOffset, endTokenOffset);
      }
    }
  ]);

  // Additional atoms only when there's no whitespace.
  $.MANY({
    GATE: () => !$.hasWS(),
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
            const startTokenOffset = $.LA(1).startOffset;
            const sel = $.simpleSelector(ctx) as unknown as SimpleSelector;
            const endTokenOffset = $.LA(0).startOffset;
            selectors.push(sel);
            appendTokenSpan(startTokenOffset, endTokenOffset);
          }
        }
      ]);
    }
  });

  const location = $.endRule();
  if (replacements.length > 0) {
    return new Interpolated({ source, replacements }, { role: 'ident' }, location, $.context);
  }
  if (selectors.length === 1) {
    return selectors[0]!;
  }
  return new CompoundSelector(selectors, undefined, location, $.context);
}

/**
 * Override CSS `layerName` to support SCSS interpolation `#{ ... }` inside layer names.
 *
 * Example: `foo-#{$bar}` becomes an `Interpolated` node.
 */
export function layerName(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  let source: string | undefined;
  let replacements: Node[] | undefined;

  const takeIdent = (tok: IToken) => {
    source ??= '';
    source += tok.image;
  };

  const takeInterpolation = (expr: Node) => {
    source ??= '';
    replacements ??= [];
    source += INTERPOLATION_PLACEHOLDER;
    replacements.push(expr);
  };

  // First segment
  $.OR([
    {
      GATE: () => $.LA(1).tokenType === $.T.InterpolationStart,
      ALT: () => {
        $.CONSUME($.T.InterpolationStart);
        const expr = $.valueSequence(ctx) as unknown as Node;
        $.CONSUME($.T.RCurly);
        takeInterpolation(expr);
      }
    },
    {
      ALT: () => {
        const tok = $.OR([
          { GATE: () => $.LA(1).tokenType === $.T.Ident, ALT: () => $.CONSUME($.T.Ident) },
          { ALT: () => $.CONSUME($.T.PlainIdent) }
        ]) as unknown as IToken;
        takeIdent(tok);
      }
    }
  ]);

  // Additional segments with no whitespace (e.g. `foo-#{$bar}`)
  $.MANY({
    GATE: () =>
      !$.hasWS()
      && $.LA(1).tokenType !== $.T.LCurly
      && $.LA(1).tokenType !== $.T.Comma
      && $.LA(1).tokenType !== $.T.Semi
      && $.LA(1).tokenType.name !== 'EOF',
    DEF: () => {
      $.OR([
        {
          GATE: () => $.LA(1).tokenType === $.T.InterpolationStart,
          ALT: () => {
            $.CONSUME($.T.InterpolationStart);
            const expr = $.valueSequence(ctx) as unknown as Node;
            $.CONSUME($.T.RCurly);
            takeInterpolation(expr);
          }
        },
        {
          ALT: () => {
            const tok = $.OR([
              { GATE: () => $.LA(1).tokenType === $.T.Ident, ALT: () => $.CONSUME($.T.Ident) },
              { ALT: () => $.CONSUME($.T.PlainIdent) }
            ]) as unknown as IToken;
            takeIdent(tok);
          }
        }
      ]);
    }
  });

  const loc = $.endRule();
  if (replacements?.length) {
    return new Interpolated({ source: source ?? '', replacements }, { role: 'any' }, loc, $.context);
  }
  return new Any(source ?? '', { role: 'ident' }, loc, $.context);
}
