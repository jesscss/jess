import { type LessActionsParser as P, type TokenMap, type RuleContext } from './lessActionsParser';
import {
  tokenMatcher,
  type IToken,
  EMPTY_ALT
} from 'chevrotain';
import {
  main as cssMain,
  declaration as cssDeclaration,
  mediaInParens as cssMediaInParens,
  simpleSelector as cssSimpleSelector,
  complexSelector as cssComplexSelector,
  unknownAtRule as cssUnknownAtRule,
  nthValue as cssNthValue,
  knownFunctions as cssKnownFunctions,
  mathValue as cssMathValue,
  innerAtRule as cssInnerAtRule,
  type AltContext
} from '@jesscss/css-parser';

import {
  type TreeContext,
  Node,
  Ampersand,
  Block,
  Any,
  type LocationInfo,
  type Operator,
  type ConditionOperator,
  Ruleset,
  type SimpleSelector,
  BasicSelector,
  Combinator,
  List,
  Sequence,
  Call,
  Paren,
  Operation,
  Quoted,
  AtRule,
  Interpolated,
  Reference,
  Dimension,
  Num,
  Extend,
  ExtendList,
  Negative,
  Mixin,
  Condition,
  VarDeclaration,
  DefaultGuard,
  Rest,
  StyleImport,
  Expression,
  ComplexSelector,
  CompoundSelector,
  SelectorList,
  type Rules,
  type ComplexSelectorComponent
} from '@jesscss/core';

let { isArray } = Array;

const isEscapedString = function(this: P, T: TokenMap) {
  const next = this.LA(1);
  return tokenMatcher(next, T.QuoteStart) && next.image.startsWith('~');
};

/** Charset moved within `main` (explained in that rule) */
export function stylesheet(this: P, T: TokenMap) {
  const $ = this;

  // stylesheet
  //   : CHARSET? main EOF
  //   ;
  return (options: Record<string, any> = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    let context: TreeContext;
    if (!RECORDING_PHASE) {
      if (options.context) {
        context = this._context = options.context;
      } else {
        context = this.context;
      }
      // Less may set scope in context.opts; TreeContext has no scope
    }

    let charset: IToken | undefined;

    $.OPTION({
      GATE: () => !$.looseMode,
      DEF: () => {
        charset = $.CONSUME(T.Charset);
      }
    });

    let root: Node = $.SUBRULE($.main, { ARGS: [{ isRoot: true }] });

    if (!RECORDING_PHASE) {
      let rules = root.value as unknown as Node[];

      if (charset) {
        let loc = $.getLocationInfo(charset);
        let rootLoc = root.location;
        rules.unshift(new Any(charset.image, { role: 'charset' }, loc, context!));
        rootLoc[0] = loc[0];
        rootLoc[1] = loc[1];
        rootLoc[2] = loc[2];
      }

      return root;
    }
  };
}

export function main(this: P, T: TokenMap) {
  const $ = this;

  let ruleAlt = [
    // { GATE: () => looksLikeMixinDefinition.call($, T), ALT: () => $.SUBRULE($.mixinDefinition) },
    { ALT: () => $.SUBRULE($.functionCall) },
    { ALT: () => $.SUBRULE($.extendList) },
    {
      GATE: () => {
        let next = $.LA(1).tokenType;
        return next === T.DotName || next === T.HashName || next === T.ColorIdentStart;
      },
      ALT: () => $.SUBRULE($.mixinOrQualifiedRule)
    },
    {
      GATE: () => {
        let next = $.LA(1).tokenType;
        return next !== T.DotName
          && next !== T.HashName
          && next !== T.ColorIdentStart;
      },
      ALT: () => $.SUBRULE($.qualifiedRule)
    },
    { ALT: () => $.SUBRULE($.atRule) },

    /**
     * Historically, Less allows `@charset` anywhere,
     * to avoid outputting it in the wrong place.
     * Ideally, this would result in an error if, say,
     * the `@charset` was defined at the bottom of the file,
     * but that wasn't the solution made.
     * @see https://github.com/less/less.js/issues/2126
     */
    {
      GATE: () => $.looseMode,
      ALT: () => $.CONSUME(T.Charset)
    },
    { ALT: () => $.CONSUME2(T.Semi) }
    // { ALT: () => $.SUBRULE($.mixinCall) }
  ];

  return cssMain.call(this, T, ruleAlt as any);
}

export function declarationList(this: P, T: TokenMap) {
  const $ = this;

  let ruleAlt = [
    { ALT: () => $.SUBRULE($.declaration) },
    { ALT: () => $.SUBRULE($.functionCall) },
    /** Less allows all at-rules in declaration lists for historical reasons */
    { ALT: () => $.SUBRULE($.atRule, { ARGS: [{ inner: true }] }) },
    {
      GATE: () => {
        let next = $.LA(1).tokenType;
        return next === T.DotName || next === T.HashName || next === T.ColorIdentStart;
      },
      ALT: () => $.SUBRULE($.mixinOrQualifiedRule, { ARGS: [{ inner: true }] })
    },
    {
      GATE: () => {
        let next = $.LA(1).tokenType;
        return next !== T.DotName
          && next !== T.HashName
          && next !== T.ColorIdentStart;
      },
      ALT: () => $.SUBRULE($.qualifiedRule, { ARGS: [{ inner: true }] }) },
    { ALT: () => $.CONSUME2(T.Semi) }
  ];

  return cssMain.call(this, T, ruleAlt as any);
}

// Wrapper to ensure a mixin call in declaration context ends with a semicolon
// export function mixinCallStatement(this: P, T: TokenMap) {
//   const $ = this;
//   return () => {
//     const node = $.SUBRULE($.mixinCall);
//     // If mixinCall did not consume a semicolon, require one now
//     if ($.LA(1).tokenType === T.Semi) {
//       $.CONSUME(T.Semi);
//     }
//     return node;
//   };
// }

let interpolatedRegex = /([$@]){([^}]+)}/g;
/** The placeholder we use for interpolation... we should probably use a const exported from @jesscss/core? */
let charPlaceholder = '{}';

const getInterpolated = (name: string, location: LocationInfo, context: TreeContext): Interpolated => {
  const replacements: Node[] = [];
  let result: RegExpExecArray | null;
  let source = name;
  while (result = interpolatedRegex.exec(name)) {
    const [match, propOrVar, value] = result;
    source = source.replace(match, '{}');
    replacements.push(new Reference({ key: value! }, { type: propOrVar === '$' ? 'property' : 'variable', role: 'ident' }));
  }
  return new Interpolated({ source, replacements }, { role: 'ident' }, location, context);
};

export function declaration(this: P, T: TokenMap) {
  const $ = this;

  let ruleAlt = [
    {
      ALT: () => {
        let name: IToken;
        $.OR2([
          {
            ALT: () => name = $.CONSUME(T.Ident)
          },
          {
            GATE: () => $.legacyMode,
            ALT: () => name = $.CONSUME(T.LegacyPropIdent)
          }
        ]);
        let assign = $.CONSUME(T.Assign);
        let value = $.SUBRULE($.valueList);
        let important: IToken | undefined;

        $.OPTION(() => {
          important = $.CONSUME(T.Important);
        });
        if (!$.RECORDING_PHASE) {
          let nameNode: Node;
          let nameValue = name!.image;
          if (nameValue.includes('@') || nameValue.includes('$')) {
            nameNode = getInterpolated(nameValue, $.getLocationInfo(name!), this.context);
          } else {
            nameNode = $.wrap(new Any(name!.image, { role: 'property' }, $.getLocationInfo(name!), this.context), true);
          }
          return [nameNode, assign, value, important];
        }
      }
    },
    {
      ALT: () => {
        let RECORDING_PHASE = $.RECORDING_PHASE;
        let nodes: Node[];
        if (!RECORDING_PHASE) {
          nodes = [];
        }
        let name = $.OR3([
          { ALT: () => $.CONSUME(T.InterpolatedCustomProperty) },
          { ALT: () => $.CONSUME(T.CustomProperty) }
        ]);
        let assign = $.CONSUME2(T.Assign);
        $.startRule();
        $.MANY(() => {
          let val = $.SUBRULE($.customValue);
          if (!RECORDING_PHASE) {
            nodes!.push(val);
          }
        });
        if (!RECORDING_PHASE) {
          let location = $.endRule();
          let nameNode: Node;
          let nameValue = name.image;
          if (nameValue.includes('@') || nameValue.includes('$')) {
            nameNode = getInterpolated(nameValue, $.getLocationInfo(name), this.context);
          } else {
            nameNode = $.wrap(new Any(name.image, { role: 'property' }, $.getLocationInfo(name), this.context), true);
          }
          let value = new Sequence(nodes!, undefined, location, this.context);
          return [nameNode, assign, value];
        }
      }
    }
  ];

  return cssDeclaration.call(this, T, ruleAlt);
}

export function mediaInParens(this: P, T: TokenMap) {
  const $ = this;

  let isEscaped = isEscapedString.bind(this, T);

  return () =>
    $.OR([
      /**
       * It's up to the Less author to validate that this will produce
       * valid media queries.
       */
      {
        /** Allow escaped strings */
        GATE: isEscaped,
        ALT: () => $.SUBRULE($.string)
      },
      /**
       * After Less evaluation, should throw an error
       * if the value of `@myvar` is a ruleset
       */
      { ALT: () => $.SUBRULE($.valueReference, { ARGS: [{ requireAccessorsAfterMixinCall: true }] }) },
      {
        ALT: cssMediaInParens.call(this, T)
      }
    ]);
}

export function mfValue(this: P, T: TokenMap) {
  const $ = this;

  return () =>
    /**
     * Like the original Less Parser, we're
     * going to allow any value expression,
     * and it's up to the Less author to know
     * if it's valid.
     */
    $.SUBRULE($.expressionSum);
}

