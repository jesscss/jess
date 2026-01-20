import { productions as cssProductions } from '@jesscss/css-parser';
import type { AltContext, RuleContext } from '@jesscss/css-parser';
import type { IToken } from 'chevrotain';
import type { ScssActionsParser, TokenMap as ScssTokenMap } from './scssActionsParser.js';
import {
  Any,
  Call,
  Collection,
  Declaration,
  type AssignmentType,
  Each,
  Expression,
  For,
  If,
  type IfBranch,
  JsImport,
  List,
  Mixin,
  Node as JessNode,
  Quoted,
  Reference,
  Rest,
  Rules,
  Sequence,
  StyleImport,
  VarDeclaration,
  While,
  type Rules as RulesType,
  type LocationInfo,
  type Node,
  isNode
} from '@jesscss/core';

/**
 * SCSS-specific production overrides.
 *
 * This milestone focuses on:
 * - Sass map literals: `(\"k\": v, ...)` → `Collection`
 * - `map-get()` and `map.get()` → `Reference` lookup chains
 */

function unwrapSingleSequence(n: Node): Node {
  if (isNode(n, 'Sequence') && (n as Sequence).value.length === 1) {
    return (n as Sequence).value[0]!;
  }
  return n;
}

function toDeclKey(node: Node): string {
  // Quoted.valueOf() returns an unquoted string
  const key = node.valueOf();
  return String(key);
}

function isValidIdentifierKey(key: string): boolean {
  return /^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(key);
}

function desugarMapLookup(
  parser: ScssActionsParser,
  call: Call
): Node {
  const name = call.value.name;
  if (typeof name !== 'string') {
    return call;
  }
  if (name !== 'map-get' && name !== 'map.get') {
    return call;
  }

  const argsList = call.value.args;
  const args = isNode(argsList, 'List') ? (argsList as List).value : [];
  if (args.length < 2) {
    return call;
  }

  const mapExpr = unwrapSingleSequence(args[0] as Node);
  const keyArgs = args.slice(1).map(a => unwrapSingleSequence(a as Node));

  // Reference.target only supports Reference or Call today; keep conservative.
  const initialTarget: Reference | Call | undefined =
    isNode(mapExpr, 'Reference') ? (mapExpr as Reference)
      : isNode(mapExpr, 'Call') ? (mapExpr as Call)
        : undefined;

  if (!initialTarget) {
    return call;
  }

  const callLoc: LocationInfo | undefined = Array.isArray(call.location) && call.location.length === 6
    ? (call.location as LocationInfo)
    : undefined;

  let currentTarget: Reference | Call = initialTarget;
  for (const keyNode of keyArgs) {
    // Prefer turning quoted keys into plain identifier keys where possible.
    const keyStr = toDeclKey(keyNode);
    const useDeclaration = isValidIdentifierKey(keyStr);
    const ref = new Reference(
      { target: currentTarget, key: useDeclaration ? keyStr : keyNode },
      { type: useDeclaration ? 'declaration' : 'index' },
      callLoc,
      parser.context
    );
    currentTarget = ref;
  }

  return currentTarget;
}

function looksLikeMapLiteral(la: (k: number) => IToken, T: ScssTokenMap): boolean {
  // Heuristic: scan until matching RParen (no nesting awareness yet) and look for a Colon.
  // This is conservative: it only claims "map" if there is an obvious "key: value".
  let depth = 0;
  for (let i = 1; i < 50; i++) {
    const tok = la(i);
    if (tok.tokenType === T.LParen) depth++;
    if (tok.tokenType === T.RParen) {
      if (depth === 0) return false;
      depth--;
      if (depth === 0) return false;
    }
    if (tok.tokenType === T.Colon && depth === 1) {
      return true;
    }
    if (tok.tokenType.name === 'EOF') {
      return false;
    }
  }
  return false;
}

