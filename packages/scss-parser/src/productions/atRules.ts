/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
// SCSS at-rule production rules for ScssRecursiveParser
// Converted from lines 1184-3096 of productions.ts (Chevrotain → hand-written recursive-descent)
import type { RuleContext, TokenMap } from '../scssRecursiveParser.js';
import type { IToken } from '@jesscss/parser';
import { NoViableAltException } from 'chevrotain';
import { productions as cssProductions } from '@jesscss/css-parser';
import {
  Ampersand,
  Any,
  AtRule,
  AtRuleStatement,
  Call,
  Collection,
  ComplexSelector,
  Declaration,
  Expression,
  Extend,
  F_VISIBLE,
  For,
  Func,
  If,
  Interpolated,
  INTERPOLATION_PLACEHOLDER,
  isNode,
  JsImport,
  List,
  Log,
  Mixin,
  N,
  Nil,
  Quoted,
  Range,
  Reference,
  Rest,
  Rules,
  Ruleset,
  Sequence,
  SelectorList,
  StyleImport,
  Url,
  VarDeclaration,
  While,
  type AssignmentType,
  type LocationInfo,
  type Node,
  type Rules as RulesType,
  type Selector
} from '@jesscss/core';
import {
  makeNamespacedReference,
  isScriptUsePath,
  quotedLike,
  defaultNamespaceFromPath,
  toNameInterpolationReplacement
} from './helpers.js';

/** Use `any` for `this` to avoid structural incompatibility */
type P = any;
type ProductionRule = (ctx?: RuleContext) => any;

type ExtendSelectorKind = 'simple' | 'basic' | 'pseudo' | 'complex' | 'compound';

function consumeExactIdentLike($: P): IToken {
  if ($.RECORDING_PHASE) {
    return $.OR([
      { ALT: () => $.CONSUME($.T.Ident) },
      { ALT: () => $.CONSUME($.T.PlainIdent) }
    ]) as unknown as IToken;
  }
  if ($.LA(1).tokenType === $.T.PlainIdent) {
    return $.CONSUME($.T.PlainIdent) as unknown as IToken;
  }
  return $.CONSUME($.T.Ident) as unknown as IToken;
}

function parseInterpolatedMixinName(
  $: P,
  ctx: RuleContext,
  endTokens: ReadonlySet<any>
): Interpolated<'name'> | undefined {
  $.startRule();
  let source = '';
  const replacements: Node[] = [];

  if ($.RECORDING_PHASE) {
    $.AT_LEAST_ONE({
      DEF: () => {
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
      }
    });
  } else {
    const consumeNamePart = (): boolean => {
      if ($.LA(1).tokenType === $.T.InterpolationStart) {
        $.CONSUME($.T.InterpolationStart);
        const expr = $.SUBRULE($.valueSequence, { ARGS: [ctx] }) as unknown as Node;
        $.CONSUME($.T.RCurly);
        source += INTERPOLATION_PLACEHOLDER;
        replacements.push(toNameInterpolationReplacement($, expr, $.getLocationFromNodes([expr])));
        return true;
      }

      if (!endTokens.has($.LA(1).tokenType) && $.LA(1).tokenType === $.T.Ident) {
        const tok = $.CONSUME($.T.Ident) as unknown as IToken;
        source += tok.image;
        return true;
      }

      if (!endTokens.has($.LA(1).tokenType) && $.LA(1).tokenType === $.T.PlainIdent) {
        const tok = $.CONSUME($.T.PlainIdent) as unknown as IToken;
        source += tok.image;
        return true;
      }

      return false;
    };

    if (!consumeNamePart()) {
      $.OR([
        { ALT: () => $.CONSUME($.T.InterpolationStart) },
        { ALT: () => $.CONSUME($.T.Ident) },
        { ALT: () => $.CONSUME($.T.PlainIdent) }
      ]);
    }
    while (consumeNamePart()) {
      // continue
    }
  }

  const loc = $.endRule();
  if ($.RECORDING_PHASE) {
    return;
  }

  return new Interpolated(
    { source, replacements },
    { role: 'name' },
    loc,
    $.context
  );
}

function parseScssNameNode(
  $: P,
  ctx: RuleContext,
  endTokens: ReadonlySet<any>
): Any<'name'> | Interpolated<'name'> | undefined {
  $.startRule();
  let source = '';
  const replacements: Node[] = [];

  if ($.RECORDING_PHASE) {
    $.AT_LEAST_ONE({
      DEF: () => {
        $.OR([
          {
            GATE: () => $.LA(1).tokenType === $.T.InterpolationStart,
            ALT: () => {
              $.CONSUME($.T.InterpolationStart);
              const expr = $.SUBRULE($.valueSequence, { ARGS: [ctx] }) as unknown as Node;
              $.CONSUME($.T.RCurly);
              if (!$.RECORDING_PHASE) {
                source += INTERPOLATION_PLACEHOLDER;
                replacements.push(toNameInterpolationReplacement($, expr, $.getLocationFromNodes([expr])));
              }
            }
          },
          {
            GATE: () => !endTokens.has($.LA(1).tokenType) && $.LA(1).tokenType === $.T.Ident,
            ALT: () => {
              const tok = $.CONSUME($.T.Ident) as unknown as IToken;
              if (!$.RECORDING_PHASE) {
                source += tok.image;
              }
            }
          },
          {
            GATE: () => !endTokens.has($.LA(1).tokenType) && $.LA(1).tokenType === $.T.PlainIdent,
            ALT: () => {
              const tok = $.CONSUME($.T.PlainIdent) as unknown as IToken;
              if (!$.RECORDING_PHASE) {
                source += tok.image;
              }
            }
          }
        ]);
      }
    });
  } else {
    const consumeNamePart = (): boolean => {
      if ($.LA(1).tokenType === $.T.InterpolationStart) {
        $.CONSUME($.T.InterpolationStart);
        if ($.LA(1).tokenType === $.T.DollarVariable && $.LA(2).tokenType === $.T.RCurly) {
          const dv = $.CONSUME($.T.DollarVariable) as unknown as IToken;
          $.CONSUME($.T.RCurly);
          source += INTERPOLATION_PLACEHOLDER;
          replacements.push(
            new Reference(
              { key: dv.image.slice(1) },
              { type: 'variable', role: 'ident' },
              $.getLocationInfo(dv),
              $.context
            )
          );
          return true;
        }
        const expr = $.SUBRULE($.valueSequence, { ARGS: [ctx] }) as unknown as Node;
        $.CONSUME($.T.RCurly);
        source += INTERPOLATION_PLACEHOLDER;
        replacements.push(toNameInterpolationReplacement($, expr, $.getLocationFromNodes([expr])));
        return true;
      }

      if (!endTokens.has($.LA(1).tokenType) && $.LA(1).tokenType === $.T.Ident) {
        const tok = $.CONSUME($.T.Ident) as unknown as IToken;
        source += tok.image;
        return true;
      }

      if (!endTokens.has($.LA(1).tokenType) && $.LA(1).tokenType === $.T.PlainIdent) {
        const tok = $.CONSUME($.T.PlainIdent) as unknown as IToken;
        source += tok.image;
        return true;
      }

      return false;
    };

    if (!consumeNamePart()) {
      $.OR([
        { ALT: () => $.CONSUME($.T.InterpolationStart) },
        { ALT: () => $.CONSUME($.T.Ident) },
        { ALT: () => $.CONSUME($.T.PlainIdent) }
      ]);
    }
    while (consumeNamePart()) {
      // continue
    }
  }

  const loc = $.endRule();
  if ($.RECORDING_PHASE) {
    return;
  }

  if (replacements.length === 0) {
    return new Any(source, { role: 'name' }, loc, $.context);
  }

  return new Interpolated(
    { source, replacements },
    { role: 'name' },
    loc,
    $.context
  );
}

function createNullParentAmpersand(context: any, selector?: Selector): Ampersand {
  const location = selector?.location.length === 6 ? selector.location : undefined;
  const nil = new Nil(undefined, undefined, location, context);
  const amp = new Ampersand(
    { selectorContainer: { selector: nil } },
    undefined,
    location,
    context
  );
  amp.adopt(nil);
  return amp;
}

function getNodeLocation(node: Node): LocationInfo | undefined {
  return node.location.length === 6 ? node.location : undefined;
}