export function wrappedDeclarationList(this: P, T: TokenMap) {
  const $ = this;
  return () => {
    $.CONSUME(T.LCurly);
    let rules = $.SUBRULE($.declarationList);
    $.CONSUME(T.RCurly);
    return rules;
  };
}

export function qualifiedRule(this: P, T: TokenMap, altContext?: AltContext) {
  const $ = this;

  let selectorAlt = altContext ?? ((ctx: RuleContext) => [
    {
      GATE: () => !ctx.inner,
      ALT: () => $.SUBRULE($.selectorList, { ARGS: [{ ...ctx, qualifiedRule: true }] })
    },
    {
      GATE: () => !!ctx.inner,
      ALT: () => $.SUBRULE($.forgivingSelectorList, { ARGS: [{ ...ctx, firstSelector: true, qualifiedRule: true }] })
    }
  ]);
  // qualifiedRule
  //   : selectorList WS* LCURLY declarationList RCURLY
  //   ;
  return (ctx: RuleContext = {}) => {
    $.startRule();

    let selector = $.OR(selectorAlt(ctx));
    let guard: Condition | undefined;

    /** Less extension - rules can be guarded */
    $.OPTION2(() => {
      guard = $.SUBRULE2($.guard);
    });

    $.CONSUME(T.LCurly);
    let rules = $.SUBRULE($.declarationList);
    $.CONSUME(T.RCurly);

    if (!$.RECORDING_PHASE) {
      let location = $.endRule();
      return new Ruleset({
        selector,
        rules,
        guard
      }, undefined, location, this.context);
    }
  };
}

/**
 * In order to not do any backtracking, anything with a class or id selector start
 * will end up here, and everything else will be shunted to the qualified rule.
 */
export function mixinOrQualifiedRule(this: P, T: TokenMap) {
  const $ = this;

  // qualifiedRule
  //   : selectorList WS* LCURLY declarationList RCURLY
  //   ;
  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    let selector = $.OR([
      {
        GATE: () => !ctx.inner,
        ALT: () => $.SUBRULE($.selectorList, { ARGS: [{ ...ctx, qualifiedRule: true }] })
      },
      {
        GATE: () => !!ctx.inner,
        ALT: () => $.SUBRULE($.forgivingSelectorList, { ARGS: [{ ...ctx, firstSelector: true, qualifiedRule: true }] })
      }
    ]);

    let isSelectorList = selector instanceof SelectorList;
    let guard: Condition | undefined;
    let args: List<Node> | undefined;
    let important: IToken | undefined;

    const createMixinCall = (location: LocationInfo) => {
      /** Okay, treat the call as a recursive reference */
      if (RECORDING_PHASE) {
        return;
      }
      let leftNode!: Node;
      for (let s of selector.nodes()) {
        if (s instanceof BasicSelector) {
          leftNode = new Reference({ target: leftNode as Reference, key: s.valueOf() }, { type: 'mixin', role: 'name' }, undefined, this.context);
        }
      }
      /** Finally, pass this reference into a call */
      leftNode = new Call({ name: leftNode, args }, { markImportant: !!important }, location, this.context);
      return leftNode;
    };

    let isPossibleMixinDefinition = selector instanceof BasicSelector && (selector.isClass || selector.isId);
    let isPossibleMixinCall = true;
    if (!isSelectorList && !isPossibleMixinDefinition && !RECORDING_PHASE) {
      for (let s of selector.nodes()) {
        /** Keep going until we get to basic selectors. */
        if (s instanceof ComplexSelector || s instanceof CompoundSelector) {
          continue;
        }
        if (
          (s instanceof BasicSelector && (s.isClass || s.isId))
          || (s instanceof Combinator && s.value === '>')
        ) {
          continue;
        }
        isPossibleMixinCall = false;
        break;
      }
    }
    let isExtendList = isSelectorList
      ? (selector as SelectorList).value.every(s => s instanceof Extend)
      : selector instanceof Extend;

    return $.OR2([
      {
        GATE: () => !isExtendList && (isPossibleMixinDefinition || isPossibleMixinCall),
        ALT: () => {
          args = $.SUBRULE($.mixinArgs);
          let next = $.LA(1).tokenType;
          if (next === T.LCurly || next === T.When || next === T.WhenFunctionStart) {
            isPossibleMixinCall = false;
          }
          return $.OR3([
            {
              GATE: () => isPossibleMixinDefinition,
              /** Mixin definition */
              ALT: () => {
                $.OPTION(() => {
                  guard = $.SUBRULE($.guard);
                });
                $.CONSUME(T.LCurly);
                let rules = $.SUBRULE($.declarationList);
                $.CONSUME(T.RCurly);
                if (!RECORDING_PHASE) {
                  return new Mixin({ name: selector.valueOf(), params: args, rules, guard }, undefined, $.endRule(), this.context);
                }
              }
            },
            {
              GATE: () => isPossibleMixinCall,
              /** Mixin call */
              ALT: () => {
                $.OPTION2(() => {
                  important = $.CONSUME(T.Important);
                });
                let location: LocationInfo;
                if (!RECORDING_PHASE) {
                  location = $.endRule();
                }
                let result = $.OPTION3(() => {
                  return $.SUBRULE($.accessors, { ARGS: [{ node: createMixinCall(location) }] });
                });
                return result ?? createMixinCall(location!);
              }
            }
          ]);
        }
      },
      {
        /** Parse as qualified rule */
        GATE: () => !isExtendList,
        ALT: () => {
          $.OPTION4({
            GATE: () => !isSelectorList,
            DEF: () => {
              guard = $.SUBRULE2($.guard);
            }
          });
          $.CONSUME2(T.LCurly);
          let rules = $.SUBRULE2($.declarationList);
          $.CONSUME2(T.RCurly);
          if (!RECORDING_PHASE) {
            return new Ruleset({ selector, rules, guard }, undefined, $.endRule(), this.context);
          }
        }
      },
      {
        GATE: () => isExtendList,
        ALT: () => {
          let rules!: Rules;
          /** In Less 5.x, curly braces are optional for extend lists */
          $.OPTION5(() => {
            $.CONSUME3(T.LCurly);
            rules = $.SUBRULE3($.declarationList);
            $.CONSUME3(T.RCurly);
          });

          if (!RECORDING_PHASE) {
            if (!rules) {
              return new ExtendList(selector.value, undefined, $.endRule(), this.context);
            }
            return new Ruleset({ selector, rules, guard }, undefined, $.endRule(), this.context);
          }
        }
      },
      {
        GATE: () => isPossibleMixinCall,
        ALT: () => {
          // Call terminated by a semi-colon and not parens, deprecated
          $.CONSUME(T.Semi);
          if (!RECORDING_PHASE) {
            $.endRule();
          }
        }
      }
    ]);
  };
}

/**
 * We need to now handle a returned `Extend` node from the complexSelector rule
 */
export function relativeSelector(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    return $.OR([
      {
        ALT: () => {
          let co = $.CONSUME(T.Combinator);
          let node: ComplexSelector | Extend = $.SUBRULE($.complexSelector, { ARGS: [ctx] });

          if (!$.RECORDING_PHASE) {
            let combinator = new Combinator(co.image, undefined, $.getLocationInfo(co), this.context);
            let targetNode =
              node instanceof Extend
                ? node.value.selector
                : node;
            if (targetNode instanceof ComplexSelector) {
              targetNode.value.unshift(combinator);
              targetNode._location = $.getLocationFromNodes(targetNode.value);
            } else {
              let nodes = [combinator, targetNode as ComplexSelectorComponent];
              let complex = new ComplexSelector(nodes, undefined, $.getLocationFromNodes(nodes), this.context);
              if (node instanceof Extend) {
                node.value.selector = complex;
                let location = node.location;
                location[0] = co.startOffset;
                location[1] = co.startLine;
                location[2] = co.startColumn;
              } else {
                node = complex;
              }
            }
          }
          return node;
        }
      },
      {
        ALT: () => $.SUBRULE2($.complexSelector, { ARGS: [ctx] })
      }
    ]);
  };
}

/**
 * Extended with :extend
 */
export function complexSelector(this: P, T: TokenMap) {
  const $ = this;
  let originalComplexRule = cssComplexSelector.call(this, T);

  return (ctx: RuleContext = {}) => {
    let selector: Node = originalComplexRule(ctx)!;

    let isQualifiedRule = !!ctx.qualifiedRule;

    $.OPTION2({
      GATE: () => isQualifiedRule,
      DEF: () => {
        selector = $.SUBRULE($.extend, { ARGS: [selector as ComplexSelector] });
      }
    });

    return selector;
  };
}

/**
 * A list of selectors, all with extends, ending with
 * a semi-colon.
 */
export function extendList(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    let nodes: Array<ComplexSelector | Extend>;

    if (!RECORDING_PHASE) {
      nodes = [];
    }

    $.AT_LEAST_ONE_SEP({
      SEP: T.Comma,
      DEF: () => {
        let sel: ComplexSelector | undefined;
        let ext: Extend | undefined;
        $.OPTION(() => {
          sel = $.OR([
            {
              GATE: () => !!ctx.inner,
              ALT: () => $.SUBRULE($.relativeSelector, { ARGS: [ctx] })
            },
            {
              GATE: () => !ctx.inner,
              ALT: () => $.SUBRULE($.complexSelector, { ARGS: [ctx] })
            }
          ]);
        });
        ext = $.SUBRULE($.extend, { ARGS: [sel] });
        if (!RECORDING_PHASE) {
          nodes.push(ext!);
        }
      }
    });

    $.CONSUME(T.Semi);

    if (!RECORDING_PHASE) {
      let location = $.endRule();
      return new ExtendList(nodes! as Extend[], undefined, location, this.context);
    }
  };
}

