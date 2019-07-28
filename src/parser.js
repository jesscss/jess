
// ----------------- Lexer -----------------
import { createToken, Lexer, Parser } from 'chevrotain';

const Imprt = createToken({name: "Imprt", pattern: /\@import[^;]+;/i});
const Const = createToken({name: "Const", pattern: /\@const\s*{/i});
const Var = createToken({name: "Var", pattern: /\@var\s*{/i});

const JSExpr = createToken({name: "JSExpr", pattern: /\${/});

const LCurly = createToken({name: "LCurly", pattern: /{/});
const RCurly = createToken({name: "RCurly", pattern: /}/});
const At = createToken({name: "At", pattern: /@/});
const Misc = createToken(
  {name: "Misc", pattern: /[^{}@$'"`]+/}
);

const StringLiteral = createToken({
  name: "StringLiteral",
  pattern: /(["'`])(?:\\.|[^\\\n\r])*?\1/
});

const jessTokens = [
  Imprt, Const, Var, JSExpr,
  RCurly, LCurly, StringLiteral,
  Misc, At
];

const JessLexer = new Lexer(jessTokens, {
  // Less position info tracked, reduces verbosity of the playground output.
  // positionTracking: "onlyStart"
});


// ----------------- parser -----------------
class JessParser extends Parser {
  constructor() {
    super(jessTokens, {
      recoveryEnabled: true
    })

    const $ = this;

    $.RULE("stylesheet", () => {
      $.MANY(() => $.OR([
        {ALT: () => $.CONSUME(Imprt)},
        {ALT: () => $.SUBRULE($.variable)},
        {ALT: () => $.SUBRULE($.blockOptions)}
      ]));
    });
    
    $.RULE("variable", () => {
      $.OR([
        {ALT: () => $.CONSUME(Const)},
        {ALT: () => $.CONSUME(Var)}
      ]);
      $.SUBRULE($.block)
      $.CONSUME(RCurly)
    })
    
    $.RULE("jsblock", () => {
      $.MANY(() => $.OR([
        {ALT: () => $.CONSUME(Misc)},
        {ALT: () => $.SUBRULE($.curly)}
      ]));
    });
    
    $.RULE("block", () => {
      $.MANY(() => $.SUBRULE($.blockOptions))
    })
    
    $.RULE("blockOptions", () => {
      $.OR([
        {ALT: () => $.CONSUME(Misc)},
        {ALT: () => $.CONSUME(StringLiteral)},
        {ALT: () => $.SUBRULE($.miscat)},
        {ALT: () => $.SUBRULE($.expression)},
        {ALT: () => $.SUBRULE($.curly)}
      ]);
    });
    
    $.RULE("expression", () => {
      $.CONSUME(JSExpr)
      $.SUBRULE($.block)
      $.CONSUME(RCurly)      
    })
    
    $.RULE("miscat", () => {
      $.CONSUME(At)
      $.SUBRULE($.block)
    })
    
    $.RULE("curly", () => {
      $.CONSUME(LCurly);
      $.SUBRULE($.block);
      $.CONSUME(RCurly);
    });

    // very important to call this after all the rules have been setup.
    // otherwise the parser may not work correctly as it will lack information
    // derived from the self analysis.
    this.performSelfAnalysis();
  }
}

const parser = new JessParser([]);

// ----------------- Interpreter -----------------
// Obtains the default CstVisitor constructor to extend.
const BaseCstVisitor = parser.getBaseCstVisitorConstructor();

class jessInterpreter extends BaseCstVisitor {
  constructor() {
    super();
    // This helper will detect any missing or redundant methods on this visitor
    this.validateVisitor();
  }
  stylesheet(ctx) {
    console.log(ctx);
    return '';
  }
  variable(ctx) {
    return '';
  }
  jsblock(ctx) {
    return '';
  }
  block(ctx) {
    return '';
  }
  blockOptions(ctx) {
    return '';
  }
  expression(ctx) {
    return '';
  }
  miscat(ctx) {
    return '';
  }
  curly(ctx) {
    return '';
  }
}

const interpreter = new jessInterpreter();

export default (text) => {
  // 1. Tokenize the input.
  const lexResult = JessLexer.tokenize(text);

  // 2. Parse the Tokens vector.
  parser.input = lexResult.tokens;
  const cst = parser.stylesheet();

  // 3. Perform semantics using a CstVisitor.
  // Note that separation of concerns between the syntactic analysis (parsing) and the semantics.
  // const value = interpreter.visit(cst);

  return {
    value: cst,
    lexResult: lexResult,
    parseErrors: parser.errors
  };
};