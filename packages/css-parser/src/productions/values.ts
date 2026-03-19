// Methods to be mixed into CssRecursiveParser
import type { CssRecursiveParser, RuleContext, TokenMap } from '../cssRecursiveParser.js';
import type { IToken } from '@chevrotain/types';
import {
  Node, Any, Declaration, CustomDeclaration, Sequence, List, Block,
  Quoted, Call, Url, Paren, Operation,
  type AssignmentType, type Operator
} from '@jesscss/core';

type C = CssRecursiveParser;

type AltContext = (ctx?: RuleContext) => Array<import('@chevrotain/types').IOrAlt<any>>;

export function declaration(this: C, T: TokenMap, alt?: AltContext) {
  const $ = this;

  alt ??= (ctx: RuleContext = {}) => [
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
        let value = $.SUBRULE($.valueList, { ARGS: [ctx] });
        let important: IToken | undefined;
        $.OPTION(() => {
          important = $.CONSUME(T.Important);
        });
        if (!$.RECORDING_PHASE) {
          let nameNode = $.wrap(new Any(name!.image, { role: 'property' }, $.getLocationInfo(name!), this.context), true);
          return [nameNode, assign, value, important];
        }
      }
    },
    {
      ALT: () => {
        let RECORDING_PHASE = $.RECORDING_PHASE;
        let name = $.CONSUME(T.CustomProperty);
        let assign = $.CONSUME2(T.Assign);
        let nodes: Node[];
        if (!RECORDING_PHASE) {
          nodes = [];
        }
        $.startRule();
        $.MANY(() => {
          let val = $.SUBRULE($.customValue, { ARGS: [{ ...ctx, inCustomPropertyValue: true }] });
          if (!RECORDING_PHASE) {
            nodes!.push(val);
          }
        });
        if (!RECORDING_PHASE) {
          let location = $.endRule();
          let nameNode = $.wrap(new Any(name.image, { role: 'property' }, $.getLocationInfo(name), this.context), true);
          let value = new Sequence(nodes!, undefined, location, this.context);
          return [nameNode, assign, value];
        }
      }
    }
  ];
  // declaration
  //   : identifier WS* COLON WS* valueList (WS* IMPORTANT)?
  //   | CUSTOM_IDENT WS* COLON CUSTOM_VALUE*
  //   ;
  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    let name: Any<'property'> | undefined;
    let assign: IToken | undefined;
    let value: Node | undefined;
    let important: IToken | undefined;
    let val = $.OR(alt(ctx));

    if (!RECORDING_PHASE) {
      ([name, assign, value, important] = val);
    }

    if (!RECORDING_PHASE) {
      let location = $.endRule();
      const isCustom = name!.valueOf().startsWith('--');
      const wrapCtx = isCustom ? { ...ctx, inCustomPropertyValue: true } : ctx;
      return new (isCustom ? CustomDeclaration : Declaration)({
        name: name!,
        value: $.wrap(value!, 'both', wrapCtx),
        important: important ? $.wrap(new Any(important.image, { role: 'flag' }, $.getLocationInfo(important), this.context), 'both') : undefined
      }, { assign: assign!.image as AssignmentType }, location, this.context);
    }
  };
}

/**
 * @todo - This could be implemented with a multi-mode lexer?
 * Multi-modes was the right way to do it with Antlr, but
 * Chevrotain does not support recursive tokens very well.
 */