function prefixAtRootSelector(selector: Selector, context: any): Selector {
  if (isNode(selector, N.SelectorList)) {
    const list = new SelectorList(
      (selector as SelectorList).value.map(item => prefixAtRootSelector(item as Selector, context)),
      undefined,
      getNodeLocation(selector),
      context
    );
    return list as Selector;
  }

  const amp = createNullParentAmpersand(context, selector);
  if (isNode(selector, N.ComplexSelector)) {
    const complex = new ComplexSelector(
      [amp, ...(selector as ComplexSelector).value],
      undefined,
      getNodeLocation(selector),
      context
    );
    return complex as Selector;
  }

  const complex = new ComplexSelector([amp, selector], undefined, getNodeLocation(selector), context);
  return complex as Selector;
}

function lowerPlainAtRootRules(rules: RulesType, context: any): void {
  const transformRule = (node: Node): Node => {
    if (isNode(node, N.Ruleset)) {
      const ruleset = node as Ruleset;
      if (!isNode(ruleset.selector, N.Nil)) {
        return new Ruleset({
          selector: prefixAtRootSelector(ruleset.selector as Selector, context),
          rules: ruleset.rules,
          ...(ruleset.guard !== undefined && { guard: ruleset.guard }),
          ...(ruleset.selectorBeforeExtend !== undefined && {
            selectorBeforeExtend: ruleset.selectorBeforeExtend
          })
        }, ruleset.options, ruleset.location, context);
      }
      return ruleset;
    }

    if (node instanceof AtRule && node.rules) {
      lowerPlainAtRootRules(node.rules as RulesType, context);
      return node;
    }

    if (node instanceof If) {
      lowerPlainAtRootRules(node as unknown as RulesType, context);
      if (node.else) {
        lowerPlainAtRootRules(node.else as RulesType, context);
      }
      return node;
    }

    if (node instanceof For) {
      lowerPlainAtRootRules(node.rules as RulesType, context);
      return node;
    }

    if (node instanceof While) {
      lowerPlainAtRootRules(node.rules as RulesType, context);
      return node;
    }

    return node;
  };

  for (let i = 0; i < rules.rules.length; i++) {
    const replacement = transformRule(rules.rules[i]!);
    if (replacement !== rules.rules[i]) {
      rules.adopt(replacement);
      rules.rules[i] = replacement;
    }
  }
}

function findDisallowedExtendSelector(selector: any, allowed: readonly ExtendSelectorKind[]): { kind: ExtendSelectorKind; selector: any } | undefined {
  if (isNode(selector, N.SelectorList)) {
    for (const item of selector.value) {
      const disallowed = findDisallowedExtendSelector(item, allowed);
      if (disallowed) {
        return disallowed;
      }
    }
    return undefined;
  }
  const kinds: ExtendSelectorKind[] = isNode(selector, N.BasicSelector)
    ? ['simple', 'basic']
    : isNode(selector, N.PseudoSelector)
      ? ['simple', 'pseudo']
      : isNode(selector, N.CompoundSelector)
        ? ['compound']
        : isNode(selector, N.ComplexSelector)
          ? ['complex']
          : ['simple'];
  if (isNode(selector, N.CompoundSelector) && selector.value.length === 1) {
    return findDisallowedExtendSelector(selector.value[0], allowed);
  }
  if (isNode(selector, N.ComplexSelector) && selector.value.length === 1) {
    return findDisallowedExtendSelector(selector.value[0], allowed);
  }
  if (kinds.some(k => allowed.includes(k))) {
    return undefined;
  }
  return { kind: kinds[0]!, selector };
}

function validateExtendTarget($: P, target: any): void {
  const allowed: ExtendSelectorKind[] | undefined = $.context?.opts?.allowExtendSelectors;
  if (!allowed) {
    return;
  }
  const disallowed = findDisallowedExtendSelector(target, allowed);
  if (!disallowed) {
    return;
  }
  const kindList = allowed.length === 1 ? `${allowed[0]} value` : allowed.join(', ');
  $.SAVE_ERROR(new NoViableAltException(
    `@extend only allows ${kindList}, but found ${disallowed.kind} selector "${disallowed.selector.valueOf()}".`,
    $.LA(1),
    $.LA(0)
  ));
}

function saveUnsupportedSyntaxError(
  $: P,
  token: any,
  loc: any,
  message: string
): void {
  const err = new NoViableAltException(
    message,
    token,
    $.LA(0)
  ) as NoViableAltException & {
    startLine?: number;
    startColumn?: number;
    endLine?: number;
    endColumn?: number;
    offset?: number;
    length?: number;
    location?: unknown;
  };
  err.startLine = loc?.[1];
  err.startColumn = loc?.[2];
  err.endLine = loc?.[4];
  err.endColumn = loc?.[5];
  err.offset = loc?.[0];
  err.length = typeof loc?.[0] === 'number' && typeof loc?.[3] === 'number'
    ? Math.max(1, (loc[3] - loc[0]) + 1)
    : undefined;
  err.location = loc;
  $.SAVE_ERROR(err);
}

// Save CSS factory methods for super calls
const cssMediaAtRule = cssProductions.mediaAtRule;
const cssContainerAtRule = cssProductions.containerAtRule;
const cssScopeAtRule = cssProductions.scopeAtRule;
const cssUnknownAtRule = cssProductions.unknownAtRule;

function isPlainCssImportPath(rawPath: string): boolean {
  return /\.css(?:$|[?#])/i.test(rawPath)
    || /^[a-z]+:\/\//i.test(rawPath)
    || rawPath.startsWith('//');
}

function isPlainCssImportPrelude(prelude: Node, extraNodes: Node[] | undefined): boolean {
  if (prelude instanceof Url) {
    return true;
  }
  if (extraNodes && extraNodes.length > 0) {
    return true;
  }
  if (isNode(prelude, N.Quoted)) {
    return isPlainCssImportPath(prelude.valueOf());
  }
  return true;
}

export function importAtRule(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();
    const name = $.CONSUME($.T.AtImport) as unknown as IToken;
    const imports: Node[] = [];

    $.AT_LEAST_ONE_SEP({
      SEP: $.T.Comma,
      DEF: () => {
        const prelude = $.SUBRULE($.importPrelude, { ARGS: [ctx] }) as unknown as Node;
        let extraNodes: Node[] | undefined;
        $.OPTION(() => {
          extraNodes = $.SUBRULE($.importPostlude, { ARGS: [ctx] }) as unknown as Node[];
        });

        if ($.RECORDING_PHASE) {
          return;
        }

        const itemLocation = $.getLocationFromNodes([
          prelude,
          ...(extraNodes ?? [])
        ]);

        if (!isPlainCssImportPrelude(prelude, extraNodes) && isNode(prelude, N.Quoted)) {
          imports.push(new StyleImport(
            { path: prelude as Quoted },
            {
              type: 'import',
              importOptions: { multiple: true }
            },
            itemLocation,
            $.context
          ));
          return;
        }

        const preludeNodes = [prelude, ...(extraNodes ?? [])];
        imports.push(new AtRuleStatement(
          {
            name: new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), $.context),
            prelude: new Sequence(preludeNodes, undefined, $.getLocationFromNodes(preludeNodes), $.context)
          },
          undefined,
          itemLocation,
          $.context
        ));
      }
    });

    $.CONSUME($.T.Semi);

    $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }

    for (const item of imports.slice(0, -1)) {
      $.enqueuePendingNode(item);
    }
    return imports[imports.length - 1]!;
  };
}

export function innerAtRule(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => $.OR([
    { GATE: () => $.isType($.T.AtImport), ALT: () => $.SUBRULE($.importAtRule, { ARGS: [{ ...ctx, inner: true }] }) },
    { GATE: () => $.isType($.T.AtContainer), ALT: () => $.SUBRULE($.containerAtRule, { ARGS: [ctx] }) },
    { GATE: () => $.isType($.T.AtScope), ALT: () => $.SUBRULE($.scopeAtRule, { ARGS: [ctx] }) },
    { GATE: () => $.isType($.T.AtDocument), ALT: () => $.SUBRULE($.documentAtRule, { ARGS: [ctx] }) },
    { GATE: () => $.isType($.T.AtLayer), ALT: () => $.SUBRULE($.layerAtRule, { ARGS: [ctx] }) },
    { GATE: () => $.isType($.T.AtKeyframes), ALT: () => $.SUBRULE($.keyframesAtRule, { ARGS: [ctx] }) },
    { GATE: () => $.isType($.T.AtMedia), ALT: () => $.SUBRULE($.mediaAtRule, { ARGS: [ctx] }) },
    { GATE: () => $.isType($.T.AtSupports), ALT: () => $.SUBRULE($.supportsAtRule, { ARGS: [ctx] }) },
    { GATE: () => $.isType($.T.AtNested), ALT: () => $.SUBRULE($.nestedAtRule, { ARGS: [ctx] }) },
    { ALT: () => $.SUBRULE($.unknownAtRule, { ARGS: [ctx] }) }
  ]);
}