export function value(this: ScssActionsParser, T: ScssTokenMap, valueAlt?: AltContext) {
  const $ = this;

  valueAlt ??= (ctx: RuleContext = {}) => [
    {
      GATE: () => $.LA(1).tokenType === T.LParen && looksLikeMapLiteral(i => $.LA(i), T),
      ALT: () => $.SUBRULE($.scssMapLiteral, { ARGS: [ctx] })
    },
    { ALT: () => $.SUBRULE($.functionCall, { ARGS: [ctx] }) },
    { ALT: () => $.CONSUME(T.DollarVariable) },
    { ALT: () => $.CONSUME(T.Ident) },
    { ALT: () => $.CONSUME(T.Dimension) },
    { ALT: () => $.CONSUME(T.Number) },
    { ALT: () => $.CONSUME(T.Color) },
    { ALT: () => $.CONSUME(T.UnicodeRange) },
    { ALT: () => $.SUBRULE($.string, { ARGS: [ctx] }) },
    { ALT: () => $.SUBRULE($.squareValue, { ARGS: [ctx] }) },
    {
      GATE: () => $.legacyMode,
      ALT: () => $.CONSUME(T.LegacyMSFilter)
    }
  ];

  return (ctx: RuleContext = {}) => {
    $.startRule();
    let node = $.OR(valueAlt!(ctx)) as unknown as Node | IToken;
    let additionalValue: Node | undefined;
    $.OPTION(() => {
      $.CONSUME(T.Slash);
      additionalValue = $.SUBRULE2($.value, { ARGS: [ctx] });
    });
    if (!$.RECORDING_PHASE) {
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
  };
}

/**
 * Override CSS `main` to allow root-level SCSS variable declarations (`$x: ...;`).
 */
export function main(this: ScssActionsParser, T: ScssTokenMap, alt?: AltContext) {
  const $ = this;
  alt ??= (ctx: RuleContext = {}) => [
    // Allow root-level SCSS variable declarations ($x: ...)
    { ALT: () => $.SUBRULE($.declaration, { ARGS: [ctx] }) },
    { ALT: () => $.SUBRULE2($.qualifiedRule) },
    { ALT: () => $.SUBRULE3($.atRule) },
    // Allow stray semicolons at root.
    { ALT: () => $.CONSUME2(T.Semi) }
  ];

  return cssProductions.main.call(this, T, alt as any);
}

/**
 * Parses a Sass map literal: `(\"k\": v, ...)` into a Jess `Collection`.
 * (Only the map form is supported in this milestone; list literals come later.)
 */
export function scssMapLiteral(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    $.startRule();
    $.CONSUME(T.LParen);

    const decls: Declaration[] = [];

    $.OPTION({
      GATE: () => $.LA(1).tokenType !== T.RParen,
      DEF: () => {
        $.AT_LEAST_ONE_SEP({
          SEP: T.Comma,
          DEF: () => {
            const keyNode = $.SUBRULE($.value, { ARGS: [ctx] });
            $.CONSUME(T.Colon);
            const valueNode = $.SUBRULE($.valueSequence, { ARGS: [ctx] });

            if (!$.RECORDING_PHASE) {
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
          }
        });
      }
    });

    $.CONSUME(T.RParen);

    if (!$.RECORDING_PHASE) {
      const location = $.endRule();
      const coll = new Collection(decls, undefined, location, $.context);
      return $.wrap(coll);
    }
  };
}

export function functionCall(this: ScssActionsParser, T: ScssTokenMap, alt?: AltContext) {
  const $ = this;

  alt ??= (ctx: RuleContext = {}) => [
    {
      GATE: () => {
        const tokenType = $.LA(1).tokenType;
        return tokenType === T.UrlStart
          || tokenType === T.Var
          || tokenType === T.Calc;
      },
      ALT: () => $.SUBRULE($.knownFunctions, { ARGS: [ctx] })
    },
    {
      GATE: () => {
        const tokenType = $.LA(1).tokenType;
        return tokenType !== T.UrlStart
          && tokenType !== T.Var
          && tokenType !== T.Calc;
      },
      ALT: () => {
        $.startRule();
        const nameTok = $.CONSUME(T.FunctionStart);
        let args: List | undefined;
        $.OPTION(() => (args = $.SUBRULE($.functionCallArgs, { ARGS: [ctx] })));
        $.CONSUME(T.RParen);

        if (!$.RECORDING_PHASE) {
          const location = $.endRule();
          const call = new Call(
            { name: nameTok.image.slice(0, -1), args },
            undefined,
            location,
            $.context
          );
          return desugarMapLookup($, call);
        }
      }
    }
  ];

  return (ctx: RuleContext = {}) => $.OR(alt!(ctx));
}

function isScriptUsePath(path: string): boolean {
  return path.endsWith('.js') || path.endsWith('.ts') || path.endsWith('.json');
}

function quotedLike(original: Quoted, nextValue: string, context: ScssActionsParser['context']): Quoted {
  const quote = original.options?.quote ?? '"';
  const escaped = original.options?.escaped;
  const loc: LocationInfo | undefined = Array.isArray(original.location) && original.location.length === 6
    ? (original.location as LocationInfo)
    : undefined;
  return new Quoted(new Any(nextValue, { role: 'any' }), { quote, escaped }, loc, context);
}

function defaultNamespaceFromPath(path: string): string | undefined {
  // 'sass:map' -> 'map'
  if (path.startsWith('sass:')) {
    const name = path.slice('sass:'.length);
    return name.split('/').filter(Boolean).pop();
  }
  const base = path.split('/').filter(Boolean).pop();
  if (!base) return undefined;
  const noExt = base.replace(/\.(scss|sass|css|jess|js|ts|json)$/i, '');
  return noExt || undefined;
}

/**
 * SCSS: `@use` → `StyleImport(type='compose')` for stylesheets,
 * and `JsImport` for script paths. `sass:*` built-ins are rewritten
 * to `#sass/*` and imported as `JsImport`.
 */
export function scssUseAtRule(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    $.CONSUME(T.AtKeyword); // '@use'

    const pathNode = $.SUBRULE($.string, { ARGS: [ctx] }) as unknown as Quoted;
    const rawPath = pathNode.valueOf();

    let namespace: string | undefined;

    // optional "as <ident|*>"
    $.OPTION({
      GATE: () => $.LA(1).image === 'as',
      DEF: () => {
        $.CONSUME(T.Ident);
        $.OR([
          { ALT: () => (namespace = $.CONSUME2(T.Ident).image) },
          { ALT: () => { $.CONSUME(T.Star); namespace = '*'; } }
        ]);
      }
    });

    // optional "with (...)"
    let withRules: RulesType | undefined;
    $.OPTION2({
      GATE: () => $.LA(1).image === 'with',
      DEF: () => {
        $.CONSUME3(T.Ident);
        withRules = $.SUBRULE($.scssWithConfig, { ARGS: [ctx] }) as unknown as RulesType;
      }
    });

    $.CONSUME(T.Semi);

    if (!RECORDING_PHASE) {
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

      const imp = new StyleImport(
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
      return imp;
    }
  };
}

/**
 * SCSS: `@forward` → `StyleImport(type='compose')` with `(forward)` semantics:
 * - reference: true
 * - export: true
 * - mutable: false (protected)
 *
 * Full show/hide/as parsing is deferred; we currently ignore extra prelude tokens.
 */
export function scssForwardAtRule(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    $.CONSUME(T.AtKeyword); // '@forward'

    const pathNode = $.SUBRULE($.string, { ARGS: [ctx] }) as unknown as Quoted;

    // Ignore any extra selectors (show/hide/as) for now.
    $.MANY({
      GATE: () => $.LA(1).tokenType !== T.Semi,
      DEF: () => {
        $.SUBRULE($.anyOuterValue, { ARGS: [ctx] });
      }
    });

    $.CONSUME(T.Semi);

    if (!RECORDING_PHASE) {
      const loc = $.endRule();
      return new StyleImport(
        { path: pathNode },
        {
          type: 'compose',
          importOptions: { reference: true, export: true, mutable: false }
        },
        loc,
        $.context
      );
    }
  };
}