export function customValue(this: C, T: TokenMap, alt?: AltContext) {
  const $ = this;

  /** Should be almost anything, but custom blocks need matching closers */
  // Order matters: prefer nested blocks first, then strings, then raw tokens.
  // Avoid knownFunctions here to remove ambiguity with custom blocks.
  alt ??= (ctx: RuleContext = {}) => [
    {
      ALT: () => {
        return $.SUBRULE($.customBlock, { ARGS: [ctx] });
      }
    },
    {
      ALT: () => {
        return $.SUBRULE($.string, { ARGS: [ctx] });
      }
    },
    {
      ALT: () => {
        const token = $.OR3([
          { ALT: () => $.CONSUME(T.Value) },
          { ALT: () => $.CONSUME(T.CustomProperty) },
          { ALT: () => $.CONSUME(T.Colon) },
          { ALT: () => $.CONSUME(T.AtName) },
          { ALT: () => $.CONSUME(T.Comma) },
          { ALT: () => $.CONSUME(T.Important) },
          { ALT: () => $.CONSUME(T.Unknown) }
        ]);
        if (!$.RECORDING_PHASE) {
          return $.wrap($.processValueToken(token, ctx), undefined, ctx);
        }
      }
    }
  ];

  return (ctx: RuleContext = {}) => {
    return $.OR(alt(ctx));
  };
}

export function innerCustomValue(this: C, T: TokenMap, alt?: AltContext) {
  const $ = this;

  alt ??= (ctx: RuleContext = {}) => [
    {
      ALT: () => {
        /** Can also have semi-colons */
        let semi = $.CONSUME(T.Semi);
        if (!$.RECORDING_PHASE) {
          return $.wrap(new Any(semi.image, { role: 'semi' }, $.getLocationInfo(semi), this.context));
        }
      }
    },
    { ALT: () => $.SUBRULE($.customValue, { ARGS: [ctx] }) }
  ];

  return (ctx: RuleContext = {}) => $.OR(alt(ctx));
}

/**
 * Extra tokens in a custom property or general enclosed. Should include any
 * and every token possible (except semis), including unknown tokens.
 *
 * @todo - In tests, is there a way to test that every token is captured?
 */
export function extraTokens(this: C, T: TokenMap, alt?: AltContext) {
  const $ = this;

  alt ??= (ctx: RuleContext = {}) => [
    { ALT: () => $.SUBRULE($.functionCallLike, { ARGS: [ctx] }) },
    { ALT: () => $.CONSUME(T.Value) },
    { ALT: () => $.CONSUME(T.CustomProperty) },
    { ALT: () => $.CONSUME(T.Colon) },
    { ALT: () => $.CONSUME(T.AtName) },
    { ALT: () => $.CONSUME(T.Comma) },
    { ALT: () => $.CONSUME(T.Important) },
    { ALT: () => $.CONSUME(T.Unknown) }
  ];

  return (ctx: RuleContext = {}) => {
    let node: Node = $.OR(alt(ctx));
    if (!$.RECORDING_PHASE) {
      if (!(node instanceof Node)) {
        node = $.wrap($.processValueToken(node));
      }
      return node;
    }
  };
}

