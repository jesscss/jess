// SCSS at-rule production rules for ScssRecursiveParser
// Converted from lines 1184-3096 of productions.ts (Chevrotain → hand-written recursive-descent)
import type { RuleContext } from '../scssRecursiveParser.js';
import type { IToken } from '@jesscss/parser-runtime';
import { tokenMatches } from '@jesscss/parser-runtime';
import { CssRecursiveParser } from '@jesscss/css-parser';
import {
  Any,
  AtRule,
  Call,
  Collection,
  Declaration,
  Expression,
  Extend,
  F_VISIBLE,
  For,
  Func,
  If,
  type IfBranch,
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
  Reference,
  Rest,
  Rules,
  Sequence,
  StyleImport,
  VarDeclaration,
  While,
  type AssignmentType,
  type Node,
  type Rules as RulesType,
  type Selector
} from '@jesscss/core';
import {
  makeNamespacedReference,
  makePublicDirectiveRules,
  isScriptUsePath,
  quotedLike,
  defaultNamespaceFromPath
} from './helpers.js';

/** Use `any` for `this` to avoid structural incompatibility */
type P = any;

// Save CSS prototype methods for super calls
const cssMediaAtRule = CssRecursiveParser.prototype.mediaAtRule;
const cssContainerAtRule = CssRecursiveParser.prototype.containerAtRule;
const cssScopeAtRule = CssRecursiveParser.prototype.scopeAtRule;
const cssUnknownAtRule = CssRecursiveParser.prototype.unknownAtRule;

/**
 * SCSS: `@use` → `StyleImport(type='compose')` for stylesheets,
 * and `JsImport` for script paths. `sass:*` built-ins are rewritten
 * to `#sass/*` and imported as `JsImport`.
 */
export function scssUseAtRule(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  $.CONSUME($.T.AtKeyword); // '@use'

  const pathNode = $.string(ctx) as unknown as Quoted;
  const rawPath = pathNode.valueOf();

  let namespace: string | undefined;

  // optional "as <ident|*>"
  if ($.la(1).image === 'as') {
    $.OPTION(() => {
      $.CONSUME($.T.Ident);
      $.OR([
        { ALT: () => {
          namespace = $.CONSUME($.T.Ident).image;
        } },
        { ALT: () => {
          $.CONSUME($.T.Star);
          namespace = '*';
        } }
      ]);
    });
  }

  // optional "with (...)"
  let withRules: Collection | undefined;
  if ($.la(1).image === 'with') {
    $.OPTION(() => {
      $.CONSUME($.T.Ident);
      withRules = $.scssWithConfig(ctx) as unknown as Collection;
    });
  }

  $.CONSUME($.T.Semi);

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
}

/**
 * SCSS: `@forward` → `StyleImport(type='compose')` with `(forward)` semantics:
 * - forward: true (not visible locally; available downstream)
 * - (compose is protected by default unless `mutable: true`)
 *
 * Full show/hide/as parsing is deferred; we currently ignore extra prelude tokens.
 */