/**
 * Parses Sass `with (...)` config into a Rules node of VarDeclarations.
 */
export function scssWithConfig(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    $.CONSUME(T.LParen);

    let decls: VarDeclaration[] | undefined;
    if (!RECORDING_PHASE) decls = [];

    $.OPTION(() => {
      $.AT_LEAST_ONE_SEP({
        SEP: T.Comma,
        DEF: () => {
          const dv = $.CONSUME(T.DollarVariable);
          $.CONSUME(T.Assign);
          const value = $.SUBRULE($.valueSequence, { ARGS: [ctx] });
          if (!RECORDING_PHASE) {
            const name = new Any(dv.image.slice(1), { role: 'property' });
            decls!.push(new VarDeclaration({ name, value }, undefined, $.getLocationInfo(dv), $.context));
          }
        }
      });
    });

    $.CONSUME(T.RParen);
    if (!RECORDING_PHASE) {
      const loc = $.endRule();
      return new Rules(decls ?? [], undefined, loc, $.context) as unknown as RulesType;
    }
  };
}

/**
 * SCSS: `@content` → `$content()` (Expression(Call(Reference('content'))))
 */
export function scssContentAtRule(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    $.CONSUME(T.AtKeyword); // assumed '@content' (dispatched by unknownAtRule)
    let args: List | undefined;
    $.OPTION(() => {
      $.CONSUME(T.LParen);
      $.OPTION2(() => (args = $.SUBRULE($.functionCallArgs, { ARGS: [ctx] })));
      $.CONSUME(T.RParen);
    });
    $.OPTION3(() => $.CONSUME(T.Semi));

    if (!RECORDING_PHASE) {
      const loc = $.endRule();
      const ref = new Reference({ key: 'content' }, { type: 'variable' }, loc, $.context);
      const call = new Call({ name: ref, args }, undefined, loc, $.context);
      return new Expression(call, undefined, loc, $.context);
    }
  };
}

