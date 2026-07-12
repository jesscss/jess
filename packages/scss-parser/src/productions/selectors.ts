// Selector-related production rules for ScssRecursiveParser
// Converted from Chevrotain-based productions.ts

import type { RuleContext, TokenMap } from '../scssRecursiveParser.js';
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
type ProductionRule = (ctx?: RuleContext) => any;

type Alt = Array<{ ALT: () => any; GATE?: () => boolean }>;
type AltContext = (ctx?: RuleContext) => Alt;

/**
 * Override CSS `simpleSelector` to add placeholder selector support (`%foo`).
 */
export function simpleSelector(this: P, T: TokenMap, selectorAlt?: AltContext): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    selectorAlt ??= (ctx: RuleContext = {}) => [
      { ALT: () => $.CONSUME($.T.Ident) },
      { GATE: () => !!ctx.inner, ALT: () => $.CONSUME($.T.Ampersand) },
      { ALT: () => $.SUBRULE($.classSelector, { ARGS: [ctx] }) },
      { ALT: () => $.SUBRULE($.idSelector, { ARGS: [ctx] }) },
      // Placeholder selector: `%foo`
      { ALT: () => $.CONSUME($.T.PlaceholderSelector) },
      { ALT: () => $.CONSUME($.T.Star) },
      { ALT: () => $.SUBRULE($.pseudoSelector, { ARGS: [ctx] }) },
      { ALT: () => $.SUBRULE($.attributeSelector, { ARGS: [ctx] }) },
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
  };
}

/**
 * Override CSS `main` to allow root-level SCSS variable declarations (`$x: ...;`).
 */
export function main(this: P, T: TokenMap, alt?: AltContext): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const isRootVarDeclarationStart = () => $.LA(1).tokenType === $.T.DollarVariable;
    alt ??= (ctx: RuleContext = {}) => [
      // Allow root-level SCSS variable declarations ($x: ...)
      { GATE: isRootVarDeclarationStart, ALT: () => $.SUBRULE($.declaration, { ARGS: [ctx] }) },
      { ALT: () => $.SUBRULE($.qualifiedRule, { ARGS: [ctx] }) },
      { ALT: () => $.SUBRULE($.atRule, { ARGS: [ctx] }) },
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
        let value: unknown;
        if ($.RECORDING_PHASE) {
          const localAlt = typeof alt === 'function' ? alt(ctx) : alt!;
          value = $.OR(localAlt);
        } else if ($.LA(1).tokenType === $.T.Semi) {
          value = $.CONSUME($.T.Semi);
        } else if ($.isTypeAt(1, $.T.AtName)) {
          value = $.SUBRULE($.atRule, { ARGS: [ctx] });
        } else if (isRootVarDeclarationStart()) {
          value = $.SUBRULE($.declaration, { ARGS: [ctx] });
        } else {
          value = $.SUBRULE($.qualifiedRule, { ARGS: [ctx] });
        }
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
    return withComments;
  };
}

/**
 * Override CSS `declarationList` so `PlainIdent`-started property names route
 * to declarations instead of being treated as nested qualified rules.
 */
export function declarationList(this: P, T: TokenMap, alt?: AltContext): ProductionRule {
  const $ = this;
  const isInterpolatedDeclarationStart = () => {
    if ($.LA(1).tokenType !== $.T.InterpolationStart) {
      return false;
    }
    for (let i = 2; i < 64; i++) {
      const tokenType = $.LA(i).tokenType;
      if (tokenType === $.T.Assign || tokenType === $.T.Colon) {
        return true;
      }
      if (
        tokenType === $.T.Semi
        || tokenType === $.T.LCurly
        || tokenType.name === 'EOF'
      ) {
        return false;
      }
    }
    return false;
  };

  /**
   * SCSS declaration-list routing: use proper GATE/ALT pattern so
   * Chevrotain can analyze all paths during recording phase.
   */
  alt ??= (ctx: RuleContext = {}) => [
    { ALT: () => $.SUBRULE($.innerAtRule, { ARGS: [{ ...ctx, inner: true }] }) },
    {
      GATE: isInterpolatedDeclarationStart,
      ALT: () => $.SUBRULE($.declaration, { ARGS: [ctx] })
    },
    {
      GATE: () => $.shouldTryQualifiedRuleInDeclarationList(),
      ALT: () => $.SUBRULE($.qualifiedRule, { ARGS: [{ ...ctx, inner: true }] })
    },
    { ALT: () => $.SUBRULE($.declaration, { ARGS: [ctx] }) },
    { ALT: () => $.CONSUME($.T.Semi) }
  ];

  return (ctx: RuleContext = {}) => {
    const rules: Node[] = [];
    let lastRule: Node | undefined;

    $.MANY(() => {
      let value: unknown = $.OR(alt!(ctx));

      if (!(value instanceof Node)) {
        if (lastRule) {
          lastRule.options.semi = true;
        } else if (!$.RECORDING_PHASE) {
          rules.push(new Any(';', { role: 'semi' }, $.getLocationInfo($.LA(1)), $.context));
        }
        return;
      }

      if (!$.RECORDING_PHASE) {
        const pending = $.consumePendingNodes();
        if (pending.length) {
          rules.push(...pending);
        }
        rules.push(value);
        lastRule = value;
      }
    });

    if ($.RECORDING_PHASE) {
      return;
    }

    const withComments = $.getRulesWithComments(rules, $.getLocationInfo($.LA(1)));
    return withComments;
  };
}

