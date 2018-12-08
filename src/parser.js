(function jsonGrammarOnlyExample() {
  // ----------------- Lexer -----------------
  const createToken = chevrotain.createToken;
  const Lexer = chevrotain.Lexer;

  const Imprt = createToken({name: "Imprt", pattern: /\@import[^;]+;/i});
  const Set = createToken({name: "Set", pattern: /\@set\s*{/i});
  const Dynamic = createToken({name: "Dynamic", pattern: /\@dynamic\s*{/i});
  
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
    Imprt, Dynamic, Set, JSExpr,
    RCurly, LCurly, StringLiteral,
    Misc, At
  ];

  const JessLexer = new Lexer(jessTokens, {
    // Less position info tracked, reduces verbosity of the playground output.
    // positionTracking: "onlyStart"
  });


  // ----------------- parser -----------------
  const Parser = chevrotain.Parser;

  class JessParser extends Parser {
    constructor() {
      super(jessTokens, {
        recoveryEnabled: false
      })

      const $ = this;

      $.RULE("stylesheet", () => {
        $.MANY(() => $.OR([
          {ALT: () => $.CONSUME(Imprt)},
          {ALT: () => $.SUBRULE($.set)},
          {ALT: () => $.SUBRULE($.blockOptions)}
        ]));
      });
      
      $.RULE("set", () => {
      	$.CONSUME(Set)
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

  // for the playground to work the returned object must contain these fields
  return {
    lexer: JessLexer,
    parser: JessParser,
    defaultRule: "stylesheet"
  };
}())