export function extend(this: P, T: TokenMap) {
  const $ = this;

  return (selector: ComplexSelector | undefined) => {
    let start = $.CONSUME(T.Extend);
    let target = $.SUBRULE($.selectorList);
    let flag: IToken | undefined;
    $.OPTION(() => flag = $.CONSUME(T.All));
    let end = $.CONSUME(T.RParen);
    if (!$.RECORDING_PHASE) {
      let startOffset: number;
      let startLine: number;
      let startColumn: number;
      if (selector) {
        let location = selector.location;
        startOffset = location[0]!;
        startLine = location[1]!;
        startColumn = location[2]!;
      } else {
        let loc = start;
        startOffset = loc.startOffset;
        startLine = loc.startLine!;
        startColumn = loc.startColumn!;
      }
      let { endOffset, endLine, endColumn } = end;
      return new Extend({
        selector: selector!,
        target,
        flag: flag ? 1 : undefined
      }, undefined, [startOffset, startLine, startColumn, endOffset!, endLine!, endColumn!], this.context);
    }
  };
}

export function simpleSelector(this: P, T: TokenMap) {
  const $ = this;

  let selectorAlt = (ctx: RuleContext) => [
    {
      /** In Less/Sass (and now CSS), the first inner selector can be an identifier */
      ALT: () => $.CONSUME(T.Ident)
    },
    {
      /**
       * Unlike CSS Nesting, Less allows outer qualified rules
       * to have `&`, and it is just silently absorbed if there
       * is no parent selector.
       */
      ALT: () => {
        let amp = $.CONSUME(T.Ampersand);
        if (!$.RECORDING_PHASE) {
          let ampImg = amp.image;
          let value = ampImg.slice(1);
          return new Ampersand(value || undefined, undefined, $.getLocationInfo(amp), this.context);
        }
      }
    },
    { ALT: () => $.CONSUME(T.InterpolatedSelector) },
    { ALT: () => $.SUBRULE($.classSelector) },
    { ALT: () => $.SUBRULE($.idSelector) },
    { ALT: () => $.CONSUME(T.Star) },
    { ALT: () => $.SUBRULE($.pseudoSelector, { ARGS: [ctx] }) },
    { ALT: () => $.SUBRULE($.attributeSelector) }
  ];

  return cssSimpleSelector.call(this, T, selectorAlt as any);
}

export function anonymousMixinDefinition(this: P, T: TokenMap) {
  const $ = this;

  return () => {
    $.startRule();
    let params: List | undefined;
    $.OPTION(() => {
      $.CONSUME(T.AnonMixinStart);
      params = $.SUBRULE($.mixinArgList, { ARGS: [{ isDefinition: true }] });
      $.CONSUME(T.RParen);
    });
    let rules = $.SUBRULE($.wrappedDeclarationList);

    if (!$.RECORDING_PHASE) {
      return new Mixin({ params, rules }, undefined, $.endRule(), this.context);
    }
  };
}

/**
 * Mostly copied from css importAtRule, but it maps
 * differently to Jess nodes depending on if it's meant
 * to be a Jess-style import or just an at-rule
 */
export function importAtRule(this: P, T: TokenMap) {
  const $ = this;

  const isCssUrl = (url: string) =>
    url.endsWith('.css') || url.startsWith('http');

  const getUrlFromNode = (urlNode: Quoted | Call): string => {
    let url: string = '';
    if (urlNode instanceof Quoted) {
      url = urlNode.valueOf();
    } else {
      let args = urlNode.value.args;
      if (args && args.value && args.value.length > 0) {
        let innerUrlNode = args.value[0]!;
        /**
         * A url function will have either a quoted value
         * or a general (un-quoted) value
         */
        if (innerUrlNode instanceof Quoted) {
          url = innerUrlNode.valueOf();
        } else if (innerUrlNode instanceof Any) {
          url = innerUrlNode.value;
        }
      }
    }
    return url;
  };

  return () => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    let name = $.CONSUME(T.AtImport);

    let options: string[];

    if (!RECORDING_PHASE) {
      options = [];
    }

    $.OPTION(() => {
      $.CONSUME(T.LParen);
      $.AT_LEAST_ONE_SEP({
        SEP: T.Comma,
        DEF: () => {
          let opt = $.CONSUME(T.PlainIdent);
          if (!RECORDING_PHASE) {
            options!.push(opt.image);
          }
        }
      });
      $.CONSUME(T.RParen);
    });

    let urlNode: Quoted | Call = $.OR([
      { ALT: () => $.SUBRULE($.urlFunction) },
      { ALT: () => $.SUBRULE($.string) }
    ]);

    let isAtRule: boolean | undefined;

    if (!RECORDING_PHASE) {
      if (options!.includes('css')) {
        isAtRule = true;
      } else {
        let url = getUrlFromNode(urlNode);
        if (isCssUrl(url)) {
          isAtRule = true;
        }
      }
    }

    let preludeNodes: Node[];

    if (!RECORDING_PHASE) {
      preludeNodes = [$.wrap(urlNode)];
    }

    let extraNodes: Node[] | undefined;
    $.OPTION2(() => {
      extraNodes = $.SUBRULE($.importPostlude) as Node[];
    });
    if (!RECORDING_PHASE && extraNodes && extraNodes.length) {
      isAtRule = true;
      for (const n of extraNodes) {
        preludeNodes!.push(n);
      }
    }

    $.CONSUME(T.Semi);

    if (!RECORDING_PHASE) {
      let location = $.endRule();
      if (isAtRule) {
        return new AtRule({
          name: $.wrap(new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), this.context), true),
          prelude: new Sequence(preludeNodes!, undefined, $.getLocationFromNodes(preludeNodes!), this.context)
        }, undefined, location, this.context);
      }
      const pathStr = getUrlFromNode(urlNode);
      const pathNode = new Quoted(new Any(pathStr, { role: 'urlvalue' }), { quote: '\'' }, undefined, this.context);
      return new StyleImport({
        path: pathNode
      }, {
        type: 'import',
        importOptions: {
          reference: options!.includes('reference'),
          once: !options!.includes('multiple')
        }
      }, location, this.context);
    }
  };
}

/* This is for variable variables (e.g. `@id-@num`) */
const getInterpolatedOrString = (name: string): Interpolated | string => {
  let nextPos = name.indexOf('@', 1);
  if (nextPos === -1) {
    nextPos = name.indexOf('$', 1);
  }
  if (nextPos === -1) {
    return name.slice(1);
  }
  let start = name.slice(1, nextPos);
  let end = name.slice(nextPos);

  return new Interpolated({
    source: start + charPlaceholder,
    replacements: [
      new Reference(getInterpolatedOrString(end) as string, { type: end.startsWith('@') ? 'variable' : 'property', role: 'ident' })
    ]
  }, { role: 'ident' });
};

/** Less variables */
export function unknownAtRule(this: P, T: TokenMap) {
  const $ = this;

  /**
   * Starts with a colon, with these conditions
   *  1. It is not preceded by a space or
   *  2. If it is preceded by a space, then it is
   *     followed by a space.
   */
  const isVariableLike = () => {
    let next = $.LA(1).tokenType;
    if (next === T.AtKeywordLessExtension || next === T.AtKeyword) {
      return true;
    }
    let token = $.LA(2);
    let isColon = token.tokenType === T.Colon;
    if (!isColon) {
      return false;
    }
    let isVariable = !$.preSkippedTokenMap.has(token.startOffset)
      || $.postSkippedTokenMap.has(token.endOffset!);
    return isVariable;
  };

  const isNotVariableLike = () => !isVariableLike();

  let nameAlt = [
    { ALT: () => $.SUBRULE($.varName) },
    { ALT: () => $.CONSUME(T.NestedReference) }
  ];

  return () => {
    $.startRule();

    let name: IToken;
    let value: Node | undefined;
    let args: List | undefined;
    let important: IToken | undefined;

    let returnVal: Node | undefined = $.OR2([
      {
        /**
         * This is a variable declaration
         * Disallows `@atrule :foo;` because it resembles a pseudo-selector
         */
        GATE: isVariableLike,
        ALT: () => {
          name = $.OR3(nameAlt);
          $.CONSUME(T.Colon);
          return $.OR4([
            /**
             * This needs to be gated early, even though it is
             * gated again in the valueList production, because
             * chevrotain-allstar needs to pick a path first.
             */
            {
              GATE: () => {
                let type = $.LA(1).tokenType;
                return type === T.AnonMixinStart || type === T.LCurly;
              },
              ALT: () => {
                value = $.SUBRULE($.anonymousMixinDefinition);
                $.OPTION2(() => $.CONSUME2(T.Semi));
                return value;
              }
            },
            {
              GATE: () => {
                let type = $.LA(1).tokenType;
                return type !== T.AnonMixinStart && type !== T.LCurly;
              },
              ALT: () => {
                value = $.SUBRULE($.valueList, { ARGS: [{ allowMixinCallWithoutAccessor: true }] });
                $.OPTION(() => {
                  important = $.CONSUME(T.Important);
                });
                return value;
              }
            }
          ]);
        }
      },
      /** This is a variable call */
      {
        GATE: () => $.noSep(1) && $.LA(2).tokenType === T.LParen,
        /**
         * This is a change from Less 1.x-4.x
         * e.g.
         * ```
         * @dr: #(@var1, @var2) {
         *   // ...
         * }
         * @dr(arg1, arg2);
         */
        ALT: () => {
          name = $.SUBRULE2($.varName);
          args = $.SUBRULE($.mixinArgs);
          return args;
        }
      },
      /** Just a regular unknown at-rule */
      {
        GATE: isNotVariableLike,
        ALT: cssUnknownAtRule.call(this, T)
      }
    ]);

    if (!$.RECORDING_PHASE) {
      let location = $.endRule();
      if (returnVal instanceof AtRule) {
        return returnVal;
      }
      let nameVal: string | Interpolated = getInterpolatedOrString(name!.image);
      let nameNode: Node;
      if (!(nameVal instanceof Interpolated)) {
        nameNode = new Any(nameVal, { role: 'ident' }, $.getLocationInfo(name!), this.context);
      } else {
        nameNode = nameVal;
      }

      /** An anonymous mixin call */
      if (!value) {
        const nameRef = nameNode instanceof Interpolated
          ? new Reference({ key: nameNode }, { type: 'mixin-ruleset', role: 'ident' })
          : new Reference({ key: nameNode as any }, { type: 'mixin-ruleset', role: 'ident' });
        return new Call({ name: new Expression(nameRef), args: args! }, undefined, location, this.context);
      }

      return new VarDeclaration({
        name: $.wrap(nameNode, true) as any,
        value: $.wrap(value, true),
        important: important ? $.wrap(new Any(important.image, { role: 'flag' }, $.getLocationInfo(important), this.context), true) : undefined
      }, undefined, location, this.context);
    }
  };
}