/**
 * Override CSS `compoundSelector` to support SCSS interpolation `#{ ... }` inside selectors.
 *
 * Example: `.foo-#{$bar}` becomes an `Interpolated` selector value.
 */
export function compoundSelector(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
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
          const expr = $.SUBRULE($.valueSequence, { ARGS: [ctx] }) as unknown as Node;
          $.CONSUME($.T.RCurly);
          source += INTERPOLATION_PLACEHOLDER;
          replacements.push(toNameInterpolationReplacement($, expr, $.getLocationFromNodes([expr])));
        }
      },
      {
        ALT: () => {
          const startTokenOffset = $.LA(1).startOffset;
          const sel = $.SUBRULE($.simpleSelector, { ARGS: [ctx] }) as unknown as SimpleSelector;
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
              const expr = $.SUBRULE($.valueSequence, { ARGS: [ctx] }) as unknown as Node;
              $.CONSUME($.T.RCurly);
              source += INTERPOLATION_PLACEHOLDER;
              replacements.push(toNameInterpolationReplacement($, expr, $.getLocationFromNodes([expr])));
            }
          },
          {
            ALT: () => {
              const startTokenOffset = $.LA(1).startOffset;
              const sel = $.SUBRULE($.simpleSelector, { ARGS: [ctx] }) as unknown as SimpleSelector;
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
  };
}

/**
 * Override CSS `layerName` to support SCSS interpolation `#{ ... }` inside layer names.
 *
 * Example: `foo-#{$bar}` becomes an `Interpolated` node.
 */
export function layerName(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
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

    const consumeSegment = () => {
      if ($.RECORDING_PHASE) {
        $.OR([
          {
            ALT: () => {
              $.CONSUME($.T.InterpolationStart);
              $.SUBRULE($.valueSequence, { ARGS: [ctx] });
              $.CONSUME($.T.RCurly);
            }
          },
          { ALT: () => $.CONSUME($.T.Ident) },
          { ALT: () => $.CONSUME($.T.PlainIdent) }
        ]);
        return;
      }

      if ($.LA(1).tokenType === $.T.InterpolationStart) {
        $.CONSUME($.T.InterpolationStart);
        const expr = $.SUBRULE($.valueSequence, { ARGS: [ctx] }) as unknown as Node;
        $.CONSUME($.T.RCurly);
        takeInterpolation(expr);
        return;
      }

      const tok = $.isType($.T.Ident)
        ? ($.CONSUME($.T.Ident) as unknown as IToken)
        : ($.CONSUME($.T.PlainIdent) as unknown as IToken);
      takeIdent(tok);
    };

    consumeSegment();

    // Additional segments with no whitespace (e.g. `foo-#{$bar}`)
    $.MANY({
      GATE: () =>
        !$.hasWS()
        && $.LA(1).tokenType !== $.T.LCurly
        && $.LA(1).tokenType !== $.T.Comma
        && $.LA(1).tokenType !== $.T.Semi
        && $.LA(1).tokenType.name !== 'EOF',
      DEF: () => {
        consumeSegment();
      }
    });

    const loc = $.endRule();
    if (replacements?.length) {
      return new Interpolated({ source: source ?? '', replacements }, { role: 'any' }, loc, $.context);
    }
    return new Any(source ?? '', { role: 'ident' }, loc, $.context);
  };
}