/**
 * SCSS: `@use` → `StyleImport(type='compose')` for stylesheets,
 * and `JsImport` for script paths. `sass:*` built-ins are rewritten
 * to `#sass/*` and imported as `JsImport`.
 */
export function scssUseAtRule(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();
    $.CONSUME($.T.AtKeyword); // '@use'

    const pathNode = $.SUBRULE($.string, { ARGS: [ctx] }) as unknown as Quoted;
    let namespace: string | undefined;

    // optional "as <ident|*>"
    $.OPTION({
      GATE: () =>
        ($.LA(1).tokenType === $.T.Ident || $.LA(1).tokenType === $.T.PlainIdent)
        && $.LA(1).image === 'as',
      DEF: () => {
        $.OR([
          { ALT: () => $.CONSUME($.T.Ident) },
          { ALT: () => $.CONSUME($.T.PlainIdent) }
        ]);
        $.OR2([
          { ALT: () => {
            namespace = $.CONSUME2($.T.Ident).image;
          } },
          { ALT: () => {
            namespace = $.CONSUME($.T.Star).image;
          } }
        ]);
      }
    });

    // optional "with (...)"
    let withRules: Collection | undefined;
    $.OPTION2({
      GATE: () =>
        ($.LA(1).tokenType === $.T.Ident || $.LA(1).tokenType === $.T.PlainIdent)
        && $.LA(1).image === 'with',
      DEF: () => {
        $.OR3([
          { ALT: () => $.CONSUME3($.T.Ident) },
          { ALT: () => $.CONSUME2($.T.PlainIdent) }
        ]);
        withRules = $.SUBRULE($.scssWithConfig, { ARGS: [ctx] }) as unknown as Collection;
      }
    });

    $.CONSUME($.T.Semi);

    const loc = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }
    const rawPath = pathNode.valueOf();

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

    return new StyleImport(
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
  };
}

/**
 * SCSS: `@forward` → `StyleImport(type='compose')` with `(forward)` semantics:
 * - forward: true (not visible locally; available downstream)
 * - (compose is protected by default unless `mutable: true`)
 *
 * Full show/hide/as parsing is deferred; we currently ignore extra prelude tokens.
 */
export function scssForwardAtRule(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();
    const atKeyword = $.CONSUME($.T.AtKeyword) as unknown as IToken; // '@forward'

    const pathNode = $.SUBRULE($.string, { ARGS: [ctx] }) as unknown as Quoted;
    const isWithConfigStart = () => $.LA(1).image === 'with' && $.LA(2).tokenType === $.T.LParen;

    // optional "as <prefix>-*"
    // NOTE: this is parsed inside the prelude loop below (instead of option),
    // to avoid ambiguous-alternative warnings (take vs skip).
    let forwardAsPrefix: string | undefined;

    // optional "show ..." or "hide ..." (parse-only; store raw list)
    let forwardShow: string[] | undefined;
    let forwardHide: string[] | undefined;
    let forwardListMode: 'show' | 'hide' | undefined;
    $.MANY({
    // Stop before `with (...)` so the option below stays unambiguous.
      GATE: () => $.LA(1).tokenType !== $.T.Semi && !isWithConfigStart(),
      DEF: () => {
        const la = $.LA(1);
        // optional "as <prefix>-*"
        if ((la.tokenType === $.T.Ident || la.tokenType === $.T.PlainIdent) && la.image === 'as') {
        // "as" may be Ident or PlainIdent depending on token mode.
          if ($.LA(1).tokenType === $.T.Ident) {
            $.CONSUME($.T.Ident);
          } else {
            $.CONSUME($.T.PlainIdent);
          }

          // The prefix is typically tokenized as a single ident/plainident (often including the trailing '-').
          const tok = ($.LA(1).tokenType === $.T.Ident)
            ? ($.CONSUME($.T.Ident) as unknown as IToken)
            : ($.CONSUME($.T.PlainIdent) as unknown as IToken);

          // If the `*` was split into its own token, consume it (and optional '-' if present as Unknown).
          if (
            ($.LA(1).tokenType === $.T.Unknown && $.LA(1).image === '-' && $.LA(2).tokenType === $.T.Star)
            || $.LA(1).tokenType === $.T.Star
          ) {
            if ($.LA(1).tokenType === $.T.Unknown && $.LA(1).image === '-') {
              $.CONSUME($.T.Unknown);
            }
            $.CONSUME($.T.Star);
          }

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
          return;
        }
        // Skip commas inside lists.
        if (la.tokenType === $.T.Comma) {
          $.CONSUME($.T.Comma);
          return;
        }
        // Start of a show/hide list.
        if ((la.tokenType === $.T.Ident || la.tokenType === $.T.PlainIdent) && (la.image === 'show' || la.image === 'hide')) {
          const kw = ($.LA(1).tokenType === $.T.Ident)
            ? ($.CONSUME($.T.Ident) as unknown as IToken)
            : ($.CONSUME($.T.PlainIdent) as unknown as IToken);
          forwardListMode = kw.image === 'hide' ? 'hide' : 'show';
          if (forwardListMode === 'show') {
            forwardShow = [];
          } else {
            forwardHide = [];
          }
          return;
        }
        // Consume list members when we're in a show/hide list.
        if (forwardListMode) {
          const t = ($.LA(1).tokenType === $.T.DollarVariable)
            ? ($.CONSUME($.T.DollarVariable) as unknown as IToken)
            : (
                $.LA(1).tokenType === $.T.Ident
                  ? ($.CONSUME($.T.Ident) as unknown as IToken)
                  : ($.CONSUME($.T.PlainIdent) as unknown as IToken)
              );
          (forwardListMode === 'show' ? forwardShow : forwardHide)!.push(t.image);
          return;
        }
        // Otherwise, consume generic prelude tokens we don't handle yet.
        $.SUBRULE($.anyOuterValue, { ARGS: [ctx] });
      }
    });

    // optional "with (...)"
    let withRules: Collection | undefined;
    // Tight gate to avoid ambiguity warnings.
    // Note: "with" may be tokenized as PlainIdent depending on mode/categories.
    $.OPTION({
      GATE: isWithConfigStart,
      DEF: () => {
        if ($.RECORDING_PHASE) {
          $.OR([
            { ALT: () => $.CONSUME($.T.Ident) },
            { ALT: () => $.CONSUME($.T.PlainIdent) }
          ]);
        } else if ($.isType($.T.Ident)) {
          $.CONSUME($.T.Ident);
        } else {
          $.CONSUME($.T.PlainIdent);
        }
        withRules = $.SUBRULE($.scssWithConfig, { ARGS: [ctx] }) as unknown as Collection;
      }
    });

    $.CONSUME($.T.Semi);

    const loc = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }

    if (forwardAsPrefix) {
      saveUnsupportedSyntaxError(
        $,
        atKeyword,
        loc,
        '@forward with "as <prefix>-*" prefixing is not supported in Jess and will never be. Use explicit namespacing instead.'
      );
    }
    if (forwardShow || forwardHide) {
      saveUnsupportedSyntaxError(
        $,
        atKeyword,
        loc,
        '@forward with "show"/"hide" lists is not supported in Jess and will never be. Visibility control belongs to the module itself.'
      );
    }

    return new StyleImport(
      {
        path: pathNode,
        with: withRules ? { node: withRules, type: 'set' } : undefined
      },
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
  };
}

/**
 * SCSS: `@extend <selector-list> [!optional];`
 *
 * We parse it into Jess `Extend` nodes (Sass default flag = All).
 * `!optional` is accepted (so sass-spec parses) but ignored in evaluation.
 */
export function scssExtendAtRule(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const $ = this;
    $.startRule();
    $.CONSUME($.T.AtKeyword); // '@extend'

    ctx.inExtend = true;
    let target: Node;
    try {
      target = $.SUBRULE($.selectorList, { ARGS: [ctx] }) as unknown as Node;
    } finally {
      ctx.inExtend = false;
    }
    validateExtendTarget($, target);

    // Accept (but ignore) any trailing bits like `!optional`
    $.MANY({
      GATE: () => $.LA(1).tokenType !== $.T.Semi && $.LA(1).tokenType.name !== 'EOF',
      DEF: () => {
        $.SUBRULE($.anyOuterValue, { ARGS: [ctx] });
      }
    });

    $.CONSUME($.T.Semi);
    const loc = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }

    // Sass module system: placeholders are not namespaced, but they can come from upstream modules.
    // For placeholder targets (tokenized as `\\foo`), we set `allNamespaces: true` so extend lookup
    // searches all file roots, regardless of namespace scoping.
    const isPlaceholderTarget = (sel: Node): boolean => {
      if (isNode(sel, N.BasicSelector)) {
        return sel.value.startsWith('\\');
      }
      if (isNode(sel, N.SelectorList) && sel.value.length === 1) {
        return isPlaceholderTarget(sel.value[0]!);
      }
      if (isNode(sel, N.CompoundSelector) && sel.value.length === 1) {
        return isPlaceholderTarget(sel.value[0]!);
      }
      if (isNode(sel, N.ComplexSelector) && sel.value.length === 1) {
        return isPlaceholderTarget(sel.value[0]!);
      }
      return false;
    };
    const namespace = isPlaceholderTarget(target) ? '*' : undefined;

    return new Extend(
      { target: target as unknown as Selector, flag: 0, namespace },
      undefined,
      loc,
      $.context
    );
  };
}