export function customBlock(this: C, T: TokenMap, alt?: AltContext) {
  const $ = this;

  alt ??= (ctx: RuleContext = {}) => [
    {
      ALT: () => {
        let RECORDING_PHASE = $.RECORDING_PHASE;
        let start: IToken;
        let end: IToken;
        let nodes: Node[];
        if (!RECORDING_PHASE) {
          nodes = [];
        }
        $.OR2([
          /**
           * All tokens that have a left parentheses.
           * These need to match a right parentheses.
           */
          { ALT: () => start = $.CONSUME(T.LParen) },
          { ALT: () => start = $.CONSUME(T.FunctionStart) },
          { ALT: () => start = $.CONSUME(T.FunctionalPseudoClass) }
        ]);

        $.MANY(() => {
          let val = $.SUBRULE($.innerCustomValue, { ARGS: [ctx] });
          if (!$.RECORDING_PHASE) {
            nodes!.push(val);
          }
        });
        end = $.CONSUME(T.RParen);
        return [start!, nodes!, end];
      }
    },
    {
      ALT: () => {
        let RECORDING_PHASE = $.RECORDING_PHASE;
        let nodes: Node[];
        if (!RECORDING_PHASE) {
          nodes = [];
        }
        let start = $.CONSUME(T.LSquare);
        $.MANY2(() => {
          let val = $.SUBRULE2($.innerCustomValue, { ARGS: [ctx] });
          if (!RECORDING_PHASE) {
            nodes!.push(val);
          }
        });
        let end = $.CONSUME(T.RSquare);

        return [start, nodes!, end];
      }
    },
    {
      ALT: () => {
        let RECORDING_PHASE = $.RECORDING_PHASE;
        let nodes: Node[];
        if (!RECORDING_PHASE) {
          nodes = [];
        }
        let start = $.CONSUME(T.LCurly);
        $.MANY3(() => {
          let val = $.SUBRULE3($.innerCustomValue, { ARGS: [ctx] });
          if (!RECORDING_PHASE) {
            nodes!.push(val);
          }
        });
        let end = $.CONSUME(T.RCurly);

        return [start, nodes!, end];
      }
    }
  ];

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    let start: IToken | undefined;
    let end: IToken | undefined;
    let nodes: Node[];

    let val = $.OR(alt(ctx));

    if (!RECORDING_PHASE) {
      ([start, nodes, end] = val);
    }

    if (!RECORDING_PHASE) {
      let location = $.endRule();
      let type: 'square' | 'curly' | undefined;
      switch (start!.image) {
        case '[':
          type = 'square';
          break;
        case '{':
          type = 'curly';
          break;
      }
      if (type) {
        // Preserve inner sequence post so trailing semicolons become part of block content
        const seqLoc = nodes!.length ? $.getLocationFromNodes(nodes!) : undefined;
        let seq = new Sequence(nodes!, undefined, seqLoc, this.context);
        return $.wrap(new Block($.wrap(seq, true, ctx), { type }, location, this.context), undefined, ctx);
      } else {
        let startNode = $.wrap(new Any(start!.image, { role: 'any' }, $.getLocationInfo(start!), this.context), undefined, ctx);
        let endNode = $.wrap(new Any(end!.image, { role: 'any' }, $.getLocationInfo(end!), this.context), undefined, ctx);
        nodes = [startNode, ...nodes!, endNode];
        return new Sequence(nodes, undefined, location, this.context);
      }
    }
  };
}

export function valueList(this: C, T: TokenMap) {
  const $ = this;

  /** Values separated by commas */
  // valueList
  //   : value+ (, value+)*
  //   ;
  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    let nodes: Node[];
    if (!RECORDING_PHASE) {
      nodes = [];
    }

    $.AT_LEAST_ONE_SEP({
      SEP: T.Comma,
      DEF: () => {
        let seq = $.SUBRULE($.valueSequence, { ARGS: [ctx] });
        if (!RECORDING_PHASE) {
          nodes!.push(seq);
        }
      }
    });

    if (!RECORDING_PHASE) {
      let location = $.endRule();
      if (nodes!.length === 1) {
        return nodes![0];
      }
      return new List(nodes!, undefined, location, this.context);
    }
  };
}

export function valueSequence(this: C, T: TokenMap) {
  const $ = this;

  /** Often space-separated */
  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    let nodes: Node[];

    if (!RECORDING_PHASE) {
      nodes = [];
    }

    $.AT_LEAST_ONE(() => {
      let value = $.SUBRULE($.value, { ARGS: [ctx] });

      if (!RECORDING_PHASE) {
        nodes.push($.wrap(value));
      }
    });

    if (!RECORDING_PHASE) {
      let location = $.endRule();
      if (nodes!.length === 1) {
        return $.wrap(nodes![0]!, true);
      }
      return $.wrap(new Sequence(nodes!, undefined, location, this.context), true);
    }
  };
}

export function squareValue(this: C, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    $.startRule();
    $.CONSUME(T.LSquare);
    let ident = $.CONSUME(T.Ident);
    $.CONSUME(T.RSquare);
    if (!$.RECORDING_PHASE) {
      let location = $.endRule();
      let identNode = new Any(ident.image, { role: 'ident' }, $.getLocationInfo(ident), this.context);
      return new Block(identNode, { type: 'square' }, location, this.context);
    }
  };
}