export function valueSequence(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    let nodes: Node[];

    if (!RECORDING_PHASE) {
      nodes = [];
    }

    $.OR([
      {
        GATE: () => $.looseMode,
        ALT: () => {
          $.MANY(() => {
            let value = $.SUBRULE($.expressionSum, { ARGS: [ctx] });
            if (!RECORDING_PHASE) {
              nodes.push(value);
            }
          });
        }
      },
      {
        GATE: () => !$.looseMode,
        /** @todo - create warning if there isn't a value */
        ALT: () => {
          $.AT_LEAST_ONE(() => {
            let value = $.SUBRULE2($.expressionSum, { ARGS: [ctx] });
            if (!RECORDING_PHASE) {
              nodes.push(value);
            }
          });
        }
      }
    ]);

    if (!RECORDING_PHASE) {
      let location = $.endRule();
      if (nodes!.length === 1) {
        return nodes![0];
      }
      return new Sequence(nodes!, undefined, location, this.context);
    }
  };
}

export function squareValue(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    $.startRule();
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.CONSUME(T.LSquare);
    let node: Node = $.OR([
      {
        GATE: () => !$.looseMode,
        ALT: () => {
          let ident = $.CONSUME(T.Ident);
          if (!RECORDING_PHASE) {
            return new Any(ident.image, { role: 'ident' }, $.getLocationInfo(ident), this.context);
          }
        }
      },
      {
        GATE: () => !!$.looseMode,
        ALT: () => {
          let nodes: Node[];
          if (!RECORDING_PHASE) {
            nodes = [];
          }
          $.MANY(() => {
            let node = $.SUBRULE($.anyInnerValue);
            if (!RECORDING_PHASE) {
              nodes.push($.wrap(node));
            }
          });
          if (!RECORDING_PHASE) {
            return new Sequence(nodes!, undefined, $.getLocationFromNodes(nodes!), this.context);
          }
        }
      }
    ]);
    $.CONSUME(T.RSquare);
    if (!$.RECORDING_PHASE) {
      let location = $.endRule();
      return new Block(node, { type: 'square' }, location, this.context);
    }
  };
}

/**
 * In CSS, would be a single value.
 * In Less, these are math expressions which
 * represent a single value. During AST construction,
 * these will be grouped by order of operations.
 */
export function expressionSum(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    let left = $.SUBRULE($.expressionProduct, { ARGS: [ctx] });

    $.MANY({
      /**
       * What this GATE does. We need to dis-ambiguate
       * 1 -1 (a value sequence) from 1-1 (a Less expression),
       * so Less is white-space sensitive here.
       */
      GATE: () => {
        const next = $.LA(1);
        const nextType = next.tokenType;
        return (
          nextType === T.Plus
          || nextType === T.Minus
          || ($.noSep() && nextType === T.Signed)
        );
      },
      DEF: () => {
        let op: string | undefined;
        let signed: IToken | undefined;
        let right: Node;

        $.OR([
          {
            ALT: () => {
              let opToken = $.OR2([
                { ALT: () => $.CONSUME(T.Plus) },
                { ALT: () => $.CONSUME(T.Minus) }
              ]);
              if (!RECORDING_PHASE) {
                op = opToken.image;
              }
              right = $.SUBRULE2($.expressionProduct, { ARGS: [ctx] });
            }
          },
          /** This will be interpreted by Less as a complete expression */
          {
            ALT: () => {
              // Consume a signed literal and convert it without rewinding
              const tok = $.CONSUME(T.Signed);
              if (!RECORDING_PHASE) {
                const str = tok.image;
                op = str[0];
                // Build a literal node from the signed token directly
                // Prefer dimension if payload exists, else number, else ident fallback
                if (tok.payload && tok.payload[1]) {
                  const dim = { number: parseFloat(tok.payload[0]), unit: tok.payload[1] };
                  right = new Dimension(dim, undefined, $.getLocationInfo(tok), this.context);
                } else {
                  const num = parseFloat(str);
                  if (!Number.isNaN(num)) {
                    right = new Num(num, undefined, $.getLocationInfo(tok), this.context);
                  } else {
                    right = $.processValueToken(tok);
                  }
                }
              }
            }
          }
        ]);

        if (!RECORDING_PHASE) {
          left = $.wrap(
            new Operation(
              [$.wrap(left, true), op as Operator, $.wrap(right!)],
              undefined,
              $.getLocationFromNodes([left, right!]),
              this.context
            )
          );
          return left;
        }
      }
    });

    if (!RECORDING_PHASE) {
      $.endRule();
      return left;
    }
  };
}

export function expressionProduct(this: P, T: TokenMap) {
  const $ = this;

  let opAlt = [
    { ALT: () => $.CONSUME(T.Star) },
    { ALT: () => $.CONSUME(T.Slash) },
    { ALT: () => $.CONSUME(T.Percent) }
  ];

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    let left = $.SUBRULE($.expressionValue, { ARGS: [ctx] });

    $.MANY(() => {
      let op = $.OR(opAlt);
      let right: Node = $.SUBRULE2($.expressionValue, { ARGS: [ctx] });

      if (!RECORDING_PHASE) {
        left = $.wrap(
          new Operation(
            [$.wrap(left, true), op.image as Operator, $.wrap(right)],
            undefined,
            $.getLocationFromNodes([left, right]),
            this.context
          )
        );
      }
    });

    if (!RECORDING_PHASE) {
      $.endRule();
      return left;
    }
  };
}

export function expressionValue(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    /** Can create a negative expression */
    let minus = $.OPTION(() => $.CONSUME(T.Minus));
    let node = $.OR([
      {
        ALT: () => {
          $.startRule();
          let escape: IToken | undefined;
          $.OPTION2(() => {
            escape = $.CONSUME(T.Tilde);
          });

          $.CONSUME(T.LParen);
          let node = $.SUBRULE($.valueList, { ARGS: [{ ...ctx, inner: true }] });
          $.CONSUME(T.RParen);

          if (!RECORDING_PHASE) {
            let location = $.endRule();
            node = $.wrap(node, 'both');
            return new Paren(node, { escaped: !!escape }, location, this.context);
          }
        }
      },
      { ALT: () => $.SUBRULE($.value, { ARGS: [ctx] }) }
    ]);
    if (!RECORDING_PHASE) {
      let location = $.endRule();
      if (minus) {
        return new Negative(node, undefined, location, this.context);
      }
      return node;
    }
  };
}

/**
 * Add interpolation
 */
export function nthValue(this: P, T: TokenMap) {
  const $ = this;

  let nthValueAlt = [
    { ALT: () => $.CONSUME(T.InterpolatedIdent) },
    { ALT: () => $.CONSUME(T.NthOdd) },
    { ALT: () => $.CONSUME(T.NthEven) },
    { ALT: () => $.CONSUME(T.Integer) },
    {
      ALT: () => {
        $.OR2([
          { ALT: () => $.CONSUME(T.NthDimension) },
          { ALT: () => $.CONSUME(T.NthDimensionSigned) }
        ]);
        $.OPTION(() => {
          $.OR3([
            { ALT: () => $.CONSUME(T.SignedInt) },
            {
              ALT: () => {
                $.CONSUME(T.Minus);
                $.CONSUME(T.UnsignedInt);
              }
            }
          ]);
        });
        $.OPTION2(() => {
          $.CONSUME(T.Of);
          $.SUBRULE($.complexSelector);
        });
      }
    }
  ];

  return cssNthValue.call(this, T, nthValueAlt as any);
}

export function knownFunctions(this: P, T: TokenMap) {
  const $ = this;

  let functions = [
    { ALT: () => $.SUBRULE($.urlFunction) },
    { ALT: () => $.SUBRULE($.varFunction) },
    { ALT: () => $.SUBRULE($.calcFunction) },
    { ALT: () => $.SUBRULE($.ifFunction) },
    { ALT: () => $.SUBRULE($.booleanFunction) }
  ];

  return cssKnownFunctions.call(this, T, functions as any);
}