/**
 * Parses Sass `with (...)` config into a Rules node of VarDeclarations.
 */
export function scssWithConfig(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const $ = this;
    $.startRule();
    $.CONSUME($.T.LParen);

    const decls: VarDeclaration[] = [];

    $.OPTION(() => {
      $.AT_LEAST_ONE_SEP({
        SEP: $.T.Comma,
        DEF: () => {
          const dv = $.CONSUME($.T.DollarVariable);
          $.CONSUME($.T.Assign);
          const value = $.SUBRULE($.valueSequence, { ARGS: [ctx] });
          // Sass config vars can include flags like `!default` and `!global`.
          // Mirror SCSS variable declaration behavior so these semantics survive into core.
          let sawDefault = false;
          let sawGlobal = false;
          if ($.RECORDING_PHASE) {
            $.MANY(() => {
              $.OR([
                { ALT: () => $.CONSUME($.T.SassDefault) },
                { ALT: () => $.CONSUME($.T.SassGlobal) }
              ]);
            });
          } else {
            while ($.isType($.T.SassDefault) || $.isType($.T.SassGlobal)) {
              if ($.isType($.T.SassDefault)) {
                $.CONSUME($.T.SassDefault);
                sawDefault = true;
              } else {
                $.CONSUME($.T.SassGlobal);
                sawGlobal = true;
              }
            }
          }
          const name = new Any(dv.image.slice(1), { role: 'property' });
          decls.push(
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
      });
    });

    $.CONSUME($.T.RParen);
    const loc = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }
    return new Collection(decls, undefined, loc, $.context) as unknown as RulesType;
  };
}

/**
 * SCSS: `@content` → `$content()` (Call(Reference(type='mixin')))
 */
export function scssContentAtRule(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const $ = this;
    $.startRule();
    $.CONSUME($.T.AtKeyword); // assumed '@content' (dispatched by unknownAtRule)
    let args: List | undefined;
    $.OPTION({
      GATE: () => $.LA(1).tokenType === $.T.LParen,
      DEF: () => {
        $.CONSUME($.T.LParen);
        $.OPTION2({
          GATE: () => $.LA(1).tokenType !== $.T.RParen,
          DEF: () => {
            args = $.SUBRULE($.functionCallArgs, { ARGS: [ctx] }) as unknown as List;
          }
        });
        $.CONSUME($.T.RParen);
      }
    });
    $.OPTION3({
      GATE: () => $.LA(1).tokenType === $.T.Semi,
      DEF: () => $.CONSUME($.T.Semi)
    });

    const loc = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }
    const ref = new Reference({ key: 'content' }, { type: 'mixin', role: 'name' }, loc, $.context);
    return new Call({ name: ref, args }, undefined, loc, $.context);
  };
}

export function scssIncludeUsingParams(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();
    $.CONSUME($.T.LParen);
    const p: Node[] = [];
    $.OPTION({
      GATE: () => $.LA(1).tokenType !== $.T.RParen,
      DEF: () => {
        $.AT_LEAST_ONE_SEP({
          SEP: $.T.Comma,
          DEF: () => {
            const dv = $.CONSUME($.T.DollarVariable);
            const paramName = new Any(dv.image.slice(1), { role: 'property' }, $.getLocationInfo(dv), $.context);
            p.push(
              new VarDeclaration(
                { name: paramName, value: new Nil() },
                { paramVar: true },
                $.getLocationInfo(dv),
                $.context
              )
            );
          }
        });
      }
    });
    $.CONSUME($.T.RParen);
    const loc = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }
    return new List(p, undefined, loc, $.context);
  };
}

/**
 * SCSS: `@include name(args...)` → mixin call (Call(Reference(type='mixin'))).
 *
 * Note: content blocks are parsed as a named argument `$content: <mixin>`
 * (parse-only). The evaluation semantics for binding it to the call scope
 * are implemented later.
 */
