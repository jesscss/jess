// Selector-related production rules for ScssRecursiveParser
// Converted from Chevrotain-based productions.ts

import type { RuleContext } from '../scssRecursiveParser.js';
import type { IToken } from '@jesscss/parser-runtime';
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
  selectorAlt ??= (ctx: RuleContext = {}) => [
    { ALT: () => this.consume(this.T.Ident) },
    { GATE: () => !!ctx.inner, ALT: () => this.consume(this.T.Ampersand) },
    { ALT: () => this.classSelector(ctx) },
    { ALT: () => this.idSelector(ctx) },
    // Placeholder selector: `%foo`
    { ALT: () => this.consume(this.T.PlaceholderSelector) },
    { ALT: () => this.consume(this.T.Star) },
    { ALT: () => this.pseudoSelector(ctx) },
    { ALT: () => this.attributeSelector(ctx) },
    { ALT: () => this.consume(this.T.DimensionInt) },
    { ALT: () => this.consume(this.T.DimensionNum) }
  ];

  const selector = this.or(selectorAlt(ctx));

  if (this.isToken(selector)) {
    if (selector.tokenType.name === 'Ampersand') {
      return new Ampersand(undefined, undefined, this.getLocationInfo(selector), this.context);
    }
    if (selector.tokenType.name === 'PlaceholderSelector') {
      const name = `\\${selector.image.slice(1)}`;
      return new BasicSelector(name, undefined, this.getLocationInfo(selector), this.context);
    }
    return new BasicSelector(selector.image, undefined, this.getLocationInfo(selector), this.context);
  }
  return selector as unknown as Node;
}

/**
 * Override CSS `main` to allow root-level SCSS variable declarations (`$x: ...;`).
 */
export function main(this: P, ctx: RuleContext = {}, alt?: AltContext) {
  alt ??= (ctx: RuleContext = {}) => [
    // Allow root-level SCSS variable declarations ($x: ...)
    { ALT: () => this.declaration(ctx) },
    { ALT: () => this.qualifiedRule() },
    { ALT: () => this.atRule() },
    // Allow stray semicolons at root.
    { ALT: () => this.consume(this.T.Semi) }
  ];

  if (ctx.isRoot) {
    this.resetGeneratedState();
  }

  let rules: Node[] = [];
  let requiredSemi = false;
  let lastRule: Node | undefined;

  this.many({
    GATE: () => !requiredSemi || (requiredSemi && (
      this.la(1).tokenType === this.T.Semi
      || this.la(0).tokenType === this.T.Semi
    )),
    DEF: () => {
      const localAlt = typeof alt === 'function' ? alt(ctx) : alt!;
      const value = this.or(localAlt);
      if (!(value instanceof Node)) {
        if (lastRule) {
          lastRule.options.semi = true;
        } else {
          rules.push(new Any(';', { role: 'semi' }, this.getLocationInfo(this.la(1)), this.context));
        }
        return;
      }

      const pending = this.consumePendingNodes();
      if (pending.length) {
        rules.push(...pending);
      }
      requiredSemi = !!value.requiredSemi;
      rules.push(value);
      lastRule = value;
    }
  });

  const withComments = this.getRulesWithComments(rules, this.getLocationInfo(this.la(1)));
  return this.wrap(withComments, true);
}

/**
 * Override CSS `compoundSelector` to support SCSS interpolation `#{ ... }` inside selectors.
 *
 * Example: `.foo-#{$bar}` becomes an `Interpolated` selector value.
 */
export function compoundSelector(this: P, ctx: RuleContext = {}) {
  this.startRule();

  let selectors: SimpleSelector[] = [];
  let source = '';
  const replacements: Node[] = [];

  const appendTokenSpan = (startTokenOffset: number, endTokenOffset: number) => {
    const origTokens = this.originalInput as IToken[];
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
        const startTokenOffset = this.la(1).startOffset;
        const sel = this.simpleSelector(ctx) as unknown as SimpleSelector;
        const endTokenOffset = this.la(0).startOffset;
        selectors.push(sel);
        appendTokenSpan(startTokenOffset, endTokenOffset);
      }
    }
  ]);

  // Additional atoms only when there's no whitespace.
  this.many({
    GATE: () => !this.hasWS(),
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
            const startTokenOffset = this.la(1).startOffset;
            const sel = this.simpleSelector(ctx) as unknown as SimpleSelector;
            const endTokenOffset = this.la(0).startOffset;
            selectors.push(sel);
            appendTokenSpan(startTokenOffset, endTokenOffset);
          }
        }
      ]);
    }
  });

  const location = this.endRule();
  if (replacements.length > 0) {
    return new Interpolated({ source, replacements }, { role: 'ident' }, location, this.context);
  }
  if (selectors.length === 1) {
    return selectors[0]!;
  }
  return new CompoundSelector(selectors, undefined, location, this.context);
}

/**
 * Override CSS `layerName` to support SCSS interpolation `#{ ... }` inside layer names.
 *
 * Example: `foo-#{$bar}` becomes an `Interpolated` node.
 */
export function layerName(this: P, ctx: RuleContext = {}) {
  this.startRule();
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
  this.or([
    {
      GATE: () => this.la(1).tokenType === this.T.InterpolationStart,
      ALT: () => {
        this.consume(this.T.InterpolationStart);
        const expr = this.valueSequence(ctx) as unknown as Node;
        this.consume(this.T.RCurly);
        takeInterpolation(expr);
      }
    },
    {
      ALT: () => {
        const tok = this.or([
          { GATE: () => this.la(1).tokenType === this.T.Ident, ALT: () => this.consume(this.T.Ident) },
          { ALT: () => this.consume(this.T.PlainIdent) }
        ]) as unknown as IToken;
        takeIdent(tok);
      }
    }
  ]);

  // Additional segments with no whitespace (e.g. `foo-#{$bar}`)
  this.many({
    GATE: () =>
      !this.hasWS()
      && this.la(1).tokenType !== this.T.LCurly
      && this.la(1).tokenType !== this.T.Comma
      && this.la(1).tokenType !== this.T.Semi
      && this.la(1).tokenType.name !== 'EOF',
    DEF: () => {
      this.or([
        {
          GATE: () => this.la(1).tokenType === this.T.InterpolationStart,
          ALT: () => {
            this.consume(this.T.InterpolationStart);
            const expr = this.valueSequence(ctx) as unknown as Node;
            this.consume(this.T.RCurly);
            takeInterpolation(expr);
          }
        },
        {
          ALT: () => {
            const tok = this.or([
              { GATE: () => this.la(1).tokenType === this.T.Ident, ALT: () => this.consume(this.T.Ident) },
              { ALT: () => this.consume(this.T.PlainIdent) }
            ]) as unknown as IToken;
            takeIdent(tok);
          }
        }
      ]);
    }
  });

  const loc = this.endRule();
  if (replacements?.length) {
    return new Interpolated({ source: source ?? '', replacements }, { role: 'any' }, loc, this.context);
  }
  return new Any(source ?? '', { role: 'ident' }, loc, this.context);
}