export function ifFunction(this: P, T: TokenMap) {
  const $ = this;

  return () => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    let name = $.CONSUME(T.IfFunction);

    $.startRule();

    let node: Node = $.SUBRULE($.guardOr, { ARGS: [{ inValueList: true }] });
    let args: Node[];

    if (!RECORDING_PHASE) {
      args = [node];
    }

    $.OR([
      {
        ALT: () => {
          $.CONSUME(T.Semi);
          node = $.SUBRULE($.valueList, { ARGS: [{ allowAnonymousMixins: true }] });
          if (!RECORDING_PHASE) {
            args.push(node);
          }
          $.OPTION(() => {
            $.CONSUME2(T.Semi);
            node = $.SUBRULE2($.valueList, { ARGS: [{ allowAnonymousMixins: true }] });
            if (!RECORDING_PHASE) {
              args.push(node);
            }
          });
        }
      },
      {
        ALT: () => {
          $.CONSUME(T.Comma);
          node = $.SUBRULE($.valueSequence, { ARGS: [{ allowAnonymousMixins: true }] });
          if (!RECORDING_PHASE) {
            args.push(node);
          }
          $.OPTION2(() => {
            $.CONSUME2(T.Comma);
            node = $.SUBRULE2($.valueSequence, { ARGS: [{ allowAnonymousMixins: true }] });
            if (!RECORDING_PHASE) {
              args.push(node);
            }
          });
        }
      }
    ]);
    let argsLocation: LocationInfo | undefined;
    if (!RECORDING_PHASE) {
      argsLocation = $.endRule();
    }

    $.CONSUME(T.RParen);

    if (!RECORDING_PHASE) {
      let location = $.endRule();
      let nameNode = new Reference('if', { type: 'variable', fallbackValue: true }, $.getLocationInfo(name), this.context);
      return new Call({ name: nameNode, args: new List(args!, undefined, argsLocation, this.context) }, undefined, location, this.context);
    }
  };
}

export function booleanFunction(this: P, T: TokenMap) {
  const $ = this;

  return () => {
    $.startRule();
    let name = $.CONSUME(T.BooleanFunction);
    let arg: Condition = $.SUBRULE($.guardOr, { ARGS: [{ inValueList: true }] });
    $.CONSUME(T.RParen);

    if (!$.RECORDING_PHASE) {
      let location = $.endRule();
      let nameNode = new Reference('boolean', { type: 'variable', fallbackValue: true }, $.getLocationInfo(name), this.context);
      return new Call({ name: nameNode, args: new List([arg], undefined, arg.location as LocationInfo, this.context) }, undefined, location, this.context);
    }
  };
}

/** At AST time, join comma-lists together if separated by semis */
// $.RULE('functionValueList', (ctx: RuleContext = {}) => {
//   ctx.allowAnonymousMixins = true
//   $.SUBRULE($.valueSequence, { ARGS: [ctx] })
//   $.MANY(() => {
//     $.OR([
//       { ALT: () => $.CONSUME(T.Comma) },
//       { ALT: () => $.CONSUME(T.Semi) }
//     ])
//     $.SUBRULE2($.valueSequence, { ARGS: [ctx] })
//   })
// })

export function varReference(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    let node: Node | undefined = $.OR([
      {
        ALT: () => {
          let token = $.CONSUME(T.PropertyReference);
          if (!RECORDING_PHASE) {
            return new Reference(token.image.slice(1), { type: 'property' }, $.getLocationInfo(token), this.context);
          }
        }
      },
      {
        ALT: () => {
          let token = $.CONSUME(T.NestedReference);
          if (!RECORDING_PHASE) {
            const raw = token.image;
            const type: 'variable' | 'property' = raw.startsWith('@') ? 'variable' : 'property';
            const key = getInterpolatedOrString(raw);
            if (typeof key === 'string') {
              return new Reference(key, { type }, $.getLocationInfo(token), this.context);
            }
            return new Reference({ key }, { type }, $.getLocationInfo(token), this.context);
          }
        }
      },
      {
        ALT: () => {
          return $.SUBRULE($.varName);
        }
      }
    ]);
    $.OR2([
      {
        ALT: () => {
          /** This spreads a (list) value within a containing list when evaluated */
          let token = $.CONSUME(T.Ellipsis);
          if (!RECORDING_PHASE) {
            node = new Rest(node, undefined, $.getLocationFromNodes([node!, token]), this.context);
          }
        }
      },
      {
        /** Only variables can have accessors */
        GATE: () => node?.options?.type === 'variable',
        ALT: () => {
          node = $.SUBRULE2($.accessors, { ARGS: [{ ...ctx, node }] });
        }
      },
      { ALT: EMPTY_ALT() }
    ]);

    if (!RECORDING_PHASE) {
      return $.wrap(node!);
    }
  };
}

export function valueReference(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    return $.OR([
      { ALT: () => $.SUBRULE($.varReference, { ARGS: [ctx] }) },
      { ALT: () => $.SUBRULE($.inlineMixinCall, { ARGS: [ctx] }) }
    ]);
  };
}

export function functionCall(this: P, T: TokenMap) {
  const $ = this;

  let funcAlt = [
    {
      // Disambiguate known functions by their dedicated tokens
      GATE: () => {
        let tokenType = $.LA(1).tokenType;
        return tokenType === T.UrlStart
          || tokenType === T.Var
          || tokenType === T.Calc
          || tokenType === T.IfFunction
          || tokenType === T.BooleanFunction;
      },
      ALT: () => $.SUBRULE($.knownFunctions)
    },
    {
      // Generic function via FunctionStart token
      GATE: () => {
        let tokenType = $.LA(1).tokenType;
        return tokenType !== T.UrlStart
          && tokenType !== T.Var
          && tokenType !== T.Calc
          && tokenType !== T.IfFunction
          && tokenType !== T.BooleanFunction;
      },
      ALT: () => {
        $.startRule();
        const fnStart = $.CONSUME(T.FunctionStart);
        let args: List | undefined;
        $.OPTION(() => args = $.SUBRULE($.functionCallArgs));
        $.CONSUME(T.RParen);
        if (!$.RECORDING_PHASE) {
          const location = $.endRule();
          const nameValue = fnStart.image.slice(0, -1);
          const nameNode = new Reference(nameValue, { type: 'variable', fallbackValue: true }, $.getLocationInfo(fnStart), this.context);
          return new Call({ name: nameNode, args }, undefined, location, this.context);
        }
      }
    }
  ];

  return () => $.OR(funcAlt);
}

export function functionCallArgs(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    // Inside function arguments, allow inner tokens like ':'
    const innerCtx = { ...ctx, inner: true } as RuleContext;
    let node = $.SUBRULE($.callArgument, { ARGS: [innerCtx] });

    let commaNodes: Node[];
    let semiNodes: Node[];
    if (!RECORDING_PHASE) {
      commaNodes = [$.wrap(node, true)];
      semiNodes = [];
    }
    let isSemiList = false;

    // First, consume any comma-separated arguments
    $.MANY(() => {
      $.CONSUME(T.Comma);
      node = $.SUBRULE2($.callArgument, { ARGS: [innerCtx] });
      if (!RECORDING_PHASE) {
        commaNodes!.push($.wrap(node, true));
      }
    });

    // Then, optionally switch to semicolon-separated list and continue with semicolons
    $.OPTION(() => {
      isSemiList = true;

      $.CONSUME(T.Semi);

      if (!RECORDING_PHASE) {
        // Aggregate the previous set of comma-nodes as the first semi item
        if (commaNodes.length > 1) {
          let commaList = new List(commaNodes, undefined, $.getLocationFromNodes(commaNodes), this.context);
          semiNodes.push(commaList);
        } else {
          semiNodes.push(commaNodes[0]!);
        }
      }

      node = $.SUBRULE3($.callArgument, { ARGS: [{ ...innerCtx, allowComma: true }] });
      if (!RECORDING_PHASE) {
        semiNodes.push($.wrap(node, true));
      }

      $.MANY2(() => {
        $.CONSUME2(T.Semi);
        node = $.SUBRULE4($.callArgument, { ARGS: [{ ...innerCtx, allowComma: true }] });
        if (!RECORDING_PHASE) {
          semiNodes.push($.wrap(node, true));
        }
      });
    });

    if (!RECORDING_PHASE) {
      let location = $.endRule();
      let nodes = isSemiList ? semiNodes! : commaNodes!;
      let sep: ';' | ',' = isSemiList ? ';' : ',';
      return $.wrap(new List(nodes, { sep }, location, this.context), 'both');
    }
  };
}

export function value(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    let node: Node = $.OR([
      /** Function should appear before Ident */
      {
        GATE: () => tokenMatcher($.LA(1), T.FunctionStart),
        ALT: () => $.SUBRULE($.functionCall)
      },
      { ALT: () => $.SUBRULE($.inlineMixinCall, { ARGS: [ctx] }) },
      { ALT: () => $.SUBRULE($.varReference, { ARGS: [ctx] }) },
      { ALT: () => $.CONSUME(T.Ident) },
      { ALT: () => $.CONSUME(T.DefaultGuardFunc) },
      { ALT: () => $.CONSUME(T.Dimension) },
      { ALT: () => $.CONSUME(T.Number) },
      { ALT: () => $.CONSUME(T.Color) },
      { ALT: () => $.SUBRULE($.string) },
      { ALT: () => $.CONSUME(T.JavaScript) },
      /** Explicitly not marked as an ident */
      { ALT: () => $.CONSUME(T.When) },
      { ALT: () => $.SUBRULE($.squareValue) },
      {
        GATE: () => $.looseMode && !!ctx.inner,
        ALT: () => $.CONSUME(T.Colon)
      },
      {
        /** Allow plain classes */
        GATE: () => $.looseMode,
        ALT: () => $.CONSUME(T.DotName)
      },
      {
        /** Allow plain Ids */
        GATE: () => $.looseMode,
        ALT: () => $.CONSUME(T.HashName)
      },
      {
        GATE: () => $.looseMode,
        ALT: () => $.CONSUME(T.Unknown)
      },
      {
        /** e.g. progid:DXImageTransform.Microsoft.Blur(pixelradius=2) */
        GATE: () => $.legacyMode,
        ALT: () => $.CONSUME(T.LegacyMSFilter)
      }
    ]);
    if (!$.RECORDING_PHASE) {
      if (!(node instanceof Node)) {
        node = $.processValueToken(node);
      }
      return $.wrap(node);
    }
  };
}