export function scssIncludeAtRule(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const $ = this;
    $.startRule();
    $.CONSUME($.T.AtKeyword); // assumed '@include' (dispatched by unknownAtRule)

    let mixinKey: string | undefined;
    let mixinNameRef: Reference | undefined;
    let interpolatedMixinKey: Interpolated<'name'> | undefined;
    let args: List | undefined;
    let nameStartsWithOpenParen = false;
    const parseGenericFunctionStartCall = () => {
      const nameTok = $.CONSUME($.T.GenericFunctionStart) as unknown as IToken;
      nameStartsWithOpenParen = true;
      if ($.RECORDING_PHASE) {
        return;
      }
      mixinKey = nameTok.image.slice(0, -1);
    };

    const parseNamespacedFunctionStartCall = () => {
      const nameTok = $.CONSUME($.T.NamespacedFunctionStart) as unknown as IToken;
      nameStartsWithOpenParen = true;
      if ($.RECORDING_PHASE) {
        return;
      }
      const parts = nameTok.image.slice(0, -1).split('.').filter(Boolean);
      if (parts.length >= 2) {
        mixinNameRef = makeNamespacedReference($, parts, 'mixin');
        return;
      }
      mixinKey = nameTok.image.slice(0, -1);
    };

    const parseNamespacedDotCall = () => {
      const ns = consumeExactIdentLike($);
      const dot = $.CONSUME($.T.DotName) as unknown as IToken;
      if ($.RECORDING_PHASE) {
        return;
      }
      mixinNameRef = makeNamespacedReference($, [ns.image, dot.image.slice(1)], 'mixin');
    };

    const parseEscapedNamespacedRulesetCall = () => {
      const ns = consumeExactIdentLike($);
      $.CONSUME($.T.Unknown); // '.'
      $.CONSUME($.T.Unknown); // '\'
      const member = $.OR5([
        { GATE: () => $.LA(1).tokenType === $.T.HashName, ALT: () => $.CONSUME($.T.HashName) },
        { ALT: () => $.CONSUME($.T.DotName) }
      ]) as unknown as IToken;
      if ($.RECORDING_PHASE) {
        return;
      }
      mixinNameRef = makeNamespacedReference($, [ns.image, member.image.slice(1)], 'mixin-ruleset');
    };

    const parseInterpolatedMixinCall = () => {
      interpolatedMixinKey = parseInterpolatedMixinName($, ctx, new Set([$.T.LParen, $.T.LCurly, $.T.Semi]));
    };

    const parsePlainMixinCall = () => {
      const ident = consumeExactIdentLike($);
      if ($.RECORDING_PHASE) {
        return;
      }
      mixinKey = ident.image;
    };

    const isNamespacedDotCall =
      ($.isTypeAt(1, $.T.Ident) || $.isTypeAt(1, $.T.PlainIdent))
      && $.isTypeAt(2, $.T.DotName);
    const isEscapedNamespacedRulesetCall =
      ($.isTypeAt(1, $.T.Ident) || $.isTypeAt(1, $.T.PlainIdent))
      && $.isTypeAt(2, $.T.Unknown)
      && $.LA(2).image === '.'
      && $.isTypeAt(3, $.T.Unknown)
      && $.LA(3).image === '\\'
      && ($.isTypeAt(4, $.T.HashName) || $.isTypeAt(4, $.T.DotName));
    const isInterpolatedMixinName =
      $.isTypeAt(1, $.T.InterpolationStart)
      || (
        ($.isTypeAt(1, $.T.Ident) || $.isTypeAt(1, $.T.PlainIdent))
        && $.isTypeAt(2, $.T.InterpolationStart)
      );

    if ($.RECORDING_PHASE) {
      $.OR([
        { ALT: () => parseGenericFunctionStartCall() },
        { ALT: () => parseNamespacedFunctionStartCall() },
        { GATE: () => isNamespacedDotCall, ALT: () => parseNamespacedDotCall() },
        { GATE: () => isEscapedNamespacedRulesetCall, ALT: () => parseEscapedNamespacedRulesetCall() },
        { GATE: () => isInterpolatedMixinName, ALT: () => parseInterpolatedMixinCall() },
        { ALT: () => parsePlainMixinCall() }
      ]);
    } else if ($.isType($.T.GenericFunctionStart)) {
      parseGenericFunctionStartCall();
    } else if ($.isType($.T.NamespacedFunctionStart)) {
      parseNamespacedFunctionStartCall();
    } else if (isNamespacedDotCall) {
      parseNamespacedDotCall();
    } else if (isEscapedNamespacedRulesetCall) {
      parseEscapedNamespacedRulesetCall();
    } else if (isInterpolatedMixinName) {
      parseInterpolatedMixinCall();
    } else {
      parsePlainMixinCall();
    }

    if ($.RECORDING_PHASE) {
      $.OR7([
        {
          GATE: () => nameStartsWithOpenParen,
          ALT: () => {
            $.OPTION({
              GATE: () => $.LA(1).tokenType !== $.T.RParen,
              DEF: () => {
                $.SUBRULE($.functionCallArgs, { ARGS: [ctx] });
              }
            });
            $.CONSUME($.T.RParen);
          }
        },
        {
          GATE: () => $.LA(1).tokenType === $.T.LParen,
          ALT: () => {
            $.CONSUME($.T.LParen);
            $.OPTION2({
              GATE: () => $.LA(1).tokenType !== $.T.RParen,
              DEF: () => {
                $.SUBRULE2($.functionCallArgs, { ARGS: [ctx] });
              }
            });
            $.CONSUME2($.T.RParen);
          }
        },
        { ALT: () => {} }
      ]);
    } else if (nameStartsWithOpenParen) {
      if ($.LA(1).tokenType !== $.T.RParen) {
        args = $.SUBRULE($.functionCallArgs, { ARGS: [ctx] }) as unknown as List;
      }
      $.CONSUME($.T.RParen);
    } else if ($.LA(1).tokenType === $.T.LParen) {
      $.CONSUME($.T.LParen);
      if ($.LA(1).tokenType !== $.T.RParen) {
        args = $.SUBRULE2($.functionCallArgs, { ARGS: [ctx] }) as unknown as List;
      }
      $.CONSUME2($.T.RParen);
    }

    // Optional content block
    let contentRules: RulesType | undefined;
    let usingParams: List | undefined;

    // SCSS: `@include foo() using ($x, $y) { ... }`
    $.OPTION8({
      GATE: () =>
        ($.LA(1).tokenType === $.T.Ident || $.LA(1).tokenType === $.T.PlainIdent)
        && $.LA(1).image === 'using',
      DEF: () => {
        if ($.RECORDING_PHASE) {
          $.OR2([
            { ALT: () => $.CONSUME($.T.Ident) },
            { ALT: () => $.CONSUME($.T.PlainIdent) }
          ]);
        } else if ($.isType($.T.Ident)) {
          $.CONSUME($.T.Ident);
        } else {
          $.CONSUME($.T.PlainIdent);
        }
        usingParams = $.SUBRULE($.scssIncludeUsingParams, { ARGS: [ctx] }) as unknown as List;
      }
    });

    $.OPTION9({
      GATE: () => $.LA(1).tokenType === $.T.LCurly,
      DEF: () => {
        $.CONSUME($.T.LCurly);
        contentRules = $.SUBRULE($.atRuleBody, { ARGS: [{ ...ctx, inner: true }] }) as unknown as RulesType;
        $.CONSUME($.T.RCurly);
      }
    });

    // Require semicolon only when present (SCSS requires it if no block; we enforce later)
    if ($.LA(1).tokenType === $.T.Semi) {
      $.CONSUME($.T.Semi);
    }

    const loc = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }
    const mixinRef = mixinNameRef ?? new Reference(
      { key: interpolatedMixinKey ?? mixinKey! },
      { type: 'mixin', role: 'name' },
      loc,
      $.context
    );

    // If we have a content block, store it on the Call itself (for serialization and future semantics).
    let contentNode: Node | undefined;
    if (contentRules) {
      const contentMixin = new Mixin(
        { rules: contentRules.rules, params: usingParams },
        undefined,
        loc,
        $.context
      );
      // This is an inline/anonymous mixin literal, so it must be visible when serialized.
      contentMixin.addFlags(F_VISIBLE);
      contentNode = contentMixin as unknown as Node;
    }

    const call = new Call({ name: mixinRef, args, contentNode }, undefined, loc, $.context);
    // SCSS `@include` is a statement; serialize as Jess mixin injection using `$ > ...`.
    return call;
  };
}

export function scssIfAtRule(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const $ = this;
    $.startRule();
    $.CONSUME($.T.AtKeyword); // assumed '@if' (dispatched by unknownAtRule)

    // Parse the condition - returns Paren(Condition(...)) or nested Conditions
    const cond = $.SUBRULE($.scssCondition, { ARGS: [ctx] }) as unknown as Node | undefined;

    $.CONSUME($.T.LCurly);
    const rules = $.SUBRULE($.atRuleBody, { ARGS: [{ ...ctx, inner: !!ctx.inner }] });
    $.CONSUME($.T.RCurly);

    const conditions: Node[] = [cond as unknown as Node];
    const bodies: Rules[] = [rules];
    let elseBranch: Rules | undefined;

    // Consume chained @else / @else if
    $.MANY({
      GATE: () => $.LA(1).image === '@else',
      DEF: () => {
        $.CONSUME($.T.AtKeyword); // @else
        if ($.RECORDING_PHASE) {
          $.OR([
            {
              ALT: () => {
                $.OR2([
                  { ALT: () => $.CONSUME($.T.Ident) },
                  { ALT: () => $.CONSUME($.T.PlainIdent) }
                ]);
                $.SUBRULE2($.scssCondition, { ARGS: [ctx] });
                $.CONSUME($.T.LCurly);
                $.SUBRULE2($.atRuleBody, { ARGS: [{ ...ctx, inner: !!ctx.inner }] });
                $.CONSUME($.T.RCurly);
              }
            },
            {
              ALT: () => {
                $.CONSUME2($.T.LCurly);
                $.SUBRULE3($.atRuleBody, { ARGS: [{ ...ctx, inner: !!ctx.inner }] });
                $.CONSUME2($.T.RCurly);
              }
            }
          ]);
          return;
        }

        if ($.LA(1).image === 'if' && ($.isType($.T.Ident) || $.isType($.T.PlainIdent))) {
          if ($.isType($.T.Ident)) {
            $.CONSUME($.T.Ident);
          } else {
            $.CONSUME($.T.PlainIdent);
          }
          const elseCond = $.SUBRULE2($.scssCondition, { ARGS: [ctx] }) as unknown as Node;
          $.CONSUME($.T.LCurly);
          const elseRules = $.SUBRULE2($.atRuleBody, { ARGS: [{ ...ctx, inner: !!ctx.inner }] });
          $.CONSUME($.T.RCurly);
          conditions.push(elseCond);
          bodies.push(elseRules);
          return;
        }

        $.CONSUME2($.T.LCurly);
        elseBranch = $.SUBRULE3($.atRuleBody, { ARGS: [{ ...ctx, inner: !!ctx.inner }] });
        $.CONSUME2($.T.RCurly);
      }
    });

    const loc = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }
    let elseNode: If | Rules | undefined = elseBranch;
    for (let index = conditions.length - 1; index >= 0; index--) {
      elseNode = new If({
        condition: conditions[index]!,
        rules: bodies[index]!.rules,
        else: elseNode
      }, undefined, loc, $.context);
    }
    return elseNode;
  };
}