// value
//   : WS
//   | identifier
//   | integer
//   | number
//   | dimension
//   | COLOR_IDENT_START
//   | COLOR_INT_START
//   | STRING
//   | function
//   | '[' identifier ']'
//   | unknownValue
//   ;
export function value(this: C, T: TokenMap, valueAlt?: AltContext) {
  const $ = this;

  valueAlt ??= (ctx: RuleContext = {}) => [
    /** Function should appear before Ident */
    { ALT: () => $.SUBRULE($.functionCall, { ARGS: [ctx] }) },
    { ALT: () => $.CONSUME(T.Ident) },
    { ALT: () => $.CONSUME(T.Dimension) },
    { ALT: () => $.CONSUME(T.Number) },
    { ALT: () => $.CONSUME(T.Color) },
    { ALT: () => $.CONSUME(T.UnicodeRange) },
    { ALT: () => $.SUBRULE($.string, { ARGS: [ctx] }) },
    { ALT: () => $.SUBRULE($.squareValue, { ARGS: [ctx] }) },
    {
      /** e.g. progid:DXImageTransform.Microsoft.Blur(pixelradius=2) */
      GATE: () => $.legacyMode,
      ALT: () => $.CONSUME(T.LegacyMSFilter)
    }
  ];

  return (ctx: RuleContext = {}) => {
    $.startRule();
    let node: Node = $.OR(valueAlt(ctx));
    /**
     * Allows slash separators. Note that, structurally, the meaning
     * of slash separators in CSS is inconsistent and ambiguous. It
     * could separate a sequence of tokens from another sequence,
     * or it could separate ONE token from another, with other tokens
     * not included in the "slash list", OR it can represent division
     * in a math expression. CSS is just, unfortunately, not a very
     * syntactically-consistent language, and each property's value
     * essentially has a defined "micro-syntax".
     */
    let additionalValue: Node | undefined;
    $.OPTION(() => {
      $.CONSUME(T.Slash);
      additionalValue = $.SUBRULE($.value, { ARGS: [ctx] });
    });
    if (!$.RECORDING_PHASE) {
      let location = $.endRule();
      if (!(node instanceof Node)) {
        node = $.processValueToken(node);
      }
      if (additionalValue) {
        return $.wrap(new List([$.wrap(node, true), additionalValue], { sep: '/' }, location, this.context));
      }
      return $.wrap(node);
    }
  };
}

export function string(this: C, T: TokenMap, stringAlt?: AltContext) {
  const $ = this;

  stringAlt ??= (ctx: RuleContext = {}) => [
    {
      ALT: () => {
        $.startRule();
        let quote = $.CONSUME(T.SingleQuoteStart);
        let contents: IToken | undefined;
        $.OPTION(() => contents = $.CONSUME(T.SingleQuoteStringContents));
        $.CONSUME(T.SingleQuoteEnd);
        if (!$.RECORDING_PHASE) {
          let location = $.endRule();
          const escaped = quote.image.startsWith('~');
          const quoteChar = quote.image.replace(/^~/, '') as '"' | '\'';
          let value = contents?.image ?? '';
          if (escaped) {
            value = value.replace(/\\(?:\r\n?|\n|\f)/g, '\n');
          }
          return new Quoted(new Any(value, { role: 'any' }), { quote: quoteChar, escaped }, location, this.context);
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
          let location = $.endRule();
          const escaped = quote.image.startsWith('~');
          const quoteChar = quote.image.replace(/^~/, '') as '"' | '\'';
          let value = contents?.image ?? '';
          if (escaped) {
            value = value.replace(/\\(?:\r\n?|\n|\f)/g, '\n');
          }
          return new Quoted(new Any(value, { role: 'any' }), { quote: quoteChar, escaped }, location, this.context);
        }
      }
    }
  ];

  return (ctx: RuleContext = {}) => $.OR(stringAlt(ctx));
}