/**
 * SCSS: `@include name(args...)` → mixin call (Call(Reference(type='mixin'))).
 *
 * Note: content blocks are parsed as a named argument `$content: <mixin>`
 * (parse-only). The evaluation semantics for binding it to the call scope
 * are implemented later.
 */
export function scssIncludeAtRule(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    $.CONSUME(T.AtKeyword); // assumed '@include' (dispatched by unknownAtRule)
    const ident = $.CONSUME(T.Ident);

    let args: List | undefined;
    $.OPTION(() => {
      $.CONSUME(T.LParen);
      $.OPTION2(() => (args = $.SUBRULE($.functionCallArgs, { ARGS: [ctx] })));
      $.CONSUME(T.RParen);
    });

    // Optional content block
    let contentRules: RulesType | undefined;
    $.OPTION3(() => {
      $.CONSUME(T.LCurly);
      contentRules = $.SUBRULE($.declarationList, { ARGS: [{ ...ctx, inner: true }] }) as unknown as RulesType;
      $.CONSUME(T.RCurly);
    });

    // Require semicolon only when present (SCSS requires it if no block; we enforce later)
    $.OPTION4({ GATE: () => $.LA(1).tokenType === T.Semi, DEF: () => $.CONSUME(T.Semi) });

    if (!RECORDING_PHASE) {
      const loc = $.endRule();
      const mixinRef = new Reference({ key: ident.image }, { type: 'mixin', resolution: 'call-time', role: 'name' }, loc, $.context);

      // If we have a content block, attach it as a named arg `$content: <mixin()>`
      if (contentRules) {
        const contentMixin = new Mixin(
          { name: new Any('content', { role: 'name' }), rules: contentRules },
          undefined,
          loc,
          $.context
        );
        const contentName = new Any('content', { role: 'property' });
        const contentDecl = new VarDeclaration(
          { name: contentName, value: contentMixin },
          undefined,
          loc,
          $.context
        );
        const nextArgs = args ? args.copy(true) : new List([]);
        nextArgs.value.unshift(contentDecl);
        args = nextArgs;
      }

      return new Call({ name: mixinRef, args }, undefined, loc, $.context);
    }
  };
}

function makePublicDirectiveRules(rules: any) {
  rules.options.rulesVisibility ??= {};
  rules.options.rulesVisibility.Declaration = 'public';
  rules.options.rulesVisibility.Ruleset = 'public';
  rules.options.rulesVisibility.VarDeclaration = 'public';
  rules.options.rulesVisibility.Mixin = 'public';
}