export function scssForAtRule(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const $ = this;
    $.startRule();
    $.CONSUME($.T.AtKeyword); // assumed '@for'

    // Sass: `@for $i from <start> (to|through) <end> { ... }`
    // Normalize to Jess `$for` range header:
    //   `$for ($i of <Range>) { ... }`
    // Where Range serializes as:
    // - `start to end` (through)
    // - `start to <end` (to)
    const dv = $.CONSUME($.T.DollarVariable);

    // consume `from` keyword (token type can vary by mode/categories)
    if ($.LA(1).image !== 'from') {
    // Trigger a useful parse error if we don't see `from`.
      $.CONSUME($.T.PlainIdent);
    } else if ($.LA(1).tokenType === $.T.PlainIdent) {
      $.CONSUME($.T.PlainIdent);
    } else {
      $.CONSUME($.T.Ident);
    }

    // Parse start expression until we hit `to`/`through`
    const startNodes: Node[] = [];
    $.AT_LEAST_ONE({
      GATE: () => {
        const la = $.LA(1);
        // Stop before `to`/`through` regardless of token type.
        return !(la.image === 'to' || la.image === 'through');
      },
      DEF: () => {
        const n = $.SUBRULE($.anyOuterValue, { ARGS: [ctx] }) as unknown as Node;
        startNodes.push(n);
      }
    });

    // consume `to` / `through`
    let kw: IToken;
    if ($.LA(1).image !== 'to' && $.LA(1).image !== 'through') {
    // Trigger a useful parse error if we don't see `to|through`.
      kw = $.CONSUME($.T.PlainIdent) as unknown as IToken;
    } else if ($.LA(1).tokenType === $.T.PlainIdent) {
      kw = $.CONSUME($.T.PlainIdent) as unknown as IToken;
    } else {
      kw = $.CONSUME($.T.Ident) as unknown as IToken;
    }
    const includeEnd = kw.image === 'through';

    // Parse end expression until `{` (or EOF)
    const endNodes: Node[] = [];
    $.AT_LEAST_ONE({
      GATE: () => $.LA(1).tokenType !== $.T.LCurly && $.LA(1).tokenType.name !== 'EOF',
      DEF: () => {
        const n = $.SUBRULE($.anyOuterValue, { ARGS: [ctx] }) as unknown as Node;
        endNodes.push(n);
      }
    });

    const name = new Any(dv.image.slice(1), { role: 'property' }, $.getLocationInfo(dv), $.context);
    const varDecl = new VarDeclaration({ name, value: new Nil() }, { paramVar: true }, $.getLocationInfo(dv), $.context);

    const startExpr = startNodes.length === 1
      ? startNodes[0]!
      : new Sequence(startNodes, undefined, $.getLocationFromNodes(startNodes), $.context);
    const endExpr = endNodes.length === 1
      ? endNodes[0]!
      : new Sequence(endNodes, undefined, $.getLocationFromNodes(endNodes), $.context);

    $.CONSUME($.T.LCurly);
    const rules = $.SUBRULE($.atRuleBody, { ARGS: [{ ...ctx, inner: !!ctx.inner }] });
    $.CONSUME($.T.RCurly);
    const loc = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }
    return new For({
      pattern: { kind: 'single', value: varDecl },
      iterable: {
        kind: 'range',
        start: startExpr,
        end: endExpr,
        includeStart: true,
        includeEnd
      },
      rules: rules.rules
    }, undefined, loc, $.context);
  };
}

export function scssEachAtRule(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const $ = this;
    $.startRule();
    $.CONSUME($.T.AtKeyword); // assumed '@each'

    // Sass: `@each $a[, $b ...] in <expr> { ... }`
    // Normalize to Jess `$for` shape (JS-like):
    // - single var: `($item of <expr>)`
    // - destructure: `([$one, $two] of <expr>)`
    const vars: VarDeclaration[] = [];

    // One or more `$var` separated by commas.
    do {
      const dv = $.CONSUME($.T.DollarVariable);
      const varName = new Any(dv.image.slice(1), { role: 'property' }, $.getLocationInfo(dv), $.context);
      // Param-like var decl (prints `$name` with no `: <value>`).
      vars.push(new VarDeclaration({ name: varName, value: new Nil() }, { paramVar: true }, $.getLocationInfo(dv), $.context));
      if ($.LA(1).tokenType === $.T.Comma) {
        $.CONSUME($.T.Comma);
      } else {
        break;
      }
    } while (true);

    // consume `in` keyword (Ident or PlainIdent depending on token mode)
    if ($.LA(1).tokenType === $.T.Ident) {
      $.CONSUME($.T.Ident);
    } else {
      $.CONSUME($.T.PlainIdent);
    }

    // Parse the iterable expression as a value sequence (stops before `{` naturally).
    const rawExpr = $.SUBRULE($.valueSequence, { ARGS: [ctx] }) as unknown as Node;

    if ($.RECORDING_PHASE) {
      return rawExpr;
    }

    const expr = isNode(rawExpr, N.Expression) ? rawExpr.node : rawExpr;

    $.CONSUME($.T.LCurly);
    const rules = $.SUBRULE($.atRuleBody, { ARGS: [{ ...ctx, inner: !!ctx.inner }] });
    $.CONSUME($.T.RCurly);
    const loc = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }
    const pattern = vars.length === 1
      ? { kind: 'single' as const, value: vars[0]! }
      : { kind: 'tuple' as const, values: vars as [VarDeclaration, ...VarDeclaration[]] };
    return new For({
      pattern,
      iterable: { kind: 'node', value: expr },
      rules: rules.rules
    }, undefined, loc, $.context);
  };
}

export function scssWhileAtRule(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const $ = this;
    $.startRule();
    $.CONSUME($.T.AtKeyword); // assumed '@while'

    const condition = $.SUBRULE($.scssCondition, { ARGS: [ctx] }) as unknown as Node | undefined;

    $.CONSUME($.T.LCurly);
    const rules = $.SUBRULE($.atRuleBody, { ARGS: [{ ...ctx, inner: !!ctx.inner }] });
    $.CONSUME($.T.RCurly);
    const loc = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }
    return new While({ condition: condition!, rules: rules.rules }, undefined, loc, $.context);
  };
}

export function scssMixinAtRule(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const $ = this;
    $.startRule();
    $.CONSUME($.T.AtKeyword); // assumed '@mixin' (dispatched by unknownAtRule)
    let nameTok: IToken | undefined;
    let nameNode: Any<'name'> | Interpolated<'name'> | undefined;
    let hasParamsFromStart = false;

    if ($.RECORDING_PHASE) {
      $.OR([
        {
          GATE: () => $.matchToken($.LA(1), $.T.FunctionStart),
          ALT: () => {
            nameTok = $.CONSUME($.T.FunctionStart) as unknown as IToken;
            hasParamsFromStart = true;
          }
        },
        {
          GATE: () => $.matchToken($.LA(1), $.T.GenericFunctionStart),
          ALT: () => {
            nameTok = $.CONSUME($.T.GenericFunctionStart) as unknown as IToken;
            hasParamsFromStart = true;
          }
        },
        { ALT: () => {
          nameNode = parseScssNameNode($, ctx, new Set([$.T.LParen, $.T.LCurly]));
        } }
      ]);
    } else if ($.matchToken($.LA(1), $.T.FunctionStart)) {
      nameTok = $.CONSUME($.T.FunctionStart) as unknown as IToken;
      hasParamsFromStart = true;
    } else if ($.matchToken($.LA(1), $.T.GenericFunctionStart)) {
      nameTok = $.CONSUME($.T.GenericFunctionStart) as unknown as IToken;
      hasParamsFromStart = true;
    } else {
      nameNode = parseScssNameNode($, ctx, new Set([$.T.LParen, $.T.LCurly]));
    }

    let params: List | undefined;
    $.OR([
      {
        GATE: () => hasParamsFromStart,
        ALT: () => {
          params = $.SUBRULE($.scssMixinParamsAfterFunctionStart, { ARGS: [ctx] }) as unknown as List;
        }
      },
      {
        GATE: () => $.LA(1).tokenType === $.T.LParen,
        ALT: () => {
          params = $.SUBRULE($.scssMixinParams, { ARGS: [ctx] }) as unknown as List;
        }
      },
      { ALT: () => {} }
    ]);

    $.CONSUME($.T.LCurly);
    const rules = $.SUBRULE($.declarationList, { ARGS: [{ ...ctx, inner: true }] });
    $.CONSUME($.T.RCurly);

    const loc = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }

    // Sass-style: inner vars/mixins should not be publicly visible by default.
    rules.options.rulesVisibility ??= {};
    rules.options.rulesVisibility.VarDeclaration ??= 'private';
    rules.options.rulesVisibility.Mixin ??= 'private';
    const finalNameNode = nameNode ?? (() => {
      const mixinName = ($.matchToken(nameTok as any, $.T.FunctionStart) || $.matchToken(nameTok as any, $.T.GenericFunctionStart))
        ? String(nameTok!.image).slice(0, -1)
        : String(nameTok!.image);
      return new Any(mixinName, { role: 'name' }, $.getLocationInfo(nameTok!), $.context);
    })();

    return new Mixin(
      { name: finalNameNode, params, rules: rules.rules },
      undefined,
      loc,
      $.context
    );
  };
}

export function scssMixinParams(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const $ = this;
    $.startRule();
    $.CONSUME($.T.LParen);
    const params: Node[] = [];

    $.OPTION(() => {
      params.push($.SUBRULE($.scssMixinParam, { ARGS: [ctx] }) as unknown as Node);
      $.MANY(() => {
        $.CONSUME($.T.Comma);
        $.OPTION2({
          GATE: () => $.LA(1).tokenType !== $.T.RParen,
          DEF: () => {
            params.push($.SUBRULE2($.scssMixinParam, { ARGS: [ctx] }) as unknown as Node);
          }
        });
      });
    });

    $.CONSUME($.T.RParen);
    const loc = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }
    return new List(params, undefined, loc, $.context);
  };
}