export function string(this: P, T: TokenMap) {
  const $ = this;

  let stringAlt = [
    {
      ALT: () => {
        $.startRule();
        let quote = $.CONSUME(T.SingleQuoteStart);
        let contents: IToken | undefined;
        $.OPTION(() => contents = $.CONSUME(T.SingleQuoteStringContents));
        $.CONSUME(T.SingleQuoteEnd);
        if (!$.RECORDING_PHASE) {
          let quoteImg = quote.image;
          let escaped = false;
          if (quoteImg.startsWith('~')) {
            escaped = true;
            quoteImg = quoteImg.slice(1);
          }
          let location = $.endRule();
          let value = contents?.image;
          return new Quoted(new Any(value ?? '', { role: 'any' }), { quote: quoteImg as '"' | '\'', escaped }, location, this.context);
        }
      }
    },
    {
      ALT: () => {
        $.startRule();
        let quote = $.CONSUME(T.DoubleQuoteStart);
        let contents: IToken | undefined;
        $.OPTION2(() => contents = $.CONSUME(T.DoubleQuoteStringContents));
        $.CONSUME(T.DoubleQuoteEnd);
        if (!$.RECORDING_PHASE) {
          let quoteImg = quote.image;
          let escaped = false;
          if (quoteImg.startsWith('~')) {
            escaped = true;
            quoteImg = quoteImg.slice(1);
          }
          let location = $.endRule();
          let value = contents?.image;
          return new Quoted(new Any(value ?? '', { role: 'any' }), { quote: quoteImg as '"' | '\'', escaped }, location, this.context);
        }
      }
    }
  ];

  return () => $.OR(stringAlt);
}

export function mathValue(this: P, T: TokenMap) {
  const $ = this;

  let valueAlt = [
    { ALT: () => $.CONSUME(T.AtKeyword) },
    { ALT: () => $.CONSUME(T.Number) },
    { ALT: () => $.CONSUME(T.Dimension) },
    // Allow identifiers like channel names in color space calcs (e.g., calc(l - 0.1))
    { ALT: () => $.CONSUME(T.Ident) },
    { ALT: () => $.SUBRULE($.functionCall) },
    {
      /** Only allow escaped strings in calc */
      GATE: () => $.LA(1).image.startsWith('~'),
      ALT: () => $.SUBRULE($.string)
    },
    {
      /** For some reason, e() goes here instead of $.function */
      GATE: () => $.LA(2).tokenType !== T.LParen,
      ALT: () => $.CONSUME(T.MathConstant)
    },
    { ALT: () => $.SUBRULE($.mathParen) }
  ];

  return cssMathValue.call(this, T, valueAlt);
}

/** @todo - add interpolation */
// $.OVERRIDE_RULE('string', () => {
//   $.OR([
//     {
//       ALT: () => {
//         $.CONSUME(T.SingleQuoteStart)
//         $.OPTION(() => $.CONSUME(T.SingleQuoteStringContents))
//         $.CONSUME(T.SingleQuoteEnd)
//       }
//     },
//     {
//       ALT: () => {
//         $.CONSUME(T.DoubleQuoteStart)
//         $.OPTION2(() => $.CONSUME(T.DoubleQuoteStringContents))
//         $.CONSUME(T.DoubleQuoteEnd)
//       }
//     }
//   ])
// })

export function guard(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    let next = $.LA(1);
    return $.OR([
      {
        ALT: () => {
          $.CONSUME(T.When);
          return $.OR2([
            {
              GATE: () => !!ctx.inValueList,
              ALT: () => $.SUBRULE($.comparison, { ARGS: [ctx] })
            },
            {
              ALT: () => {
                ctx.allowComma = true;
                return $.SUBRULE($.guardOr, { ARGS: [ctx] });
              }
            }
          ]);
        }
      },
      {
        ALT: () => {
          $.CONSUME(T.WhenFunctionStart); // consumes 'when('
          const node = $.SUBRULE($.guardInner, { ARGS: [ctx] });
          $.CONSUME(T.RParen);
          return node;
        }
      }
    ]);
  };
}

/**
 * 'or' expression
 * Allows an (outer) comma like historical media queries
 */
export function guardOr(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    let left = $.SUBRULE($.guardAnd, { ARGS: [ctx] });
    let right: Node | undefined;
    $.MANY({
      GATE: () => {
        const next = $.LA(1).tokenType;
        return (ctx.allowComma && next === T.Comma) || next === T.Or;
      },
      DEF: () => {
        /**
               * Nest expressions within expressions for correct
               * order of operations.
               */
        $.OR3([
          { ALT: () => $.CONSUME(T.Comma) },
          { ALT: () => $.CONSUME(T.Or) }
        ]);
        right = $.SUBRULE2($.guardAnd, { ARGS: [ctx] });
        if (!RECORDING_PHASE) {
          let location = $.endRule();
          $.startRule();
          left = new Condition(
            [$.wrap(left, true), 'or', $.wrap(right!)],
            undefined,
            location,
            this.context
          );
        }
      }
    });
    if (!RECORDING_PHASE) {
      $.endRule();
    }
    return left;
  };
}

export function guardDefault(this: P, T: TokenMap) {
  const $ = this;

  let guardAlt = [
    { ALT: () => $.CONSUME(T.DefaultGuardIdent) },
    { ALT: () => $.CONSUME(T.DefaultGuardFunc) }
  ];

  return (ctx: RuleContext = {}) => {
    let guard = $.OR(guardAlt);
    ctx.hasDefault = true;
    if (!$.RECORDING_PHASE) {
      return new DefaultGuard(guard.image, undefined, $.getLocationInfo(guard), this.context);
    }
  };
}

/**
 * 'and' and 'or' expressions
 *
 *  In Media queries level 4, you cannot have
 *  `([expr]) or ([expr]) and ([expr])` because
 *  of evaluation order ambiguity.
 *  However, Less allows it.
 */
export function guardAnd(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    let left: Node;
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.MANY_SEP({
      SEP: T.And,
      DEF: () => {
        let not: IToken | undefined;
        $.OPTION(() => not = $.CONSUME(T.Not));
        let allowComma = ctx.allowComma;
        ctx.allowComma = false;
        let right = $.SUBRULE($.guardInParens, { ARGS: [ctx] });
        ctx.allowComma = allowComma;
        if (!RECORDING_PHASE && not) {
          let [,,, endOffset, endLine, endColumn] = right.location!;
          let [startOffset, startLine, startColumn] = $.getLocationInfo(not);
          right = new Condition(
            right,
            { negate: true },
            [startOffset, startLine, startColumn, endOffset, endLine, endColumn],
            this.context
          );
        }
        if (!left) {
          left = right;
          return;
        }
        if (!RECORDING_PHASE) {
          left = new Condition(
            [$.wrap(left, true), 'and', $.wrap(right)],
            undefined,
            $.getLocationFromNodes([left, right]),
            this.context
          );
        }
      }
    });
    return left!;
  };
}

export function guardInParens(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext) => {
    $.startRule();
    let node = $.OR([
      { ALT: () => $.SUBRULE($.guardDefault, { ARGS: [ctx] }) },
      {
        ALT: () => {
          $.CONSUME(T.LParen);
          let node = $.SUBRULE($.guardInner, { ARGS: [ctx] });
          $.CONSUME(T.RParen);
          return node;
        }
      }
    ]);

    if (!$.RECORDING_PHASE) {
      node = $.wrap(node, 'both');
      return new Paren(node, undefined, $.endRule(), this.context);
    }
  };
}

// The inner content of a guard inside parentheses
export function guardInner(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) =>
    $.OR([
      { ALT: () => $.SUBRULE($.comparison, { ARGS: [ctx] }) },
      {
        GATE: () => {
          let tokenType = $.LA(1).tokenType;
          return tokenType !== T.Not && tokenType !== T.DefaultGuardFunc && tokenType !== T.DefaultGuardIdent;
        },
        ALT: () => $.SUBRULE($.value, { ARGS: [ctx] })
      },
      {
        ALT: () => $.SUBRULE($.guardOr, { ARGS: [ctx] })
      }
    ]);
}

export function guardWithConditionValue(this: P, T: TokenMap) {
  const $ = this;
  return () => $.OR([
    {
      ALT: () => {
        $.OR2([
          { ALT: () => $.CONSUME(T.DefaultGuardIdent) },
          { ALT: () => $.CONSUME(T.DefaultGuardFunc) }
        ]);
      }
    },
    { ALT: () => $.SUBRULE($.guardInParens) }
  ]);
}

export function guardWithCondition(this: P, T: TokenMap) {
  const $ = this;
  return () => {
    $.SUBRULE($.guardWithConditionValue);
    $.AT_LEAST_ONE(() => {
      $.OR([
        { ALT: () => $.CONSUME(T.Or) },
        { ALT: () => $.CONSUME(T.And) },
        { ALT: () => $.CONSUME(T.Comma) }
      ]);
      $.SUBRULE2($.guardWithConditionValue);
    });
  };
}

/**
 * Currently, Less only allows a single comparison expression,
 * unlike Media Queries Level 4, which allows a left and right
 * comparison.
 */