export function scssIfAtRule(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    $.CONSUME(T.AtKeyword); // assumed '@if' (dispatched by unknownAtRule)

    let condNodes: Node[] | undefined;
    if (!RECORDING_PHASE) condNodes = [];
    $.MANY({
      GATE: () => $.LA(1).tokenType !== T.LCurly && $.LA(1).tokenType.name !== 'EOF',
      DEF: () => {
        const n = $.SUBRULE($.anyOuterValue, { ARGS: [ctx] });
        if (!RECORDING_PHASE) condNodes!.push($.wrap(n));
      }
    });
    const cond = !RECORDING_PHASE && condNodes!.length
      ? new Sequence(condNodes!, undefined, $.getLocationFromNodes(condNodes!), $.context)
      : undefined;

    $.CONSUME(T.LCurly);
    const rules = $.SUBRULE($.atRuleBody, { ARGS: [{ ...ctx, inner: !!ctx.inner }] });
    $.CONSUME(T.RCurly);

    if (!RECORDING_PHASE) {
      makePublicDirectiveRules(rules);
    }

    const branches: IfBranch[] = !RECORDING_PHASE ? [{ condition: cond, rules }] : [];

    // Consume chained @else / @else if
    $.MANY2({
      GATE: () => $.LA(1).image === '@else',
      DEF: () => {
        $.CONSUME2(T.AtKeyword); // @else

        let elseCond: Sequence | undefined;

        // @else if ...
        $.OPTION4({
          GATE: () => $.LA(1).image === 'if',
          DEF: () => {
            $.CONSUME3(T.Ident); // if (token category)

            let elseCondNodes: Node[] | undefined;
            if (!RECORDING_PHASE) elseCondNodes = [];

            $.MANY3({
              GATE: () => $.LA(1).tokenType !== T.LCurly && $.LA(1).tokenType.name !== 'EOF',
              DEF: () => {
                const n = $.SUBRULE2($.anyOuterValue, { ARGS: [ctx] });
                if (!RECORDING_PHASE) elseCondNodes!.push($.wrap(n));
              }
            });

            if (!RECORDING_PHASE && elseCondNodes!.length) {
              elseCond = new Sequence(elseCondNodes!, undefined, $.getLocationFromNodes(elseCondNodes!), $.context);
            }
          }
        });

        $.CONSUME2(T.LCurly);
        const elseRules = $.SUBRULE2($.atRuleBody, { ARGS: [{ ...ctx, inner: !!ctx.inner }] });
        $.CONSUME2(T.RCurly);
        if (!RECORDING_PHASE) {
          makePublicDirectiveRules(elseRules);
          branches.push({ condition: elseCond, rules: elseRules });
        }
      }
    });

    if (!RECORDING_PHASE) {
      const loc = $.endRule();
      return new If({ branches }, undefined, loc, $.context);
    }
  };
}

export function scssForAtRule(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    $.CONSUME(T.AtKeyword); // assumed '@for'

    let headerNodes: Node[] | undefined;
    if (!RECORDING_PHASE) headerNodes = [];
    $.MANY({
      GATE: () => $.LA(1).tokenType !== T.LCurly && $.LA(1).tokenType.name !== 'EOF',
      DEF: () => {
        const n = $.SUBRULE($.anyOuterValue, { ARGS: [ctx] });
        if (!RECORDING_PHASE) headerNodes!.push($.wrap(n));
      }
    });
    const header = !RECORDING_PHASE
      ? new Sequence(headerNodes ?? [], undefined, $.getLocationFromNodes(headerNodes ?? []), $.context)
      : undefined;

    $.CONSUME(T.LCurly);
    const rules = $.SUBRULE($.atRuleBody, { ARGS: [{ ...ctx, inner: !!ctx.inner }] });
    $.CONSUME(T.RCurly);
    if (!RECORDING_PHASE) {
      makePublicDirectiveRules(rules);
      const loc = $.endRule();
      return new For({ header: header!, rules }, undefined, loc, $.context);
    }
  };
}

export function scssEachAtRule(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    $.CONSUME(T.AtKeyword); // assumed '@each'

    let headerNodes: Node[] | undefined;
    if (!RECORDING_PHASE) headerNodes = [];
    $.MANY({
      GATE: () => $.LA(1).tokenType !== T.LCurly && $.LA(1).tokenType.name !== 'EOF',
      DEF: () => {
        const n = $.SUBRULE($.anyOuterValue, { ARGS: [ctx] });
        if (!RECORDING_PHASE) headerNodes!.push($.wrap(n));
      }
    });
    const header = !RECORDING_PHASE
      ? new Sequence(headerNodes ?? [], undefined, $.getLocationFromNodes(headerNodes ?? []), $.context)
      : undefined;

    $.CONSUME(T.LCurly);
    const rules = $.SUBRULE($.atRuleBody, { ARGS: [{ ...ctx, inner: !!ctx.inner }] });
    $.CONSUME(T.RCurly);
    if (!RECORDING_PHASE) {
      makePublicDirectiveRules(rules);
      const loc = $.endRule();
      return new Each({ header: header!, rules }, undefined, loc, $.context);
    }
  };
}