export function scssMixinParamsAfterFunctionStart(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const $ = this;
    $.startRule();
    const params: Node[] = [];

    $.OPTION(() => {
      params.push($.SUBRULE($.scssMixinParam, { ARGS: [ctx] }) as unknown as Node);
      $.MANY(() => {
        $.CONSUME($.T.Comma);
        $.OPTION2({
          GATE: () => $.LA(1).tokenType !== $.T.RParen,
          DEF: () => {
            params.push($.SUBRULE2($.scssMixinParam, { ARGS: [ctx] }) as unknown as Node);
          }
        });
      });
    });

    $.CONSUME($.T.RParen);
    const loc = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }
    return new List(params, undefined, loc, $.context);
  };
}

export function scssMixinParam(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const $ = this;
    $.startRule();

    let node: Node | undefined;
    $.OR([
    // Legacy JessCSS form: ...$rest
      {
        GATE: () => $.LA(1).tokenType?.name === 'Ellipsis' || $.LA(1).image === '...',
        ALT: () => {
          $.CONSUME($.T.Ellipsis);
          const dv = $.CONSUME($.T.DollarVariable);
          node = new Rest(dv.image.slice(1), undefined, $.getLocationInfo(dv), $.context);
        }
      },
      {
        ALT: () => {
          const dv = $.CONSUME($.T.DollarVariable);
          if ($.LA(1).tokenType === $.T.Ellipsis) {
            $.CONSUME2($.T.Ellipsis);
            node = new Rest(dv.image.slice(1), undefined, $.getLocationInfo(dv), $.context);
            return;
          }
          let defaultValue: Node | undefined;
          $.OPTION(() => {
          // In SCSS, default params use `:`, which is tokenized under the Assign category.
            $.CONSUME($.T.Assign);
            defaultValue = $.SUBRULE($.valueSequence, { ARGS: [ctx] });
          });
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
    ]);

    $.endRule();
    return node!;
  };
}

export function scssMediaPrelude(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const $ = this;
    $.startRule();
    const nodes: Node[] = [];

    $.MANY({
      GATE: () => $.LA(1).tokenType !== $.T.LCurly && $.LA(1).tokenType.name !== 'EOF',
      DEF: () => {
        const n = $.OR([
          {
            GATE: () => $.LA(1).tokenType === $.T.InterpolationStart,
            ALT: () => {
              $.CONSUME($.T.InterpolationStart);
              const expr = $.SUBRULE($.valueSequence, { ARGS: [ctx] }) as unknown as Node;
              $.CONSUME($.T.RCurly);
              return new Interpolated(
                { source: INTERPOLATION_PLACEHOLDER, replacements: [expr] },
                { role: 'any' },
                $.getLocationFromNodes([expr]),
                $.context
              );
            }
          },
          { ALT: () => $.SUBRULE($.anyOuterValue, { ARGS: [ctx] }) }
        ]) as unknown as Node;

        nodes.push(n);
      }
    });

    const loc = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }
    if (nodes.length === 1) {
      return nodes[0]!;
    }
    return new Sequence(nodes, undefined, loc, $.context);
  };
}

export function mediaAtRule(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const $ = this;
    // Use CSS implementation and inject only the prelude rule.
    return cssMediaAtRule.call($, $.T, 'scssMediaPrelude')(ctx);
  };
}

export function scssSupportsPrelude(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const $ = this;
    $.startRule();
    const nodes: Node[] = [];

    $.MANY({
      GATE: () => $.LA(1).tokenType !== $.T.LCurly && $.LA(1).tokenType.name !== 'EOF',
      DEF: () => {
        const n = $.OR([
          {
            GATE: () => $.LA(1).tokenType === $.T.InterpolationStart,
            ALT: () => {
              $.CONSUME($.T.InterpolationStart);
              const expr = $.SUBRULE($.valueSequence, { ARGS: [ctx] }) as unknown as Node;
              $.CONSUME($.T.RCurly);
              return new Interpolated(
                { source: INTERPOLATION_PLACEHOLDER, replacements: [expr] },
                { role: 'any' },
                $.getLocationFromNodes([expr]),
                $.context
              );
            }
          },
          { ALT: () => $.SUBRULE($.anyOuterValue, { ARGS: [ctx] }) }
        ]) as unknown as Node;

        nodes.push(n);
      }
    });

    const loc = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }
    if (nodes.length === 1) {
      return nodes[0]!;
    }
    return new Sequence(nodes, undefined, loc, $.context);
  };
}

export function supportsAtRule(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const $ = this;
    // Reimplemented to use scssSupportsPrelude instead of supportsCondition,
    // since the CSS misc.ts supportsAtRule does not accept a prelude rule parameter.
    $.startRule();
    const name = $.CONSUME($.T.AtSupports);
    const prelude: Node = $.SUBRULE($.scssSupportsPrelude, { ARGS: [ctx] }) as unknown as Node;
    $.CONSUME($.T.LCurly);
    const rules = $.SUBRULE($.atRuleBody, { ARGS: [ctx] }) as Rules;
    $.CONSUME($.T.RCurly);
    const location = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }
    return new AtRule({
      name: new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), $.context),
      prelude: prelude,
      rules: rules.rules
    }, { nestable: true }, location, $.context);
  };
}

export function scssContainerPrelude(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const $ = this;
    $.startRule();
    const nodes: Node[] = [];

    $.MANY({
      GATE: () => $.LA(1).tokenType !== $.T.LCurly && $.LA(1).tokenType.name !== 'EOF',
      DEF: () => {
        const n = $.OR([
          {
            GATE: () => $.LA(1).tokenType === $.T.InterpolationStart,
            ALT: () => {
              $.CONSUME($.T.InterpolationStart);
              const expr = $.SUBRULE($.valueSequence, { ARGS: [ctx] }) as unknown as Node;
              $.CONSUME($.T.RCurly);
              return new Interpolated(
                { source: INTERPOLATION_PLACEHOLDER, replacements: [expr] },
                { role: 'any' },
                $.getLocationFromNodes([expr]),
                $.context
              );
            }
          },
          { ALT: () => $.SUBRULE($.anyOuterValue, { ARGS: [ctx] }) }
        ]) as unknown as Node;

        nodes.push(n);
      }
    });

    const loc = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }
    if (nodes.length === 1) {
      return nodes[0]!;
    }
    return new Sequence(nodes, undefined, loc, $.context);
  };
}

export function containerAtRule(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const $ = this;
    // Use CSS implementation and inject only the prelude rule.
    return cssContainerAtRule.call($, $.T, 'scssContainerPrelude')(ctx);
  };
}

export function scssScopePrelude(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const $ = this;
    $.startRule();
    const nodes: Node[] = [];

    $.MANY({
      GATE: () => $.LA(1).tokenType !== $.T.LCurly && $.LA(1).tokenType.name !== 'EOF',
      DEF: () => {
        const n = $.OR([
          {
            GATE: () => $.LA(1).tokenType === $.T.InterpolationStart,
            ALT: () => {
              $.CONSUME($.T.InterpolationStart);
              const expr = $.SUBRULE($.valueSequence, { ARGS: [ctx] }) as unknown as Node;
              $.CONSUME($.T.RCurly);
              return new Interpolated(
                { source: INTERPOLATION_PLACEHOLDER, replacements: [expr] },
                { role: 'any' },
                $.getLocationFromNodes([expr]),
                $.context
              );
            }
          },
          { ALT: () => $.SUBRULE($.anyOuterValue, { ARGS: [ctx] }) }
        ]) as unknown as Node;

        nodes.push(n);
      }
    });

    const loc = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }
    if (nodes.length === 1) {
      return nodes[0]!;
    }
    return new Sequence(nodes, undefined, loc, $.context);
  };
}

export function scopeAtRule(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const $ = this;
    // Use CSS implementation and inject only the prelude rule.
    return cssScopeAtRule.call($, $.T, 'scssScopePrelude')(ctx);
  };
}

/**
 * Override CSS `unknownAtRule` to special-case Sass directives.
 *
 * We do this (instead of extending `atRule`) because the CSS parser's
 * lookahead will otherwise choose `unknownAtRule` and skip our custom
 * alternatives.
 */
