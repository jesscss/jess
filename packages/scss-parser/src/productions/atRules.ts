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
  this.startRule();
  this.consume(this.T.AtKeyword); // '@use'

  const pathNode = this.string(ctx) as unknown as Quoted;
  const rawPath = pathNode.valueOf();

  let namespace: string | undefined;

  // optional "as <ident|*>"
  if (this.la(1).image === 'as') {
    this.option(() => {
      this.consume(this.T.Ident);
      this.or([
        { ALT: () => {
          namespace = this.consume(this.T.Ident).image;
        } },
        { ALT: () => {
          this.consume(this.T.Star);
          namespace = '*';
        } }
      ]);
    });
  }

  // optional "with (...)"
  let withRules: Collection | undefined;
  if (this.la(1).image === 'with') {
    this.option(() => {
      this.consume(this.T.Ident);
      withRules = this.scssWithConfig(ctx) as unknown as Collection;
    });
  }

  this.consume(this.T.Semi);

  const loc = this.endRule();

  // Built-in sass modules: @use "sass:map" -> @-use "#sass/map"
  if (rawPath.startsWith('sass:')) {
    const mod = rawPath.slice('sass:'.length);
    const rewritten = `#sass/${mod}`;
    const q = quotedLike(pathNode, rewritten, this.context);
    return new JsImport({ path: q }, { namespace: namespace ?? defaultNamespaceFromPath(rawPath) }, loc, this.context);
  }

  if (isScriptUsePath(rawPath)) {
    return new JsImport({ path: pathNode }, { namespace: namespace ?? defaultNamespaceFromPath(rawPath) }, loc, this.context);
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
    this.context
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
  this.startRule();
  const atKeyword = this.consume(this.T.AtKeyword) as unknown as IToken; // '@forward'

  const pathNode = this.string(ctx) as unknown as Quoted;

  const isWithConfigStart = () => this.la(1).image === 'with' && this.la(2).tokenType === this.T.LParen;

  // optional "as <prefix>-*"
  // NOTE: this is parsed inside the prelude loop below (instead of option),
  // to avoid ambiguous-alternative warnings (take vs skip).
  let forwardAsPrefix: string | undefined;

  // optional "show ..." or "hide ..." (parse-only; store raw list)
  let forwardShow: string[] | undefined;
  let forwardHide: string[] | undefined;
  let forwardListMode: 'show' | 'hide' | undefined;
  this.many({
    // Stop before `with (...)` so the option below stays unambiguous.
    GATE: () => this.la(1).tokenType !== this.T.Semi && !isWithConfigStart(),
    DEF: () => {
      const la = this.la(1);
      // optional "as <prefix>-*"
      if ((la.tokenType === this.T.Ident || la.tokenType === this.T.PlainIdent) && la.image === 'as') {
        // "as" may be Ident or PlainIdent depending on token mode.
        if (this.la(1).tokenType === this.T.Ident) {
          this.consume(this.T.Ident);
        } else {
          this.consume(this.T.PlainIdent);
        }

        // The prefix is typically tokenized as a single ident/plainident (often including the trailing '-').
        const tok = (this.la(1).tokenType === this.T.Ident)
          ? (this.consume(this.T.Ident) as unknown as IToken)
          : (this.consume(this.T.PlainIdent) as unknown as IToken);

        // If the `*` was split into its own token, consume it (and optional '-' if present as Unknown).
        if (
          (this.la(1).tokenType === this.T.Unknown && this.la(1).image === '-' && this.la(2).tokenType === this.T.Star)
          || this.la(1).tokenType === this.T.Star
        ) {
          if (this.la(1).tokenType === this.T.Unknown && this.la(1).image === '-') {
            this.consume(this.T.Unknown);
          }
          this.consume(this.T.Star);
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
      if (la.tokenType === this.T.Comma) {
        this.consume(this.T.Comma);
        return;
      }
      // Start of a show/hide list.
      if ((la.tokenType === this.T.Ident || la.tokenType === this.T.PlainIdent) && (la.image === 'show' || la.image === 'hide')) {
        const kw = (this.la(1).tokenType === this.T.Ident)
          ? (this.consume(this.T.Ident) as unknown as IToken)
          : (this.consume(this.T.PlainIdent) as unknown as IToken);
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
        const t = (this.la(1).tokenType === this.T.DollarVariable)
          ? (this.consume(this.T.DollarVariable) as unknown as IToken)
          : (
              this.la(1).tokenType === this.T.Ident
                ? (this.consume(this.T.Ident) as unknown as IToken)
                : (this.consume(this.T.PlainIdent) as unknown as IToken)
            );
        (forwardListMode === 'show' ? forwardShow : forwardHide)!.push(t.image);
        return;
      }
      // Otherwise, consume generic prelude tokens we don't handle yet.
      this.anyOuterValue(ctx);
    }
  });

  // optional "with (...)"
  let withRules: Collection | undefined;
  // Tight gate to avoid ambiguity warnings.
  // Note: "with" may be tokenized as PlainIdent depending on mode/categories.
  if (isWithConfigStart()) {
    this.option(() => {
      // "with" may be Ident or PlainIdent depending on token mode.
      this.or([
        { GATE: () => this.la(1).tokenType === this.T.Ident, ALT: () => this.consume(this.T.Ident) },
        { ALT: () => this.consume(this.T.PlainIdent) }
      ]);
      withRules = this.scssWithConfig(ctx) as unknown as Collection;
    });
  }

  this.consume(this.T.Semi);

  const loc = this.endRule();

  // Emit warnings for unsupported @forward features
  if (forwardAsPrefix) {
    this.warnings.push({
      message: '@forward with "as <prefix>-*" prefixing is not supported in Jess and will never be. Use explicit namespacing instead (e.g., @-compose "theme" as theme; then access as $theme.colors).',
      token: atKeyword,
      deprecation: undefined
    });
  }
  if (forwardShow || forwardHide) {
    this.warnings.push({
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
    this.context
  );
}

/**
 * SCSS: `@extend <selector-list> [!optional];`
 *
 * We parse it into Jess `Extend` nodes (Sass default flag = All).
 * `!optional` is accepted (so sass-spec parses) but ignored in evaluation.
 */
export function scssExtendAtRule(this: P, ctx: RuleContext = {}) {
  this.startRule();
  this.consume(this.T.AtKeyword); // '@extend'

  const target = this.selectorList(ctx) as unknown as Node;

  // Accept (but ignore) any trailing bits like `!optional`
  this.many({
    GATE: () => this.la(1).tokenType !== this.T.Semi && this.la(1).tokenType.name !== 'EOF',
    DEF: () => {
      this.anyOuterValue(ctx);
    }
  });

  this.consume(this.T.Semi);
  const loc = this.endRule();

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
    this.context
  );
}

/**
 * Parses Sass `with (...)` config into a Rules node of VarDeclarations.
 */
export function scssWithConfig(this: P, ctx: RuleContext = {}) {
  this.startRule();
  this.consume(this.T.LParen);

  const decls: VarDeclaration[] = [];

  this.option(() => {
    this.atLeastOneSep({
      SEP: this.T.Comma,
      DEF: () => {
        const dv = this.consume(this.T.DollarVariable);
        this.consume(this.T.Assign);
        const value = this.valueSequence(ctx);
        // Sass config vars can include flags like `!default` and `!global`.
        // Mirror SCSS variable declaration behavior so these semantics survive into core.
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
            this.getLocationInfo(dv),
            this.context
          )
        );
      }
    });
  });

  this.consume(this.T.RParen);
  const loc = this.endRule();
  return new Collection(decls, undefined, loc, this.context) as unknown as RulesType;
}

/**
 * SCSS: `@content` → `$content()` (Expression(Call(Reference('content'))))
 */
export function scssContentAtRule(this: P, ctx: RuleContext = {}) {
  this.startRule();
  this.consume(this.T.AtKeyword); // assumed '@content' (dispatched by unknownAtRule)
  let args: List | undefined;
  this.option(() => {
    this.consume(this.T.LParen);
    this.option(() => {
      args = this.functionCallArgs(ctx) as unknown as List;
    });
    this.consume(this.T.RParen);
  });
  this.option(() => this.consume(this.T.Semi));

  const loc = this.endRule();
  const ref = new Reference({ key: 'content' }, { type: 'variable' }, loc, this.context);
  const call = new Call({ name: ref, args }, undefined, loc, this.context);
  return new Expression(call, undefined, loc, this.context);
}

/**
 * SCSS: `@include name(args...)` → mixin call (Call(Reference(type='mixin'))).
 *
 * Note: content blocks are parsed as a named argument `$content: <mixin>`
 * (parse-only). The evaluation semantics for binding it to the call scope
 * are implemented later.
 */
export function scssIncludeAtRule(this: P, ctx: RuleContext = {}) {
  this.startRule();
  this.consume(this.T.AtKeyword); // assumed '@include' (dispatched by unknownAtRule)

  let mixinKey: string | undefined;
  let mixinNameRef: Reference | undefined;
  let nameHasOpenParen = false;
  this.or([
    {
      // Sass parity: interpolation in mixin names is not valid syntax.
      GATE: () => this.la(1).tokenType === this.T.InterpolationStart || this.la(2).tokenType === this.T.InterpolationStart,
      ALT: () => {
        this.atLeastOne({
          DEF: () => {
            this.or([
              {
                GATE: () => this.la(1).tokenType === this.T.InterpolationStart,
                ALT: () => {
                  this.consume(this.T.InterpolationStart);
                  this.valueSequence(ctx);
                  this.consume(this.T.RCurly);
                }
              },
              {
                ALT: () => {
                  this.consume(this.T.Ident);
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
      GATE: () => tokenMatches(this.la(1), this.T.FunctionStart) || tokenMatches(this.la(1), this.T.GenericFunctionStart),
      ALT: () => {
        const nameTok = this.or([
          { GATE: () => tokenMatches(this.la(1), this.T.FunctionStart), ALT: () => this.consume(this.T.FunctionStart) },
          { ALT: () => this.consume(this.T.GenericFunctionStart) }
        ]) as unknown as IToken;
        const parsedName = nameTok.image.slice(0, -1);
        if (parsedName.includes('.')) {
          const parts = parsedName.split('.').filter(Boolean);
          if (parts.length >= 2) {
            mixinNameRef = makeNamespacedReference(this, parts, 'mixin');
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
        (this.la(1).tokenType === this.T.Ident || this.la(1).tokenType === this.T.PlainIdent)
        && this.la(2).tokenType === this.T.DotName,
      ALT: () => {
        const ns = this.or([
          { GATE: () => this.la(1).tokenType === this.T.Ident, ALT: () => this.consume(this.T.Ident) },
          { ALT: () => this.consume(this.T.PlainIdent) }
        ]) as unknown as IToken;
        const dot = this.consume(this.T.DotName) as unknown as IToken; // ".foo"
        const key = dot.image.slice(1);
        mixinNameRef = makeNamespacedReference(this, [ns.image, key], 'mixin');
      }
    },
    {
      // Escaped module-qualified mixin "ruleset" reference: `@include ns.\#foo(...)` or `@include ns.\.foo(...)`
      // Note: there is no standalone dot token; the '.' is tokenized as Unknown when not part of DotName.
      GATE: () =>
        (this.la(1).tokenType === this.T.Ident || this.la(1).tokenType === this.T.PlainIdent)
        && this.la(2).tokenType === this.T.Unknown
        && this.la(2).image === '.'
        && this.la(3).tokenType === this.T.Unknown
        && this.la(3).image === '\\'
        && (this.la(4).tokenType === this.T.HashName || this.la(4).tokenType === this.T.DotName),
      ALT: () => {
        const ns = this.or([
          { GATE: () => this.la(1).tokenType === this.T.Ident, ALT: () => this.consume(this.T.Ident) },
          { ALT: () => this.consume(this.T.PlainIdent) }
        ]) as unknown as IToken;
        this.consume(this.T.Unknown); // '.'
        this.consume(this.T.Unknown); // '\'
        const member = this.or([
          { GATE: () => this.la(1).tokenType === this.T.HashName, ALT: () => this.consume(this.T.HashName) },
          { ALT: () => this.consume(this.T.DotName) }
        ]) as unknown as IToken;
        const key = member.image.slice(1);
        mixinNameRef = makeNamespacedReference(this, [ns.image, key], 'mixin-ruleset');
      }
    },
    {
      ALT: () => {
        const ident = this.or([
          { GATE: () => this.la(1).tokenType === this.T.Ident, ALT: () => this.consume(this.T.Ident) },
          { ALT: () => this.consume(this.T.PlainIdent) }
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
    this.option(() => {
      args = this.functionCallArgs(ctx) as unknown as List;
    });
    this.consume(this.T.RParen);
  } else {
    this.option(() => {
      this.consume(this.T.LParen);
      this.option(() => {
        args = this.functionCallArgs(ctx) as unknown as List;
      });
      this.consume(this.T.RParen);
    });
  }

  // Optional content block
  let contentRules: RulesType | undefined;
  let usingParams: List | undefined;

  // SCSS: `@include foo() using ($x, $y) { ... }`
  if (this.la(1).image === 'using') {
    this.option(() => {
      this.consume(this.T.Ident); // using
      // Sass `using(...)` parameters are just variable names.
      // Represent them as VarDeclaration(paramVar=true, value=Nil()) so they print as `$x`
      // (no `: <default>`), matching Jess' `@($x, $y) { ... }` syntax.
      this.consume(this.T.LParen);
      const p: Node[] = [];
      this.option(() => {
        this.atLeastOneSep({
          SEP: this.T.Comma,
          DEF: () => {
            const dv = this.consume(this.T.DollarVariable);
            const paramName = new Any(dv.image.slice(1), { role: 'property' }, this.getLocationInfo(dv), this.context);
            p.push(
              new VarDeclaration(
                { name: paramName, value: new Nil() },
                { paramVar: true },
                this.getLocationInfo(dv),
                this.context
              )
            );
          }
        });
      });
      this.consume(this.T.RParen);
      usingParams = new List(p, undefined, this.getLocationInfo(this.la(0)), this.context);
    });
  }

  this.option(() => {
    this.consume(this.T.LCurly);
    contentRules = this.atRuleBody({ ...ctx, inner: true }) as unknown as RulesType;
    this.consume(this.T.RCurly);
  });

  // Require semicolon only when present (SCSS requires it if no block; we enforce later)
  if (this.la(1).tokenType === this.T.Semi) {
    this.option(() => this.consume(this.T.Semi));
  }

  const loc = this.endRule();
  const mixinRef = mixinNameRef ?? new Reference(
    { key: mixinKey! },
    { type: 'mixin', role: 'name' },
    loc,
    this.context
  );

  // If we have a content block, store it on the Call itself (for serialization and future semantics).
  let contentNode: Node | undefined;
  if (contentRules) {
    const contentMixin = new Mixin(
      { rules: contentRules, params: usingParams },
      undefined,
      loc,
      this.context
    );
    // This is an inline/anonymous mixin literal, so it must be visible when serialized.
    contentMixin.addFlags(F_VISIBLE);
    contentNode = contentMixin;
  }

  const call = new Call({ name: mixinRef, args, contentNode }, undefined, loc, this.context);
  // SCSS `@include` is a statement; serialize as Jess mixin injection using `$ > ...`.
  return call;
}

export function scssIfAtRule(this: P, ctx: RuleContext = {}) {
  this.startRule();
  this.consume(this.T.AtKeyword); // assumed '@if' (dispatched by unknownAtRule)

  // Parse the condition - returns Paren(Condition(...)) or nested Conditions
  const cond = this.scssCondition(ctx) as unknown as Node | undefined;

  this.consume(this.T.LCurly);
  const rules = this.atRuleBody({ ...ctx, inner: !!ctx.inner });
  this.consume(this.T.RCurly);

  makePublicDirectiveRules(rules);

  const branches: IfBranch[] = [{ condition: cond, rules }];

  // Consume chained @else / @else if
  this.many({
    GATE: () => this.la(1).image === '@else',
    DEF: () => {
      this.consume(this.T.AtKeyword); // @else

      let elseCond: Node | undefined;

      // @else if ...
      if (this.la(1).image === 'if') {
        this.option(() => {
          this.consume(this.T.Ident); // if (token category)
          elseCond = this.scssCondition(ctx) as unknown as Node;
        });
      }

      this.consume(this.T.LCurly);
      const elseRules = this.atRuleBody({ ...ctx, inner: !!ctx.inner });
      this.consume(this.T.RCurly);
      makePublicDirectiveRules(elseRules);
      branches.push({ condition: elseCond, rules: elseRules });
    }
  });

  const loc = this.endRule();
  return new If({ branches }, undefined, loc, this.context);
}

export function scssForAtRule(this: P, ctx: RuleContext = {}) {
  this.startRule();
  this.consume(this.T.AtKeyword); // assumed '@for'

  // Sass: `@for $i from <start> (to|through) <end> { ... }`
  // Normalize to Jess `$for` range header:
  //   `$for ($i of <Range>) { ... }`
  // Where Range serializes as:
  // - `start to end` (through)
  // - `start to <end` (to)
  const dv = this.consume(this.T.DollarVariable);

  // consume `from` keyword (token type can vary by mode/categories)
  if (this.la(1).image !== 'from') {
    // Trigger a useful parse error if we don't see `from`.
    this.consume(this.T.PlainIdent);
  } else if (this.la(1).tokenType === this.T.PlainIdent) {
    this.consume(this.T.PlainIdent);
  } else {
    this.consume(this.T.Ident);
  }

  // Parse start expression until we hit `to`/`through`
  const startNodes: Node[] = [];
  this.atLeastOne({
    GATE: () => {
      const la = this.la(1);
      // Stop before `to`/`through` regardless of token type.
      return !(la.image === 'to' || la.image === 'through');
    },
    DEF: () => {
      const n = this.anyOuterValue(ctx) as unknown as Node;
      startNodes.push(this.wrap(n, 'both'));
    }
  });

  // consume `to` / `through`
  let kw: IToken;
  if (this.la(1).image !== 'to' && this.la(1).image !== 'through') {
    // Trigger a useful parse error if we don't see `to|through`.
    kw = this.consume(this.T.PlainIdent) as unknown as IToken;
  } else if (this.la(1).tokenType === this.T.PlainIdent) {
    kw = this.consume(this.T.PlainIdent) as unknown as IToken;
  } else {
    kw = this.consume(this.T.Ident) as unknown as IToken;
  }
  const includeEnd = kw.image === 'through';

  // Parse end expression until `{` (or EOF)
  const endNodes: Node[] = [];
  this.atLeastOne({
    GATE: () => this.la(1).tokenType !== this.T.LCurly && this.la(1).tokenType.name !== 'EOF',
    DEF: () => {
      const n = this.anyOuterValue(ctx) as unknown as Node;
      endNodes.push(this.wrap(n, 'both'));
    }
  });

  const name = new Any(dv.image.slice(1), { role: 'property' }, this.getLocationInfo(dv), this.context);
  const varDecl = new VarDeclaration({ name, value: new Nil() }, { paramVar: true }, this.getLocationInfo(dv), this.context);

  const startExpr = startNodes.length === 1
    ? startNodes[0]!
    : new Sequence(startNodes, undefined, this.getLocationFromNodes(startNodes), this.context);
  const endExpr = endNodes.length === 1
    ? endNodes[0]!
    : new Sequence(endNodes, undefined, this.getLocationFromNodes(endNodes), this.context);

  this.consume(this.T.LCurly);
  const rules = this.atRuleBody({ ...ctx, inner: !!ctx.inner });
  this.consume(this.T.RCurly);
  makePublicDirectiveRules(rules);
  const loc = this.endRule();
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
  }, undefined, loc, this.context);
}

export function scssEachAtRule(this: P, ctx: RuleContext = {}) {
  this.startRule();
  this.consume(this.T.AtKeyword); // assumed '@each'

  // Sass: `@each $a[, $b ...] in <expr> { ... }`
  // Normalize to Jess `$for` shape (JS-like):
  // - single var: `($item of <expr>)`
  // - destructure: `([$one, $two] of <expr>)`
  const vars: VarDeclaration[] = [];

  // One or more `$var` separated by commas.
  do {
    const dv = this.consume(this.T.DollarVariable);
    const varName = new Any(dv.image.slice(1), { role: 'property' }, this.getLocationInfo(dv), this.context);
    // Param-like var decl (prints `$name` with no `: <value>`).
    vars.push(new VarDeclaration({ name: varName, value: new Nil() }, { paramVar: true }, this.getLocationInfo(dv), this.context));
    if (this.la(1).tokenType === this.T.Comma) {
      this.consume(this.T.Comma);
    } else {
      break;
    }
  } while (true);

  // consume `in` keyword (Ident or PlainIdent depending on token mode)
  if (this.la(1).tokenType === this.T.Ident) {
    this.consume(this.T.Ident);
  } else {
    this.consume(this.T.PlainIdent);
  }

  // Parse the iterable expression as a value sequence (stops before `{` naturally).
  const rawExpr = this.valueSequence(ctx) as unknown as Node;

  const expr = isNode(rawExpr, N.Expression)
    ? rawExpr
    : (() => {
        const innerExpr = this.wrap(rawExpr, 'both');
        // Prevent `$` + leading-space output like `$ list`.
        innerExpr.pre = 0;
        return new Expression(innerExpr, undefined, this.getLocationFromNodes([rawExpr]), this.context);
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

  this.consume(this.T.LCurly);
  const rules = this.atRuleBody({ ...ctx, inner: !!ctx.inner });
  this.consume(this.T.RCurly);
  makePublicDirectiveRules(rules);
  const loc = this.endRule();
  return new For({
    pattern,
    iterable: {
      kind: 'node' as const,
      value: expr
    },
    rules
  }, undefined, loc, this.context);
}

export function scssWhileAtRule(this: P, ctx: RuleContext = {}) {
  this.startRule();
  this.consume(this.T.AtKeyword); // assumed '@while'

  const condition = this.scssCondition(ctx) as unknown as Node | undefined;

  this.consume(this.T.LCurly);
  const rules = this.atRuleBody({ ...ctx, inner: !!ctx.inner });
  this.consume(this.T.RCurly);
  makePublicDirectiveRules(rules);
  const loc = this.endRule();
  return new While({ condition: condition!, rules }, undefined, loc, this.context);
}

export function scssMixinAtRule(this: P, ctx: RuleContext = {}) {
  this.startRule();
  this.consume(this.T.AtKeyword); // assumed '@mixin' (dispatched by unknownAtRule)
  let nameTok: IToken | undefined;
  let hasParamsFromStart = false;

  const looksLikeInterpolatedMixinName = () => {
    for (let i = 1; i < 64; i++) {
      const tok = this.la(i);
      if (tok.tokenType === this.T.LParen || tok.tokenType === this.T.LCurly || tok.tokenType.name === 'EOF') {
        return false;
      }
      if (tok.tokenType === this.T.InterpolationStart) {
        return true;
      }
    }
    return false;
  };

  this.or([
    {
      // Sass parity: interpolation in mixin names is not valid syntax.
      GATE: () => looksLikeInterpolatedMixinName(),
      ALT: () => {
        this.atLeastOne({
          DEF: () => {
            this.or([
              {
                GATE: () => this.la(1).tokenType === this.T.InterpolationStart,
                ALT: () => {
                  this.consume(this.T.InterpolationStart);
                  this.valueSequence(ctx);
                  this.consume(this.T.RCurly);
                }
              },
              {
                ALT: () => {
                  this.consume(this.T.Ident);
                }
              }
            ]);
          }
        });
        throw new Error('SCSS does not allow interpolation in mixin names for @mixin.');
      }
    },
    {
      GATE: () => tokenMatches(this.la(1), this.T.FunctionStart),
      ALT: () => {
        nameTok = this.consume(this.T.FunctionStart) as unknown as IToken;
        hasParamsFromStart = true;
      }
    },
    {
      GATE: () => tokenMatches(this.la(1), this.T.GenericFunctionStart),
      ALT: () => {
        nameTok = this.consume(this.T.GenericFunctionStart) as unknown as IToken;
        hasParamsFromStart = true;
      }
    },
    { ALT: () => {
      nameTok = this.consume(this.T.Ident) as unknown as IToken;
    } }
  ]);

  let params: List | undefined;
  this.or([
    {
      GATE: () => hasParamsFromStart,
      ALT: () => {
        params = this.scssMixinParamsAfterFunctionStart(ctx) as unknown as List;
      }
    },
    {
      GATE: () => this.la(1).tokenType === this.T.LParen,
      ALT: () => {
        params = this.scssMixinParams(ctx) as unknown as List;
      }
    },
    { ALT: () => {} }
  ]);

  this.consume(this.T.LCurly);
  const rules = this.declarationList({ ...ctx, inner: true });
  this.consume(this.T.RCurly);

  // Sass-style: inner vars/mixins should not be publicly visible by default.
  rules.options.rulesVisibility ??= {};
  rules.options.rulesVisibility.VarDeclaration ??= 'private';
  rules.options.rulesVisibility.Mixin ??= 'private';

  const loc = this.endRule();

  const mixinName = (tokenMatches(nameTok!, this.T.FunctionStart) || tokenMatches(nameTok!, this.T.GenericFunctionStart))
    ? String(nameTok!.image).slice(0, -1)
    : String(nameTok!.image);
  const finalNameNode = new Any(mixinName, { role: 'name' }, this.getLocationInfo(nameTok!), this.context);

  return new Mixin(
    { name: finalNameNode, params, rules },
    undefined,
    loc,
    this.context
  );
}

export function scssMixinParams(this: P, ctx: RuleContext = {}) {
  this.startRule();
  this.consume(this.T.LParen);
  const params: Node[] = [];

  this.option(() => {
    this.atLeastOneSep({
      SEP: this.T.Comma,
      DEF: () => {
        const p = this.scssMixinParam(ctx) as unknown as Node;
        params.push(p);
      }
    });
  });

  this.consume(this.T.RParen);
  const loc = this.endRule();
  return new List(params, undefined, loc, this.context);
}

export function scssMixinParamsAfterFunctionStart(this: P, ctx: RuleContext = {}) {
  this.startRule();
  const params: Node[] = [];

  this.option(() => {
    this.atLeastOneSep({
      SEP: this.T.Comma,
      DEF: () => {
        const p = this.scssMixinParam(ctx) as unknown as Node;
        params.push(p);
      }
    });
  });

  this.consume(this.T.RParen);
  const loc = this.endRule();
  return new List(params, undefined, loc, this.context);
}

export function scssMixinParam(this: P, ctx: RuleContext = {}) {
  this.startRule();

  let node: Node | undefined;
  this.or([
    // ...$rest
    {
      GATE: () => this.la(1).tokenType?.name === 'Ellipsis' || this.la(1).image === '...',
      ALT: () => {
        this.consume(this.T.Ellipsis);
        const dv = this.consume(this.T.DollarVariable);
        node = new Rest(dv.image.slice(1), undefined, this.getLocationInfo(dv), this.context);
      }
    },
    {
      ALT: () => {
        const dv = this.consume(this.T.DollarVariable);
        let defaultValue: Node | undefined;
        this.option(() => {
          // In SCSS, default params use `:`, which is tokenized as `Assign` in this lexer setup.
          this.consume(this.T.Assign);
          defaultValue = this.valueSequence(ctx);
        });
        if (defaultValue) {
          const paramName = new Any(dv.image.slice(1), { role: 'property' });
          node = new VarDeclaration(
            { name: paramName, value: defaultValue },
            { paramVar: true },
            this.getLocationInfo(dv),
            this.context
          );
        } else {
          node = new Any(dv.image.slice(1), { role: 'property' }, this.getLocationInfo(dv), this.context);
        }
      }
    }
  ]);

  this.endRule();
  return node!;
}

export function scssMediaPrelude(this: P, ctx: RuleContext = {}) {
  this.startRule();
  const nodes: Node[] = [];

  this.many({
    GATE: () => this.la(1).tokenType !== this.T.LCurly && this.la(1).tokenType.name !== 'EOF',
    DEF: () => {
      const n = this.or([
        {
          GATE: () => this.la(1).tokenType === this.T.InterpolationStart,
          ALT: () => {
            this.consume(this.T.InterpolationStart);
            const expr = this.valueSequence(ctx) as unknown as Node;
            this.consume(this.T.RCurly);
            return new Interpolated(
              { source: INTERPOLATION_PLACEHOLDER, replacements: [expr] },
              { role: 'any' },
              this.getLocationFromNodes([expr]),
              this.context
            );
          }
        },
        { ALT: () => this.anyOuterValue(ctx) }
      ]) as unknown as Node;

      nodes.push(this.wrap(n));
    }
  });

  const loc = this.endRule();
  if (nodes.length === 1) {
    return nodes[0]!;
  }
  return new Sequence(nodes, undefined, loc, this.context);
}

export function mediaAtRule(this: P, ctx: RuleContext = {}) {
  // Use CSS implementation and inject only the prelude rule.
  return cssMediaAtRule.call(this, ctx, 'scssMediaPrelude');
}

export function scssSupportsPrelude(this: P, ctx: RuleContext = {}) {
  this.startRule();
  const nodes: Node[] = [];

  this.many({
    GATE: () => this.la(1).tokenType !== this.T.LCurly && this.la(1).tokenType.name !== 'EOF',
    DEF: () => {
      const n = this.or([
        {
          GATE: () => this.la(1).tokenType === this.T.InterpolationStart,
          ALT: () => {
            this.consume(this.T.InterpolationStart);
            const expr = this.valueSequence(ctx) as unknown as Node;
            this.consume(this.T.RCurly);
            return new Interpolated(
              { source: INTERPOLATION_PLACEHOLDER, replacements: [expr] },
              { role: 'any' },
              this.getLocationFromNodes([expr]),
              this.context
            );
          }
        },
        { ALT: () => this.anyOuterValue(ctx) }
      ]) as unknown as Node;

      nodes.push(this.wrap(n));
    }
  });

  const loc = this.endRule();
  if (nodes.length === 1) {
    return nodes[0]!;
  }
  return new Sequence(nodes, undefined, loc, this.context);
}

export function supportsAtRule(this: P, ctx: RuleContext = {}) {
  // Reimplemented to use scssSupportsPrelude instead of supportsCondition,
  // since the CSS misc.ts supportsAtRule does not accept a prelude rule parameter.
  this.startRule();
  const name = this.consume(this.T.AtSupports);
  const prelude: Node = this.scssSupportsPrelude(ctx) as unknown as Node;
  this.consume(this.T.LCurly);
  const rules = this.atRuleBody(ctx) as Rules;
  this.consume(this.T.RCurly);
  const location = this.endRule();
  return new AtRule({
    name: this.wrap(new Any(name.image, { role: 'atkeyword' }, this.getLocationInfo(name), this.context), true),
    prelude: this.wrap(prelude, 'both'),
    rules
  }, { nestable: true }, location, this.context);
}

export function scssContainerPrelude(this: P, ctx: RuleContext = {}) {
  this.startRule();
  const nodes: Node[] = [];

  this.many({
    GATE: () => this.la(1).tokenType !== this.T.LCurly && this.la(1).tokenType.name !== 'EOF',
    DEF: () => {
      const n = this.or([
        {
          GATE: () => this.la(1).tokenType === this.T.InterpolationStart,
          ALT: () => {
            this.consume(this.T.InterpolationStart);
            const expr = this.valueSequence(ctx) as unknown as Node;
            this.consume(this.T.RCurly);
            return new Interpolated(
              { source: INTERPOLATION_PLACEHOLDER, replacements: [expr] },
              { role: 'any' },
              this.getLocationFromNodes([expr]),
              this.context
            );
          }
        },
        { ALT: () => this.anyOuterValue(ctx) }
      ]) as unknown as Node;

      nodes.push(this.wrap(n));
    }
  });

  const loc = this.endRule();
  if (nodes.length === 1) {
    return nodes[0]!;
  }
  return new Sequence(nodes, undefined, loc, this.context);
}

export function containerAtRule(this: P, ctx: RuleContext = {}) {
  // Use CSS implementation and inject only the prelude rule.
  return cssContainerAtRule.call(this, ctx, 'scssContainerPrelude');
}

export function scssScopePrelude(this: P, ctx: RuleContext = {}) {
  this.startRule();
  const nodes: Node[] = [];

  this.many({
    GATE: () => this.la(1).tokenType !== this.T.LCurly && this.la(1).tokenType.name !== 'EOF',
    DEF: () => {
      const n = this.or([
        {
          GATE: () => this.la(1).tokenType === this.T.InterpolationStart,
          ALT: () => {
            this.consume(this.T.InterpolationStart);
            const expr = this.valueSequence(ctx) as unknown as Node;
            this.consume(this.T.RCurly);
            return new Interpolated(
              { source: INTERPOLATION_PLACEHOLDER, replacements: [expr] },
              { role: 'any' },
              this.getLocationFromNodes([expr]),
              this.context
            );
          }
        },
        { ALT: () => this.anyOuterValue(ctx) }
      ]) as unknown as Node;

      nodes.push(this.wrap(n));
    }
  });

  const loc = this.endRule();
  if (nodes.length === 1) {
    return nodes[0]!;
  }
  return new Sequence(nodes, undefined, loc, this.context);
}

export function scopeAtRule(this: P, ctx: RuleContext = {}) {
  // Use CSS implementation and inject only the prelude rule.
  return cssScopeAtRule.call(this, ctx, 'scssScopePrelude');
}

/**
 * Override CSS `unknownAtRule` to special-case Sass directives.
 *
 * We do this (instead of extending `atRule`) because the CSS parser's
 * lookahead will otherwise choose `unknownAtRule` and skip our custom
 * alternatives.
 */
export function unknownAtRule(this: P, ctx: RuleContext = {}) {
  const img = this.la(1).image;
  if (img === '@use') {
    return this.scssUseAtRule(ctx);
  }
  if (img === '@forward') {
    return this.scssForwardAtRule(ctx);
  }
  if (img === '@extend') {
    return this.scssExtendAtRule(ctx);
  }
  if (img === '@content') {
    return this.scssContentAtRule(ctx);
  }
  if (img === '@if') {
    return this.scssIfAtRule(ctx);
  }
  if (img === '@for') {
    return this.scssForAtRule(ctx);
  }
  if (img === '@each') {
    return this.scssEachAtRule(ctx);
  }
  if (img === '@while') {
    return this.scssWhileAtRule(ctx);
  }
  if (img === '@include') {
    return this.scssIncludeAtRule(ctx);
  }
  if (img === '@mixin') {
    return this.scssMixinAtRule(ctx);
  }
  if (img === '@function') {
    return this.scssFunctionAtRule(ctx);
  }
  if (img === '@return') {
    return this.scssReturnAtRule(ctx);
  }
  if (img === '@debug' || img === '@warn' || img === '@error') {
    return this.scssDiagnosticAtRule(ctx);
  }
  if (img === '@at-root') {
    return this.scssAtRootAtRule(ctx);
  }
  return cssUnknownAtRule.call(this, ctx);
}

/**
 * SCSS: `@return <value>;` → `return: <value>;`
 */
export function scssReturnAtRule(this: P, ctx: RuleContext = {}) {
  this.startRule();
  this.consume(this.T.AtKeyword); // '@return'
  // Use valueList to allow expressions like `$a + $b` (Sass return values commonly include operations).
  const value = this.valueList(ctx) as unknown as Node;
  this.consume(this.T.Semi);
  const loc = this.endRule();
  const name = new Any('return', { role: 'property' }, loc, this.context);
  return new Declaration({ name, value: this.wrap(value) }, undefined, loc, this.context);
}

/**
 * SCSS: `@function name($a, $b: 1) { ... }`
 *
 * Parsed as a `Func` node with a `body` (Rules) and `params` list, and registered in the function registry.
 * Return value is represented by a `return: <value>;` declaration (see `@return`).
 */
export function scssFunctionAtRule(this: P, ctx: RuleContext = {}) {
  this.startRule();
  this.consume(this.T.AtKeyword); // '@function'

  let nameTok: IToken | undefined;
  let params: List | undefined;
  let hasParamsFromStart = false;

  this.or([
    {
      // function name may be tokenized as a FunctionStart / GenericFunctionStart (`name(`)
      GATE: () => tokenMatches(this.la(1), this.T.FunctionStart),
      ALT: () => {
        nameTok = this.consume(this.T.FunctionStart) as unknown as IToken;
        hasParamsFromStart = true;
      }
    },
    {
      GATE: () => tokenMatches(this.la(1), this.T.GenericFunctionStart),
      ALT: () => {
        nameTok = this.consume(this.T.GenericFunctionStart) as unknown as IToken;
        hasParamsFromStart = true;
      }
    },
    {
      ALT: () => {
        nameTok = this.or([
          { GATE: () => this.la(1).tokenType === this.T.Ident, ALT: () => this.consume(this.T.Ident) },
          { ALT: () => this.consume(this.T.PlainIdent) }
        ]) as unknown as IToken;
      }
    }
  ]);

  this.or([
    {
      GATE: () => hasParamsFromStart,
      ALT: () => {
        params = this.scssMixinParamsAfterFunctionStart(ctx) as unknown as List;
      }
    },
    {
      GATE: () => this.la(1).tokenType === this.T.LParen,
      ALT: () => {
        params = this.scssMixinParams(ctx) as unknown as List;
      }
    },
    { ALT: () => {} }
  ]);

  this.consume(this.T.LCurly);
  const bodyRules = this.declarationList({ ...ctx, inner: true }) as unknown as Rules;
  this.consume(this.T.RCurly);

  // Keep function body "private-ish" by default, like Sass.
  bodyRules.options.rulesVisibility ??= {};
  bodyRules.options.rulesVisibility.VarDeclaration ??= 'private';
  bodyRules.options.rulesVisibility.Mixin ??= 'private';
  bodyRules.options.rulesVisibility.Ruleset ??= 'private';

  const loc = this.endRule();
  const tok = nameTok ?? (this.la(0) as unknown as IToken);
  const rawName = hasParamsFromStart ? String(tok.image).slice(0, -1) : String(tok.image);
  const fnName = new Any(rawName, { role: 'name' }, this.getLocationInfo(tok), this.context);
  return new Func(
    { name: fnName, params, body: bodyRules },
    undefined,
    loc,
    this.context
  );
}

/**
 * SCSS: `@debug <expr>;`, `@warn <expr>;`, `@error <expr>;`
 *
 * Parsed as `Log` nodes. These are diagnostic at-rules that output messages during compilation.
 * They serialize to empty strings since they're not supported in Jess syntax.
 */
export function scssDiagnosticAtRule(this: P, ctx: RuleContext = {}) {
  this.startRule();
  const atKeyword = this.consume(this.T.AtKeyword) as unknown as IToken; // '@debug', '@warn', or '@error'
  // Parse the diagnostic message as a value sequence (stops at `;` naturally).
  const message = this.valueSequence(ctx) as unknown as Node;
  this.consume(this.T.Semi);
  const loc = this.endRule();
  const keywordImage = atKeyword.image;
  // Extract level from @debug, @warn, or @error
  const level = keywordImage.slice(1) as 'debug' | 'warn' | 'error';
  return new Log(
    { level, message: this.wrap(message, 'both') },
    undefined,
    loc,
    this.context
  );
}

/**
 * SCSS: `@at-root [selector] { ... }` or `@at-root (without: media) { ... }`
 *
 * Parsed as `AtRule` nodes. This feature is currently unsupported in Jess.
 * A warning is emitted when this directive is encountered.
 */
export function scssAtRootAtRule(this: P, ctx: RuleContext = {}) {
  this.startRule();
  const atKeyword = this.consume(this.T.AtKeyword) as unknown as IToken; // '@at-root'

  // Parse optional selector or control arguments
  let prelude: Node | undefined;
  this.or([
    {
      // @at-root (without: media) or @at-root (with: rule)
      GATE: () => this.la(1).tokenType === this.T.LParen,
      ALT: () => {
        prelude = this.valueSequence(ctx) as unknown as Node;
      }
    },
    {
      // @at-root .selector { ... }
      GATE: () => {
        const next = this.la(1);
        return next.tokenType === this.T.Ident || next.tokenType === this.T.PlainIdent
          || next.tokenType === this.T.Dot || next.tokenType === this.T.Hash
          || next.tokenType === this.T.Colon || next.tokenType === this.T.LBracket;
      },
      ALT: () => {
        // Parse as a selector list (CSS parser method)
        prelude = this.selectorList(ctx) as unknown as Node;
      }
    },
    {
      // @at-root { ... } (no prelude)
      ALT: () => {}
    }
  ]);

  this.consume(this.T.LCurly);
  const rules = this.atRuleBody({ ...ctx, inner: !!ctx.inner });
  this.consume(this.T.RCurly);

  const loc = this.endRule();
  const name = new Any(atKeyword.image, { role: 'atkeyword' }, this.getLocationInfo(atKeyword), this.context);
  const atRule = new AtRule({ name, prelude: prelude ? this.wrap(prelude, 'both') : undefined, rules }, undefined, loc, this.context);

  // Emit warning that @at-root is unsupported (and will never be)
  this.warnings.push({
    message: '@at-root is not supported in Jess and will never be. Write utilities at the top level or use separate files/modules instead. See docs for alternatives.',
    token: atKeyword,
    deprecation: undefined
  });

  return atRule;
}