export function comparison(this: P, T: TokenMap) {
  const $ = this;

  let opAlt = [
    { ALT: () => $.CONSUME(T.Eq) },
    { ALT: () => $.CONSUME(T.Gt) },
    { ALT: () => $.CONSUME(T.GtEq) },
    { ALT: () => $.CONSUME(T.GtEqAlias) },
    { ALT: () => $.CONSUME(T.Lt) },
    { ALT: () => $.CONSUME(T.LtEq) },
    { ALT: () => $.CONSUME(T.LtEqAlias) }
  ];

  return () => {
    let left = $.SUBRULE($.valueList);
    // $.OPTION(() => {
    let op = $.OR(opAlt);
    let right = $.SUBRULE2($.valueList);
    if (!$.RECORDING_PHASE) {
      let opStr = op.image;
      if (opStr === '=>') {
        opStr = '>=';
      } else if (opStr === '=<') {
        opStr = '<=';
      }
      left = new Condition(
        [$.wrap(left, true), opStr as ConditionOperator, $.wrap(right)],
        undefined,
        $.getLocationFromNodes([left, right]),
        this.context
      );
    }
    // })
    return left;
  };
}

/**
 * Less (perhaps unwisely) allows bubling of normally document-root
 * at-rules, so we need to override CSS here.
 */
export function innerAtRule(this: P, T: TokenMap) {
  const $ = this;

  let ruleAlt = [
    { ALT: () => $.SUBRULE($.mediaAtRule, { ARGS: [true] }) },
    { ALT: () => $.SUBRULE($.supportsAtRule, { ARGS: [true] }) },
    { ALT: () => $.SUBRULE($.layerAtRule, { ARGS: [true] }) },
    { ALT: () => $.SUBRULE($.containerAtRule, { ARGS: [true] }) },
    { ALT: () => $.SUBRULE($.keyframesAtRule) },
    { ALT: () => $.SUBRULE($.documentAtRule, { ARGS: [true] }) },
    { ALT: () => $.SUBRULE($.importAtRule) },
    { ALT: () => $.SUBRULE($.pageAtRule) },
    { ALT: () => $.SUBRULE($.fontFaceAtRule) },
    { ALT: () => $.SUBRULE($.nestedAtRule) },
    { ALT: () => $.SUBRULE($.nonNestedAtRule) },
    { ALT: () => $.SUBRULE($.unknownAtRule) }
  ];

  return cssInnerAtRule.call(this, T, ruleAlt);
}

/**
 * Less override: allow variable reference as the first segment of a layer-name
 * CSS: <ident> ('.' <ident>)*
 * Less: (<var-ref> | <ident>) ('.' <ident>)*
 */
export function layerName(this: P, T: TokenMap) {
  const $ = this;
  return () => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    const nodes: Node[] = RECORDING_PHASE ? ([] as unknown as Node[]) : [];

    // First segment: variable reference or plain ident
    const first = $.OR([
      { ALT: () => $.SUBRULE($.valueReference) },
      { ALT: () => $.CONSUME(T.Ident) }
    ]);

    if (!RECORDING_PHASE) {
      if (first instanceof Node) {
        nodes.push($.wrap(first));
      } else {
        nodes.push($.wrap($.processValueToken(first)));
      }
    }

    // Remaining segments: dot + ident (same as CSS)
    $.MANY({
      GATE: $.noSep,
      DEF: () => {
        const seg = $.CONSUME(T.DotName);
        if (!RECORDING_PHASE) {
          nodes.push($.wrap($.processValueToken(seg)));
        }
      }
    });

    if (!RECORDING_PHASE) {
      const loc = $.endRule();
      return new Sequence(nodes, undefined, loc, this.context);
    }
  };
}

/**
 * Less override: allow variable reference for @keyframes name
 * CSS: Ident | String
 * Less: valueReference | Ident | String
 */
// Less override: allow variable reference in keyframes name by overriding keyframesName only
export function keyframesName(this: P, T: TokenMap) {
  const $ = this;
  return () => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    let node: Node | undefined;
    $.OR({
      DEF: [
        { ALT: () => node = $.SUBRULE($.valueReference) },
        { ALT: () => {
          const tok = $.CONSUME(T.Ident);
          if (!RECORDING_PHASE) node = $.wrap($.processValueToken(tok));
        } },
        { ALT: () => node = $.SUBRULE($.string) }
      ]
    });
    return node!;
  };
}

/**
 * One of the rare rules that returns a token, because
 * other rules will transform it differently.
 */
export function mixinName(this: P, T: TokenMap) {
  const $ = this;

  let nameAlt = [
    { ALT: () => $.CONSUME(T.HashName) },
    { ALT: () => $.CONSUME(T.ColorIdentStart) },
    { ALT: () => $.CONSUME(T.DotName) },
    { ALT: () => $.CONSUME(T.InterpolatedIdent) }
  ];

  /** e.g. .mixin, #mixin */
  return (asReference?: boolean) => {
    let name = $.OR(nameAlt);
    if (!$.RECORDING_PHASE) {
      let nameNode: Node;
      let nameValue = name.image;
      let location = $.getLocationInfo(name);
      if (nameValue.includes('@') || nameValue.includes('$')) {
        nameNode = getInterpolated(nameValue, location, this.context);
        if (asReference) {
          nameNode = new Reference({ key: nameNode as Interpolated }, { type: 'mixin', role: 'name' }, location, this.context);
        }
      } else {
        if (asReference) {
          nameNode = new Reference({ key: nameValue }, { type: 'mixin', role: 'name' }, location, this.context);
        } else {
          nameNode = $.wrap(new Any(nameValue, { role: 'name' }, $.getLocationInfo(name), this.context), true);
        }
      }
      return nameNode;
    }
  };
}

/** @todo - should these names be Jess-normalized when saved? */
export function mixinReference(this: P, T: TokenMap) {
  const $ = this;

  return () => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    let leftNode = $.SUBRULE($.mixinName, { ARGS: [true] });
    $.MANY(() => {
      $.OPTION(() => $.CONSUME(T.Gt));
      let rightNode = $.SUBRULE2($.mixinName, { ARGS: [true] });
      if (!RECORDING_PHASE) {
        const loc = $.getLocationFromNodes([leftNode, rightNode]);
        leftNode = new Reference({ target: new Call({ name: leftNode }), key: rightNode }, { type: 'mixin', role: 'name' }, loc, this.context);
      }
    });
    return leftNode;
  };
}

/** e.g. #ns > .mixin() */
// export function mixinCall(this: P, T: TokenMap) {
//   const $ = this;

//   return () => {
//     let RECORDING_PHASE = $.RECORDING_PHASE;
//     $.startRule();
//     let ref = $.SUBRULE($.mixinReference);
//     let semi: boolean | undefined;
//     let argList: List | undefined;
//     let important: IToken | undefined;
//     /** Either needs to end in parens or in a semi-colon (or both) */
//     $.OR([
//       {
//         ALT: () => {
//           argList = $.SUBRULE($.mixinArgs);
//           $.OPTION2(() => important = $.CONSUME(T.Important));
//           $.OPTION3(() => {
//             semi = true;
//             $.CONSUME(T.Semi);
//           });
//         }
//       },
//       {
//         ALT: () => {
//           semi = true;
//           $.CONSUME2(T.Semi);
//         }
//       }
//     ]);
//     if (!RECORDING_PHASE) {
//       const location = $.endRule();
//       const node = new Call({ name: ref, args: argList }, { markImportant: !!important }, location, this.context);
//       if (semi) node.options.semi = true;
//       return node;
//     }
//   };
// }

/**
 * Used within a value. These can be
 * chained more recursively, unlike
 * Less 1.x-4.x
 *   e.g. .mixin1() > .mixin2[@val1].ns() > .sub-mixin[@val2]
 *
 * Note: unlike valueReference, an inline mixin call doesn't
 * needs args or accessors.
 */
export function inlineMixinCall(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    let nodeContext = ctx.node;
    let RECORDING_PHASE = $.RECORDING_PHASE;

    let argList: List | undefined;
    let node: Node;
    let ref = $.SUBRULE($.mixinReference);
    if (!RECORDING_PHASE) {
      if (nodeContext) {
        ref = new Reference({ target: new Call({ name: nodeContext }), key: ref }, { type: 'mixin' });
      }
      node = new Call({ name: ref }, undefined, ref.location, this.context);
    }
    $.OR([
      {
        ALT: () => {
          ctx.node = node;
          node = $.SUBRULE($.accessors, { ARGS: [ctx] });
        }
      },
      {
        ALT: () => {
          argList = $.SUBRULE($.mixinArgs);
          if (!RECORDING_PHASE) {
            const RParen = $.LA(0);
            const loc = $.getLocationFromNodes([node, RParen]);
            node = new Call({ name: ref, args: argList }, undefined, loc, this.context);
          }
          $.OR2([
            {
              ALT: () => {
                ctx.node = node;
                node = $.SUBRULE2($.accessors, { ARGS: [ctx] });
              }
            },
            {
              GATE: () => !ctx.requireAccessorsAfterMixinCall,
              ALT: () => EMPTY_ALT()
            }
          ]);
        }
      }
    ]);

    return node!;
  };
}

export function mixinDefinition(this: P, T: TokenMap) {
  const $ = this;

  return () => {
    // Disambiguate definition vs call: name + args must be followed by optional guard and a block
    $.startRule();
    const name = $.SUBRULE($.mixinName);
    const params = $.SUBRULE($.mixinArgs, { ARGS: [{ isDefinition: true }] });
    const ctx: RuleContext = {};
    let guard: Condition | undefined;
    $.OPTION(() => guard = $.SUBRULE($.guard, { ARGS: [ctx] }));
    // Require a block start to qualify as a definition
    $.CONSUME(T.LCurly);
    const rulesInner = $.SUBRULE($.declarationList);
    $.CONSUME(T.RCurly);

    if (!$.RECORDING_PHASE) {
      const location = $.endRule();
      const rules = rulesInner;
      return new Mixin({ name, params, rules, guard }, { hasDefault: !!ctx.hasDefault }, location, this.context);
    }
  };
}