export function unknownAtRule(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const $ = this;
    const img = $.LA(1).image;
    if (img === '@use') {
      return $.SUBRULE($.scssUseAtRule, { ARGS: [ctx] });
    }
    if (img === '@forward') {
      return $.SUBRULE($.scssForwardAtRule, { ARGS: [ctx] });
    }
    if (img === '@extend') {
      return $.SUBRULE($.scssExtendAtRule, { ARGS: [ctx] });
    }
    if (img === '@content') {
      return $.SUBRULE($.scssContentAtRule, { ARGS: [ctx] });
    }
    if (img === '@if') {
      return $.SUBRULE($.scssIfAtRule, { ARGS: [ctx] });
    }
    if (img === '@for') {
      return $.SUBRULE($.scssForAtRule, { ARGS: [ctx] });
    }
    if (img === '@each') {
      return $.SUBRULE($.scssEachAtRule, { ARGS: [ctx] });
    }
    if (img === '@while') {
      return $.SUBRULE($.scssWhileAtRule, { ARGS: [ctx] });
    }
    if (img === '@include') {
      return $.SUBRULE($.scssIncludeAtRule, { ARGS: [ctx] });
    }
    if (img === '@mixin') {
      return $.SUBRULE($.scssMixinAtRule, { ARGS: [ctx] });
    }
    if (img === '@function') {
      return $.SUBRULE($.scssFunctionAtRule, { ARGS: [ctx] });
    }
    if (img === '@return') {
      return $.SUBRULE($.scssReturnAtRule, { ARGS: [ctx] });
    }
    if (img === '@debug' || img === '@warn' || img === '@error') {
      return $.SUBRULE($.scssDiagnosticAtRule, { ARGS: [ctx] });
    }
    if (img === '@at-root') {
      return $.SUBRULE($.scssAtRootAtRule, { ARGS: [ctx] });
    }
    return cssUnknownAtRule.call($, $.T)(ctx);
  };
}

/**
 * SCSS: `@return <value>;` → `$result: <value>;`
 */
export function scssReturnAtRule(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const $ = this;
    $.startRule();
    $.CONSUME($.T.AtKeyword); // '@return'
    // Use valueList to allow expressions like `$a + $b` (Sass return values commonly include operations).
    const value = $.SUBRULE($.valueList, { ARGS: [ctx] }) as unknown as Node;
    $.CONSUME($.T.Semi);
    const loc = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }
    const name = new Any('result', { role: 'property' }, loc, $.context);
    return new VarDeclaration({ name, value: value }, undefined, loc, $.context);
  };
}

/**
 * SCSS: `@function name($a, $b: 1) { ... }`
 *
 * Parsed as a `Func` node with a `body` (Rules) and `params` list, and registered in the function registry.
 * Return value is represented by a `$result: <value>;` variable declaration (see `@return`).
 */
export function scssFunctionAtRule(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const $ = this;
    $.startRule();
    $.CONSUME($.T.AtKeyword); // '@function'

    let nameTok: IToken | undefined;
    let params: List | undefined;
    let hasParamsFromStart = false;

    $.OR([
      {
      // Function-like names are a single token, including `ns.fn(`.
        GATE: () => $.isTypeAt(1, $.T.FunctionStart),
        ALT: () => {
          nameTok = $.CONSUME($.T.FunctionStart) as unknown as IToken;
          hasParamsFromStart = true;
        }
      },
      {
        ALT: () => {
          nameTok = $.OR2([
            { GATE: () => $.isTypeAt(1, $.T.Ident), ALT: () => $.CONSUME($.T.Ident) },
            { ALT: () => $.CONSUME($.T.PlainIdent) }
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
        GATE: () => $.LA(1).tokenType === $.T.LParen,
        ALT: () => {
          params = $.SUBRULE($.scssMixinParams, { ARGS: [ctx] }) as unknown as List;
        }
      },
      { ALT: () => undefined }
    ]);

    $.CONSUME($.T.LCurly);
    const bodyRules = $.SUBRULE($.declarationList, { ARGS: [{ ...ctx, inner: true }] }) as unknown as Rules;
    $.CONSUME($.T.RCurly);

    const loc = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }

    // Keep function body "private-ish" by default, like Sass.
    bodyRules.options.rulesVisibility ??= {};
    bodyRules.options.rulesVisibility.VarDeclaration ??= 'private';
    bodyRules.options.rulesVisibility.Mixin ??= 'private';
    bodyRules.options.rulesVisibility.Ruleset ??= 'private';
    const tok = nameTok ?? ($.LA(0) as unknown as IToken);
    const rawName = hasParamsFromStart ? String(tok.image).slice(0, -1) : String(tok.image);
    const fnName = new Any(rawName, { role: 'name' }, $.getLocationInfo(tok), $.context);
    return new Func(
      { name: fnName, params, body: bodyRules },
      { returnName: 'result' },
      loc,
      $.context
    );
  };
}

/**
 * SCSS: `@debug <expr>;`, `@warn <expr>;`, `@error <expr>;`
 *
 * Parsed as `Log` nodes. These are diagnostic at-rules that output messages during compilation.
 * They serialize to empty strings since they're not supported in Jess syntax.
 */
export function scssDiagnosticAtRule(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const $ = this;
    $.startRule();
    const atKeyword = $.CONSUME($.T.AtKeyword) as unknown as IToken; // '@debug', '@warn', or '@error'
    // Parse the diagnostic message as a value sequence (stops at `;` naturally).
    const message = $.SUBRULE($.valueSequence, { ARGS: [ctx] }) as unknown as Node;
    $.CONSUME($.T.Semi);
    const loc = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }
    const keywordImage = atKeyword.image;
    // Extract level from @debug, @warn, or @error
    const level = keywordImage.slice(1) as 'debug' | 'warn' | 'error';
    return new Log(
      { level, message: message },
      undefined,
      loc,
      $.context
    );
  };
}

/**
 * SCSS: `@at-root [selector] { ... }` or `@at-root (without: media) { ... }`
 *
 * Plain `@at-root { ... }` is lowered by prefixing contained value with a
 * null-parent ampersand template so they hoist naturally during selector
 * composition. Prelude/filter forms remain preserved as unsupported at-rules.
 */
export function scssAtRootAtRule(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const $ = this;
    $.startRule();
    const atKeyword = $.CONSUME($.T.AtKeyword) as unknown as IToken; // '@at-root'

    // Parse optional selector or control arguments
    let prelude: Node | undefined;
    let preludeKind = 'none' as 'selector' | 'filter' | 'none' | string;
    $.OR([
      {
      // @at-root (without: media) or @at-root (with: rule)
        GATE: () => $.LA(1).tokenType === $.T.LParen,
        ALT: () => {
          preludeKind = 'filter';
          prelude = $.SUBRULE($.valueSequence, { ARGS: [ctx] }) as unknown as Node;
        }
      },
      {
      // @at-root .selector { ... }
        GATE: () => {
          const next = $.LA(1);
          return $.matchToken(next, $.T.NestedRuleStart)
            && next.tokenType !== $.T.AtKeyword
            && next.tokenType !== $.T.LParen;
        },
        ALT: () => {
          preludeKind = 'selector';
          // Parse as a selector list (CSS parser method)
          prelude = $.SUBRULE($.selectorList, { ARGS: [ctx] }) as unknown as Node;
        }
      },
      {
      // @at-root { ... } (no prelude)
        ALT: () => {}
      }
    ]);

    let rules: RulesType;
    $.CONSUME($.T.LCurly);
    if (preludeKind === 'selector') {
      rules = $.SUBRULE($.declarationList, { ARGS: [{ ...ctx, inner: true }] }) as unknown as RulesType;
    } else {
      rules = $.SUBRULE($.atRuleBody, { ARGS: [{ ...ctx, inner: !!ctx.inner }] }) as unknown as RulesType;
    }
    $.CONSUME($.T.RCurly);

    const loc = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }

    if (preludeKind === 'selector' && prelude) {
      return new Ruleset(
        {
          selector: prefixAtRootSelector(prelude as Selector, $.context),
          rules: rules.rules
        },
        undefined,
        loc,
        $.context
      );
    }

    if (!prelude) {
      lowerPlainAtRootRules(rules as RulesType, $.context);
      const flattened = [...(rules as RulesType).rules];
      if (flattened.length === 0) {
        return new Nil(undefined, undefined, loc, $.context);
      }
      for (const node of flattened.slice(0, -1)) {
        $.enqueuePendingNode(node);
      }
      return flattened[flattened.length - 1]!;
    }

    const name = new Any(atKeyword.image, { role: 'atkeyword' }, $.getLocationInfo(atKeyword), $.context);
    const atRule = new AtRule({ name, prelude: prelude ? prelude : undefined, rules: rules.rules }, undefined, loc, $.context);
    saveUnsupportedSyntaxError(
      $,
      atKeyword,
      loc,
      '@at-root prelude/filter forms are not yet supported in Jess. Write the hoisted rules directly instead.'
    );

    return atRule;
  };
}