/** Abstracted for easy over-ride */
export function mathSum(this: C, T: TokenMap) {
  const $ = this;

  let opAlt = [
    { ALT: () => $.CONSUME(T.Plus) },
    { ALT: () => $.CONSUME(T.Minus) }
  ];
  // mathSum
  //   : mathProduct (WS* ('+' | '-') WS* mathProduct)*
  //   ;
  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    let left: Node = $.SUBRULE($.mathProduct, { ARGS: [ctx] });

    $.MANY(() => {
      let op = $.OR(opAlt);
      let right: Node = $.SUBRULE2($.mathProduct, { ARGS: [ctx] });

      if (!RECORDING_PHASE) {
        left = new Operation([left, op.image as Operator, right], { inCalc: true }, undefined, this.context);
      }
    });
    if (!RECORDING_PHASE) {
      left._location = $.endRule();
      return left;
    }
  };
}

// mathProduct
//   : mathValue (WS* ('*' | '/') WS* mathValue)*
//   ;
export function mathProduct(this: C, T: TokenMap) {
  const $ = this;

  let opAlt = [
    { ALT: () => $.CONSUME(T.Star) },
    { ALT: () => $.CONSUME(T.Divide) }
  ];

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    let left: Node = $.SUBRULE($.mathValue, { ARGS: [ctx] });

    $.MANY(() => {
      let op = $.OR(opAlt);
      let right: Node = $.SUBRULE2($.mathValue, { ARGS: [ctx] });

      if (!RECORDING_PHASE) {
        left = new Operation([left, op.image as Operator, right], { inCalc: true }, undefined, this.context);
      }
    });

    if (!RECORDING_PHASE) {
      left._location = $.endRule();
      return left;
    }
  };
}

// mathValue
//   : number
//   | dimension
//   | percentage
//   | mathConstant
//   | '(' WS* mathSum WS* ')'
//   ;
export function mathValue(this: C, T: TokenMap, alt?: AltContext) {
  const $ = this;

  alt ??= (ctx: RuleContext = {}) => [
    { ALT: () => $.CONSUME(T.Number) },
    { ALT: () => $.CONSUME(T.Dimension) },
    { ALT: () => $.CONSUME(T.MathConstant) },
    // Allow identifiers like channel names in color space calcs (e.g., calc(l - 0.1))
    {
      GATE: () => $.LA(1).tokenType !== T.MathConstant,
      ALT: () => $.CONSUME(T.Ident)
    },
    { ALT: () => $.SUBRULE($.knownFunctions, { ARGS: [ctx] }) },
    { ALT: () => $.SUBRULE($.mathParen, { ARGS: [ctx] }) }
  ];

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    let node: Node = $.OR(alt(ctx));
    if (!RECORDING_PHASE) {
      if (!(node instanceof Node)) {
        node = $.processValueToken(node);
      }
      return $.wrap(node, 'both');
    }
  };
}

export function mathParen(this: C, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    $.startRule();
    $.CONSUME(T.LParen);
    let node = $.SUBRULE($.mathSum, { ARGS: [ctx] });
    $.CONSUME(T.RParen);
    if (!$.RECORDING_PHASE) {
      let location = $.endRule();
      return new Paren(node, undefined, location, this.context);
    }
  };
}

// function
//   : URL_FUNCTION
//   | VAR_FUNCTION '(' WS* CUSTOM_IDENT (WS* COMMA WS* valueList)? ')'
//   | CALC_FUNCTION '(' WS* mathSum WS* ')'
//   | identifier '(' valueList ')'
//   ;
// These have special parsing rules
export function knownFunctions(this: C, T: TokenMap, alt?: AltContext) {
  const $ = this;

  alt ??= (ctx: RuleContext = {}) => [
    { ALT: () => $.SUBRULE($.urlFunction, { ARGS: [ctx] }) },
    { ALT: () => $.SUBRULE($.varFunction, { ARGS: [ctx] }) },
    { ALT: () => $.SUBRULE($.calcFunction, { ARGS: [ctx] }) }
  ];

  return (ctx: RuleContext = {}) => $.OR(alt(ctx));
}

