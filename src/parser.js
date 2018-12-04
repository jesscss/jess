(function jsonGrammarOnlyExample() {
  // ----------------- Lexer -----------------
  const createToken = chevrotain.createToken;
  const Lexer = chevrotain.Lexer;

  const PreambleStart = createToken({name: "PreambleStart", pattern: /\s*@{/});
  const JSLineStart = createToken({name: "JSLineStart", pattern: /\s*\$[^\{]/});
  const JSInlineStart = createToken({name: "JSInlineStart", pattern: /\${/});
  
  const LCurly = createToken({name: "LCurly", pattern: /{/});
  const RCurly = createToken({name: "RCurly", pattern: /}/});
  const LSquare = createToken({name: "LSquare", pattern: /\[/});
  const RSquare = createToken({name: "RSquare", pattern: /]/});
  const LParen = createToken({name: "LParen", pattern: /\(/});
  const RParen = createToken({name: "RParen", pattern: /\)/});
  const AnythingButBlock = createToken(
    {name: "AnythingButBlock", pattern: /[^{\[\(}\)\]\n\r\$]+/}
  );
  
  const WhiteSpace = createToken({
    name: "WhiteSpace",
    pattern: /[ \t]+/
  })
  
  const LineTerminator = createToken({
    name: "LineTerminator",
    pattern: /\n\r|\r|\n/
  })
 

  const jessTokens = [
    WhiteSpace, LineTerminator, PreambleStart, JSLineStart,
    JSInlineStart, RCurly, LCurly,
    LSquare, RSquare, LParen, RParen, AnythingButBlock
  ];

  const JessLexer = new Lexer(jessTokens, {
    // Less position info tracked, reduces verbosity of the playground output.
    positionTracking: "onlyStart"
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
          {ALT: () => $.SUBRULE($.preamble)},
          {ALT: () => {
            $.CONSUME(JSLineStart)
            $.SUBRULE($.jsblock)
          }},
          {ALT: () => $.CONSUME(WhiteSpace)},
          {ALT: () => $.CONSUME(LineTerminator)},
          {ALT: () => {
            $.CONSUME(AnythingButBlock)
            $.SUBRULE($.block)
          }}
        ]));
      }); 

      $.RULE("preamble", () => {
        $.CONSUME(PreambleStart);
        $.SUBRULE($.block);
        $.CONSUME(RCurly);
      });
      
      $.RULE("jsblock", () => {
      	$.MANY(() => $.OR([
          {ALT: () => $.CONSUME(AnythingButBlock)},
          {ALT: () => $.CONSUME(WhiteSpace)},
          {ALT: () => $.SUBRULE($.curly)},
          {ALT: () => $.SUBRULE($.paren)},
          {ALT: () => $.SUBRULE($.square)}
        ]));
      });
      
      $.RULE("block", () => {
      	$.MANY(() => $.OR([
          {ALT: () => $.CONSUME(AnythingButBlock)},
          {ALT: () => $.CONSUME(LineTerminator)},
          {ALT: () => $.CONSUME(WhiteSpace)},
          {ALT: () => {
            $.CONSUME(JSInlineStart)
            $.SUBRULE($.block)
        	$.CONSUME(RCurly)
          }},
          {ALT: () => $.SUBRULE($.curly)},
          {ALT: () => $.SUBRULE($.paren)},
          {ALT: () => $.SUBRULE($.square)}
        ]));
      });
      
      $.RULE("curly", () => {
      	$.CONSUME(LCurly);
        $.SUBRULE($.block);
        $.CONSUME(RCurly);
      });
      
      $.RULE("paren", () => {
      	$.CONSUME(LParen);
        $.SUBRULE($.block);
        $.CONSUME(RParen);
      });
      
      $.RULE("square", () => {
      	$.CONSUME(LSquare);
        $.SUBRULE($.block);
        $.CONSUME(RSquare);
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