export function scssWhileAtRule(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    $.CONSUME(T.AtKeyword); // assumed '@while'

    let condNodes: Node[] | undefined;
    if (!RECORDING_PHASE) condNodes = [];
    $.MANY({
      GATE: () => $.LA(1).tokenType !== T.LCurly && $.LA(1).tokenType.name !== 'EOF',
      DEF: () => {
        const n = $.SUBRULE($.anyOuterValue, { ARGS: [ctx] });
        if (!RECORDING_PHASE) condNodes!.push($.wrap(n));
      }
    });
    const condition = !RECORDING_PHASE && condNodes!.length
      ? new Sequence(condNodes!, undefined, $.getLocationFromNodes(condNodes!), $.context)
      : undefined;

    $.CONSUME(T.LCurly);
    const rules = $.SUBRULE($.atRuleBody, { ARGS: [{ ...ctx, inner: !!ctx.inner }] });
    $.CONSUME(T.RCurly);
    if (!RECORDING_PHASE) {
      makePublicDirectiveRules(rules);
      const loc = $.endRule();
      return new While({ condition: condition!, rules }, undefined, loc, $.context);
    }
  };
}

export function scssMixinAtRule(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    $.CONSUME(T.AtKeyword); // assumed '@mixin' (dispatched by unknownAtRule)
    let nameTok: any;
    let hasParamsFromStart = false;
    $.OR([
      {
        GATE: () => $.LA(1).tokenType === T.FunctionStart,
        ALT: () => {
          nameTok = $.CONSUME(T.FunctionStart);
          hasParamsFromStart = true;
        }
      },
      {
        GATE: () => $.LA(1).tokenType === T.GenericFunctionStart,
        ALT: () => {
          nameTok = $.CONSUME(T.GenericFunctionStart);
          hasParamsFromStart = true;
        }
      },
      { ALT: () => nameTok = $.CONSUME(T.Ident) }
    ]);

    let params: List | undefined;
    $.OR2([
      {
        GATE: () => hasParamsFromStart,
        ALT: () => {
          params = $.SUBRULE($.scssMixinParamsAfterFunctionStart, { ARGS: [ctx] });
        }
      },
      {
        GATE: () => $.LA(1).tokenType === T.LParen,
        ALT: () => {
          params = $.SUBRULE($.scssMixinParams, { ARGS: [ctx] });
        }
      },
      { ALT: () => {} }
    ]);

    $.CONSUME(T.LCurly);
    const rules = $.SUBRULE($.declarationList, { ARGS: [{ ...ctx, inner: true }] });
    $.CONSUME(T.RCurly);

    if (!RECORDING_PHASE) {
      // Sass-style: inner vars/mixins should not be publicly visible by default.
      rules.options.rulesVisibility ??= {};
      rules.options.rulesVisibility.VarDeclaration ??= 'private';
      rules.options.rulesVisibility.Mixin ??= 'private';

      const loc = $.endRule();
      const mixinName = (nameTok.tokenType === T.FunctionStart || nameTok.tokenType === T.GenericFunctionStart)
        ? String(nameTok.image).slice(0, -1)
        : String(nameTok.image);

      return new Mixin(
        {
          name: new Any(mixinName, { role: 'name' }, $.getLocationInfo(nameTok), $.context),
          params,
          rules
        },
        undefined,
        loc,
        $.context
      );
    }
  };
}

export function scssMixinParams(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    $.CONSUME(T.LParen);
    let params: Node[] | undefined;
    if (!RECORDING_PHASE) params = [];

    $.OPTION(() => {
      $.AT_LEAST_ONE_SEP({
        SEP: T.Comma,
        DEF: () => {
          const p = $.SUBRULE($.scssMixinParam, { ARGS: [ctx] }) as unknown as Node;
          if (!RECORDING_PHASE) {
            params!.push(p);
          }
        }
      });
    });

    $.CONSUME(T.RParen);
    if (!RECORDING_PHASE) {
      const loc = $.endRule();
      return new List(params ?? [], undefined, loc, $.context);
    }
  };
}

export function scssMixinParamsAfterFunctionStart(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    let params: Node[] | undefined;
    if (!RECORDING_PHASE) params = [];

    $.OPTION(() => {
      $.AT_LEAST_ONE_SEP({
        SEP: T.Comma,
        DEF: () => {
          const p = $.SUBRULE($.scssMixinParam, { ARGS: [ctx] }) as unknown as Node;
          if (!RECORDING_PHASE) {
            params!.push(p);
          }
        }
      });
    });

    $.CONSUME(T.RParen);
    if (!RECORDING_PHASE) {
      const loc = $.endRule();
      return new List(params ?? [], undefined, loc, $.context);
    }
  };
}