export function ifFunctionArgs(this: C, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    let branches: Node[];
    if (!RECORDING_PHASE) {
      branches = [];
    }
    $.AT_LEAST_ONE_SEP({
      SEP: T.Semi,
      DEF: () => {
        const condition = $.SUBRULE($.valueSequence, { ARGS: [{ ...ctx, inner: true }] });
        $.CONSUME(T.Assign);
        const value = $.SUBRULE($.valueList, { ARGS: [{ ...ctx, inner: true }] });
        if (!RECORDING_PHASE) {
          const sep = $.wrap(new Any(':', { role: 'operator' }, undefined, this.context), true);
          const loc = $.getLocationFromNodes([condition, value]);
          branches!.push(new Sequence([$.wrap(condition, true), sep, $.wrap(value, true)], undefined, loc, this.context));
        }
      }
    });
    $.OPTION(() => $.CONSUME2(T.Semi));
    if (!RECORDING_PHASE) {
      const location = $.endRule();
      if (branches!.length === 1) {
        return branches![0]!;
      }
      return new List(branches!, { sep: ';' }, location, this.context);
    }
  };
}

export function ifFunction(this: C, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();
    const start = $.CONSUME(T.FunctionStart);
    const args = $.SUBRULE($.ifFunctionArgs, { ARGS: [{ ...ctx, inner: true }] }) as Node;
    $.CONSUME(T.RParen);
    if (!$.RECORDING_PHASE) {
      const location = $.endRule();
      return new Call({
        name: start.image.slice(0, -1),
        args: new List([args])
      }, undefined, location, this.context);
    }
  };
}

export function varFunction(this: C, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    $.startRule();
    $.CONSUME(T.Var);
    let prop = $.CONSUME(T.CustomProperty);
    let args: List | undefined;
    $.OPTION(() => {
      $.CONSUME(T.Comma);
      args = $.SUBRULE($.valueList, { ARGS: [ctx] });
    });
    $.CONSUME(T.RParen);

    if (!$.RECORDING_PHASE) {
      let location = $.endRule();
      let propNode = $.wrap(new Any(prop.image, { role: 'customprop' }, $.getLocationInfo(prop), this.context), 'both');
      if (!args) {
        args = new List([propNode], undefined, $.getLocationInfo(prop), this.context);
      } else {
        let { startOffset, startLine, startColumn } = prop;
        args.value.unshift(propNode);
        args.location[0] = startOffset;
        args.location[1] = startLine!;
        args.location[2] = startColumn!;
      }
      return new Call({
        name: 'var',
        args
      }, undefined, location, this.context);
    }
  };
}

export function calcFunction(this: C, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    $.startRule();

    $.CONSUME(T.Calc);
    let args = $.SUBRULE($.mathSum, { ARGS: [ctx] });
    $.CONSUME2(T.RParen);

    if (!$.RECORDING_PHASE) {
      let location = $.endRule();
      return new Call({
        name: 'calc',
        args: new List([args])
      }, undefined, location, this.context);
    }
  };
}

export function urlFunction(this: C, T: TokenMap, alt?: AltContext) {
  const $ = this;

  alt ??= (ctx: RuleContext = {}) => [
    { ALT: () => $.SUBRULE($.string, { ARGS: [ctx] }) },
    { ALT: () => $.CONSUME(T.NonQuotedUrl) }
  ];

  return (ctx: RuleContext = {}) => {
    $.startRule();

    $.CONSUME(T.UrlStart);
    let node: Any | IToken = $.OR(alt(ctx));
    $.CONSUME(T.UrlEnd);

    if (!$.RECORDING_PHASE) {
      let location = $.endRule();
      if (!(node instanceof Node)) {
        /** Whitespace should be included in the NonQuotedUrl */
        node = new Any(node.image, { role: 'urlvalue' }, $.getLocationInfo(node), this.context);
      }
      return new Url(node, undefined, location, this.context);
    }
  };
}