export function scssForwardAtRule(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  const atKeyword = $.CONSUME($.T.AtKeyword) as unknown as IToken; // '@forward'

  const pathNode = $.string(ctx) as unknown as Quoted;

  const isWithConfigStart = () => $.la(1).image === 'with' && $.la(2).tokenType === $.T.LParen;

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
    GATE: () => $.la(1).tokenType !== $.T.Semi && !isWithConfigStart(),
    DEF: () => {
      const la = $.la(1);
      // optional "as <prefix>-*"
      if ((la.tokenType === $.T.Ident || la.tokenType === $.T.PlainIdent) && la.image === 'as') {
        // "as" may be Ident or PlainIdent depending on token mode.
        if ($.la(1).tokenType === $.T.Ident) {
          $.CONSUME($.T.Ident);
        } else {
          $.CONSUME($.T.PlainIdent);
        }

        // The prefix is typically tokenized as a single ident/plainident (often including the trailing '-').
        const tok = ($.la(1).tokenType === $.T.Ident)
          ? ($.CONSUME($.T.Ident) as unknown as IToken)
          : ($.CONSUME($.T.PlainIdent) as unknown as IToken);

        // If the `*` was split into its own token, consume it (and optional '-' if present as Unknown).
        if (
          ($.la(1).tokenType === $.T.Unknown && $.la(1).image === '-' && $.la(2).tokenType === $.T.Star)
          || $.la(1).tokenType === $.T.Star
        ) {
          if ($.la(1).tokenType === $.T.Unknown && $.la(1).image === '-') {
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
        const kw = ($.la(1).tokenType === $.T.Ident)
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
        const t = ($.la(1).tokenType === $.T.DollarVariable)
          ? ($.CONSUME($.T.DollarVariable) as unknown as IToken)
          : (
              $.la(1).tokenType === $.T.Ident
                ? ($.CONSUME($.T.Ident) as unknown as IToken)
                : ($.CONSUME($.T.PlainIdent) as unknown as IToken)
            );
        (forwardListMode === 'show' ? forwardShow : forwardHide)!.push(t.image);
        return;
      }
      // Otherwise, consume generic prelude tokens we don't handle yet.
      $.anyOuterValue(ctx);
    }
  });

  // optional "with (...)"
  let withRules: Collection | undefined;
  // Tight gate to avoid ambiguity warnings.
  // Note: "with" may be tokenized as PlainIdent depending on mode/categories.
  if (isWithConfigStart()) {
    $.OPTION(() => {
      // "with" may be Ident or PlainIdent depending on token mode.
      $.OR([
        { GATE: () => $.la(1).tokenType === $.T.Ident, ALT: () => $.CONSUME($.T.Ident) },
        { ALT: () => $.CONSUME($.T.PlainIdent) }
      ]);
      withRules = $.scssWithConfig(ctx) as unknown as Collection;
    });
  }

  $.CONSUME($.T.Semi);

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

/**
 * SCSS: `@extend <selector-list> [!optional];`
 *
 * We parse it into Jess `Extend` nodes (Sass default flag = All).
 * `!optional` is accepted (so sass-spec parses) but ignored in evaluation.
 */
export function scssExtendAtRule(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  $.CONSUME($.T.AtKeyword); // '@extend'

  const target = $.selectorList(ctx) as unknown as Node;

  // Accept (but ignore) any trailing bits like `!optional`
  $.MANY({
    GATE: () => $.la(1).tokenType !== $.T.Semi && $.la(1).tokenType.name !== 'EOF',
    DEF: () => {
      $.anyOuterValue(ctx);
    }
  });

  $.CONSUME($.T.Semi);
  const loc = $.endRule();

  // Sass module system: placeholders are not namespaced, but they can come from upstream modules.
  // For placeholder targets (tokenized as `\\foo`), we set `allNamespaces: true` so extend lookup
  // searches all file roots, regardless of namespace scoping.
  const isPlaceholderTarget = (sel: Node): boolean => {
    const sv = (sel as any).value;
    if (typeof sv === 'string' && sv.startsWith('\\')) {
      return true;
    }
    if (Array.isArray(sv) && sv.length === 1) {
      const only = sv[0];
      return typeof only?.value === 'string' && only.value.startsWith('\\');
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
}

/**
 * Parses Sass `with (...)` config into a Rules node of VarDeclarations.
 */
export function scssWithConfig(this: P, ctx: RuleContext = {}) {
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
        const value = $.valueSequence(ctx);
        // Sass config vars can include flags like `!default` and `!global`.
        // Mirror SCSS variable declaration behavior so these semantics survive into core.
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
  return new Collection(decls, undefined, loc, $.context) as unknown as RulesType;
}

/**
 * SCSS: `@content` → `$content()` (Expression(Call(Reference('content'))))
 */
export function scssContentAtRule(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  $.CONSUME($.T.AtKeyword); // assumed '@content' (dispatched by unknownAtRule)
  let args: List | undefined;
  $.OPTION(() => {
    $.CONSUME($.T.LParen);
    $.OPTION(() => {
      args = $.functionCallArgs(ctx) as unknown as List;
    });
    $.CONSUME($.T.RParen);
  });
  $.OPTION(() => $.CONSUME($.T.Semi));

  const loc = $.endRule();
  const ref = new Reference({ key: 'content' }, { type: 'variable' }, loc, $.context);
  const call = new Call({ name: ref, args }, undefined, loc, $.context);
  return new Expression(call, undefined, loc, $.context);
}

/**
 * SCSS: `@include name(args...)` → mixin call (Call(Reference(type='mixin'))).
 *
 * Note: content blocks are parsed as a named argument `$content: <mixin>`
 * (parse-only). The evaluation semantics for binding it to the call scope
 * are implemented later.
 */
export function scssIncludeAtRule(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  $.CONSUME($.T.AtKeyword); // assumed '@include' (dispatched by unknownAtRule)

  let mixinKey: string | undefined;
  let mixinNameRef: Reference | undefined;
  let nameHasOpenParen = false;
  $.OR([
    {
      // Sass parity: interpolation in mixin names is not valid syntax.
      GATE: () => $.la(1).tokenType === $.T.InterpolationStart || $.la(2).tokenType === $.T.InterpolationStart,
      ALT: () => {
        $.AT_LEAST_ONE({
          DEF: () => {
            $.OR([
              {
                GATE: () => $.la(1).tokenType === $.T.InterpolationStart,
                ALT: () => {
                  $.CONSUME($.T.InterpolationStart);
                  $.valueSequence(ctx);
                  $.CONSUME($.T.RCurly);
                }
              },
              {
                ALT: () => {
                  $.CONSUME($.T.Ident);
                }
              }
            ]);
          }
        });
        throw new Error('SCSS does not allow interpolation in mixin names for @include.');
      }
    },
    {
      // Mixin call where lexer tokenizes `name(` as a single token.
      // e.g. `@include wrap(red);` may arrive as FunctionStart("wrap(") + ...
      GATE: () => tokenMatches($.la(1), $.T.FunctionStart) || tokenMatches($.la(1), $.T.GenericFunctionStart),
      ALT: () => {
        const nameTok = $.OR([
          { GATE: () => tokenMatches($.la(1), $.T.FunctionStart), ALT: () => $.CONSUME($.T.FunctionStart) },
          { ALT: () => $.CONSUME($.T.GenericFunctionStart) }
        ]) as unknown as IToken;
        const parsedName = nameTok.image.slice(0, -1);
        if (parsedName.includes('.')) {
          const parts = parsedName.split('.').filter(Boolean);
          if (parts.length >= 2) {
            mixinNameRef = makeNamespacedReference($, parts, 'mixin');
          } else {
            mixinKey = parsedName;
          }
        } else {
          mixinKey = parsedName;
        }
        nameHasOpenParen = true;
      }
    },
    {
      // SCSS module-qualified mixin call: `@include ns.foo(...)`
      // Tokenizes as: Ident + DotName(".foo")
      GATE: () =>
        ($.la(1).tokenType === $.T.Ident || $.la(1).tokenType === $.T.PlainIdent)
        && $.la(2).tokenType === $.T.DotName,
      ALT: () => {
        const ns = $.OR([
          { GATE: () => $.la(1).tokenType === $.T.Ident, ALT: () => $.CONSUME($.T.Ident) },
          { ALT: () => $.CONSUME($.T.PlainIdent) }
        ]) as unknown as IToken;
        const dot = $.CONSUME($.T.DotName) as unknown as IToken; // ".foo"
        const key = dot.image.slice(1);
        mixinNameRef = makeNamespacedReference($, [ns.image, key], 'mixin');
      }
    },
    {
      // Escaped module-qualified mixin "ruleset" reference: `@include ns.\#foo(...)` or `@include ns.\.foo(...)`
      // Note: there is no standalone dot token; the '.' is tokenized as Unknown when not part of DotName.
      GATE: () =>
        ($.la(1).tokenType === $.T.Ident || $.la(1).tokenType === $.T.PlainIdent)
        && $.la(2).tokenType === $.T.Unknown
        && $.la(2).image === '.'
        && $.la(3).tokenType === $.T.Unknown
        && $.la(3).image === '\\'
        && ($.la(4).tokenType === $.T.HashName || $.la(4).tokenType === $.T.DotName),
      ALT: () => {
        const ns = $.OR([
          { GATE: () => $.la(1).tokenType === $.T.Ident, ALT: () => $.CONSUME($.T.Ident) },
          { ALT: () => $.CONSUME($.T.PlainIdent) }
        ]) as unknown as IToken;
        $.CONSUME($.T.Unknown); // '.'
        $.CONSUME($.T.Unknown); // '\'
        const member = $.OR([
          { GATE: () => $.la(1).tokenType === $.T.HashName, ALT: () => $.CONSUME($.T.HashName) },
          { ALT: () => $.CONSUME($.T.DotName) }
        ]) as unknown as IToken;
        const key = member.image.slice(1);
        mixinNameRef = makeNamespacedReference($, [ns.image, key], 'mixin-ruleset');
      }
    },
    {
      ALT: () => {
        const ident = $.OR([
          { GATE: () => $.la(1).tokenType === $.T.Ident, ALT: () => $.CONSUME($.T.Ident) },
          { ALT: () => $.CONSUME($.T.PlainIdent) }
        ]) as unknown as IToken;
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
  ]);

  let args: List | undefined;
  if (nameHasOpenParen) {
    // We already consumed the `(` as part of the name token (FunctionStart/GenericFunctionStart).
    $.OPTION(() => {
      args = $.functionCallArgs(ctx) as unknown as List;
    });
    $.CONSUME($.T.RParen);
  } else {
    $.OPTION(() => {
      $.CONSUME($.T.LParen);
      $.OPTION(() => {
        args = $.functionCallArgs(ctx) as unknown as List;
      });
      $.CONSUME($.T.RParen);
    });
  }

  // Optional content block
  let contentRules: RulesType | undefined;
  let usingParams: List | undefined;

  // SCSS: `@include foo() using ($x, $y) { ... }`
  if ($.la(1).image === 'using') {
    $.OPTION(() => {
      $.CONSUME($.T.Ident); // using
      // Sass `using(...)` parameters are just variable names.
      // Represent them as VarDeclaration(paramVar=true, value=Nil()) so they print as `$x`
      // (no `: <default>`), matching Jess' `@($x, $y) { ... }` syntax.
      $.CONSUME($.T.LParen);
      const p: Node[] = [];
      $.OPTION(() => {
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
      });
      $.CONSUME($.T.RParen);
      usingParams = new List(p, undefined, $.getLocationInfo($.la(0)), $.context);
    });
  }

  $.OPTION(() => {
    $.CONSUME($.T.LCurly);
    contentRules = $.atRuleBody({ ...ctx, inner: true }) as unknown as RulesType;
    $.CONSUME($.T.RCurly);
  });

  // Require semicolon only when present (SCSS requires it if no block; we enforce later)
  if ($.la(1).tokenType === $.T.Semi) {
    $.OPTION(() => $.CONSUME($.T.Semi));
  }

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
  return call;
}

export function scssIfAtRule(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  $.CONSUME($.T.AtKeyword); // assumed '@if' (dispatched by unknownAtRule)

  // Parse the condition - returns Paren(Condition(...)) or nested Conditions
  const cond = $.scssCondition(ctx) as unknown as Node | undefined;

  $.CONSUME($.T.LCurly);
  const rules = $.atRuleBody({ ...ctx, inner: !!ctx.inner });
  $.CONSUME($.T.RCurly);

  makePublicDirectiveRules(rules);

  const branches: IfBranch[] = [{ condition: cond, rules }];

  // Consume chained @else / @else if
  $.MANY({
    GATE: () => $.la(1).image === '@else',
    DEF: () => {
      $.CONSUME($.T.AtKeyword); // @else

      let elseCond: Node | undefined;

      // @else if ...
      if ($.la(1).image === 'if') {
        $.OPTION(() => {
          $.CONSUME($.T.Ident); // if (token category)
          elseCond = $.scssCondition(ctx) as unknown as Node;
        });
      }

      $.CONSUME($.T.LCurly);
      const elseRules = $.atRuleBody({ ...ctx, inner: !!ctx.inner });
      $.CONSUME($.T.RCurly);
      makePublicDirectiveRules(elseRules);
      branches.push({ condition: elseCond, rules: elseRules });
    }
  });

  const loc = $.endRule();
  return new If({ branches }, undefined, loc, $.context);
}

export function scssForAtRule(this: P, ctx: RuleContext = {}) {
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
  if ($.la(1).image !== 'from') {
    // Trigger a useful parse error if we don't see `from`.
    $.CONSUME($.T.PlainIdent);
  } else if ($.la(1).tokenType === $.T.PlainIdent) {
    $.CONSUME($.T.PlainIdent);
  } else {
    $.CONSUME($.T.Ident);
  }

  // Parse start expression until we hit `to`/`through`
  const startNodes: Node[] = [];
  $.AT_LEAST_ONE({
    GATE: () => {
      const la = $.la(1);
      // Stop before `to`/`through` regardless of token type.
      return !(la.image === 'to' || la.image === 'through');
    },
    DEF: () => {
      const n = $.anyOuterValue(ctx) as unknown as Node;
      startNodes.push($.wrap(n, 'both'));
    }
  });

  // consume `to` / `through`
  let kw: IToken;
  if ($.la(1).image !== 'to' && $.la(1).image !== 'through') {
    // Trigger a useful parse error if we don't see `to|through`.
    kw = $.CONSUME($.T.PlainIdent) as unknown as IToken;
  } else if ($.la(1).tokenType === $.T.PlainIdent) {
    kw = $.CONSUME($.T.PlainIdent) as unknown as IToken;
  } else {
    kw = $.CONSUME($.T.Ident) as unknown as IToken;
  }
  const includeEnd = kw.image === 'through';

  // Parse end expression until `{` (or EOF)
  const endNodes: Node[] = [];
  $.AT_LEAST_ONE({
    GATE: () => $.la(1).tokenType !== $.T.LCurly && $.la(1).tokenType.name !== 'EOF',
    DEF: () => {
      const n = $.anyOuterValue(ctx) as unknown as Node;
      endNodes.push($.wrap(n, 'both'));
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
  const rules = $.atRuleBody({ ...ctx, inner: !!ctx.inner });
  $.CONSUME($.T.RCurly);
  makePublicDirectiveRules(rules);
  const loc = $.endRule();
  return new For({
    pattern: {
      kind: 'single' as const,
      value: varDecl
    },
    iterable: {
      kind: 'range' as const,
      start: startExpr,
      end: endExpr,
      includeStart: true,
      includeEnd
    },
    rules
  }, undefined, loc, $.context);
}

export function scssEachAtRule(this: P, ctx: RuleContext = {}) {
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
    if ($.la(1).tokenType === $.T.Comma) {
      $.CONSUME($.T.Comma);
    } else {
      break;
    }
  } while (true);

  // consume `in` keyword (Ident or PlainIdent depending on token mode)
  if ($.la(1).tokenType === $.T.Ident) {
    $.CONSUME($.T.Ident);
  } else {
    $.CONSUME($.T.PlainIdent);
  }

  // Parse the iterable expression as a value sequence (stops before `{` naturally).
  const rawExpr = $.valueSequence(ctx) as unknown as Node;

  const expr = isNode(rawExpr, N.Expression)
    ? rawExpr
    : (() => {
        const innerExpr = $.wrap(rawExpr, 'both');
        // Prevent `$` + leading-space output like `$ list`.
        innerExpr.pre = 0;
        return new Expression(innerExpr, undefined, $.getLocationFromNodes([rawExpr]), $.context);
      })();

  const pattern = vars.length > 1
    ? {
        kind: 'tuple' as const,
        values: vars as [VarDeclaration, ...VarDeclaration[]]
      }
    : {
        kind: 'single' as const,
        value: vars[0]!
      };

  $.CONSUME($.T.LCurly);
  const rules = $.atRuleBody({ ...ctx, inner: !!ctx.inner });
  $.CONSUME($.T.RCurly);
  makePublicDirectiveRules(rules);
  const loc = $.endRule();
  return new For({
    pattern,
    iterable: {
      kind: 'node' as const,
      value: expr
    },
    rules
  }, undefined, loc, $.context);
}

export function scssWhileAtRule(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  $.CONSUME($.T.AtKeyword); // assumed '@while'

  const condition = $.scssCondition(ctx) as unknown as Node | undefined;

  $.CONSUME($.T.LCurly);
  const rules = $.atRuleBody({ ...ctx, inner: !!ctx.inner });
  $.CONSUME($.T.RCurly);
  makePublicDirectiveRules(rules);
  const loc = $.endRule();
  return new While({ condition: condition!, rules }, undefined, loc, $.context);
}

export function scssMixinAtRule(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  $.CONSUME($.T.AtKeyword); // assumed '@mixin' (dispatched by unknownAtRule)
  let nameTok: IToken | undefined;
  let hasParamsFromStart = false;

  const looksLikeInterpolatedMixinName = () => {
    for (let i = 1; i < 64; i++) {
      const tok = $.la(i);
      if (tok.tokenType === $.T.LParen || tok.tokenType === $.T.LCurly || tok.tokenType.name === 'EOF') {
        return false;
      }
      if (tok.tokenType === $.T.InterpolationStart) {
        return true;
      }
    }
    return false;
  };

  $.OR([
    {
      // Sass parity: interpolation in mixin names is not valid syntax.
      GATE: () => looksLikeInterpolatedMixinName(),
      ALT: () => {
        $.AT_LEAST_ONE({
          DEF: () => {
            $.OR([
              {
                GATE: () => $.la(1).tokenType === $.T.InterpolationStart,
                ALT: () => {
                  $.CONSUME($.T.InterpolationStart);
                  $.valueSequence(ctx);
                  $.CONSUME($.T.RCurly);
                }
              },
              {
                ALT: () => {
                  $.CONSUME($.T.Ident);
                }
              }
            ]);
          }
        });
        throw new Error('SCSS does not allow interpolation in mixin names for @mixin.');
      }
    },
    {
      GATE: () => tokenMatches($.la(1), $.T.FunctionStart),
      ALT: () => {
        nameTok = $.CONSUME($.T.FunctionStart) as unknown as IToken;
        hasParamsFromStart = true;
      }
    },
    {
      GATE: () => tokenMatches($.la(1), $.T.GenericFunctionStart),
      ALT: () => {
        nameTok = $.CONSUME($.T.GenericFunctionStart) as unknown as IToken;
        hasParamsFromStart = true;
      }
    },
    { ALT: () => {
      nameTok = $.CONSUME($.T.Ident) as unknown as IToken;
    } }
  ]);

  let params: List | undefined;
  $.OR([
    {
      GATE: () => hasParamsFromStart,
      ALT: () => {
        params = $.scssMixinParamsAfterFunctionStart(ctx) as unknown as List;
      }
    },
    {
      GATE: () => $.la(1).tokenType === $.T.LParen,
      ALT: () => {
        params = $.scssMixinParams(ctx) as unknown as List;
      }
    },
    { ALT: () => {} }
  ]);

  $.CONSUME($.T.LCurly);
  const rules = $.declarationList({ ...ctx, inner: true });
  $.CONSUME($.T.RCurly);

  // Sass-style: inner vars/mixins should not be publicly visible by default.
  rules.options.rulesVisibility ??= {};
  rules.options.rulesVisibility.VarDeclaration ??= 'private';
  rules.options.rulesVisibility.Mixin ??= 'private';

  const loc = $.endRule();

  const mixinName = (tokenMatches(nameTok!, $.T.FunctionStart) || tokenMatches(nameTok!, $.T.GenericFunctionStart))
    ? String(nameTok!.image).slice(0, -1)
    : String(nameTok!.image);
  const finalNameNode = new Any(mixinName, { role: 'name' }, $.getLocationInfo(nameTok!), $.context);

  return new Mixin(
    { name: finalNameNode, params, rules },
    undefined,
    loc,
    $.context
  );
}

export function scssMixinParams(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  $.CONSUME($.T.LParen);
  const params: Node[] = [];

  $.OPTION(() => {
    $.AT_LEAST_ONE_SEP({
      SEP: $.T.Comma,
      DEF: () => {
        const p = $.scssMixinParam(ctx) as unknown as Node;
        params.push(p);
      }
    });
  });

  $.CONSUME($.T.RParen);
  const loc = $.endRule();
  return new List(params, undefined, loc, $.context);
}

export function scssMixinParamsAfterFunctionStart(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  const params: Node[] = [];

  $.OPTION(() => {
    $.AT_LEAST_ONE_SEP({
      SEP: $.T.Comma,
      DEF: () => {
        const p = $.scssMixinParam(ctx) as unknown as Node;
        params.push(p);
      }
    });
  });

  $.CONSUME($.T.RParen);
  const loc = $.endRule();
  return new List(params, undefined, loc, $.context);
}

export function scssMixinParam(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();

  let node: Node | undefined;
  $.OR([
    // ...$rest
    {
      GATE: () => $.la(1).tokenType?.name === 'Ellipsis' || $.la(1).image === '...',
      ALT: () => {
        $.CONSUME($.T.Ellipsis);
        const dv = $.CONSUME($.T.DollarVariable);
        node = new Rest(dv.image.slice(1), undefined, $.getLocationInfo(dv), $.context);
      }
    },
    {
      ALT: () => {
        const dv = $.CONSUME($.T.DollarVariable);
        let defaultValue: Node | undefined;
        $.OPTION(() => {
          // In SCSS, default params use `:`, which is tokenized as `Assign` in this lexer setup.
          $.CONSUME($.T.Assign);
          defaultValue = $.valueSequence(ctx);
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
}

export function scssMediaPrelude(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  const nodes: Node[] = [];

  $.MANY({
    GATE: () => $.la(1).tokenType !== $.T.LCurly && $.la(1).tokenType.name !== 'EOF',
    DEF: () => {
      const n = $.OR([
        {
          GATE: () => $.la(1).tokenType === $.T.InterpolationStart,
          ALT: () => {
            $.CONSUME($.T.InterpolationStart);
            const expr = $.valueSequence(ctx) as unknown as Node;
            $.CONSUME($.T.RCurly);
            return new Interpolated(
              { source: INTERPOLATION_PLACEHOLDER, replacements: [expr] },
              { role: 'any' },
              $.getLocationFromNodes([expr]),
              $.context
            );
          }
        },
        { ALT: () => $.anyOuterValue(ctx) }
      ]) as unknown as Node;

      nodes.push($.wrap(n));
    }
  });

  const loc = $.endRule();
  if (nodes.length === 1) {
    return nodes[0]!;
  }
  return new Sequence(nodes, undefined, loc, $.context);
}

export function mediaAtRule(this: P, ctx: RuleContext = {}) {
  const $ = this;
  // Use CSS implementation and inject only the prelude rule.
  return cssMediaAtRule.call($, ctx, 'scssMediaPrelude');
}

export function scssSupportsPrelude(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  const nodes: Node[] = [];

  $.MANY({
    GATE: () => $.la(1).tokenType !== $.T.LCurly && $.la(1).tokenType.name !== 'EOF',
    DEF: () => {
      const n = $.OR([
        {
          GATE: () => $.la(1).tokenType === $.T.InterpolationStart,
          ALT: () => {
            $.CONSUME($.T.InterpolationStart);
            const expr = $.valueSequence(ctx) as unknown as Node;
            $.CONSUME($.T.RCurly);
            return new Interpolated(
              { source: INTERPOLATION_PLACEHOLDER, replacements: [expr] },
              { role: 'any' },
              $.getLocationFromNodes([expr]),
              $.context
            );
          }
        },
        { ALT: () => $.anyOuterValue(ctx) }
      ]) as unknown as Node;

      nodes.push($.wrap(n));
    }
  });

  const loc = $.endRule();
  if (nodes.length === 1) {
    return nodes[0]!;
  }
  return new Sequence(nodes, undefined, loc, $.context);
}

export function supportsAtRule(this: P, ctx: RuleContext = {}) {
  const $ = this;
  // Reimplemented to use scssSupportsPrelude instead of supportsCondition,
  // since the CSS misc.ts supportsAtRule does not accept a prelude rule parameter.
  $.startRule();
  const name = $.CONSUME($.T.AtSupports);
  const prelude: Node = $.scssSupportsPrelude(ctx) as unknown as Node;
  $.CONSUME($.T.LCurly);
  const rules = $.atRuleBody(ctx) as Rules;
  $.CONSUME($.T.RCurly);
  const location = $.endRule();
  return new AtRule({
    name: $.wrap(new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), $.context), true),
    prelude: $.wrap(prelude, 'both'),
    rules
  }, { nestable: true }, location, $.context);
}

export function scssContainerPrelude(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  const nodes: Node[] = [];

  $.MANY({
    GATE: () => $.la(1).tokenType !== $.T.LCurly && $.la(1).tokenType.name !== 'EOF',
    DEF: () => {
      const n = $.OR([
        {
          GATE: () => $.la(1).tokenType === $.T.InterpolationStart,
          ALT: () => {
            $.CONSUME($.T.InterpolationStart);
            const expr = $.valueSequence(ctx) as unknown as Node;
            $.CONSUME($.T.RCurly);
            return new Interpolated(
              { source: INTERPOLATION_PLACEHOLDER, replacements: [expr] },
              { role: 'any' },
              $.getLocationFromNodes([expr]),
              $.context
            );
          }
        },
        { ALT: () => $.anyOuterValue(ctx) }
      ]) as unknown as Node;

      nodes.push($.wrap(n));
    }
  });

  const loc = $.endRule();
  if (nodes.length === 1) {
    return nodes[0]!;
  }
  return new Sequence(nodes, undefined, loc, $.context);
}

export function containerAtRule(this: P, ctx: RuleContext = {}) {
  const $ = this;
  // Use CSS implementation and inject only the prelude rule.
  return cssContainerAtRule.call($, ctx, 'scssContainerPrelude');
}

export function scssScopePrelude(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  const nodes: Node[] = [];

  $.MANY({
    GATE: () => $.la(1).tokenType !== $.T.LCurly && $.la(1).tokenType.name !== 'EOF',
    DEF: () => {
      const n = $.OR([
        {
          GATE: () => $.la(1).tokenType === $.T.InterpolationStart,
          ALT: () => {
            $.CONSUME($.T.InterpolationStart);
            const expr = $.valueSequence(ctx) as unknown as Node;
            $.CONSUME($.T.RCurly);
            return new Interpolated(
              { source: INTERPOLATION_PLACEHOLDER, replacements: [expr] },
              { role: 'any' },
              $.getLocationFromNodes([expr]),
              $.context
            );
          }
        },
        { ALT: () => $.anyOuterValue(ctx) }
      ]) as unknown as Node;

      nodes.push($.wrap(n));
    }
  });

  const loc = $.endRule();
  if (nodes.length === 1) {
    return nodes[0]!;
  }
  return new Sequence(nodes, undefined, loc, $.context);
}

export function scopeAtRule(this: P, ctx: RuleContext = {}) {
  const $ = this;
  // Use CSS implementation and inject only the prelude rule.
  return cssScopeAtRule.call($, ctx, 'scssScopePrelude');
}

/**
 * Override CSS `unknownAtRule` to special-case Sass directives.
 *
 * We do this (instead of extending `atRule`) because the CSS parser's
 * lookahead will otherwise choose `unknownAtRule` and skip our custom
 * alternatives.
 */
export function unknownAtRule(this: P, ctx: RuleContext = {}) {
  const $ = this;
  const img = $.la(1).image;
  if (img === '@use') {
    return $.scssUseAtRule(ctx);
  }
  if (img === '@forward') {
    return $.scssForwardAtRule(ctx);
  }
  if (img === '@extend') {
    return $.scssExtendAtRule(ctx);
  }
  if (img === '@content') {
    return $.scssContentAtRule(ctx);
  }
  if (img === '@if') {
    return $.scssIfAtRule(ctx);
  }
  if (img === '@for') {
    return $.scssForAtRule(ctx);
  }
  if (img === '@each') {
    return $.scssEachAtRule(ctx);
  }
  if (img === '@while') {
    return $.scssWhileAtRule(ctx);
  }
  if (img === '@include') {
    return $.scssIncludeAtRule(ctx);
  }
  if (img === '@mixin') {
    return $.scssMixinAtRule(ctx);
  }
  if (img === '@function') {
    return $.scssFunctionAtRule(ctx);
  }
  if (img === '@return') {
    return $.scssReturnAtRule(ctx);
  }
  if (img === '@debug' || img === '@warn' || img === '@error') {
    return $.scssDiagnosticAtRule(ctx);
  }
  if (img === '@at-root') {
    return $.scssAtRootAtRule(ctx);
  }
  return cssUnknownAtRule.call($, ctx);
}

/**
 * SCSS: `@return <value>;` → `return: <value>;`
 */
export function scssReturnAtRule(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  $.CONSUME($.T.AtKeyword); // '@return'
  // Use valueList to allow expressions like `$a + $b` (Sass return values commonly include operations).
  const value = $.valueList(ctx) as unknown as Node;
  $.CONSUME($.T.Semi);
  const loc = $.endRule();
  const name = new Any('return', { role: 'property' }, loc, $.context);
  return new Declaration({ name, value: $.wrap(value) }, undefined, loc, $.context);
}

/**
 * SCSS: `@function name($a, $b: 1) { ... }`
 *
 * Parsed as a `Func` node with a `body` (Rules) and `params` list, and registered in the function registry.
 * Return value is represented by a `return: <value>;` declaration (see `@return`).
 */
export function scssFunctionAtRule(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  $.CONSUME($.T.AtKeyword); // '@function'

  let nameTok: IToken | undefined;
  let params: List | undefined;
  let hasParamsFromStart = false;

  $.OR([
    {
      // function name may be tokenized as a FunctionStart / GenericFunctionStart (`name(`)
      GATE: () => tokenMatches($.la(1), $.T.FunctionStart),
      ALT: () => {
        nameTok = $.CONSUME($.T.FunctionStart) as unknown as IToken;
        hasParamsFromStart = true;
      }
    },
    {
      GATE: () => tokenMatches($.la(1), $.T.GenericFunctionStart),
      ALT: () => {
        nameTok = $.CONSUME($.T.GenericFunctionStart) as unknown as IToken;
        hasParamsFromStart = true;
      }
    },
    {
      ALT: () => {
        nameTok = $.OR([
          { GATE: () => $.la(1).tokenType === $.T.Ident, ALT: () => $.CONSUME($.T.Ident) },
          { ALT: () => $.CONSUME($.T.PlainIdent) }
        ]) as unknown as IToken;
      }
    }
  ]);

  $.OR([
    {
      GATE: () => hasParamsFromStart,
      ALT: () => {
        params = $.scssMixinParamsAfterFunctionStart(ctx) as unknown as List;
      }
    },
    {
      GATE: () => $.la(1).tokenType === $.T.LParen,
      ALT: () => {
        params = $.scssMixinParams(ctx) as unknown as List;
      }
    },
    { ALT: () => {} }
  ]);

  $.CONSUME($.T.LCurly);
  const bodyRules = $.declarationList({ ...ctx, inner: true }) as unknown as Rules;
  $.CONSUME($.T.RCurly);

  // Keep function body "private-ish" by default, like Sass.
  bodyRules.options.rulesVisibility ??= {};
  bodyRules.options.rulesVisibility.VarDeclaration ??= 'private';
  bodyRules.options.rulesVisibility.Mixin ??= 'private';
  bodyRules.options.rulesVisibility.Ruleset ??= 'private';

  const loc = $.endRule();
  const tok = nameTok ?? ($.la(0) as unknown as IToken);
  const rawName = hasParamsFromStart ? String(tok.image).slice(0, -1) : String(tok.image);
  const fnName = new Any(rawName, { role: 'name' }, $.getLocationInfo(tok), $.context);
  return new Func(
    { name: fnName, params, body: bodyRules },
    undefined,
    loc,
    $.context
  );
}

/**
 * SCSS: `@debug <expr>;`, `@warn <expr>;`, `@error <expr>;`
 *
 * Parsed as `Log` nodes. These are diagnostic at-rules that output messages during compilation.
 * They serialize to empty strings since they're not supported in Jess syntax.
 */
export function scssDiagnosticAtRule(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  const atKeyword = $.CONSUME($.T.AtKeyword) as unknown as IToken; // '@debug', '@warn', or '@error'
  // Parse the diagnostic message as a value sequence (stops at `;` naturally).
  const message = $.valueSequence(ctx) as unknown as Node;
  $.CONSUME($.T.Semi);
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

/**
 * SCSS: `@at-root [selector] { ... }` or `@at-root (without: media) { ... }`
 *
 * Parsed as `AtRule` nodes. This feature is currently unsupported in Jess.
 * A warning is emitted when this directive is encountered.
 */
export function scssAtRootAtRule(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  const atKeyword = $.CONSUME($.T.AtKeyword) as unknown as IToken; // '@at-root'

  // Parse optional selector or control arguments
  let prelude: Node | undefined;
  $.OR([
    {
      // @at-root (without: media) or @at-root (with: rule)
      GATE: () => $.la(1).tokenType === $.T.LParen,
      ALT: () => {
        prelude = $.valueSequence(ctx) as unknown as Node;
      }
    },
    {
      // @at-root .selector { ... }
      GATE: () => {
        const next = $.la(1);
        return next.tokenType === $.T.Ident || next.tokenType === $.T.PlainIdent
          || next.tokenType === $.T.Dot || next.tokenType === $.T.Hash
          || next.tokenType === $.T.Colon || next.tokenType === $.T.LBracket;
      },
      ALT: () => {
        // Parse as a selector list (CSS parser method)
        prelude = $.selectorList(ctx) as unknown as Node;
      }
    },
    {
      // @at-root { ... } (no prelude)
      ALT: () => {}
    }
  ]);

  $.CONSUME($.T.LCurly);
  const rules = $.atRuleBody({ ...ctx, inner: !!ctx.inner });
  $.CONSUME($.T.RCurly);

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