export function mixinArgs(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    let args: List | undefined;
    $.CONSUME(T.LParen);
    $.OPTION(() => args = $.SUBRULE($.mixinArgList, { ARGS: [ctx] }));
    $.CONSUME(T.RParen);
    return args;
  };
}

export function accessors(this: P, T: TokenMap) {
  const $ = this;

  const getReferenceFromLookupToken = (token: IToken) => {
    let tokenStr = token.image;
    let firstChar = tokenStr[0];
    if (firstChar !== '$' && firstChar !== '@') {
      /** Treat idents as property lookups */
      tokenStr = '$' + tokenStr;
    }
    let key = getInterpolatedOrString(tokenStr);
    let type: 'variable' | 'property' = tokenStr.startsWith('@') ? 'variable' : 'property';

    return new Reference({ key }, { type }, $.getLocationInfo(token), this.context);
  };

  let keyAlt = [
    { ALT: () => $.CONSUME(T.NestedReference) },
    { ALT: () => $.CONSUME(T.AtKeyword) },
    { ALT: () => $.CONSUME(T.PropertyReference) },
    { ALT: () => $.CONSUME(T.Ident) }
  ];

  /** The node passed in is what we're looking up on */
  return (ctx: RuleContext = {}) => {
    let nodeContext = ctx.node!;
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    let keyToken: IToken | undefined;
    let key: string | number | Reference;
    let returnNode: Node;

    $.CONSUME(T.LSquare);
    $.OPTION(() => keyToken = $.OR(keyAlt));
    $.CONSUME(T.RSquare);

    if (!RECORDING_PHASE) {
      if (keyToken) {
        if (keyToken.tokenType === T.NestedReference) {
          key = getReferenceFromLookupToken(keyToken);
        } else {
          let tokenStr = keyToken.image;
          let tokenStart = tokenStr[0];
          if (tokenStart === '@') {
            key = new Reference(tokenStr.slice(1), { type: 'variable' }, $.getLocationInfo(keyToken), this.context);
          } else {
            key = tokenStart === '$' ? tokenStr.slice(1) : tokenStr;
            key = new Reference(tokenStr, { type: 'property' }, $.getLocationInfo(keyToken), this.context);
          }
        }
      } else {
        key = -1;
      }
      const location = $.endRule();
      // Replace Lookup with a Reference targeting the current nodeContext
      const targetRef = nodeContext as Reference | Node;
      returnNode = new Reference({ target: targetRef as any, key: key as any }, { type: 'declaration' }, location, this.context);
    }
    /**
     * Allows chaining of lookups / calls
     * @note - In Less, an additional call or accessor implies
     * that the previous accessor is a mixin call, therefore
     * it should be returned as a Call node.
     */
    $.OPTION2(() => {
      $.OR2([
        {
          ALT: () => {
            let args = $.SUBRULE($.mixinArgs);
            if (!RECORDING_PHASE) {
              let [startOffset, startLine, startColumn] = returnNode.location;
              let { endOffset, endLine, endColumn } = $.LA(0);
              returnNode = new Call({ name: returnNode, args }, undefined, [startOffset!, startLine!, startColumn!, endOffset!, endLine!, endColumn!], this.context);
            }
          }
        },
        {
          ALT: () => {
            ctx.node = returnNode;
            returnNode = $.SUBRULE($.inlineMixinCall, { ARGS: [ctx] });
            return returnNode;
          }
        },
        {
          ALT: () => {
            ctx.node = returnNode;
            returnNode = $.SUBRULE($.accessors, { ARGS: [ctx] });
            return returnNode;
          }
        }
      ]);
    });
    return returnNode!;
  };
}

/**
 * @see https://lesscss.org/features/#mixins-feature-mixins-parametric-feature
 *
 * This rule is recursive to allow chevrotain-allstar (hopefully) to lookahead
 * and find semi-colon separators vs. commas.
 */
export function mixinArgList(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    let node = $.SUBRULE($.mixinArg, { ARGS: [ctx] });

    let commaNodes: Node[] | undefined;
    let semiNodes: Node[];
    if (!RECORDING_PHASE) {
      commaNodes = [$.wrap(node, true)];
      semiNodes = [];
    }
    let isSemiList = false;
    let moreArgs = true;

    $.MANY({
      GATE: () => moreArgs,
      DEF: () => {
        $.OR([
          {
            GATE: () => !isSemiList,
            ALT: () => {
              $.CONSUME(T.Comma);
              let node = $.SUBRULE2($.mixinArg, { ARGS: [ctx] });
              if (!RECORDING_PHASE) {
                commaNodes!.push($.wrap(node, true));
              }
            }
          },
          {
            ALT: () => {
              isSemiList = true;

              $.CONSUME(T.Semi);

              if (!RECORDING_PHASE) {
                /**
                 * Aggregate the previous set of comma-nodes
                 */
                if (commaNodes) {
                  if (commaNodes.length > 1) {
                    let [first, ...rest] = commaNodes;
                    if (first instanceof VarDeclaration) {
                      const nodes = [first.value.value, ...rest];
                      first.value.value = new List(nodes, undefined, $.getLocationFromNodes(nodes), this.context);
                      semiNodes.push(first);
                    } else {
                      let commaList = new List(commaNodes, undefined, $.getLocationFromNodes(commaNodes), this.context);
                      semiNodes.push(commaList);
                    }
                  } else {
                    semiNodes.push(commaNodes[0]!);
                  }
                  commaNodes = undefined;
                }
              }
              $.OR2([
                {
                  GATE: () => $.LA(1).tokenType !== T.RParen,
                  ALT: () => {
                    node = $.SUBRULE3($.mixinArg, { ARGS: [{ ...ctx, allowComma: true }] });
                    if (!RECORDING_PHASE) {
                      semiNodes.push($.wrap(node, true));
                    }
                  }
                },
                {
                  ALT: () => {
                    moreArgs = false;
                    EMPTY_ALT();
                  }
                }
              ]);
            }
          }
        ]);
      }
    });

    if (!RECORDING_PHASE) {
      let location = $.endRule();
      let nodes = isSemiList ? semiNodes! : commaNodes!;
      let sep: ';' | ',' = isSemiList ? ';' : ',';
      return $.wrap(new List(nodes, { sep }, location, this.context), 'both');
    }
  };
}

/**
 * Less is more lenient about at-keywords. See lessTokens.ts for more details.
 */
export function varName(this: P, T: TokenMap) {
  const $ = this;
  let nameAlt = [
    { ALT: () => $.CONSUME(T.AtKeyword) },
    { ALT: () => $.CONSUME(T.AtKeywordLessExtension) }
  ];
  return () => $.OR(nameAlt);
}

/**
 * Originally, we were creating alternatives for mixin calls and mixin definitions
 * that could mostly overlap, which led to longer parsing. Instead, we parse
 * as if it could be either, and then we disambiguate at the end.
 */
export function mixinArg(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    const isDefinition = !!ctx.isDefinition;
    let RECORDING_PHASE = $.RECORDING_PHASE;
    let firstToken = $.LA(1);

    let atStart = (
      firstToken.tokenType === T.AtKeyword
      || firstToken.tokenType === T.AtKeywordLessExtension
    );

    let isDeclaration = atStart && $.LA(2).tokenType === T.Colon;

    return $.OR([
      {
        GATE: () => !atStart && !isDeclaration,
        ALT: () => $.SUBRULE($.callArgument, { ARGS: [ctx] })
      },
      {
        GATE: () => isDeclaration,
        ALT: () => {
          $.startRule();
          let name = $.SUBRULE2($.varName);
          $.CONSUME(T.Colon);
          /** Default value */
          let value = $.SUBRULE2($.callArgument, { ARGS: [ctx] });

          if (!RECORDING_PHASE) {
            let location = $.endRule();
            return new VarDeclaration({
              name: new Any(name.image.slice(1), { role: 'property' }, $.getLocationInfo(name), this.context),
              value
            }, { paramVar: true }, location, this.context);
          }
        }
      },
      {
        /**
         * Mixin definitions can have a spread parameter, which
         * means it will match a variable number of elements
         * at the end.
         *
         * However, mixin calls can have a spread argument,
         * which means it will expand a variable representing
         * a list, which, to my knowledge, is an undocumented
         * feature of Less (and only exists in mixin calls?)
         *
         * @todo - Intuitively, shouldn't this be available
         * elsewhere in the language? Or would there be no
         * reason?
         */
        GATE: () => atStart,
        ALT: () => {
          $.startRule();
          let name = $.SUBRULE($.varName);
          let ellipsis;
          $.OPTION(() => ellipsis = $.CONSUME(T.Ellipsis));
          if (!RECORDING_PHASE) {
            let varName = name.image.slice(1);
            if (ellipsis) {
              /** @todo - turn this into a reference if a call */
              return new Rest(varName, undefined, $.endRule(), this.context);

              // return new Rest(new Reference(varName, { type: 'variable' }, $.getLocationInfo(name), this.context), undefined, location, this.context);
            } else {
              return new Any(varName, { role: 'name' }, $.endRule(), this.context);
            }
          }
        }
      },
      {
        ALT: () => {
          let ellipsis = $.CONSUME2(T.Ellipsis);
          return new Rest(undefined, undefined, $.getLocationInfo(ellipsis), this.context);
        }
      }
    ]);
  };
}

export function callArgument(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    return $.OR([
      { ALT: () => $.SUBRULE($.anonymousMixinDefinition) },
      {
        GATE: () => !ctx.allowComma,
        ALT: () => $.SUBRULE($.valueSequence)
      },
      {
        GATE: () => !!ctx.allowComma,
        ALT: () => $.SUBRULE($.valueList)
      }
    ]);
  };
}