export function scssMixinParam(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    let node: Node | undefined;
    $.OR([
      // ...$rest
      {
        GATE: () => $.LA(1).tokenType?.name === 'Ellipsis' || $.LA(1).image === '...',
        ALT: () => {
          $.CONSUME(T.Ellipsis);
          const dv = $.CONSUME(T.DollarVariable);
          if (!RECORDING_PHASE) {
            node = new Rest(dv.image.slice(1), undefined, $.getLocationInfo(dv), $.context);
          }
        }
      },
      {
        ALT: () => {
          const dv = $.CONSUME2(T.DollarVariable);
          let defaultValue: Node | undefined;
          $.OPTION(() => {
            // In SCSS, default params use `:`, which is tokenized as `Assign` in this lexer setup.
            $.CONSUME(T.Assign);
            defaultValue = $.SUBRULE($.valueSequence, { ARGS: [ctx] });
          });
          if (!RECORDING_PHASE) {
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
      }
    ]);

    if (!RECORDING_PHASE) {
      $.endRule();
      return node!;
    }
  };
}

export function declaration(this: ScssActionsParser, T: ScssTokenMap, alt?: AltContext) {
  const $ = this;
  const baseDecl = cssProductions.declaration.call(this, T);

  return (ctx: RuleContext = {}) => {
    // SCSS variable declaration: `$x: ... [!default] [!global]`
    return $.OR5([
      {
        GATE: () => $.LA(1).tokenType === T.DollarVariable,
        ALT: () => {
          const RECORDING_PHASE = $.RECORDING_PHASE;
          $.startRule();
          const dv = $.CONSUME(T.DollarVariable);
          const assign = $.CONSUME(T.Assign);
          const value = $.SUBRULE($.valueList, { ARGS: [ctx] });

          let sawDefault = false;
          let sawGlobal = false;
          $.MANY(() => {
            $.OR([
              { ALT: () => { $.CONSUME(T.SassDefault); sawDefault = true; } },
              { ALT: () => { $.CONSUME(T.SassGlobal); sawGlobal = true; } },
            ]);
          });

          if (!RECORDING_PHASE) {
            const location = $.endRule();
            const nameNode = $.wrap(
              new Any(dv.image.slice(1), { role: 'property' }, $.getLocationInfo(dv), $.context),
              true
            );
            return new VarDeclaration(
              { name: nameNode, value: $.wrap(value, 'both') },
              {
                assign: (sawDefault ? '?:' : assign.image) as AssignmentType,
                setDefined: sawGlobal,
              },
              location,
              $.context
            );
          }
        }
      },
      { ALT: () => baseDecl(ctx) }
    ]);
  };
}

/**
 * Override CSS `unknownAtRule` to special-case Sass directives.
 *
 * We do this (instead of extending `atRule`) because the CSS parser’s
 * lookahead will otherwise choose `unknownAtRule` and skip our custom
 * alternatives.
 */
export function unknownAtRule(this: ScssActionsParser, T: ScssTokenMap) {
  const $ = this;
  const baseUnknown = cssProductions.unknownAtRule.call(this, T);

  return (ctx: RuleContext = {}) => {
    const img = $.LA(1).image;
    if (img === '@use') return $.SUBRULE($.scssUseAtRule, { ARGS: [ctx] });
    if (img === '@forward') return $.SUBRULE($.scssForwardAtRule, { ARGS: [ctx] });
    if (img === '@content') return $.SUBRULE($.scssContentAtRule, { ARGS: [ctx] });
    if (img === '@if') return $.SUBRULE($.scssIfAtRule, { ARGS: [ctx] });
    if (img === '@for') return $.SUBRULE($.scssForAtRule, { ARGS: [ctx] });
    if (img === '@each') return $.SUBRULE($.scssEachAtRule, { ARGS: [ctx] });
    if (img === '@while') return $.SUBRULE($.scssWhileAtRule, { ARGS: [ctx] });
    if (img === '@include') return $.SUBRULE($.scssIncludeAtRule, { ARGS: [ctx] });
    if (img === '@mixin') return $.SUBRULE($.scssMixinAtRule, { ARGS: [ctx] });
    return baseUnknown(ctx);
  };
}

