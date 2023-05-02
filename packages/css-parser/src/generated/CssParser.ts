// Generated from ../grammar/CssParser.g4 by ANTLR 4.12.0
// noinspection ES6UnusedImports,JSUnusedGlobalSymbols,JSUnusedLocalSymbols

import {
	ATN,
	ATNDeserializer, DecisionState, DFA, FailedPredicateException,
	RecognitionException, NoViableAltException, BailErrorStrategy,
	Parser, ParserATNSimulator,
	RuleContext, ParserRuleContext, PredictionMode, PredictionContextCache,
	TerminalNode, RuleNode,
	Token, TokenStream,
	Interval, IntervalSet
} from 'antlr4';
import CssParserListener from "./CssParserListener.js";
// for running tests with parameters, TODO: discuss strategy for typed parameters in CI
// eslint-disable-next-line no-unused-vars
type int = number;

export default class CssParser extends Parser {
	public static readonly AND = 1;
	public static readonly OR = 2;
	public static readonly NOT = 3;
	public static readonly ONLY = 4;
	public static readonly SCREEN = 5;
	public static readonly PRINT = 6;
	public static readonly ALL = 7;
	public static readonly IMPORTANT = 8;
	public static readonly ATTRIBUTE_FLAG = 9;
	public static readonly UNSIGNED_INTEGER = 10;
	public static readonly SIGNED_INTEGER = 11;
	public static readonly UNSIGNED_NUMBER = 12;
	public static readonly SIGNED_NUMBER = 13;
	public static readonly NTH_DIMENSION = 14;
	public static readonly NTH_DIMENSION_SIGNED = 15;
	public static readonly UNSIGNED_DIMENSION = 16;
	public static readonly SIGNED_DIMENSION = 17;
	public static readonly UNSIGNED_PERCENTAGE = 18;
	public static readonly SIGNED_PERCENTAGE = 19;
	public static readonly AMPERSAND = 20;
	public static readonly COLOR_IDENT_START = 21;
	public static readonly COLOR_INT_START = 22;
	public static readonly ID = 23;
	public static readonly NTH_PSEUDO_CLASS = 24;
	public static readonly OF = 25;
	public static readonly FUNCTIONAL_PSEUDO_CLASS = 26;
	public static readonly PAGE_PSEUDO_CLASS = 27;
	public static readonly STAR = 28;
	public static readonly SLASH = 29;
	public static readonly TILDE = 30;
	public static readonly GT = 31;
	public static readonly LT = 32;
	public static readonly GTE = 33;
	public static readonly LTE = 34;
	public static readonly EQ = 35;
	public static readonly PLUS = 36;
	public static readonly MINUS = 37;
	public static readonly COLUMN = 38;
	public static readonly CARET = 39;
	public static readonly DOLLAR = 40;
	public static readonly PIPE = 41;
	public static readonly COLON = 42;
	public static readonly NTH_ODD = 43;
	public static readonly NTH_EVEN = 44;
	public static readonly SEMI = 45;
	public static readonly LCURLY = 46;
	public static readonly RCURLY = 47;
	public static readonly LPAREN = 48;
	public static readonly RPAREN = 49;
	public static readonly LSQUARE = 50;
	public static readonly RSQUARE = 51;
	public static readonly COMMA = 52;
	public static readonly DOT = 53;
	public static readonly STRING = 54;
	public static readonly CHARSET = 55;
	public static readonly IMPORT_RULE = 56;
	public static readonly NAMESPACE_RULE = 57;
	public static readonly MEDIA_RULE = 58;
	public static readonly SUPPORTS_RULE = 59;
	public static readonly PAGE_RULE = 60;
	public static readonly FONT_FACE_RULE = 61;
	public static readonly KEYFRAMES_RULE = 62;
	public static readonly CONTAINER_RULE = 63;
	public static readonly PROPERTY_RULE = 64;
	public static readonly LAYER_RULE = 65;
	public static readonly SCOPE_RULE = 66;
	public static readonly AT_RULE = 67;
	public static readonly URL_FUNCTION = 68;
	public static readonly SUPPORTS_FUNCTION = 69;
	public static readonly VAR_FUNCTION = 70;
	public static readonly CALC_FUNCTION = 71;
	public static readonly E = 72;
	public static readonly PI = 73;
	public static readonly INFINITY = 74;
	public static readonly NAN = 75;
	public static readonly CUSTOM_IDENT = 76;
	public static readonly Comment = 77;
	public static readonly WS = 78;
	public static readonly Cdo = 79;
	public static readonly Cdc = 80;
	public static readonly UnicodeBOM = 81;
	public static readonly IDENT = 82;
	public static readonly UNKNOWN = 83;
	public static readonly CUSTOM_VALUE = 84;
	public static readonly EOF = Token.EOF;
	public static readonly RULE_stylesheet = 0;
	public static readonly RULE_main = 1;
	public static readonly RULE_qualifiedRule = 2;
	public static readonly RULE_innerQualifiedRule = 3;
	public static readonly RULE_simpleSelector = 4;
	public static readonly RULE_classSelector = 5;
	public static readonly RULE_pseudoSelector = 6;
	public static readonly RULE_nthValue = 7;
	public static readonly RULE_attributeSelector = 8;
	public static readonly RULE_compoundSelector = 9;
	public static readonly RULE_complexSelector = 10;
	public static readonly RULE_combinator = 11;
	public static readonly RULE_relativeSelector = 12;
	public static readonly RULE_forgivingSelectorList = 13;
	public static readonly RULE_selectorList = 14;
	public static readonly RULE_declarationList = 15;
	public static readonly RULE_declaration = 16;
	public static readonly RULE_valueList = 17;
	public static readonly RULE_value = 18;
	public static readonly RULE_unknownValue = 19;
	public static readonly RULE_mathSum = 20;
	public static readonly RULE_mathProduct = 21;
	public static readonly RULE_mathValue = 22;
	public static readonly RULE_mathConstant = 23;
	public static readonly RULE_function = 24;
	public static readonly RULE_integer = 25;
	public static readonly RULE_number = 26;
	public static readonly RULE_dimension = 27;
	public static readonly RULE_percentage = 28;
	public static readonly RULE_atRule = 29;
	public static readonly RULE_innerAtRule = 30;
	public static readonly RULE_mediaAtRule = 31;
	public static readonly RULE_innerMediaAtRule = 32;
	public static readonly RULE_mediaQuery = 33;
	public static readonly RULE_mediaType = 34;
	public static readonly RULE_mediaCondition = 35;
	public static readonly RULE_mediaConditionWithoutOr = 36;
	public static readonly RULE_mediaNot = 37;
	public static readonly RULE_mediaAnd = 38;
	public static readonly RULE_mediaOr = 39;
	public static readonly RULE_mediaInParens = 40;
	public static readonly RULE_mediaFeature = 41;
	public static readonly RULE_mediaRange = 42;
	public static readonly RULE_mfNonIdentifierValue = 43;
	public static readonly RULE_mfValue = 44;
	public static readonly RULE_mfLt = 45;
	public static readonly RULE_mfGt = 46;
	public static readonly RULE_mfEq = 47;
	public static readonly RULE_mfComparison = 48;
	public static readonly RULE_generalEnclosed = 49;
	public static readonly RULE_ratio = 50;
	public static readonly RULE_pageAtRule = 51;
	public static readonly RULE_fontFaceAtRule = 52;
	public static readonly RULE_supportsAtRule = 53;
	public static readonly RULE_supportsCondition = 54;
	public static readonly RULE_supportsInParens = 55;
	public static readonly RULE_importAtRule = 56;
	public static readonly RULE_unknownAtRule = 57;
	public static readonly RULE_identifier = 58;
	public static readonly RULE_anyOuterValue = 59;
	public static readonly RULE_anyInnerValue = 60;
	public static readonly literalNames: (string | null)[] = [ null, "'and'", 
                                                            "'or'", "'not'", 
                                                            "'only'", "'screen'", 
                                                            "'print'", "'all'", 
                                                            null, null, 
                                                            null, null, 
                                                            null, null, 
                                                            null, null, 
                                                            null, null, 
                                                            null, null, 
                                                            "'&'", null, 
                                                            null, null, 
                                                            null, "'of'", 
                                                            null, null, 
                                                            "'*'", "'/'", 
                                                            "'~'", "'>'", 
                                                            "'<'", "'>='", 
                                                            "'<='", "'='", 
                                                            "'+'", "'-'", 
                                                            "'||'", "'^'", 
                                                            "'$'", "'|'", 
                                                            "':'", "'odd'", 
                                                            "'even'", "';'", 
                                                            "'{'", "'}'", 
                                                            "'('", "')'", 
                                                            "'['", "']'", 
                                                            "','", "'.'", 
                                                            null, null, 
                                                            "'@import'", 
                                                            "'@namespace'", 
                                                            "'@media'", 
                                                            "'@supports'", 
                                                            "'@page'", "'@font-face'", 
                                                            null, "'@container'", 
                                                            "'@property'", 
                                                            "'@layer'", 
                                                            "'@scope'", 
                                                            null, null, 
                                                            "'supports'", 
                                                            "'var'", "'calc'", 
                                                            "'e'", "'pi'", 
                                                            "'infinity'", 
                                                            "'nan'", null, 
                                                            null, null, 
                                                            "'<!--'", "'-->'", 
                                                            "'\\uFFFE'" ];
	public static readonly symbolicNames: (string | null)[] = [ null, "AND", 
                                                             "OR", "NOT", 
                                                             "ONLY", "SCREEN", 
                                                             "PRINT", "ALL", 
                                                             "IMPORTANT", 
                                                             "ATTRIBUTE_FLAG", 
                                                             "UNSIGNED_INTEGER", 
                                                             "SIGNED_INTEGER", 
                                                             "UNSIGNED_NUMBER", 
                                                             "SIGNED_NUMBER", 
                                                             "NTH_DIMENSION", 
                                                             "NTH_DIMENSION_SIGNED", 
                                                             "UNSIGNED_DIMENSION", 
                                                             "SIGNED_DIMENSION", 
                                                             "UNSIGNED_PERCENTAGE", 
                                                             "SIGNED_PERCENTAGE", 
                                                             "AMPERSAND", 
                                                             "COLOR_IDENT_START", 
                                                             "COLOR_INT_START", 
                                                             "ID", "NTH_PSEUDO_CLASS", 
                                                             "OF", "FUNCTIONAL_PSEUDO_CLASS", 
                                                             "PAGE_PSEUDO_CLASS", 
                                                             "STAR", "SLASH", 
                                                             "TILDE", "GT", 
                                                             "LT", "GTE", 
                                                             "LTE", "EQ", 
                                                             "PLUS", "MINUS", 
                                                             "COLUMN", "CARET", 
                                                             "DOLLAR", "PIPE", 
                                                             "COLON", "NTH_ODD", 
                                                             "NTH_EVEN", 
                                                             "SEMI", "LCURLY", 
                                                             "RCURLY", "LPAREN", 
                                                             "RPAREN", "LSQUARE", 
                                                             "RSQUARE", 
                                                             "COMMA", "DOT", 
                                                             "STRING", "CHARSET", 
                                                             "IMPORT_RULE", 
                                                             "NAMESPACE_RULE", 
                                                             "MEDIA_RULE", 
                                                             "SUPPORTS_RULE", 
                                                             "PAGE_RULE", 
                                                             "FONT_FACE_RULE", 
                                                             "KEYFRAMES_RULE", 
                                                             "CONTAINER_RULE", 
                                                             "PROPERTY_RULE", 
                                                             "LAYER_RULE", 
                                                             "SCOPE_RULE", 
                                                             "AT_RULE", 
                                                             "URL_FUNCTION", 
                                                             "SUPPORTS_FUNCTION", 
                                                             "VAR_FUNCTION", 
                                                             "CALC_FUNCTION", 
                                                             "E", "PI", 
                                                             "INFINITY", 
                                                             "NAN", "CUSTOM_IDENT", 
                                                             "Comment", 
                                                             "WS", "Cdo", 
                                                             "Cdc", "UnicodeBOM", 
                                                             "IDENT", "UNKNOWN", 
                                                             "CUSTOM_VALUE" ];
	// tslint:disable:no-trailing-whitespace
	public static readonly ruleNames: string[] = [
		"stylesheet", "main", "qualifiedRule", "innerQualifiedRule", "simpleSelector", 
		"classSelector", "pseudoSelector", "nthValue", "attributeSelector", "compoundSelector", 
		"complexSelector", "combinator", "relativeSelector", "forgivingSelectorList", 
		"selectorList", "declarationList", "declaration", "valueList", "value", 
		"unknownValue", "mathSum", "mathProduct", "mathValue", "mathConstant", 
		"function", "integer", "number", "dimension", "percentage", "atRule", 
		"innerAtRule", "mediaAtRule", "innerMediaAtRule", "mediaQuery", "mediaType", 
		"mediaCondition", "mediaConditionWithoutOr", "mediaNot", "mediaAnd", "mediaOr", 
		"mediaInParens", "mediaFeature", "mediaRange", "mfNonIdentifierValue", 
		"mfValue", "mfLt", "mfGt", "mfEq", "mfComparison", "generalEnclosed", 
		"ratio", "pageAtRule", "fontFaceAtRule", "supportsAtRule", "supportsCondition", 
		"supportsInParens", "importAtRule", "unknownAtRule", "identifier", "anyOuterValue", 
		"anyInnerValue",
	];
	public get grammarFileName(): string { return "CssParser.g4"; }
	public get literalNames(): (string | null)[] { return CssParser.literalNames; }
	public get symbolicNames(): (string | null)[] { return CssParser.symbolicNames; }
	public get ruleNames(): string[] { return CssParser.ruleNames; }
	public get serializedATN(): number[] { return CssParser._serializedATN; }

	protected createFailedPredicateException(predicate?: string, message?: string): FailedPredicateException {
		return new FailedPredicateException(this, predicate, message);
	}

	constructor(input: TokenStream) {
		super(input);
		this._interp = new ParserATNSimulator(this, CssParser._ATN, CssParser.DecisionsToDFA, new PredictionContextCache());
	}
	// @RuleVersion(0)
	public stylesheet(): StylesheetContext {
		let localctx: StylesheetContext = new StylesheetContext(this, this._ctx, this.state);
		this.enterRule(localctx, 0, CssParser.RULE_stylesheet);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 123;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===55) {
				{
				this.state = 122;
				this.match(CssParser.CHARSET);
				}
			}

			this.state = 125;
			this.main();
			this.state = 126;
			this.match(CssParser.EOF);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public main(): MainContext {
		let localctx: MainContext = new MainContext(this, this._ctx, this.state);
		this.enterRule(localctx, 2, CssParser.RULE_main);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 133;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while ((((_la) & ~0x1F) === 0 && ((1 << _la) & 397411070) !== 0) || ((((_la - 42)) & ~0x1F) === 0 && ((1 << (_la - 42)) & 3255781633) !== 0) || ((((_la - 74)) & ~0x1F) === 0 && ((1 << (_la - 74)) & 275) !== 0)) {
				{
				this.state = 131;
				this._errHandler.sync(this);
				switch (this._input.LA(1)) {
				case 78:
					{
					this.state = 128;
					this.match(CssParser.WS);
					}
					break;
				case 1:
				case 2:
				case 3:
				case 4:
				case 5:
				case 6:
				case 7:
				case 9:
				case 20:
				case 21:
				case 23:
				case 24:
				case 25:
				case 26:
				case 28:
				case 42:
				case 50:
				case 53:
				case 72:
				case 73:
				case 74:
				case 75:
				case 82:
					{
					this.state = 129;
					this.qualifiedRule();
					}
					break;
				case 56:
				case 58:
				case 59:
				case 60:
				case 61:
				case 67:
					{
					this.state = 130;
					this.atRule();
					}
					break;
				default:
					throw new NoViableAltException(this);
				}
				}
				this.state = 135;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public qualifiedRule(): QualifiedRuleContext {
		let localctx: QualifiedRuleContext = new QualifiedRuleContext(this, this._ctx, this.state);
		this.enterRule(localctx, 4, CssParser.RULE_qualifiedRule);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 136;
			this.selectorList();
			this.state = 140;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===78) {
				{
				{
				this.state = 137;
				this.match(CssParser.WS);
				}
				}
				this.state = 142;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 143;
			this.match(CssParser.LCURLY);
			this.state = 144;
			this.declarationList();
			this.state = 145;
			this.match(CssParser.RCURLY);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public innerQualifiedRule(): InnerQualifiedRuleContext {
		let localctx: InnerQualifiedRuleContext = new InnerQualifiedRuleContext(this, this._ctx, this.state);
		this.enterRule(localctx, 6, CssParser.RULE_innerQualifiedRule);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 147;
			this.forgivingSelectorList();
			this.state = 151;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===78) {
				{
				{
				this.state = 148;
				this.match(CssParser.WS);
				}
				}
				this.state = 153;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 154;
			this.match(CssParser.LCURLY);
			this.state = 155;
			this.declarationList();
			this.state = 156;
			this.match(CssParser.RCURLY);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public simpleSelector(): SimpleSelectorContext {
		let localctx: SimpleSelectorContext = new SimpleSelectorContext(this, this._ctx, this.state);
		this.enterRule(localctx, 8, CssParser.RULE_simpleSelector);
		try {
			this.state = 166;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 53:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 158;
				this.classSelector();
				}
				break;
			case 23:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 159;
				this.match(CssParser.ID);
				}
				break;
			case 21:
				this.enterOuterAlt(localctx, 3);
				{
				this.state = 160;
				this.match(CssParser.COLOR_IDENT_START);
				}
				break;
			case 1:
			case 2:
			case 3:
			case 4:
			case 5:
			case 6:
			case 7:
			case 9:
			case 25:
			case 72:
			case 73:
			case 74:
			case 75:
			case 82:
				this.enterOuterAlt(localctx, 4);
				{
				this.state = 161;
				this.identifier();
				}
				break;
			case 20:
				this.enterOuterAlt(localctx, 5);
				{
				this.state = 162;
				this.match(CssParser.AMPERSAND);
				}
				break;
			case 28:
				this.enterOuterAlt(localctx, 6);
				{
				this.state = 163;
				this.match(CssParser.STAR);
				}
				break;
			case 24:
			case 26:
			case 42:
				this.enterOuterAlt(localctx, 7);
				{
				this.state = 164;
				this.pseudoSelector();
				}
				break;
			case 50:
				this.enterOuterAlt(localctx, 8);
				{
				this.state = 165;
				this.attributeSelector();
				}
				break;
			default:
				throw new NoViableAltException(this);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public classSelector(): ClassSelectorContext {
		let localctx: ClassSelectorContext = new ClassSelectorContext(this, this._ctx, this.state);
		this.enterRule(localctx, 10, CssParser.RULE_classSelector);
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 168;
			this.match(CssParser.DOT);
			this.state = 169;
			this.identifier();
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public pseudoSelector(): PseudoSelectorContext {
		let localctx: PseudoSelectorContext = new PseudoSelectorContext(this, this._ctx, this.state);
		this.enterRule(localctx, 12, CssParser.RULE_pseudoSelector);
		let _la: number;
		try {
			let _alt: number;
			this.state = 220;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 24:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 171;
				this.match(CssParser.NTH_PSEUDO_CLASS);
				this.state = 172;
				this.match(CssParser.LPAREN);
				this.state = 176;
				this._errHandler.sync(this);
				_alt = this._interp.adaptivePredict(this._input, 6, this._ctx);
				while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
					if (_alt === 1) {
						{
						{
						this.state = 173;
						this.match(CssParser.WS);
						}
						}
					}
					this.state = 178;
					this._errHandler.sync(this);
					_alt = this._interp.adaptivePredict(this._input, 6, this._ctx);
				}
				this.state = 179;
				this.nthValue();
				this.state = 183;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 180;
					this.match(CssParser.WS);
					}
					}
					this.state = 185;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 186;
				this.match(CssParser.RPAREN);
				}
				break;
			case 26:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 188;
				this.match(CssParser.FUNCTIONAL_PSEUDO_CLASS);
				this.state = 189;
				this.match(CssParser.LPAREN);
				this.state = 193;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 190;
					this.match(CssParser.WS);
					}
					}
					this.state = 195;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 196;
				this.forgivingSelectorList();
				this.state = 200;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 197;
					this.match(CssParser.WS);
					}
					}
					this.state = 202;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 203;
				this.match(CssParser.RPAREN);
				}
				break;
			case 42:
				this.enterOuterAlt(localctx, 3);
				{
				this.state = 205;
				this.match(CssParser.COLON);
				this.state = 207;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if (_la===42) {
					{
					this.state = 206;
					this.match(CssParser.COLON);
					}
				}

				this.state = 209;
				this.identifier();
				this.state = 218;
				this._errHandler.sync(this);
				switch ( this._interp.adaptivePredict(this._input, 12, this._ctx) ) {
				case 1:
					{
					this.state = 210;
					this.match(CssParser.LPAREN);
					this.state = 214;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while ((((_la) & ~0x1F) === 0 && ((1 << _la) & 132382462) !== 0) || ((((_la - 35)) & ~0x1F) === 0 && ((1 << (_la - 35)) & 961665) !== 0) || ((((_la - 67)) & ~0x1F) === 0 && ((1 << (_la - 67)) & 100859) !== 0)) {
						{
						{
						this.state = 211;
						this.anyInnerValue();
						}
						}
						this.state = 216;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 217;
					this.match(CssParser.RPAREN);
					}
					break;
				}
				}
				break;
			default:
				throw new NoViableAltException(this);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public nthValue(): NthValueContext {
		let localctx: NthValueContext = new NthValueContext(this, this._ctx, this.state);
		this.enterRule(localctx, 14, CssParser.RULE_nthValue);
		let _la: number;
		try {
			this.state = 255;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 43:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 222;
				this.match(CssParser.NTH_ODD);
				}
				break;
			case 44:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 223;
				this.match(CssParser.NTH_EVEN);
				}
				break;
			case 11:
			case 14:
			case 15:
			case 25:
			case 37:
			case 49:
			case 78:
				this.enterOuterAlt(localctx, 3);
				{
				this.state = 227;
				this._errHandler.sync(this);
				switch (this._input.LA(1)) {
				case 11:
				case 25:
				case 37:
				case 49:
				case 78:
					// tslint:disable-next-line:no-empty
					{
					}
					break;
				case 14:
					{
					this.state = 225;
					this.match(CssParser.NTH_DIMENSION);
					}
					break;
				case 15:
					{
					this.state = 226;
					this.match(CssParser.NTH_DIMENSION_SIGNED);
					}
					break;
				default:
					throw new NoViableAltException(this);
				}
				this.state = 237;
				this._errHandler.sync(this);
				switch (this._input.LA(1)) {
				case 11:
					{
					this.state = 229;
					this.match(CssParser.SIGNED_INTEGER);
					}
					break;
				case 37:
					{
					this.state = 230;
					this.match(CssParser.MINUS);
					this.state = 232;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					do {
						{
						{
						this.state = 231;
						this.match(CssParser.WS);
						}
						}
						this.state = 234;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					} while (_la===78);
					this.state = 236;
					this.match(CssParser.UNSIGNED_INTEGER);
					}
					break;
				case 25:
				case 49:
				case 78:
					break;
				default:
					break;
				}
				this.state = 253;
				this._errHandler.sync(this);
				switch ( this._interp.adaptivePredict(this._input, 19, this._ctx) ) {
				case 1:
					{
					this.state = 242;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 239;
						this.match(CssParser.WS);
						}
						}
						this.state = 244;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 245;
					this.match(CssParser.OF);
					this.state = 249;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 246;
						this.match(CssParser.WS);
						}
						}
						this.state = 251;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 252;
					this.complexSelector();
					}
					break;
				}
				}
				break;
			default:
				throw new NoViableAltException(this);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public attributeSelector(): AttributeSelectorContext {
		let localctx: AttributeSelectorContext = new AttributeSelectorContext(this, this._ctx, this.state);
		this.enterRule(localctx, 16, CssParser.RULE_attributeSelector);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 257;
			this.match(CssParser.LSQUARE);
			this.state = 261;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===78) {
				{
				{
				this.state = 258;
				this.match(CssParser.WS);
				}
				}
				this.state = 263;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 264;
			this.identifier();
			this.state = 266;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (((((_la - 28)) & ~0x1F) === 0 && ((1 << (_la - 28)) & 14341) !== 0)) {
				{
				this.state = 265;
				_la = this._input.LA(1);
				if(!(((((_la - 28)) & ~0x1F) === 0 && ((1 << (_la - 28)) & 14341) !== 0))) {
				this._errHandler.recoverInline(this);
				}
				else {
					this._errHandler.reportMatch(this);
				    this.consume();
				}
				}
			}

			this.state = 268;
			this.match(CssParser.EQ);
			this.state = 272;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===78) {
				{
				{
				this.state = 269;
				this.match(CssParser.WS);
				}
				}
				this.state = 274;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 277;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 1:
			case 2:
			case 3:
			case 4:
			case 5:
			case 6:
			case 7:
			case 9:
			case 25:
			case 72:
			case 73:
			case 74:
			case 75:
			case 82:
				{
				this.state = 275;
				this.identifier();
				}
				break;
			case 54:
				{
				this.state = 276;
				this.match(CssParser.STRING);
				}
				break;
			default:
				throw new NoViableAltException(this);
			}
			this.state = 282;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===78) {
				{
				{
				this.state = 279;
				this.match(CssParser.WS);
				}
				}
				this.state = 284;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 292;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===9) {
				{
				this.state = 285;
				this.match(CssParser.ATTRIBUTE_FLAG);
				this.state = 289;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 286;
					this.match(CssParser.WS);
					}
					}
					this.state = 291;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				}
			}

			this.state = 294;
			this.match(CssParser.RSQUARE);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public compoundSelector(): CompoundSelectorContext {
		let localctx: CompoundSelectorContext = new CompoundSelectorContext(this, this._ctx, this.state);
		this.enterRule(localctx, 18, CssParser.RULE_compoundSelector);
		try {
			let _alt: number;
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 297;
			this._errHandler.sync(this);
			_alt = 1;
			do {
				switch (_alt) {
				case 1:
					{
					{
					this.state = 296;
					this.simpleSelector();
					}
					}
					break;
				default:
					throw new NoViableAltException(this);
				}
				this.state = 299;
				this._errHandler.sync(this);
				_alt = this._interp.adaptivePredict(this._input, 28, this._ctx);
			} while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public complexSelector(): ComplexSelectorContext {
		let localctx: ComplexSelectorContext = new ComplexSelectorContext(this, this._ctx, this.state);
		this.enterRule(localctx, 20, CssParser.RULE_complexSelector);
		let _la: number;
		try {
			let _alt: number;
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 301;
			this.compoundSelector();
			this.state = 320;
			this._errHandler.sync(this);
			_alt = this._interp.adaptivePredict(this._input, 32, this._ctx);
			while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
				if (_alt === 1) {
					{
					{
					this.state = 305;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 302;
						this.match(CssParser.WS);
						}
						}
						this.state = 307;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 315;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					if (((((_la - 30)) & ~0x1F) === 0 && ((1 << (_la - 30)) & 323) !== 0)) {
						{
						this.state = 308;
						this.combinator();
						this.state = 312;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
						while (_la===78) {
							{
							{
							this.state = 309;
							this.match(CssParser.WS);
							}
							}
							this.state = 314;
							this._errHandler.sync(this);
							_la = this._input.LA(1);
						}
						}
					}

					this.state = 317;
					this.compoundSelector();
					}
					}
				}
				this.state = 322;
				this._errHandler.sync(this);
				_alt = this._interp.adaptivePredict(this._input, 32, this._ctx);
			}
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public combinator(): CombinatorContext {
		let localctx: CombinatorContext = new CombinatorContext(this, this._ctx, this.state);
		this.enterRule(localctx, 22, CssParser.RULE_combinator);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 323;
			_la = this._input.LA(1);
			if(!(((((_la - 30)) & ~0x1F) === 0 && ((1 << (_la - 30)) & 323) !== 0))) {
			this._errHandler.recoverInline(this);
			}
			else {
				this._errHandler.reportMatch(this);
			    this.consume();
			}
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public relativeSelector(): RelativeSelectorContext {
		let localctx: RelativeSelectorContext = new RelativeSelectorContext(this, this._ctx, this.state);
		this.enterRule(localctx, 24, CssParser.RULE_relativeSelector);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 332;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (((((_la - 30)) & ~0x1F) === 0 && ((1 << (_la - 30)) & 323) !== 0)) {
				{
				this.state = 325;
				this.combinator();
				this.state = 329;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 326;
					this.match(CssParser.WS);
					}
					}
					this.state = 331;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				}
			}

			this.state = 334;
			this.complexSelector();
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public forgivingSelectorList(): ForgivingSelectorListContext {
		let localctx: ForgivingSelectorListContext = new ForgivingSelectorListContext(this, this._ctx, this.state);
		this.enterRule(localctx, 26, CssParser.RULE_forgivingSelectorList);
		let _la: number;
		try {
			let _alt: number;
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 336;
			this.relativeSelector();
			this.state = 353;
			this._errHandler.sync(this);
			_alt = this._interp.adaptivePredict(this._input, 37, this._ctx);
			while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
				if (_alt === 1) {
					{
					{
					this.state = 340;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 337;
						this.match(CssParser.WS);
						}
						}
						this.state = 342;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 343;
					this.match(CssParser.COMMA);
					this.state = 347;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 344;
						this.match(CssParser.WS);
						}
						}
						this.state = 349;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 350;
					this.relativeSelector();
					}
					}
				}
				this.state = 355;
				this._errHandler.sync(this);
				_alt = this._interp.adaptivePredict(this._input, 37, this._ctx);
			}
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public selectorList(): SelectorListContext {
		let localctx: SelectorListContext = new SelectorListContext(this, this._ctx, this.state);
		this.enterRule(localctx, 28, CssParser.RULE_selectorList);
		let _la: number;
		try {
			let _alt: number;
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 356;
			this.complexSelector();
			this.state = 373;
			this._errHandler.sync(this);
			_alt = this._interp.adaptivePredict(this._input, 40, this._ctx);
			while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
				if (_alt === 1) {
					{
					{
					this.state = 360;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 357;
						this.match(CssParser.WS);
						}
						}
						this.state = 362;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 363;
					this.match(CssParser.COMMA);
					this.state = 367;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 364;
						this.match(CssParser.WS);
						}
						}
						this.state = 369;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 370;
					this.complexSelector();
					}
					}
				}
				this.state = 375;
				this._errHandler.sync(this);
				_alt = this._interp.adaptivePredict(this._input, 40, this._ctx);
			}
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public declarationList(): DeclarationListContext {
		let localctx: DeclarationListContext = new DeclarationListContext(this, this._ctx, this.state);
		this.enterRule(localctx, 30, CssParser.RULE_declarationList);
		let _la: number;
		try {
			let _alt: number;
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 379;
			this._errHandler.sync(this);
			_alt = this._interp.adaptivePredict(this._input, 41, this._ctx);
			while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
				if (_alt === 1) {
					{
					{
					this.state = 376;
					this.match(CssParser.WS);
					}
					}
				}
				this.state = 381;
				this._errHandler.sync(this);
				_alt = this._interp.adaptivePredict(this._input, 41, this._ctx);
			}
			this.state = 404;
			this._errHandler.sync(this);
			switch ( this._interp.adaptivePredict(this._input, 45, this._ctx) ) {
			case 1:
				{
				this.state = 383;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if ((((_la) & ~0x1F) === 0 && ((1 << _la) & 33555198) !== 0) || ((((_la - 72)) & ~0x1F) === 0 && ((1 << (_la - 72)) & 1055) !== 0)) {
					{
					this.state = 382;
					this.declaration();
					}
				}

				this.state = 395;
				this._errHandler.sync(this);
				_alt = this._interp.adaptivePredict(this._input, 44, this._ctx);
				while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
					if (_alt === 1) {
						{
						{
						this.state = 388;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
						while (_la===78) {
							{
							{
							this.state = 385;
							this.match(CssParser.WS);
							}
							}
							this.state = 390;
							this._errHandler.sync(this);
							_la = this._input.LA(1);
						}
						this.state = 391;
						this.match(CssParser.SEMI);
						this.state = 392;
						this.declarationList();
						}
						}
					}
					this.state = 397;
					this._errHandler.sync(this);
					_alt = this._interp.adaptivePredict(this._input, 44, this._ctx);
				}
				}
				break;
			case 2:
				{
				this.state = 398;
				this.innerAtRule();
				this.state = 399;
				this.declarationList();
				}
				break;
			case 3:
				{
				this.state = 401;
				this.innerQualifiedRule();
				this.state = 402;
				this.declarationList();
				}
				break;
			}
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public declaration(): DeclarationContext {
		let localctx: DeclarationContext = new DeclarationContext(this, this._ctx, this.state);
		this.enterRule(localctx, 32, CssParser.RULE_declaration);
		let _la: number;
		try {
			let _alt: number;
			this.state = 444;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 1:
			case 2:
			case 3:
			case 4:
			case 5:
			case 6:
			case 7:
			case 9:
			case 25:
			case 72:
			case 73:
			case 74:
			case 75:
			case 82:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 406;
				this.identifier();
				this.state = 410;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 407;
					this.match(CssParser.WS);
					}
					}
					this.state = 412;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 413;
				this.match(CssParser.COLON);
				this.state = 417;
				this._errHandler.sync(this);
				_alt = this._interp.adaptivePredict(this._input, 47, this._ctx);
				while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
					if (_alt === 1) {
						{
						{
						this.state = 414;
						this.match(CssParser.WS);
						}
						}
					}
					this.state = 419;
					this._errHandler.sync(this);
					_alt = this._interp.adaptivePredict(this._input, 47, this._ctx);
				}
				this.state = 420;
				this.valueList();
				this.state = 428;
				this._errHandler.sync(this);
				switch ( this._interp.adaptivePredict(this._input, 49, this._ctx) ) {
				case 1:
					{
					this.state = 424;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 421;
						this.match(CssParser.WS);
						}
						}
						this.state = 426;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 427;
					this.match(CssParser.IMPORTANT);
					}
					break;
				}
				}
				break;
			case 76:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 430;
				this.match(CssParser.CUSTOM_IDENT);
				this.state = 434;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 431;
					this.match(CssParser.WS);
					}
					}
					this.state = 436;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 437;
				this.match(CssParser.COLON);
				this.state = 441;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===84) {
					{
					{
					this.state = 438;
					this.match(CssParser.CUSTOM_VALUE);
					}
					}
					this.state = 443;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				}
				break;
			default:
				throw new NoViableAltException(this);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public valueList(): ValueListContext {
		let localctx: ValueListContext = new ValueListContext(this, this._ctx, this.state);
		this.enterRule(localctx, 34, CssParser.RULE_valueList);
		let _la: number;
		try {
			let _alt: number;
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 447;
			this._errHandler.sync(this);
			_alt = 1;
			do {
				switch (_alt) {
				case 1:
					{
					{
					this.state = 446;
					this.value();
					}
					}
					break;
				default:
					throw new NoViableAltException(this);
				}
				this.state = 449;
				this._errHandler.sync(this);
				_alt = this._interp.adaptivePredict(this._input, 53, this._ctx);
			} while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER);
			this.state = 459;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===29 || _la===52) {
				{
				{
				this.state = 451;
				_la = this._input.LA(1);
				if(!(_la===29 || _la===52)) {
				this._errHandler.recoverInline(this);
				}
				else {
					this._errHandler.reportMatch(this);
				    this.consume();
				}
				this.state = 453;
				this._errHandler.sync(this);
				_alt = 1;
				do {
					switch (_alt) {
					case 1:
						{
						{
						this.state = 452;
						this.value();
						}
						}
						break;
					default:
						throw new NoViableAltException(this);
					}
					this.state = 455;
					this._errHandler.sync(this);
					_alt = this._interp.adaptivePredict(this._input, 54, this._ctx);
				} while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER);
				}
				}
				this.state = 461;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public value(): ValueContext {
		let localctx: ValueContext = new ValueContext(this, this._ctx, this.state);
		this.enterRule(localctx, 36, CssParser.RULE_value);
		try {
			this.state = 476;
			this._errHandler.sync(this);
			switch ( this._interp.adaptivePredict(this._input, 56, this._ctx) ) {
			case 1:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 462;
				this.match(CssParser.WS);
				}
				break;
			case 2:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 463;
				this.identifier();
				}
				break;
			case 3:
				this.enterOuterAlt(localctx, 3);
				{
				this.state = 464;
				this.integer();
				}
				break;
			case 4:
				this.enterOuterAlt(localctx, 4);
				{
				this.state = 465;
				this.number_();
				}
				break;
			case 5:
				this.enterOuterAlt(localctx, 5);
				{
				this.state = 466;
				this.dimension();
				}
				break;
			case 6:
				this.enterOuterAlt(localctx, 6);
				{
				this.state = 467;
				this.match(CssParser.COLOR_IDENT_START);
				}
				break;
			case 7:
				this.enterOuterAlt(localctx, 7);
				{
				this.state = 468;
				this.match(CssParser.COLOR_INT_START);
				}
				break;
			case 8:
				this.enterOuterAlt(localctx, 8);
				{
				this.state = 469;
				this.match(CssParser.STRING);
				}
				break;
			case 9:
				this.enterOuterAlt(localctx, 9);
				{
				this.state = 470;
				this.function_();
				}
				break;
			case 10:
				this.enterOuterAlt(localctx, 10);
				{
				this.state = 471;
				this.match(CssParser.LSQUARE);
				this.state = 472;
				this.identifier();
				this.state = 473;
				this.match(CssParser.RSQUARE);
				}
				break;
			case 11:
				this.enterOuterAlt(localctx, 11);
				{
				this.state = 475;
				this.unknownValue();
				}
				break;
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public unknownValue(): UnknownValueContext {
		let localctx: UnknownValueContext = new UnknownValueContext(this, this._ctx, this.state);
		this.enterRule(localctx, 38, CssParser.RULE_unknownValue);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 478;
			_la = this._input.LA(1);
			if(!(((((_la - 23)) & ~0x1F) === 0 && ((1 << (_la - 23)) & 1074270209) !== 0) || _la===67 || _la===83)) {
			this._errHandler.recoverInline(this);
			}
			else {
				this._errHandler.reportMatch(this);
			    this.consume();
			}
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public mathSum(): MathSumContext {
		let localctx: MathSumContext = new MathSumContext(this, this._ctx, this.state);
		this.enterRule(localctx, 40, CssParser.RULE_mathSum);
		let _la: number;
		try {
			let _alt: number;
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 480;
			this.mathProduct();
			this.state = 497;
			this._errHandler.sync(this);
			_alt = this._interp.adaptivePredict(this._input, 59, this._ctx);
			while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
				if (_alt === 1) {
					{
					{
					this.state = 484;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 481;
						this.match(CssParser.WS);
						}
						}
						this.state = 486;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 487;
					_la = this._input.LA(1);
					if(!(_la===36 || _la===37)) {
					this._errHandler.recoverInline(this);
					}
					else {
						this._errHandler.reportMatch(this);
					    this.consume();
					}
					this.state = 491;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 488;
						this.match(CssParser.WS);
						}
						}
						this.state = 493;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 494;
					this.mathProduct();
					}
					}
				}
				this.state = 499;
				this._errHandler.sync(this);
				_alt = this._interp.adaptivePredict(this._input, 59, this._ctx);
			}
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public mathProduct(): MathProductContext {
		let localctx: MathProductContext = new MathProductContext(this, this._ctx, this.state);
		this.enterRule(localctx, 42, CssParser.RULE_mathProduct);
		let _la: number;
		try {
			let _alt: number;
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 500;
			this.mathValue();
			this.state = 517;
			this._errHandler.sync(this);
			_alt = this._interp.adaptivePredict(this._input, 62, this._ctx);
			while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
				if (_alt === 1) {
					{
					{
					this.state = 504;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 501;
						this.match(CssParser.WS);
						}
						}
						this.state = 506;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 507;
					_la = this._input.LA(1);
					if(!(_la===28 || _la===29)) {
					this._errHandler.recoverInline(this);
					}
					else {
						this._errHandler.reportMatch(this);
					    this.consume();
					}
					this.state = 511;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 508;
						this.match(CssParser.WS);
						}
						}
						this.state = 513;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 514;
					this.mathValue();
					}
					}
				}
				this.state = 519;
				this._errHandler.sync(this);
				_alt = this._interp.adaptivePredict(this._input, 62, this._ctx);
			}
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public mathValue(): MathValueContext {
		let localctx: MathValueContext = new MathValueContext(this, this._ctx, this.state);
		this.enterRule(localctx, 44, CssParser.RULE_mathValue);
		let _la: number;
		try {
			this.state = 540;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 10:
			case 11:
			case 12:
			case 13:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 520;
				this.number_();
				}
				break;
			case 14:
			case 15:
			case 16:
			case 17:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 521;
				this.dimension();
				}
				break;
			case 18:
			case 19:
				this.enterOuterAlt(localctx, 3);
				{
				this.state = 522;
				this.percentage();
				}
				break;
			case 37:
			case 72:
			case 73:
			case 74:
			case 75:
				this.enterOuterAlt(localctx, 4);
				{
				this.state = 523;
				this.mathConstant();
				}
				break;
			case 48:
				this.enterOuterAlt(localctx, 5);
				{
				this.state = 524;
				this.match(CssParser.LPAREN);
				this.state = 528;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 525;
					this.match(CssParser.WS);
					}
					}
					this.state = 530;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 531;
				this.mathSum();
				this.state = 535;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 532;
					this.match(CssParser.WS);
					}
					}
					this.state = 537;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 538;
				this.match(CssParser.RPAREN);
				}
				break;
			default:
				throw new NoViableAltException(this);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public mathConstant(): MathConstantContext {
		let localctx: MathConstantContext = new MathConstantContext(this, this._ctx, this.state);
		this.enterRule(localctx, 46, CssParser.RULE_mathConstant);
		let _la: number;
		try {
			this.state = 549;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 72:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 542;
				this.match(CssParser.E);
				}
				break;
			case 73:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 543;
				this.match(CssParser.PI);
				}
				break;
			case 37:
			case 74:
				this.enterOuterAlt(localctx, 3);
				{
				this.state = 545;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if (_la===37) {
					{
					this.state = 544;
					this.match(CssParser.MINUS);
					}
				}

				this.state = 547;
				this.match(CssParser.INFINITY);
				}
				break;
			case 75:
				this.enterOuterAlt(localctx, 4);
				{
				this.state = 548;
				this.match(CssParser.NAN);
				}
				break;
			default:
				throw new NoViableAltException(this);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public function_(): FunctionContext {
		let localctx: FunctionContext = new FunctionContext(this, this._ctx, this.state);
		this.enterRule(localctx, 48, CssParser.RULE_function);
		let _la: number;
		try {
			let _alt: number;
			this.state = 600;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 68:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 551;
				this.match(CssParser.URL_FUNCTION);
				}
				break;
			case 70:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 552;
				this.match(CssParser.VAR_FUNCTION);
				this.state = 553;
				this.match(CssParser.LPAREN);
				this.state = 557;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 554;
					this.match(CssParser.WS);
					}
					}
					this.state = 559;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 560;
				this.match(CssParser.CUSTOM_IDENT);
				this.state = 575;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if (_la===52 || _la===78) {
					{
					this.state = 564;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 561;
						this.match(CssParser.WS);
						}
						}
						this.state = 566;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 567;
					this.match(CssParser.COMMA);
					this.state = 571;
					this._errHandler.sync(this);
					_alt = this._interp.adaptivePredict(this._input, 70, this._ctx);
					while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
						if (_alt === 1) {
							{
							{
							this.state = 568;
							this.match(CssParser.WS);
							}
							}
						}
						this.state = 573;
						this._errHandler.sync(this);
						_alt = this._interp.adaptivePredict(this._input, 70, this._ctx);
					}
					this.state = 574;
					this.valueList();
					}
				}

				this.state = 577;
				this.match(CssParser.RPAREN);
				}
				break;
			case 71:
				this.enterOuterAlt(localctx, 3);
				{
				this.state = 578;
				this.match(CssParser.CALC_FUNCTION);
				this.state = 579;
				this.match(CssParser.LPAREN);
				this.state = 583;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 580;
					this.match(CssParser.WS);
					}
					}
					this.state = 585;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 586;
				this.mathSum();
				this.state = 590;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 587;
					this.match(CssParser.WS);
					}
					}
					this.state = 592;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 593;
				this.match(CssParser.RPAREN);
				}
				break;
			case 1:
			case 2:
			case 3:
			case 4:
			case 5:
			case 6:
			case 7:
			case 9:
			case 25:
			case 72:
			case 73:
			case 74:
			case 75:
			case 82:
				this.enterOuterAlt(localctx, 4);
				{
				this.state = 595;
				this.identifier();
				this.state = 596;
				this.match(CssParser.LPAREN);
				this.state = 597;
				this.valueList();
				this.state = 598;
				this.match(CssParser.RPAREN);
				}
				break;
			default:
				throw new NoViableAltException(this);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public integer(): IntegerContext {
		let localctx: IntegerContext = new IntegerContext(this, this._ctx, this.state);
		this.enterRule(localctx, 50, CssParser.RULE_integer);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 602;
			_la = this._input.LA(1);
			if(!(_la===10 || _la===11)) {
			this._errHandler.recoverInline(this);
			}
			else {
				this._errHandler.reportMatch(this);
			    this.consume();
			}
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public number_(): NumberContext {
		let localctx: NumberContext = new NumberContext(this, this._ctx, this.state);
		this.enterRule(localctx, 52, CssParser.RULE_number);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 604;
			_la = this._input.LA(1);
			if(!((((_la) & ~0x1F) === 0 && ((1 << _la) & 15360) !== 0))) {
			this._errHandler.recoverInline(this);
			}
			else {
				this._errHandler.reportMatch(this);
			    this.consume();
			}
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public dimension(): DimensionContext {
		let localctx: DimensionContext = new DimensionContext(this, this._ctx, this.state);
		this.enterRule(localctx, 54, CssParser.RULE_dimension);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 606;
			_la = this._input.LA(1);
			if(!((((_la) & ~0x1F) === 0 && ((1 << _la) & 245760) !== 0))) {
			this._errHandler.recoverInline(this);
			}
			else {
				this._errHandler.reportMatch(this);
			    this.consume();
			}
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public percentage(): PercentageContext {
		let localctx: PercentageContext = new PercentageContext(this, this._ctx, this.state);
		this.enterRule(localctx, 56, CssParser.RULE_percentage);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 608;
			_la = this._input.LA(1);
			if(!(_la===18 || _la===19)) {
			this._errHandler.recoverInline(this);
			}
			else {
				this._errHandler.reportMatch(this);
			    this.consume();
			}
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public atRule(): AtRuleContext {
		let localctx: AtRuleContext = new AtRuleContext(this, this._ctx, this.state);
		this.enterRule(localctx, 58, CssParser.RULE_atRule);
		try {
			this.state = 616;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 56:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 610;
				this.importAtRule();
				}
				break;
			case 58:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 611;
				this.mediaAtRule();
				}
				break;
			case 67:
				this.enterOuterAlt(localctx, 3);
				{
				this.state = 612;
				this.unknownAtRule();
				}
				break;
			case 60:
				this.enterOuterAlt(localctx, 4);
				{
				this.state = 613;
				this.pageAtRule();
				}
				break;
			case 61:
				this.enterOuterAlt(localctx, 5);
				{
				this.state = 614;
				this.fontFaceAtRule();
				}
				break;
			case 59:
				this.enterOuterAlt(localctx, 6);
				{
				this.state = 615;
				this.supportsAtRule();
				}
				break;
			default:
				throw new NoViableAltException(this);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public innerAtRule(): InnerAtRuleContext {
		let localctx: InnerAtRuleContext = new InnerAtRuleContext(this, this._ctx, this.state);
		this.enterRule(localctx, 60, CssParser.RULE_innerAtRule);
		try {
			this.state = 620;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 58:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 618;
				this.innerMediaAtRule();
				}
				break;
			case 67:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 619;
				this.unknownAtRule();
				}
				break;
			default:
				throw new NoViableAltException(this);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public mediaAtRule(): MediaAtRuleContext {
		let localctx: MediaAtRuleContext = new MediaAtRuleContext(this, this._ctx, this.state);
		this.enterRule(localctx, 62, CssParser.RULE_mediaAtRule);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 622;
			this.match(CssParser.MEDIA_RULE);
			this.state = 626;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===78) {
				{
				{
				this.state = 623;
				this.match(CssParser.WS);
				}
				}
				this.state = 628;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 629;
			this.mediaQuery();
			this.state = 633;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===78) {
				{
				{
				this.state = 630;
				this.match(CssParser.WS);
				}
				}
				this.state = 635;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 636;
			this.match(CssParser.LCURLY);
			this.state = 637;
			this.main();
			this.state = 638;
			this.match(CssParser.RCURLY);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public innerMediaAtRule(): InnerMediaAtRuleContext {
		let localctx: InnerMediaAtRuleContext = new InnerMediaAtRuleContext(this, this._ctx, this.state);
		this.enterRule(localctx, 64, CssParser.RULE_innerMediaAtRule);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 640;
			this.match(CssParser.MEDIA_RULE);
			this.state = 644;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===78) {
				{
				{
				this.state = 641;
				this.match(CssParser.WS);
				}
				}
				this.state = 646;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 647;
			this.mediaQuery();
			this.state = 651;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===78) {
				{
				{
				this.state = 648;
				this.match(CssParser.WS);
				}
				}
				this.state = 653;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 654;
			this.match(CssParser.LCURLY);
			this.state = 655;
			this.declarationList();
			this.state = 656;
			this.match(CssParser.RCURLY);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public mediaQuery(): MediaQueryContext {
		let localctx: MediaQueryContext = new MediaQueryContext(this, this._ctx, this.state);
		this.enterRule(localctx, 66, CssParser.RULE_mediaQuery);
		let _la: number;
		try {
			this.state = 685;
			this._errHandler.sync(this);
			switch ( this._interp.adaptivePredict(this._input, 86, this._ctx) ) {
			case 1:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 658;
				this.mediaCondition();
				}
				break;
			case 2:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 666;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if (_la===3 || _la===4) {
					{
					this.state = 659;
					_la = this._input.LA(1);
					if(!(_la===3 || _la===4)) {
					this._errHandler.recoverInline(this);
					}
					else {
						this._errHandler.reportMatch(this);
					    this.consume();
					}
					this.state = 663;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 660;
						this.match(CssParser.WS);
						}
						}
						this.state = 665;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					}
				}

				this.state = 668;
				this.mediaType();
				this.state = 683;
				this._errHandler.sync(this);
				switch ( this._interp.adaptivePredict(this._input, 85, this._ctx) ) {
				case 1:
					{
					this.state = 672;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 669;
						this.match(CssParser.WS);
						}
						}
						this.state = 674;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 675;
					this.match(CssParser.AND);
					this.state = 679;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 676;
						this.match(CssParser.WS);
						}
						}
						this.state = 681;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 682;
					this.mediaConditionWithoutOr();
					}
					break;
				}
				}
				break;
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public mediaType(): MediaTypeContext {
		let localctx: MediaTypeContext = new MediaTypeContext(this, this._ctx, this.state);
		this.enterRule(localctx, 68, CssParser.RULE_mediaType);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 687;
			_la = this._input.LA(1);
			if(!((((_la) & ~0x1F) === 0 && ((1 << _la) & 224) !== 0) || _la===82)) {
			this._errHandler.recoverInline(this);
			}
			else {
				this._errHandler.reportMatch(this);
			    this.consume();
			}
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public mediaCondition(): MediaConditionContext {
		let localctx: MediaConditionContext = new MediaConditionContext(this, this._ctx, this.state);
		this.enterRule(localctx, 70, CssParser.RULE_mediaCondition);
		let _la: number;
		try {
			let _alt: number;
			this.state = 711;
			this._errHandler.sync(this);
			switch ( this._interp.adaptivePredict(this._input, 91, this._ctx) ) {
			case 1:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 689;
				this.mediaNot();
				}
				break;
			case 2:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 690;
				this.mediaInParens();
				{
				this.state = 694;
				this._errHandler.sync(this);
				_alt = this._interp.adaptivePredict(this._input, 87, this._ctx);
				while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
					if (_alt === 1) {
						{
						{
						this.state = 691;
						this.match(CssParser.WS);
						}
						}
					}
					this.state = 696;
					this._errHandler.sync(this);
					_alt = this._interp.adaptivePredict(this._input, 87, this._ctx);
				}
				this.state = 709;
				this._errHandler.sync(this);
				switch ( this._interp.adaptivePredict(this._input, 90, this._ctx) ) {
				case 1:
					{
					this.state = 700;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===1) {
						{
						{
						this.state = 697;
						this.mediaAnd();
						}
						}
						this.state = 702;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					}
					break;
				case 2:
					{
					this.state = 706;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===2) {
						{
						{
						this.state = 703;
						this.mediaOr();
						}
						}
						this.state = 708;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					}
					break;
				}
				}
				}
				break;
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public mediaConditionWithoutOr(): MediaConditionWithoutOrContext {
		let localctx: MediaConditionWithoutOrContext = new MediaConditionWithoutOrContext(this, this._ctx, this.state);
		this.enterRule(localctx, 72, CssParser.RULE_mediaConditionWithoutOr);
		let _la: number;
		try {
			let _alt: number;
			this.state = 727;
			this._errHandler.sync(this);
			switch ( this._interp.adaptivePredict(this._input, 94, this._ctx) ) {
			case 1:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 713;
				this.mediaNot();
				}
				break;
			case 2:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 714;
				this.mediaInParens();
				this.state = 724;
				this._errHandler.sync(this);
				_alt = this._interp.adaptivePredict(this._input, 93, this._ctx);
				while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
					if (_alt === 1) {
						{
						{
						this.state = 718;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
						while (_la===78) {
							{
							{
							this.state = 715;
							this.match(CssParser.WS);
							}
							}
							this.state = 720;
							this._errHandler.sync(this);
							_la = this._input.LA(1);
						}
						this.state = 721;
						this.mediaAnd();
						}
						}
					}
					this.state = 726;
					this._errHandler.sync(this);
					_alt = this._interp.adaptivePredict(this._input, 93, this._ctx);
				}
				}
				break;
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public mediaNot(): MediaNotContext {
		let localctx: MediaNotContext = new MediaNotContext(this, this._ctx, this.state);
		this.enterRule(localctx, 74, CssParser.RULE_mediaNot);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 729;
			this.match(CssParser.NOT);
			this.state = 733;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===78) {
				{
				{
				this.state = 730;
				this.match(CssParser.WS);
				}
				}
				this.state = 735;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 736;
			this.mediaInParens();
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public mediaAnd(): MediaAndContext {
		let localctx: MediaAndContext = new MediaAndContext(this, this._ctx, this.state);
		this.enterRule(localctx, 76, CssParser.RULE_mediaAnd);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 738;
			this.match(CssParser.AND);
			this.state = 742;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===78) {
				{
				{
				this.state = 739;
				this.match(CssParser.WS);
				}
				}
				this.state = 744;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 745;
			this.mediaInParens();
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public mediaOr(): MediaOrContext {
		let localctx: MediaOrContext = new MediaOrContext(this, this._ctx, this.state);
		this.enterRule(localctx, 78, CssParser.RULE_mediaOr);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 747;
			this.match(CssParser.OR);
			this.state = 751;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===78) {
				{
				{
				this.state = 748;
				this.match(CssParser.WS);
				}
				}
				this.state = 753;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 754;
			this.mediaInParens();
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public mediaInParens(): MediaInParensContext {
		let localctx: MediaInParensContext = new MediaInParensContext(this, this._ctx, this.state);
		this.enterRule(localctx, 80, CssParser.RULE_mediaInParens);
		let _la: number;
		try {
			this.state = 776;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 48:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 756;
				this.match(CssParser.LPAREN);
				this.state = 760;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 757;
					this.match(CssParser.WS);
					}
					}
					this.state = 762;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 765;
				this._errHandler.sync(this);
				switch ( this._interp.adaptivePredict(this._input, 99, this._ctx) ) {
				case 1:
					{
					this.state = 763;
					this.mediaCondition();
					}
					break;
				case 2:
					{
					this.state = 764;
					this.mediaFeature();
					}
					break;
				}
				this.state = 770;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 767;
					this.match(CssParser.WS);
					}
					}
					this.state = 772;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 773;
				this.match(CssParser.RPAREN);
				}
				break;
			case 1:
			case 2:
			case 3:
			case 4:
			case 5:
			case 6:
			case 7:
			case 9:
			case 25:
			case 68:
			case 70:
			case 71:
			case 72:
			case 73:
			case 74:
			case 75:
			case 82:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 775;
				this.generalEnclosed();
				}
				break;
			default:
				throw new NoViableAltException(this);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public mediaFeature(): MediaFeatureContext {
		let localctx: MediaFeatureContext = new MediaFeatureContext(this, this._ctx, this.state);
		this.enterRule(localctx, 82, CssParser.RULE_mediaFeature);
		let _la: number;
		try {
			this.state = 826;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 1:
			case 2:
			case 3:
			case 4:
			case 5:
			case 6:
			case 7:
			case 9:
			case 25:
			case 72:
			case 73:
			case 74:
			case 75:
			case 82:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 778;
				this.identifier();
				this.state = 805;
				this._errHandler.sync(this);
				switch ( this._interp.adaptivePredict(this._input, 106, this._ctx) ) {
				case 1:
					{
					this.state = 782;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 779;
						this.match(CssParser.WS);
						}
						}
						this.state = 784;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 803;
					this._errHandler.sync(this);
					switch ( this._interp.adaptivePredict(this._input, 105, this._ctx) ) {
					case 1:
						{
						this.state = 785;
						this.match(CssParser.COLON);
						this.state = 789;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
						while (_la===78) {
							{
							{
							this.state = 786;
							this.match(CssParser.WS);
							}
							}
							this.state = 791;
							this._errHandler.sync(this);
							_la = this._input.LA(1);
						}
						this.state = 792;
						this.mfValue();
						}
						break;
					case 2:
						{
						this.state = 793;
						this.mediaRange();
						}
						break;
					case 3:
						{
						this.state = 794;
						this.mfComparison();
						this.state = 798;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
						while (_la===78) {
							{
							{
							this.state = 795;
							this.match(CssParser.WS);
							}
							}
							this.state = 800;
							this._errHandler.sync(this);
							_la = this._input.LA(1);
						}
						this.state = 801;
						this.mfNonIdentifierValue();
						}
						break;
					}
					}
					break;
				}
				}
				break;
			case 10:
			case 11:
			case 12:
			case 13:
			case 14:
			case 15:
			case 16:
			case 17:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 807;
				this.mfNonIdentifierValue();
				this.state = 811;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 808;
					this.match(CssParser.WS);
					}
					}
					this.state = 813;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 824;
				this._errHandler.sync(this);
				switch ( this._interp.adaptivePredict(this._input, 109, this._ctx) ) {
				case 1:
					{
					this.state = 814;
					this.mfComparison();
					this.state = 818;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 815;
						this.match(CssParser.WS);
						}
						}
						this.state = 820;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 821;
					this.identifier();
					}
					break;
				case 2:
					{
					this.state = 823;
					this.mediaRange();
					}
					break;
				}
				}
				break;
			default:
				throw new NoViableAltException(this);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public mediaRange(): MediaRangeContext {
		let localctx: MediaRangeContext = new MediaRangeContext(this, this._ctx, this.state);
		this.enterRule(localctx, 84, CssParser.RULE_mediaRange);
		let _la: number;
		try {
			this.state = 878;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 32:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 828;
				this.mfLt();
				this.state = 832;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 829;
					this.match(CssParser.WS);
					}
					}
					this.state = 834;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 835;
				this.identifier();
				this.state = 851;
				this._errHandler.sync(this);
				switch ( this._interp.adaptivePredict(this._input, 114, this._ctx) ) {
				case 1:
					{
					this.state = 839;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 836;
						this.match(CssParser.WS);
						}
						}
						this.state = 841;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 842;
					this.mfLt();
					this.state = 846;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 843;
						this.match(CssParser.WS);
						}
						}
						this.state = 848;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 849;
					this.mfValue();
					}
					break;
				}
				}
				break;
			case 31:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 853;
				this.mfGt();
				this.state = 857;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 854;
					this.match(CssParser.WS);
					}
					}
					this.state = 859;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 860;
				this.identifier();
				this.state = 876;
				this._errHandler.sync(this);
				switch ( this._interp.adaptivePredict(this._input, 118, this._ctx) ) {
				case 1:
					{
					this.state = 864;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 861;
						this.match(CssParser.WS);
						}
						}
						this.state = 866;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 867;
					this.mfGt();
					this.state = 871;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 868;
						this.match(CssParser.WS);
						}
						}
						this.state = 873;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 874;
					this.mfValue();
					}
					break;
				}
				}
				break;
			default:
				throw new NoViableAltException(this);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public mfNonIdentifierValue(): MfNonIdentifierValueContext {
		let localctx: MfNonIdentifierValueContext = new MfNonIdentifierValueContext(this, this._ctx, this.state);
		this.enterRule(localctx, 86, CssParser.RULE_mfNonIdentifierValue);
		let _la: number;
		try {
			this.state = 898;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 10:
			case 11:
			case 12:
			case 13:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 880;
				this.number_();
				this.state = 895;
				this._errHandler.sync(this);
				switch ( this._interp.adaptivePredict(this._input, 122, this._ctx) ) {
				case 1:
					{
					this.state = 884;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 881;
						this.match(CssParser.WS);
						}
						}
						this.state = 886;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 887;
					this.match(CssParser.SLASH);
					this.state = 891;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 888;
						this.match(CssParser.WS);
						}
						}
						this.state = 893;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 894;
					this.number_();
					}
					break;
				}
				}
				break;
			case 14:
			case 15:
			case 16:
			case 17:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 897;
				this.dimension();
				}
				break;
			default:
				throw new NoViableAltException(this);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public mfValue(): MfValueContext {
		let localctx: MfValueContext = new MfValueContext(this, this._ctx, this.state);
		this.enterRule(localctx, 88, CssParser.RULE_mfValue);
		try {
			this.state = 902;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 10:
			case 11:
			case 12:
			case 13:
			case 14:
			case 15:
			case 16:
			case 17:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 900;
				this.mfNonIdentifierValue();
				}
				break;
			case 1:
			case 2:
			case 3:
			case 4:
			case 5:
			case 6:
			case 7:
			case 9:
			case 25:
			case 72:
			case 73:
			case 74:
			case 75:
			case 82:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 901;
				this.identifier();
				}
				break;
			default:
				throw new NoViableAltException(this);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public mfLt(): MfLtContext {
		let localctx: MfLtContext = new MfLtContext(this, this._ctx, this.state);
		this.enterRule(localctx, 90, CssParser.RULE_mfLt);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 904;
			this.match(CssParser.LT);
			this.state = 906;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===35) {
				{
				this.state = 905;
				this.match(CssParser.EQ);
				}
			}

			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public mfGt(): MfGtContext {
		let localctx: MfGtContext = new MfGtContext(this, this._ctx, this.state);
		this.enterRule(localctx, 92, CssParser.RULE_mfGt);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 908;
			this.match(CssParser.GT);
			this.state = 910;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===35) {
				{
				this.state = 909;
				this.match(CssParser.EQ);
				}
			}

			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public mfEq(): MfEqContext {
		let localctx: MfEqContext = new MfEqContext(this, this._ctx, this.state);
		this.enterRule(localctx, 94, CssParser.RULE_mfEq);
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 912;
			this.match(CssParser.EQ);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public mfComparison(): MfComparisonContext {
		let localctx: MfComparisonContext = new MfComparisonContext(this, this._ctx, this.state);
		this.enterRule(localctx, 96, CssParser.RULE_mfComparison);
		try {
			this.state = 917;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 32:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 914;
				this.mfLt();
				}
				break;
			case 31:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 915;
				this.mfGt();
				}
				break;
			case 35:
				this.enterOuterAlt(localctx, 3);
				{
				this.state = 916;
				this.mfEq();
				}
				break;
			default:
				throw new NoViableAltException(this);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public generalEnclosed(): GeneralEnclosedContext {
		let localctx: GeneralEnclosedContext = new GeneralEnclosedContext(this, this._ctx, this.state);
		this.enterRule(localctx, 98, CssParser.RULE_generalEnclosed);
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 919;
			this.function_();
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public ratio(): RatioContext {
		let localctx: RatioContext = new RatioContext(this, this._ctx, this.state);
		this.enterRule(localctx, 100, CssParser.RULE_ratio);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 921;
			this.number_();
			this.state = 925;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===78) {
				{
				{
				this.state = 922;
				this.match(CssParser.WS);
				}
				}
				this.state = 927;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 928;
			this.match(CssParser.SLASH);
			this.state = 932;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===78) {
				{
				{
				this.state = 929;
				this.match(CssParser.WS);
				}
				}
				this.state = 934;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 935;
			this.number_();
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public pageAtRule(): PageAtRuleContext {
		let localctx: PageAtRuleContext = new PageAtRuleContext(this, this._ctx, this.state);
		this.enterRule(localctx, 102, CssParser.RULE_pageAtRule);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 937;
			this.match(CssParser.PAGE_RULE);
			this.state = 941;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===78) {
				{
				{
				this.state = 938;
				this.match(CssParser.WS);
				}
				}
				this.state = 943;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 951;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===27) {
				{
				this.state = 944;
				this.match(CssParser.PAGE_PSEUDO_CLASS);
				this.state = 948;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 945;
					this.match(CssParser.WS);
					}
					}
					this.state = 950;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				}
			}

			this.state = 953;
			this.match(CssParser.LCURLY);
			this.state = 954;
			this.declarationList();
			this.state = 955;
			this.match(CssParser.RCURLY);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public fontFaceAtRule(): FontFaceAtRuleContext {
		let localctx: FontFaceAtRuleContext = new FontFaceAtRuleContext(this, this._ctx, this.state);
		this.enterRule(localctx, 104, CssParser.RULE_fontFaceAtRule);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 957;
			this.match(CssParser.FONT_FACE_RULE);
			this.state = 961;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===78) {
				{
				{
				this.state = 958;
				this.match(CssParser.WS);
				}
				}
				this.state = 963;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 964;
			this.match(CssParser.LCURLY);
			this.state = 965;
			this.declarationList();
			this.state = 966;
			this.match(CssParser.RCURLY);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public supportsAtRule(): SupportsAtRuleContext {
		let localctx: SupportsAtRuleContext = new SupportsAtRuleContext(this, this._ctx, this.state);
		this.enterRule(localctx, 106, CssParser.RULE_supportsAtRule);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 968;
			this.match(CssParser.SUPPORTS_RULE);
			this.state = 972;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===78) {
				{
				{
				this.state = 969;
				this.match(CssParser.WS);
				}
				}
				this.state = 974;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 975;
			this.supportsCondition();
			this.state = 979;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===78) {
				{
				{
				this.state = 976;
				this.match(CssParser.WS);
				}
				}
				this.state = 981;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 982;
			this.match(CssParser.LCURLY);
			this.state = 983;
			this.main();
			this.state = 984;
			this.match(CssParser.RCURLY);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public supportsCondition(): SupportsConditionContext {
		let localctx: SupportsConditionContext = new SupportsConditionContext(this, this._ctx, this.state);
		this.enterRule(localctx, 108, CssParser.RULE_supportsCondition);
		let _la: number;
		try {
			let _alt: number;
			this.state = 1016;
			this._errHandler.sync(this);
			switch ( this._interp.adaptivePredict(this._input, 140, this._ctx) ) {
			case 1:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 986;
				this.match(CssParser.NOT);
				this.state = 987;
				this.supportsInParens();
				}
				break;
			case 2:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 988;
				this.supportsInParens();
				this.state = 999;
				this._errHandler.sync(this);
				_alt = this._interp.adaptivePredict(this._input, 137, this._ctx);
				while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
					if (_alt === 1) {
						{
						{
						this.state = 992;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
						while (_la===78) {
							{
							{
							this.state = 989;
							this.match(CssParser.WS);
							}
							}
							this.state = 994;
							this._errHandler.sync(this);
							_la = this._input.LA(1);
						}
						this.state = 995;
						this.match(CssParser.AND);
						this.state = 996;
						this.supportsInParens();
						}
						}
					}
					this.state = 1001;
					this._errHandler.sync(this);
					_alt = this._interp.adaptivePredict(this._input, 137, this._ctx);
				}
				}
				break;
			case 3:
				this.enterOuterAlt(localctx, 3);
				{
				this.state = 1002;
				this.supportsInParens();
				this.state = 1013;
				this._errHandler.sync(this);
				_alt = this._interp.adaptivePredict(this._input, 139, this._ctx);
				while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
					if (_alt === 1) {
						{
						{
						this.state = 1006;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
						while (_la===78) {
							{
							{
							this.state = 1003;
							this.match(CssParser.WS);
							}
							}
							this.state = 1008;
							this._errHandler.sync(this);
							_la = this._input.LA(1);
						}
						this.state = 1009;
						this.match(CssParser.OR);
						this.state = 1010;
						this.supportsInParens();
						}
						}
					}
					this.state = 1015;
					this._errHandler.sync(this);
					_alt = this._interp.adaptivePredict(this._input, 139, this._ctx);
				}
				}
				break;
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public supportsInParens(): SupportsInParensContext {
		let localctx: SupportsInParensContext = new SupportsInParensContext(this, this._ctx, this.state);
		this.enterRule(localctx, 110, CssParser.RULE_supportsInParens);
		let _la: number;
		try {
			this.state = 1051;
			this._errHandler.sync(this);
			switch ( this._interp.adaptivePredict(this._input, 145, this._ctx) ) {
			case 1:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 1018;
				this.match(CssParser.LPAREN);
				this.state = 1022;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 1019;
					this.match(CssParser.WS);
					}
					}
					this.state = 1024;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 1025;
				this.supportsCondition();
				this.state = 1029;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 1026;
					this.match(CssParser.WS);
					}
					}
					this.state = 1031;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 1032;
				this.match(CssParser.RPAREN);
				}
				break;
			case 2:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 1034;
				this.match(CssParser.LPAREN);
				this.state = 1038;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 1035;
					this.match(CssParser.WS);
					}
					}
					this.state = 1040;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 1041;
				this.declaration();
				this.state = 1045;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 1042;
					this.match(CssParser.WS);
					}
					}
					this.state = 1047;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 1048;
				this.match(CssParser.RPAREN);
				}
				break;
			case 3:
				this.enterOuterAlt(localctx, 3);
				{
				this.state = 1050;
				this.generalEnclosed();
				}
				break;
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public importAtRule(): ImportAtRuleContext {
		let localctx: ImportAtRuleContext = new ImportAtRuleContext(this, this._ctx, this.state);
		this.enterRule(localctx, 112, CssParser.RULE_importAtRule);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 1053;
			this.match(CssParser.IMPORT_RULE);
			this.state = 1057;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===78) {
				{
				{
				this.state = 1054;
				this.match(CssParser.WS);
				}
				}
				this.state = 1059;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 1060;
			_la = this._input.LA(1);
			if(!(_la===54 || _la===68)) {
			this._errHandler.recoverInline(this);
			}
			else {
				this._errHandler.reportMatch(this);
			    this.consume();
			}
			this.state = 1078;
			this._errHandler.sync(this);
			switch ( this._interp.adaptivePredict(this._input, 150, this._ctx) ) {
			case 1:
				{
				this.state = 1064;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 1061;
					this.match(CssParser.WS);
					}
					}
					this.state = 1066;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 1067;
				this.match(CssParser.SUPPORTS_FUNCTION);
				this.state = 1071;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 1068;
					this.match(CssParser.WS);
					}
					}
					this.state = 1073;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 1076;
				this._errHandler.sync(this);
				switch ( this._interp.adaptivePredict(this._input, 149, this._ctx) ) {
				case 1:
					{
					this.state = 1074;
					this.supportsCondition();
					}
					break;
				case 2:
					{
					this.state = 1075;
					this.declaration();
					}
					break;
				}
				}
				break;
			}
			this.state = 1087;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if ((((_la) & ~0x1F) === 0 && ((1 << _la) & 33555198) !== 0) || ((((_la - 48)) & ~0x1F) === 0 && ((1 << (_la - 48)) & 1339031553) !== 0) || _la===82) {
				{
				this.state = 1083;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 1080;
					this.match(CssParser.WS);
					}
					}
					this.state = 1085;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 1086;
				this.mediaQuery();
				}
			}

			this.state = 1089;
			this.match(CssParser.SEMI);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public unknownAtRule(): UnknownAtRuleContext {
		let localctx: UnknownAtRuleContext = new UnknownAtRuleContext(this, this._ctx, this.state);
		this.enterRule(localctx, 114, CssParser.RULE_unknownAtRule);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 1091;
			this.match(CssParser.AT_RULE);
			this.state = 1095;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while ((((_la) & ~0x1F) === 0 && ((1 << _la) & 48496382) !== 0) || ((((_la - 35)) & ~0x1F) === 0 && ((1 << (_la - 35)) & 958593) !== 0) || ((((_la - 67)) & ~0x1F) === 0 && ((1 << (_la - 67)) & 100859) !== 0)) {
				{
				{
				this.state = 1092;
				this.anyOuterValue();
				}
				}
				this.state = 1097;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 1107;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 45:
				{
				this.state = 1098;
				this.match(CssParser.SEMI);
				}
				break;
			case 46:
				{
				this.state = 1099;
				this.match(CssParser.LCURLY);
				this.state = 1103;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while ((((_la) & ~0x1F) === 0 && ((1 << _la) & 132382462) !== 0) || ((((_la - 35)) & ~0x1F) === 0 && ((1 << (_la - 35)) & 961665) !== 0) || ((((_la - 67)) & ~0x1F) === 0 && ((1 << (_la - 67)) & 100859) !== 0)) {
					{
					{
					this.state = 1100;
					this.anyInnerValue();
					}
					}
					this.state = 1105;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 1106;
				this.match(CssParser.RCURLY);
				}
				break;
			default:
				throw new NoViableAltException(this);
			}
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public identifier(): IdentifierContext {
		let localctx: IdentifierContext = new IdentifierContext(this, this._ctx, this.state);
		this.enterRule(localctx, 116, CssParser.RULE_identifier);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 1109;
			_la = this._input.LA(1);
			if(!((((_la) & ~0x1F) === 0 && ((1 << _la) & 33555198) !== 0) || ((((_la - 72)) & ~0x1F) === 0 && ((1 << (_la - 72)) & 1039) !== 0))) {
			this._errHandler.recoverInline(this);
			}
			else {
				this._errHandler.reportMatch(this);
			    this.consume();
			}
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public anyOuterValue(): AnyOuterValueContext {
		let localctx: AnyOuterValueContext = new AnyOuterValueContext(this, this._ctx, this.state);
		this.enterRule(localctx, 118, CssParser.RULE_anyOuterValue);
		let _la: number;
		try {
			this.state = 1129;
			this._errHandler.sync(this);
			switch ( this._interp.adaptivePredict(this._input, 158, this._ctx) ) {
			case 1:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 1111;
				this.value();
				}
				break;
			case 2:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 1112;
				this.match(CssParser.COMMA);
				}
				break;
			case 3:
				this.enterOuterAlt(localctx, 3);
				{
				this.state = 1113;
				this.match(CssParser.LPAREN);
				this.state = 1117;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while ((((_la) & ~0x1F) === 0 && ((1 << _la) & 132382462) !== 0) || ((((_la - 35)) & ~0x1F) === 0 && ((1 << (_la - 35)) & 961665) !== 0) || ((((_la - 67)) & ~0x1F) === 0 && ((1 << (_la - 67)) & 100859) !== 0)) {
					{
					{
					this.state = 1114;
					this.anyInnerValue();
					}
					}
					this.state = 1119;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 1120;
				this.match(CssParser.RPAREN);
				}
				break;
			case 4:
				this.enterOuterAlt(localctx, 4);
				{
				this.state = 1121;
				this.match(CssParser.LSQUARE);
				this.state = 1125;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while ((((_la) & ~0x1F) === 0 && ((1 << _la) & 132382462) !== 0) || ((((_la - 35)) & ~0x1F) === 0 && ((1 << (_la - 35)) & 961665) !== 0) || ((((_la - 67)) & ~0x1F) === 0 && ((1 << (_la - 67)) & 100859) !== 0)) {
					{
					{
					this.state = 1122;
					this.anyInnerValue();
					}
					}
					this.state = 1127;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 1128;
				this.match(CssParser.RSQUARE);
				}
				break;
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}
	// @RuleVersion(0)
	public anyInnerValue(): AnyInnerValueContext {
		let localctx: AnyInnerValueContext = new AnyInnerValueContext(this, this._ctx, this.state);
		this.enterRule(localctx, 120, CssParser.RULE_anyInnerValue);
		let _la: number;
		try {
			this.state = 1143;
			this._errHandler.sync(this);
			switch ( this._interp.adaptivePredict(this._input, 160, this._ctx) ) {
			case 1:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 1131;
				this.anyOuterValue();
				}
				break;
			case 2:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 1132;
				this.match(CssParser.LCURLY);
				this.state = 1136;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while ((((_la) & ~0x1F) === 0 && ((1 << _la) & 132382462) !== 0) || ((((_la - 35)) & ~0x1F) === 0 && ((1 << (_la - 35)) & 961665) !== 0) || ((((_la - 67)) & ~0x1F) === 0 && ((1 << (_la - 67)) & 100859) !== 0)) {
					{
					{
					this.state = 1133;
					this.anyInnerValue();
					}
					}
					this.state = 1138;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 1139;
				this.match(CssParser.RCURLY);
				}
				break;
			case 3:
				this.enterOuterAlt(localctx, 3);
				{
				this.state = 1140;
				this.match(CssParser.ID);
				}
				break;
			case 4:
				this.enterOuterAlt(localctx, 4);
				{
				this.state = 1141;
				this.match(CssParser.SEMI);
				}
				break;
			case 5:
				this.enterOuterAlt(localctx, 5);
				{
				this.state = 1142;
				this.pseudoSelector();
				}
				break;
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return localctx;
	}

	public static readonly _serializedATN: number[] = [4,1,84,1146,2,0,7,0,
	2,1,7,1,2,2,7,2,2,3,7,3,2,4,7,4,2,5,7,5,2,6,7,6,2,7,7,7,2,8,7,8,2,9,7,9,
	2,10,7,10,2,11,7,11,2,12,7,12,2,13,7,13,2,14,7,14,2,15,7,15,2,16,7,16,2,
	17,7,17,2,18,7,18,2,19,7,19,2,20,7,20,2,21,7,21,2,22,7,22,2,23,7,23,2,24,
	7,24,2,25,7,25,2,26,7,26,2,27,7,27,2,28,7,28,2,29,7,29,2,30,7,30,2,31,7,
	31,2,32,7,32,2,33,7,33,2,34,7,34,2,35,7,35,2,36,7,36,2,37,7,37,2,38,7,38,
	2,39,7,39,2,40,7,40,2,41,7,41,2,42,7,42,2,43,7,43,2,44,7,44,2,45,7,45,2,
	46,7,46,2,47,7,47,2,48,7,48,2,49,7,49,2,50,7,50,2,51,7,51,2,52,7,52,2,53,
	7,53,2,54,7,54,2,55,7,55,2,56,7,56,2,57,7,57,2,58,7,58,2,59,7,59,2,60,7,
	60,1,0,3,0,124,8,0,1,0,1,0,1,0,1,1,1,1,1,1,5,1,132,8,1,10,1,12,1,135,9,
	1,1,2,1,2,5,2,139,8,2,10,2,12,2,142,9,2,1,2,1,2,1,2,1,2,1,3,1,3,5,3,150,
	8,3,10,3,12,3,153,9,3,1,3,1,3,1,3,1,3,1,4,1,4,1,4,1,4,1,4,1,4,1,4,1,4,3,
	4,167,8,4,1,5,1,5,1,5,1,6,1,6,1,6,5,6,175,8,6,10,6,12,6,178,9,6,1,6,1,6,
	5,6,182,8,6,10,6,12,6,185,9,6,1,6,1,6,1,6,1,6,1,6,5,6,192,8,6,10,6,12,6,
	195,9,6,1,6,1,6,5,6,199,8,6,10,6,12,6,202,9,6,1,6,1,6,1,6,1,6,3,6,208,8,
	6,1,6,1,6,1,6,5,6,213,8,6,10,6,12,6,216,9,6,1,6,3,6,219,8,6,3,6,221,8,6,
	1,7,1,7,1,7,1,7,1,7,3,7,228,8,7,1,7,1,7,1,7,4,7,233,8,7,11,7,12,7,234,1,
	7,3,7,238,8,7,1,7,5,7,241,8,7,10,7,12,7,244,9,7,1,7,1,7,5,7,248,8,7,10,
	7,12,7,251,9,7,1,7,3,7,254,8,7,3,7,256,8,7,1,8,1,8,5,8,260,8,8,10,8,12,
	8,263,9,8,1,8,1,8,3,8,267,8,8,1,8,1,8,5,8,271,8,8,10,8,12,8,274,9,8,1,8,
	1,8,3,8,278,8,8,1,8,5,8,281,8,8,10,8,12,8,284,9,8,1,8,1,8,5,8,288,8,8,10,
	8,12,8,291,9,8,3,8,293,8,8,1,8,1,8,1,9,4,9,298,8,9,11,9,12,9,299,1,10,1,
	10,5,10,304,8,10,10,10,12,10,307,9,10,1,10,1,10,5,10,311,8,10,10,10,12,
	10,314,9,10,3,10,316,8,10,1,10,5,10,319,8,10,10,10,12,10,322,9,10,1,11,
	1,11,1,12,1,12,5,12,328,8,12,10,12,12,12,331,9,12,3,12,333,8,12,1,12,1,
	12,1,13,1,13,5,13,339,8,13,10,13,12,13,342,9,13,1,13,1,13,5,13,346,8,13,
	10,13,12,13,349,9,13,1,13,5,13,352,8,13,10,13,12,13,355,9,13,1,14,1,14,
	5,14,359,8,14,10,14,12,14,362,9,14,1,14,1,14,5,14,366,8,14,10,14,12,14,
	369,9,14,1,14,5,14,372,8,14,10,14,12,14,375,9,14,1,15,5,15,378,8,15,10,
	15,12,15,381,9,15,1,15,3,15,384,8,15,1,15,5,15,387,8,15,10,15,12,15,390,
	9,15,1,15,1,15,5,15,394,8,15,10,15,12,15,397,9,15,1,15,1,15,1,15,1,15,1,
	15,1,15,3,15,405,8,15,1,16,1,16,5,16,409,8,16,10,16,12,16,412,9,16,1,16,
	1,16,5,16,416,8,16,10,16,12,16,419,9,16,1,16,1,16,5,16,423,8,16,10,16,12,
	16,426,9,16,1,16,3,16,429,8,16,1,16,1,16,5,16,433,8,16,10,16,12,16,436,
	9,16,1,16,1,16,5,16,440,8,16,10,16,12,16,443,9,16,3,16,445,8,16,1,17,4,
	17,448,8,17,11,17,12,17,449,1,17,1,17,4,17,454,8,17,11,17,12,17,455,5,17,
	458,8,17,10,17,12,17,461,9,17,1,18,1,18,1,18,1,18,1,18,1,18,1,18,1,18,1,
	18,1,18,1,18,1,18,1,18,1,18,3,18,477,8,18,1,19,1,19,1,20,1,20,5,20,483,
	8,20,10,20,12,20,486,9,20,1,20,1,20,5,20,490,8,20,10,20,12,20,493,9,20,
	1,20,5,20,496,8,20,10,20,12,20,499,9,20,1,21,1,21,5,21,503,8,21,10,21,12,
	21,506,9,21,1,21,1,21,5,21,510,8,21,10,21,12,21,513,9,21,1,21,5,21,516,
	8,21,10,21,12,21,519,9,21,1,22,1,22,1,22,1,22,1,22,1,22,5,22,527,8,22,10,
	22,12,22,530,9,22,1,22,1,22,5,22,534,8,22,10,22,12,22,537,9,22,1,22,1,22,
	3,22,541,8,22,1,23,1,23,1,23,3,23,546,8,23,1,23,1,23,3,23,550,8,23,1,24,
	1,24,1,24,1,24,5,24,556,8,24,10,24,12,24,559,9,24,1,24,1,24,5,24,563,8,
	24,10,24,12,24,566,9,24,1,24,1,24,5,24,570,8,24,10,24,12,24,573,9,24,1,
	24,3,24,576,8,24,1,24,1,24,1,24,1,24,5,24,582,8,24,10,24,12,24,585,9,24,
	1,24,1,24,5,24,589,8,24,10,24,12,24,592,9,24,1,24,1,24,1,24,1,24,1,24,1,
	24,1,24,3,24,601,8,24,1,25,1,25,1,26,1,26,1,27,1,27,1,28,1,28,1,29,1,29,
	1,29,1,29,1,29,1,29,3,29,617,8,29,1,30,1,30,3,30,621,8,30,1,31,1,31,5,31,
	625,8,31,10,31,12,31,628,9,31,1,31,1,31,5,31,632,8,31,10,31,12,31,635,9,
	31,1,31,1,31,1,31,1,31,1,32,1,32,5,32,643,8,32,10,32,12,32,646,9,32,1,32,
	1,32,5,32,650,8,32,10,32,12,32,653,9,32,1,32,1,32,1,32,1,32,1,33,1,33,1,
	33,5,33,662,8,33,10,33,12,33,665,9,33,3,33,667,8,33,1,33,1,33,5,33,671,
	8,33,10,33,12,33,674,9,33,1,33,1,33,5,33,678,8,33,10,33,12,33,681,9,33,
	1,33,3,33,684,8,33,3,33,686,8,33,1,34,1,34,1,35,1,35,1,35,5,35,693,8,35,
	10,35,12,35,696,9,35,1,35,5,35,699,8,35,10,35,12,35,702,9,35,1,35,5,35,
	705,8,35,10,35,12,35,708,9,35,3,35,710,8,35,3,35,712,8,35,1,36,1,36,1,36,
	5,36,717,8,36,10,36,12,36,720,9,36,1,36,5,36,723,8,36,10,36,12,36,726,9,
	36,3,36,728,8,36,1,37,1,37,5,37,732,8,37,10,37,12,37,735,9,37,1,37,1,37,
	1,38,1,38,5,38,741,8,38,10,38,12,38,744,9,38,1,38,1,38,1,39,1,39,5,39,750,
	8,39,10,39,12,39,753,9,39,1,39,1,39,1,40,1,40,5,40,759,8,40,10,40,12,40,
	762,9,40,1,40,1,40,3,40,766,8,40,1,40,5,40,769,8,40,10,40,12,40,772,9,40,
	1,40,1,40,1,40,3,40,777,8,40,1,41,1,41,5,41,781,8,41,10,41,12,41,784,9,
	41,1,41,1,41,5,41,788,8,41,10,41,12,41,791,9,41,1,41,1,41,1,41,1,41,5,41,
	797,8,41,10,41,12,41,800,9,41,1,41,1,41,3,41,804,8,41,3,41,806,8,41,1,41,
	1,41,5,41,810,8,41,10,41,12,41,813,9,41,1,41,1,41,5,41,817,8,41,10,41,12,
	41,820,9,41,1,41,1,41,1,41,3,41,825,8,41,3,41,827,8,41,1,42,1,42,5,42,831,
	8,42,10,42,12,42,834,9,42,1,42,1,42,5,42,838,8,42,10,42,12,42,841,9,42,
	1,42,1,42,5,42,845,8,42,10,42,12,42,848,9,42,1,42,1,42,3,42,852,8,42,1,
	42,1,42,5,42,856,8,42,10,42,12,42,859,9,42,1,42,1,42,5,42,863,8,42,10,42,
	12,42,866,9,42,1,42,1,42,5,42,870,8,42,10,42,12,42,873,9,42,1,42,1,42,3,
	42,877,8,42,3,42,879,8,42,1,43,1,43,5,43,883,8,43,10,43,12,43,886,9,43,
	1,43,1,43,5,43,890,8,43,10,43,12,43,893,9,43,1,43,3,43,896,8,43,1,43,3,
	43,899,8,43,1,44,1,44,3,44,903,8,44,1,45,1,45,3,45,907,8,45,1,46,1,46,3,
	46,911,8,46,1,47,1,47,1,48,1,48,1,48,3,48,918,8,48,1,49,1,49,1,50,1,50,
	5,50,924,8,50,10,50,12,50,927,9,50,1,50,1,50,5,50,931,8,50,10,50,12,50,
	934,9,50,1,50,1,50,1,51,1,51,5,51,940,8,51,10,51,12,51,943,9,51,1,51,1,
	51,5,51,947,8,51,10,51,12,51,950,9,51,3,51,952,8,51,1,51,1,51,1,51,1,51,
	1,52,1,52,5,52,960,8,52,10,52,12,52,963,9,52,1,52,1,52,1,52,1,52,1,53,1,
	53,5,53,971,8,53,10,53,12,53,974,9,53,1,53,1,53,5,53,978,8,53,10,53,12,
	53,981,9,53,1,53,1,53,1,53,1,53,1,54,1,54,1,54,1,54,5,54,991,8,54,10,54,
	12,54,994,9,54,1,54,1,54,5,54,998,8,54,10,54,12,54,1001,9,54,1,54,1,54,
	5,54,1005,8,54,10,54,12,54,1008,9,54,1,54,1,54,5,54,1012,8,54,10,54,12,
	54,1015,9,54,3,54,1017,8,54,1,55,1,55,5,55,1021,8,55,10,55,12,55,1024,9,
	55,1,55,1,55,5,55,1028,8,55,10,55,12,55,1031,9,55,1,55,1,55,1,55,1,55,5,
	55,1037,8,55,10,55,12,55,1040,9,55,1,55,1,55,5,55,1044,8,55,10,55,12,55,
	1047,9,55,1,55,1,55,1,55,3,55,1052,8,55,1,56,1,56,5,56,1056,8,56,10,56,
	12,56,1059,9,56,1,56,1,56,5,56,1063,8,56,10,56,12,56,1066,9,56,1,56,1,56,
	5,56,1070,8,56,10,56,12,56,1073,9,56,1,56,1,56,3,56,1077,8,56,3,56,1079,
	8,56,1,56,5,56,1082,8,56,10,56,12,56,1085,9,56,1,56,3,56,1088,8,56,1,56,
	1,56,1,57,1,57,5,57,1094,8,57,10,57,12,57,1097,9,57,1,57,1,57,1,57,5,57,
	1102,8,57,10,57,12,57,1105,9,57,1,57,3,57,1108,8,57,1,58,1,58,1,59,1,59,
	1,59,1,59,5,59,1116,8,59,10,59,12,59,1119,9,59,1,59,1,59,1,59,5,59,1124,
	8,59,10,59,12,59,1127,9,59,1,59,3,59,1130,8,59,1,60,1,60,1,60,5,60,1135,
	8,60,10,60,12,60,1138,9,60,1,60,1,60,1,60,1,60,3,60,1144,8,60,1,60,0,0,
	61,0,2,4,6,8,10,12,14,16,18,20,22,24,26,28,30,32,34,36,38,40,42,44,46,48,
	50,52,54,56,58,60,62,64,66,68,70,72,74,76,78,80,82,84,86,88,90,92,94,96,
	98,100,102,104,106,108,110,112,114,116,118,120,0,14,3,0,28,28,30,30,39,
	41,3,0,30,31,36,36,38,38,2,0,29,29,52,52,6,0,23,23,35,35,42,42,53,53,67,
	67,83,83,1,0,36,37,1,0,28,29,1,0,10,11,1,0,10,13,1,0,14,17,1,0,18,19,1,
	0,3,4,2,0,5,7,82,82,2,0,54,54,68,68,5,0,1,7,9,9,25,25,72,75,82,82,1286,
	0,123,1,0,0,0,2,133,1,0,0,0,4,136,1,0,0,0,6,147,1,0,0,0,8,166,1,0,0,0,10,
	168,1,0,0,0,12,220,1,0,0,0,14,255,1,0,0,0,16,257,1,0,0,0,18,297,1,0,0,0,
	20,301,1,0,0,0,22,323,1,0,0,0,24,332,1,0,0,0,26,336,1,0,0,0,28,356,1,0,
	0,0,30,379,1,0,0,0,32,444,1,0,0,0,34,447,1,0,0,0,36,476,1,0,0,0,38,478,
	1,0,0,0,40,480,1,0,0,0,42,500,1,0,0,0,44,540,1,0,0,0,46,549,1,0,0,0,48,
	600,1,0,0,0,50,602,1,0,0,0,52,604,1,0,0,0,54,606,1,0,0,0,56,608,1,0,0,0,
	58,616,1,0,0,0,60,620,1,0,0,0,62,622,1,0,0,0,64,640,1,0,0,0,66,685,1,0,
	0,0,68,687,1,0,0,0,70,711,1,0,0,0,72,727,1,0,0,0,74,729,1,0,0,0,76,738,
	1,0,0,0,78,747,1,0,0,0,80,776,1,0,0,0,82,826,1,0,0,0,84,878,1,0,0,0,86,
	898,1,0,0,0,88,902,1,0,0,0,90,904,1,0,0,0,92,908,1,0,0,0,94,912,1,0,0,0,
	96,917,1,0,0,0,98,919,1,0,0,0,100,921,1,0,0,0,102,937,1,0,0,0,104,957,1,
	0,0,0,106,968,1,0,0,0,108,1016,1,0,0,0,110,1051,1,0,0,0,112,1053,1,0,0,
	0,114,1091,1,0,0,0,116,1109,1,0,0,0,118,1129,1,0,0,0,120,1143,1,0,0,0,122,
	124,5,55,0,0,123,122,1,0,0,0,123,124,1,0,0,0,124,125,1,0,0,0,125,126,3,
	2,1,0,126,127,5,0,0,1,127,1,1,0,0,0,128,132,5,78,0,0,129,132,3,4,2,0,130,
	132,3,58,29,0,131,128,1,0,0,0,131,129,1,0,0,0,131,130,1,0,0,0,132,135,1,
	0,0,0,133,131,1,0,0,0,133,134,1,0,0,0,134,3,1,0,0,0,135,133,1,0,0,0,136,
	140,3,28,14,0,137,139,5,78,0,0,138,137,1,0,0,0,139,142,1,0,0,0,140,138,
	1,0,0,0,140,141,1,0,0,0,141,143,1,0,0,0,142,140,1,0,0,0,143,144,5,46,0,
	0,144,145,3,30,15,0,145,146,5,47,0,0,146,5,1,0,0,0,147,151,3,26,13,0,148,
	150,5,78,0,0,149,148,1,0,0,0,150,153,1,0,0,0,151,149,1,0,0,0,151,152,1,
	0,0,0,152,154,1,0,0,0,153,151,1,0,0,0,154,155,5,46,0,0,155,156,3,30,15,
	0,156,157,5,47,0,0,157,7,1,0,0,0,158,167,3,10,5,0,159,167,5,23,0,0,160,
	167,5,21,0,0,161,167,3,116,58,0,162,167,5,20,0,0,163,167,5,28,0,0,164,167,
	3,12,6,0,165,167,3,16,8,0,166,158,1,0,0,0,166,159,1,0,0,0,166,160,1,0,0,
	0,166,161,1,0,0,0,166,162,1,0,0,0,166,163,1,0,0,0,166,164,1,0,0,0,166,165,
	1,0,0,0,167,9,1,0,0,0,168,169,5,53,0,0,169,170,3,116,58,0,170,11,1,0,0,
	0,171,172,5,24,0,0,172,176,5,48,0,0,173,175,5,78,0,0,174,173,1,0,0,0,175,
	178,1,0,0,0,176,174,1,0,0,0,176,177,1,0,0,0,177,179,1,0,0,0,178,176,1,0,
	0,0,179,183,3,14,7,0,180,182,5,78,0,0,181,180,1,0,0,0,182,185,1,0,0,0,183,
	181,1,0,0,0,183,184,1,0,0,0,184,186,1,0,0,0,185,183,1,0,0,0,186,187,5,49,
	0,0,187,221,1,0,0,0,188,189,5,26,0,0,189,193,5,48,0,0,190,192,5,78,0,0,
	191,190,1,0,0,0,192,195,1,0,0,0,193,191,1,0,0,0,193,194,1,0,0,0,194,196,
	1,0,0,0,195,193,1,0,0,0,196,200,3,26,13,0,197,199,5,78,0,0,198,197,1,0,
	0,0,199,202,1,0,0,0,200,198,1,0,0,0,200,201,1,0,0,0,201,203,1,0,0,0,202,
	200,1,0,0,0,203,204,5,49,0,0,204,221,1,0,0,0,205,207,5,42,0,0,206,208,5,
	42,0,0,207,206,1,0,0,0,207,208,1,0,0,0,208,209,1,0,0,0,209,218,3,116,58,
	0,210,214,5,48,0,0,211,213,3,120,60,0,212,211,1,0,0,0,213,216,1,0,0,0,214,
	212,1,0,0,0,214,215,1,0,0,0,215,217,1,0,0,0,216,214,1,0,0,0,217,219,5,49,
	0,0,218,210,1,0,0,0,218,219,1,0,0,0,219,221,1,0,0,0,220,171,1,0,0,0,220,
	188,1,0,0,0,220,205,1,0,0,0,221,13,1,0,0,0,222,256,5,43,0,0,223,256,5,44,
	0,0,224,228,1,0,0,0,225,228,5,14,0,0,226,228,5,15,0,0,227,224,1,0,0,0,227,
	225,1,0,0,0,227,226,1,0,0,0,228,237,1,0,0,0,229,238,5,11,0,0,230,232,5,
	37,0,0,231,233,5,78,0,0,232,231,1,0,0,0,233,234,1,0,0,0,234,232,1,0,0,0,
	234,235,1,0,0,0,235,236,1,0,0,0,236,238,5,10,0,0,237,229,1,0,0,0,237,230,
	1,0,0,0,237,238,1,0,0,0,238,253,1,0,0,0,239,241,5,78,0,0,240,239,1,0,0,
	0,241,244,1,0,0,0,242,240,1,0,0,0,242,243,1,0,0,0,243,245,1,0,0,0,244,242,
	1,0,0,0,245,249,5,25,0,0,246,248,5,78,0,0,247,246,1,0,0,0,248,251,1,0,0,
	0,249,247,1,0,0,0,249,250,1,0,0,0,250,252,1,0,0,0,251,249,1,0,0,0,252,254,
	3,20,10,0,253,242,1,0,0,0,253,254,1,0,0,0,254,256,1,0,0,0,255,222,1,0,0,
	0,255,223,1,0,0,0,255,227,1,0,0,0,256,15,1,0,0,0,257,261,5,50,0,0,258,260,
	5,78,0,0,259,258,1,0,0,0,260,263,1,0,0,0,261,259,1,0,0,0,261,262,1,0,0,
	0,262,264,1,0,0,0,263,261,1,0,0,0,264,266,3,116,58,0,265,267,7,0,0,0,266,
	265,1,0,0,0,266,267,1,0,0,0,267,268,1,0,0,0,268,272,5,35,0,0,269,271,5,
	78,0,0,270,269,1,0,0,0,271,274,1,0,0,0,272,270,1,0,0,0,272,273,1,0,0,0,
	273,277,1,0,0,0,274,272,1,0,0,0,275,278,3,116,58,0,276,278,5,54,0,0,277,
	275,1,0,0,0,277,276,1,0,0,0,278,282,1,0,0,0,279,281,5,78,0,0,280,279,1,
	0,0,0,281,284,1,0,0,0,282,280,1,0,0,0,282,283,1,0,0,0,283,292,1,0,0,0,284,
	282,1,0,0,0,285,289,5,9,0,0,286,288,5,78,0,0,287,286,1,0,0,0,288,291,1,
	0,0,0,289,287,1,0,0,0,289,290,1,0,0,0,290,293,1,0,0,0,291,289,1,0,0,0,292,
	285,1,0,0,0,292,293,1,0,0,0,293,294,1,0,0,0,294,295,5,51,0,0,295,17,1,0,
	0,0,296,298,3,8,4,0,297,296,1,0,0,0,298,299,1,0,0,0,299,297,1,0,0,0,299,
	300,1,0,0,0,300,19,1,0,0,0,301,320,3,18,9,0,302,304,5,78,0,0,303,302,1,
	0,0,0,304,307,1,0,0,0,305,303,1,0,0,0,305,306,1,0,0,0,306,315,1,0,0,0,307,
	305,1,0,0,0,308,312,3,22,11,0,309,311,5,78,0,0,310,309,1,0,0,0,311,314,
	1,0,0,0,312,310,1,0,0,0,312,313,1,0,0,0,313,316,1,0,0,0,314,312,1,0,0,0,
	315,308,1,0,0,0,315,316,1,0,0,0,316,317,1,0,0,0,317,319,3,18,9,0,318,305,
	1,0,0,0,319,322,1,0,0,0,320,318,1,0,0,0,320,321,1,0,0,0,321,21,1,0,0,0,
	322,320,1,0,0,0,323,324,7,1,0,0,324,23,1,0,0,0,325,329,3,22,11,0,326,328,
	5,78,0,0,327,326,1,0,0,0,328,331,1,0,0,0,329,327,1,0,0,0,329,330,1,0,0,
	0,330,333,1,0,0,0,331,329,1,0,0,0,332,325,1,0,0,0,332,333,1,0,0,0,333,334,
	1,0,0,0,334,335,3,20,10,0,335,25,1,0,0,0,336,353,3,24,12,0,337,339,5,78,
	0,0,338,337,1,0,0,0,339,342,1,0,0,0,340,338,1,0,0,0,340,341,1,0,0,0,341,
	343,1,0,0,0,342,340,1,0,0,0,343,347,5,52,0,0,344,346,5,78,0,0,345,344,1,
	0,0,0,346,349,1,0,0,0,347,345,1,0,0,0,347,348,1,0,0,0,348,350,1,0,0,0,349,
	347,1,0,0,0,350,352,3,24,12,0,351,340,1,0,0,0,352,355,1,0,0,0,353,351,1,
	0,0,0,353,354,1,0,0,0,354,27,1,0,0,0,355,353,1,0,0,0,356,373,3,20,10,0,
	357,359,5,78,0,0,358,357,1,0,0,0,359,362,1,0,0,0,360,358,1,0,0,0,360,361,
	1,0,0,0,361,363,1,0,0,0,362,360,1,0,0,0,363,367,5,52,0,0,364,366,5,78,0,
	0,365,364,1,0,0,0,366,369,1,0,0,0,367,365,1,0,0,0,367,368,1,0,0,0,368,370,
	1,0,0,0,369,367,1,0,0,0,370,372,3,20,10,0,371,360,1,0,0,0,372,375,1,0,0,
	0,373,371,1,0,0,0,373,374,1,0,0,0,374,29,1,0,0,0,375,373,1,0,0,0,376,378,
	5,78,0,0,377,376,1,0,0,0,378,381,1,0,0,0,379,377,1,0,0,0,379,380,1,0,0,
	0,380,404,1,0,0,0,381,379,1,0,0,0,382,384,3,32,16,0,383,382,1,0,0,0,383,
	384,1,0,0,0,384,395,1,0,0,0,385,387,5,78,0,0,386,385,1,0,0,0,387,390,1,
	0,0,0,388,386,1,0,0,0,388,389,1,0,0,0,389,391,1,0,0,0,390,388,1,0,0,0,391,
	392,5,45,0,0,392,394,3,30,15,0,393,388,1,0,0,0,394,397,1,0,0,0,395,393,
	1,0,0,0,395,396,1,0,0,0,396,405,1,0,0,0,397,395,1,0,0,0,398,399,3,60,30,
	0,399,400,3,30,15,0,400,405,1,0,0,0,401,402,3,6,3,0,402,403,3,30,15,0,403,
	405,1,0,0,0,404,383,1,0,0,0,404,398,1,0,0,0,404,401,1,0,0,0,405,31,1,0,
	0,0,406,410,3,116,58,0,407,409,5,78,0,0,408,407,1,0,0,0,409,412,1,0,0,0,
	410,408,1,0,0,0,410,411,1,0,0,0,411,413,1,0,0,0,412,410,1,0,0,0,413,417,
	5,42,0,0,414,416,5,78,0,0,415,414,1,0,0,0,416,419,1,0,0,0,417,415,1,0,0,
	0,417,418,1,0,0,0,418,420,1,0,0,0,419,417,1,0,0,0,420,428,3,34,17,0,421,
	423,5,78,0,0,422,421,1,0,0,0,423,426,1,0,0,0,424,422,1,0,0,0,424,425,1,
	0,0,0,425,427,1,0,0,0,426,424,1,0,0,0,427,429,5,8,0,0,428,424,1,0,0,0,428,
	429,1,0,0,0,429,445,1,0,0,0,430,434,5,76,0,0,431,433,5,78,0,0,432,431,1,
	0,0,0,433,436,1,0,0,0,434,432,1,0,0,0,434,435,1,0,0,0,435,437,1,0,0,0,436,
	434,1,0,0,0,437,441,5,42,0,0,438,440,5,84,0,0,439,438,1,0,0,0,440,443,1,
	0,0,0,441,439,1,0,0,0,441,442,1,0,0,0,442,445,1,0,0,0,443,441,1,0,0,0,444,
	406,1,0,0,0,444,430,1,0,0,0,445,33,1,0,0,0,446,448,3,36,18,0,447,446,1,
	0,0,0,448,449,1,0,0,0,449,447,1,0,0,0,449,450,1,0,0,0,450,459,1,0,0,0,451,
	453,7,2,0,0,452,454,3,36,18,0,453,452,1,0,0,0,454,455,1,0,0,0,455,453,1,
	0,0,0,455,456,1,0,0,0,456,458,1,0,0,0,457,451,1,0,0,0,458,461,1,0,0,0,459,
	457,1,0,0,0,459,460,1,0,0,0,460,35,1,0,0,0,461,459,1,0,0,0,462,477,5,78,
	0,0,463,477,3,116,58,0,464,477,3,50,25,0,465,477,3,52,26,0,466,477,3,54,
	27,0,467,477,5,21,0,0,468,477,5,22,0,0,469,477,5,54,0,0,470,477,3,48,24,
	0,471,472,5,50,0,0,472,473,3,116,58,0,473,474,5,51,0,0,474,477,1,0,0,0,
	475,477,3,38,19,0,476,462,1,0,0,0,476,463,1,0,0,0,476,464,1,0,0,0,476,465,
	1,0,0,0,476,466,1,0,0,0,476,467,1,0,0,0,476,468,1,0,0,0,476,469,1,0,0,0,
	476,470,1,0,0,0,476,471,1,0,0,0,476,475,1,0,0,0,477,37,1,0,0,0,478,479,
	7,3,0,0,479,39,1,0,0,0,480,497,3,42,21,0,481,483,5,78,0,0,482,481,1,0,0,
	0,483,486,1,0,0,0,484,482,1,0,0,0,484,485,1,0,0,0,485,487,1,0,0,0,486,484,
	1,0,0,0,487,491,7,4,0,0,488,490,5,78,0,0,489,488,1,0,0,0,490,493,1,0,0,
	0,491,489,1,0,0,0,491,492,1,0,0,0,492,494,1,0,0,0,493,491,1,0,0,0,494,496,
	3,42,21,0,495,484,1,0,0,0,496,499,1,0,0,0,497,495,1,0,0,0,497,498,1,0,0,
	0,498,41,1,0,0,0,499,497,1,0,0,0,500,517,3,44,22,0,501,503,5,78,0,0,502,
	501,1,0,0,0,503,506,1,0,0,0,504,502,1,0,0,0,504,505,1,0,0,0,505,507,1,0,
	0,0,506,504,1,0,0,0,507,511,7,5,0,0,508,510,5,78,0,0,509,508,1,0,0,0,510,
	513,1,0,0,0,511,509,1,0,0,0,511,512,1,0,0,0,512,514,1,0,0,0,513,511,1,0,
	0,0,514,516,3,44,22,0,515,504,1,0,0,0,516,519,1,0,0,0,517,515,1,0,0,0,517,
	518,1,0,0,0,518,43,1,0,0,0,519,517,1,0,0,0,520,541,3,52,26,0,521,541,3,
	54,27,0,522,541,3,56,28,0,523,541,3,46,23,0,524,528,5,48,0,0,525,527,5,
	78,0,0,526,525,1,0,0,0,527,530,1,0,0,0,528,526,1,0,0,0,528,529,1,0,0,0,
	529,531,1,0,0,0,530,528,1,0,0,0,531,535,3,40,20,0,532,534,5,78,0,0,533,
	532,1,0,0,0,534,537,1,0,0,0,535,533,1,0,0,0,535,536,1,0,0,0,536,538,1,0,
	0,0,537,535,1,0,0,0,538,539,5,49,0,0,539,541,1,0,0,0,540,520,1,0,0,0,540,
	521,1,0,0,0,540,522,1,0,0,0,540,523,1,0,0,0,540,524,1,0,0,0,541,45,1,0,
	0,0,542,550,5,72,0,0,543,550,5,73,0,0,544,546,5,37,0,0,545,544,1,0,0,0,
	545,546,1,0,0,0,546,547,1,0,0,0,547,550,5,74,0,0,548,550,5,75,0,0,549,542,
	1,0,0,0,549,543,1,0,0,0,549,545,1,0,0,0,549,548,1,0,0,0,550,47,1,0,0,0,
	551,601,5,68,0,0,552,553,5,70,0,0,553,557,5,48,0,0,554,556,5,78,0,0,555,
	554,1,0,0,0,556,559,1,0,0,0,557,555,1,0,0,0,557,558,1,0,0,0,558,560,1,0,
	0,0,559,557,1,0,0,0,560,575,5,76,0,0,561,563,5,78,0,0,562,561,1,0,0,0,563,
	566,1,0,0,0,564,562,1,0,0,0,564,565,1,0,0,0,565,567,1,0,0,0,566,564,1,0,
	0,0,567,571,5,52,0,0,568,570,5,78,0,0,569,568,1,0,0,0,570,573,1,0,0,0,571,
	569,1,0,0,0,571,572,1,0,0,0,572,574,1,0,0,0,573,571,1,0,0,0,574,576,3,34,
	17,0,575,564,1,0,0,0,575,576,1,0,0,0,576,577,1,0,0,0,577,601,5,49,0,0,578,
	579,5,71,0,0,579,583,5,48,0,0,580,582,5,78,0,0,581,580,1,0,0,0,582,585,
	1,0,0,0,583,581,1,0,0,0,583,584,1,0,0,0,584,586,1,0,0,0,585,583,1,0,0,0,
	586,590,3,40,20,0,587,589,5,78,0,0,588,587,1,0,0,0,589,592,1,0,0,0,590,
	588,1,0,0,0,590,591,1,0,0,0,591,593,1,0,0,0,592,590,1,0,0,0,593,594,5,49,
	0,0,594,601,1,0,0,0,595,596,3,116,58,0,596,597,5,48,0,0,597,598,3,34,17,
	0,598,599,5,49,0,0,599,601,1,0,0,0,600,551,1,0,0,0,600,552,1,0,0,0,600,
	578,1,0,0,0,600,595,1,0,0,0,601,49,1,0,0,0,602,603,7,6,0,0,603,51,1,0,0,
	0,604,605,7,7,0,0,605,53,1,0,0,0,606,607,7,8,0,0,607,55,1,0,0,0,608,609,
	7,9,0,0,609,57,1,0,0,0,610,617,3,112,56,0,611,617,3,62,31,0,612,617,3,114,
	57,0,613,617,3,102,51,0,614,617,3,104,52,0,615,617,3,106,53,0,616,610,1,
	0,0,0,616,611,1,0,0,0,616,612,1,0,0,0,616,613,1,0,0,0,616,614,1,0,0,0,616,
	615,1,0,0,0,617,59,1,0,0,0,618,621,3,64,32,0,619,621,3,114,57,0,620,618,
	1,0,0,0,620,619,1,0,0,0,621,61,1,0,0,0,622,626,5,58,0,0,623,625,5,78,0,
	0,624,623,1,0,0,0,625,628,1,0,0,0,626,624,1,0,0,0,626,627,1,0,0,0,627,629,
	1,0,0,0,628,626,1,0,0,0,629,633,3,66,33,0,630,632,5,78,0,0,631,630,1,0,
	0,0,632,635,1,0,0,0,633,631,1,0,0,0,633,634,1,0,0,0,634,636,1,0,0,0,635,
	633,1,0,0,0,636,637,5,46,0,0,637,638,3,2,1,0,638,639,5,47,0,0,639,63,1,
	0,0,0,640,644,5,58,0,0,641,643,5,78,0,0,642,641,1,0,0,0,643,646,1,0,0,0,
	644,642,1,0,0,0,644,645,1,0,0,0,645,647,1,0,0,0,646,644,1,0,0,0,647,651,
	3,66,33,0,648,650,5,78,0,0,649,648,1,0,0,0,650,653,1,0,0,0,651,649,1,0,
	0,0,651,652,1,0,0,0,652,654,1,0,0,0,653,651,1,0,0,0,654,655,5,46,0,0,655,
	656,3,30,15,0,656,657,5,47,0,0,657,65,1,0,0,0,658,686,3,70,35,0,659,663,
	7,10,0,0,660,662,5,78,0,0,661,660,1,0,0,0,662,665,1,0,0,0,663,661,1,0,0,
	0,663,664,1,0,0,0,664,667,1,0,0,0,665,663,1,0,0,0,666,659,1,0,0,0,666,667,
	1,0,0,0,667,668,1,0,0,0,668,683,3,68,34,0,669,671,5,78,0,0,670,669,1,0,
	0,0,671,674,1,0,0,0,672,670,1,0,0,0,672,673,1,0,0,0,673,675,1,0,0,0,674,
	672,1,0,0,0,675,679,5,1,0,0,676,678,5,78,0,0,677,676,1,0,0,0,678,681,1,
	0,0,0,679,677,1,0,0,0,679,680,1,0,0,0,680,682,1,0,0,0,681,679,1,0,0,0,682,
	684,3,72,36,0,683,672,1,0,0,0,683,684,1,0,0,0,684,686,1,0,0,0,685,658,1,
	0,0,0,685,666,1,0,0,0,686,67,1,0,0,0,687,688,7,11,0,0,688,69,1,0,0,0,689,
	712,3,74,37,0,690,694,3,80,40,0,691,693,5,78,0,0,692,691,1,0,0,0,693,696,
	1,0,0,0,694,692,1,0,0,0,694,695,1,0,0,0,695,709,1,0,0,0,696,694,1,0,0,0,
	697,699,3,76,38,0,698,697,1,0,0,0,699,702,1,0,0,0,700,698,1,0,0,0,700,701,
	1,0,0,0,701,710,1,0,0,0,702,700,1,0,0,0,703,705,3,78,39,0,704,703,1,0,0,
	0,705,708,1,0,0,0,706,704,1,0,0,0,706,707,1,0,0,0,707,710,1,0,0,0,708,706,
	1,0,0,0,709,700,1,0,0,0,709,706,1,0,0,0,710,712,1,0,0,0,711,689,1,0,0,0,
	711,690,1,0,0,0,712,71,1,0,0,0,713,728,3,74,37,0,714,724,3,80,40,0,715,
	717,5,78,0,0,716,715,1,0,0,0,717,720,1,0,0,0,718,716,1,0,0,0,718,719,1,
	0,0,0,719,721,1,0,0,0,720,718,1,0,0,0,721,723,3,76,38,0,722,718,1,0,0,0,
	723,726,1,0,0,0,724,722,1,0,0,0,724,725,1,0,0,0,725,728,1,0,0,0,726,724,
	1,0,0,0,727,713,1,0,0,0,727,714,1,0,0,0,728,73,1,0,0,0,729,733,5,3,0,0,
	730,732,5,78,0,0,731,730,1,0,0,0,732,735,1,0,0,0,733,731,1,0,0,0,733,734,
	1,0,0,0,734,736,1,0,0,0,735,733,1,0,0,0,736,737,3,80,40,0,737,75,1,0,0,
	0,738,742,5,1,0,0,739,741,5,78,0,0,740,739,1,0,0,0,741,744,1,0,0,0,742,
	740,1,0,0,0,742,743,1,0,0,0,743,745,1,0,0,0,744,742,1,0,0,0,745,746,3,80,
	40,0,746,77,1,0,0,0,747,751,5,2,0,0,748,750,5,78,0,0,749,748,1,0,0,0,750,
	753,1,0,0,0,751,749,1,0,0,0,751,752,1,0,0,0,752,754,1,0,0,0,753,751,1,0,
	0,0,754,755,3,80,40,0,755,79,1,0,0,0,756,760,5,48,0,0,757,759,5,78,0,0,
	758,757,1,0,0,0,759,762,1,0,0,0,760,758,1,0,0,0,760,761,1,0,0,0,761,765,
	1,0,0,0,762,760,1,0,0,0,763,766,3,70,35,0,764,766,3,82,41,0,765,763,1,0,
	0,0,765,764,1,0,0,0,766,770,1,0,0,0,767,769,5,78,0,0,768,767,1,0,0,0,769,
	772,1,0,0,0,770,768,1,0,0,0,770,771,1,0,0,0,771,773,1,0,0,0,772,770,1,0,
	0,0,773,774,5,49,0,0,774,777,1,0,0,0,775,777,3,98,49,0,776,756,1,0,0,0,
	776,775,1,0,0,0,777,81,1,0,0,0,778,805,3,116,58,0,779,781,5,78,0,0,780,
	779,1,0,0,0,781,784,1,0,0,0,782,780,1,0,0,0,782,783,1,0,0,0,783,803,1,0,
	0,0,784,782,1,0,0,0,785,789,5,42,0,0,786,788,5,78,0,0,787,786,1,0,0,0,788,
	791,1,0,0,0,789,787,1,0,0,0,789,790,1,0,0,0,790,792,1,0,0,0,791,789,1,0,
	0,0,792,804,3,88,44,0,793,804,3,84,42,0,794,798,3,96,48,0,795,797,5,78,
	0,0,796,795,1,0,0,0,797,800,1,0,0,0,798,796,1,0,0,0,798,799,1,0,0,0,799,
	801,1,0,0,0,800,798,1,0,0,0,801,802,3,86,43,0,802,804,1,0,0,0,803,785,1,
	0,0,0,803,793,1,0,0,0,803,794,1,0,0,0,804,806,1,0,0,0,805,782,1,0,0,0,805,
	806,1,0,0,0,806,827,1,0,0,0,807,811,3,86,43,0,808,810,5,78,0,0,809,808,
	1,0,0,0,810,813,1,0,0,0,811,809,1,0,0,0,811,812,1,0,0,0,812,824,1,0,0,0,
	813,811,1,0,0,0,814,818,3,96,48,0,815,817,5,78,0,0,816,815,1,0,0,0,817,
	820,1,0,0,0,818,816,1,0,0,0,818,819,1,0,0,0,819,821,1,0,0,0,820,818,1,0,
	0,0,821,822,3,116,58,0,822,825,1,0,0,0,823,825,3,84,42,0,824,814,1,0,0,
	0,824,823,1,0,0,0,825,827,1,0,0,0,826,778,1,0,0,0,826,807,1,0,0,0,827,83,
	1,0,0,0,828,832,3,90,45,0,829,831,5,78,0,0,830,829,1,0,0,0,831,834,1,0,
	0,0,832,830,1,0,0,0,832,833,1,0,0,0,833,835,1,0,0,0,834,832,1,0,0,0,835,
	851,3,116,58,0,836,838,5,78,0,0,837,836,1,0,0,0,838,841,1,0,0,0,839,837,
	1,0,0,0,839,840,1,0,0,0,840,842,1,0,0,0,841,839,1,0,0,0,842,846,3,90,45,
	0,843,845,5,78,0,0,844,843,1,0,0,0,845,848,1,0,0,0,846,844,1,0,0,0,846,
	847,1,0,0,0,847,849,1,0,0,0,848,846,1,0,0,0,849,850,3,88,44,0,850,852,1,
	0,0,0,851,839,1,0,0,0,851,852,1,0,0,0,852,879,1,0,0,0,853,857,3,92,46,0,
	854,856,5,78,0,0,855,854,1,0,0,0,856,859,1,0,0,0,857,855,1,0,0,0,857,858,
	1,0,0,0,858,860,1,0,0,0,859,857,1,0,0,0,860,876,3,116,58,0,861,863,5,78,
	0,0,862,861,1,0,0,0,863,866,1,0,0,0,864,862,1,0,0,0,864,865,1,0,0,0,865,
	867,1,0,0,0,866,864,1,0,0,0,867,871,3,92,46,0,868,870,5,78,0,0,869,868,
	1,0,0,0,870,873,1,0,0,0,871,869,1,0,0,0,871,872,1,0,0,0,872,874,1,0,0,0,
	873,871,1,0,0,0,874,875,3,88,44,0,875,877,1,0,0,0,876,864,1,0,0,0,876,877,
	1,0,0,0,877,879,1,0,0,0,878,828,1,0,0,0,878,853,1,0,0,0,879,85,1,0,0,0,
	880,895,3,52,26,0,881,883,5,78,0,0,882,881,1,0,0,0,883,886,1,0,0,0,884,
	882,1,0,0,0,884,885,1,0,0,0,885,887,1,0,0,0,886,884,1,0,0,0,887,891,5,29,
	0,0,888,890,5,78,0,0,889,888,1,0,0,0,890,893,1,0,0,0,891,889,1,0,0,0,891,
	892,1,0,0,0,892,894,1,0,0,0,893,891,1,0,0,0,894,896,3,52,26,0,895,884,1,
	0,0,0,895,896,1,0,0,0,896,899,1,0,0,0,897,899,3,54,27,0,898,880,1,0,0,0,
	898,897,1,0,0,0,899,87,1,0,0,0,900,903,3,86,43,0,901,903,3,116,58,0,902,
	900,1,0,0,0,902,901,1,0,0,0,903,89,1,0,0,0,904,906,5,32,0,0,905,907,5,35,
	0,0,906,905,1,0,0,0,906,907,1,0,0,0,907,91,1,0,0,0,908,910,5,31,0,0,909,
	911,5,35,0,0,910,909,1,0,0,0,910,911,1,0,0,0,911,93,1,0,0,0,912,913,5,35,
	0,0,913,95,1,0,0,0,914,918,3,90,45,0,915,918,3,92,46,0,916,918,3,94,47,
	0,917,914,1,0,0,0,917,915,1,0,0,0,917,916,1,0,0,0,918,97,1,0,0,0,919,920,
	3,48,24,0,920,99,1,0,0,0,921,925,3,52,26,0,922,924,5,78,0,0,923,922,1,0,
	0,0,924,927,1,0,0,0,925,923,1,0,0,0,925,926,1,0,0,0,926,928,1,0,0,0,927,
	925,1,0,0,0,928,932,5,29,0,0,929,931,5,78,0,0,930,929,1,0,0,0,931,934,1,
	0,0,0,932,930,1,0,0,0,932,933,1,0,0,0,933,935,1,0,0,0,934,932,1,0,0,0,935,
	936,3,52,26,0,936,101,1,0,0,0,937,941,5,60,0,0,938,940,5,78,0,0,939,938,
	1,0,0,0,940,943,1,0,0,0,941,939,1,0,0,0,941,942,1,0,0,0,942,951,1,0,0,0,
	943,941,1,0,0,0,944,948,5,27,0,0,945,947,5,78,0,0,946,945,1,0,0,0,947,950,
	1,0,0,0,948,946,1,0,0,0,948,949,1,0,0,0,949,952,1,0,0,0,950,948,1,0,0,0,
	951,944,1,0,0,0,951,952,1,0,0,0,952,953,1,0,0,0,953,954,5,46,0,0,954,955,
	3,30,15,0,955,956,5,47,0,0,956,103,1,0,0,0,957,961,5,61,0,0,958,960,5,78,
	0,0,959,958,1,0,0,0,960,963,1,0,0,0,961,959,1,0,0,0,961,962,1,0,0,0,962,
	964,1,0,0,0,963,961,1,0,0,0,964,965,5,46,0,0,965,966,3,30,15,0,966,967,
	5,47,0,0,967,105,1,0,0,0,968,972,5,59,0,0,969,971,5,78,0,0,970,969,1,0,
	0,0,971,974,1,0,0,0,972,970,1,0,0,0,972,973,1,0,0,0,973,975,1,0,0,0,974,
	972,1,0,0,0,975,979,3,108,54,0,976,978,5,78,0,0,977,976,1,0,0,0,978,981,
	1,0,0,0,979,977,1,0,0,0,979,980,1,0,0,0,980,982,1,0,0,0,981,979,1,0,0,0,
	982,983,5,46,0,0,983,984,3,2,1,0,984,985,5,47,0,0,985,107,1,0,0,0,986,987,
	5,3,0,0,987,1017,3,110,55,0,988,999,3,110,55,0,989,991,5,78,0,0,990,989,
	1,0,0,0,991,994,1,0,0,0,992,990,1,0,0,0,992,993,1,0,0,0,993,995,1,0,0,0,
	994,992,1,0,0,0,995,996,5,1,0,0,996,998,3,110,55,0,997,992,1,0,0,0,998,
	1001,1,0,0,0,999,997,1,0,0,0,999,1000,1,0,0,0,1000,1017,1,0,0,0,1001,999,
	1,0,0,0,1002,1013,3,110,55,0,1003,1005,5,78,0,0,1004,1003,1,0,0,0,1005,
	1008,1,0,0,0,1006,1004,1,0,0,0,1006,1007,1,0,0,0,1007,1009,1,0,0,0,1008,
	1006,1,0,0,0,1009,1010,5,2,0,0,1010,1012,3,110,55,0,1011,1006,1,0,0,0,1012,
	1015,1,0,0,0,1013,1011,1,0,0,0,1013,1014,1,0,0,0,1014,1017,1,0,0,0,1015,
	1013,1,0,0,0,1016,986,1,0,0,0,1016,988,1,0,0,0,1016,1002,1,0,0,0,1017,109,
	1,0,0,0,1018,1022,5,48,0,0,1019,1021,5,78,0,0,1020,1019,1,0,0,0,1021,1024,
	1,0,0,0,1022,1020,1,0,0,0,1022,1023,1,0,0,0,1023,1025,1,0,0,0,1024,1022,
	1,0,0,0,1025,1029,3,108,54,0,1026,1028,5,78,0,0,1027,1026,1,0,0,0,1028,
	1031,1,0,0,0,1029,1027,1,0,0,0,1029,1030,1,0,0,0,1030,1032,1,0,0,0,1031,
	1029,1,0,0,0,1032,1033,5,49,0,0,1033,1052,1,0,0,0,1034,1038,5,48,0,0,1035,
	1037,5,78,0,0,1036,1035,1,0,0,0,1037,1040,1,0,0,0,1038,1036,1,0,0,0,1038,
	1039,1,0,0,0,1039,1041,1,0,0,0,1040,1038,1,0,0,0,1041,1045,3,32,16,0,1042,
	1044,5,78,0,0,1043,1042,1,0,0,0,1044,1047,1,0,0,0,1045,1043,1,0,0,0,1045,
	1046,1,0,0,0,1046,1048,1,0,0,0,1047,1045,1,0,0,0,1048,1049,5,49,0,0,1049,
	1052,1,0,0,0,1050,1052,3,98,49,0,1051,1018,1,0,0,0,1051,1034,1,0,0,0,1051,
	1050,1,0,0,0,1052,111,1,0,0,0,1053,1057,5,56,0,0,1054,1056,5,78,0,0,1055,
	1054,1,0,0,0,1056,1059,1,0,0,0,1057,1055,1,0,0,0,1057,1058,1,0,0,0,1058,
	1060,1,0,0,0,1059,1057,1,0,0,0,1060,1078,7,12,0,0,1061,1063,5,78,0,0,1062,
	1061,1,0,0,0,1063,1066,1,0,0,0,1064,1062,1,0,0,0,1064,1065,1,0,0,0,1065,
	1067,1,0,0,0,1066,1064,1,0,0,0,1067,1071,5,69,0,0,1068,1070,5,78,0,0,1069,
	1068,1,0,0,0,1070,1073,1,0,0,0,1071,1069,1,0,0,0,1071,1072,1,0,0,0,1072,
	1076,1,0,0,0,1073,1071,1,0,0,0,1074,1077,3,108,54,0,1075,1077,3,32,16,0,
	1076,1074,1,0,0,0,1076,1075,1,0,0,0,1077,1079,1,0,0,0,1078,1064,1,0,0,0,
	1078,1079,1,0,0,0,1079,1087,1,0,0,0,1080,1082,5,78,0,0,1081,1080,1,0,0,
	0,1082,1085,1,0,0,0,1083,1081,1,0,0,0,1083,1084,1,0,0,0,1084,1086,1,0,0,
	0,1085,1083,1,0,0,0,1086,1088,3,66,33,0,1087,1083,1,0,0,0,1087,1088,1,0,
	0,0,1088,1089,1,0,0,0,1089,1090,5,45,0,0,1090,113,1,0,0,0,1091,1095,5,67,
	0,0,1092,1094,3,118,59,0,1093,1092,1,0,0,0,1094,1097,1,0,0,0,1095,1093,
	1,0,0,0,1095,1096,1,0,0,0,1096,1107,1,0,0,0,1097,1095,1,0,0,0,1098,1108,
	5,45,0,0,1099,1103,5,46,0,0,1100,1102,3,120,60,0,1101,1100,1,0,0,0,1102,
	1105,1,0,0,0,1103,1101,1,0,0,0,1103,1104,1,0,0,0,1104,1106,1,0,0,0,1105,
	1103,1,0,0,0,1106,1108,5,47,0,0,1107,1098,1,0,0,0,1107,1099,1,0,0,0,1108,
	115,1,0,0,0,1109,1110,7,13,0,0,1110,117,1,0,0,0,1111,1130,3,36,18,0,1112,
	1130,5,52,0,0,1113,1117,5,48,0,0,1114,1116,3,120,60,0,1115,1114,1,0,0,0,
	1116,1119,1,0,0,0,1117,1115,1,0,0,0,1117,1118,1,0,0,0,1118,1120,1,0,0,0,
	1119,1117,1,0,0,0,1120,1130,5,49,0,0,1121,1125,5,50,0,0,1122,1124,3,120,
	60,0,1123,1122,1,0,0,0,1124,1127,1,0,0,0,1125,1123,1,0,0,0,1125,1126,1,
	0,0,0,1126,1128,1,0,0,0,1127,1125,1,0,0,0,1128,1130,5,51,0,0,1129,1111,
	1,0,0,0,1129,1112,1,0,0,0,1129,1113,1,0,0,0,1129,1121,1,0,0,0,1130,119,
	1,0,0,0,1131,1144,3,118,59,0,1132,1136,5,46,0,0,1133,1135,3,120,60,0,1134,
	1133,1,0,0,0,1135,1138,1,0,0,0,1136,1134,1,0,0,0,1136,1137,1,0,0,0,1137,
	1139,1,0,0,0,1138,1136,1,0,0,0,1139,1144,5,47,0,0,1140,1144,5,23,0,0,1141,
	1144,5,45,0,0,1142,1144,3,12,6,0,1143,1131,1,0,0,0,1143,1132,1,0,0,0,1143,
	1140,1,0,0,0,1143,1141,1,0,0,0,1143,1142,1,0,0,0,1144,121,1,0,0,0,161,123,
	131,133,140,151,166,176,183,193,200,207,214,218,220,227,234,237,242,249,
	253,255,261,266,272,277,282,289,292,299,305,312,315,320,329,332,340,347,
	353,360,367,373,379,383,388,395,404,410,417,424,428,434,441,444,449,455,
	459,476,484,491,497,504,511,517,528,535,540,545,549,557,564,571,575,583,
	590,600,616,620,626,633,644,651,663,666,672,679,683,685,694,700,706,709,
	711,718,724,727,733,742,751,760,765,770,776,782,789,798,803,805,811,818,
	824,826,832,839,846,851,857,864,871,876,878,884,891,895,898,902,906,910,
	917,925,932,941,948,951,961,972,979,992,999,1006,1013,1016,1022,1029,1038,
	1045,1051,1057,1064,1071,1076,1078,1083,1087,1095,1103,1107,1117,1125,1129,
	1136,1143];

	private static __ATN: ATN;
	public static get _ATN(): ATN {
		if (!CssParser.__ATN) {
			CssParser.__ATN = new ATNDeserializer().deserialize(CssParser._serializedATN);
		}

		return CssParser.__ATN;
	}


	static DecisionsToDFA = CssParser._ATN.decisionToState.map( (ds: DecisionState, index: number) => new DFA(ds, index) );

}

export class StylesheetContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public main(): MainContext {
		return this.getTypedRuleContext(MainContext, 0) as MainContext;
	}
	public EOF(): TerminalNode {
		return this.getToken(CssParser.EOF, 0);
	}
	public CHARSET(): TerminalNode {
		return this.getToken(CssParser.CHARSET, 0);
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_stylesheet;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterStylesheet) {
	 		listener.enterStylesheet(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitStylesheet) {
	 		listener.exitStylesheet(this);
		}
	}
}


export class MainContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public WS_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.WS);
	}
	public WS(i: number): TerminalNode {
		return this.getToken(CssParser.WS, i);
	}
	public qualifiedRule_list(): QualifiedRuleContext[] {
		return this.getTypedRuleContexts(QualifiedRuleContext) as QualifiedRuleContext[];
	}
	public qualifiedRule(i: number): QualifiedRuleContext {
		return this.getTypedRuleContext(QualifiedRuleContext, i) as QualifiedRuleContext;
	}
	public atRule_list(): AtRuleContext[] {
		return this.getTypedRuleContexts(AtRuleContext) as AtRuleContext[];
	}
	public atRule(i: number): AtRuleContext {
		return this.getTypedRuleContext(AtRuleContext, i) as AtRuleContext;
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_main;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterMain) {
	 		listener.enterMain(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitMain) {
	 		listener.exitMain(this);
		}
	}
}


export class QualifiedRuleContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public selectorList(): SelectorListContext {
		return this.getTypedRuleContext(SelectorListContext, 0) as SelectorListContext;
	}
	public LCURLY(): TerminalNode {
		return this.getToken(CssParser.LCURLY, 0);
	}
	public declarationList(): DeclarationListContext {
		return this.getTypedRuleContext(DeclarationListContext, 0) as DeclarationListContext;
	}
	public RCURLY(): TerminalNode {
		return this.getToken(CssParser.RCURLY, 0);
	}
	public WS_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.WS);
	}
	public WS(i: number): TerminalNode {
		return this.getToken(CssParser.WS, i);
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_qualifiedRule;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterQualifiedRule) {
	 		listener.enterQualifiedRule(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitQualifiedRule) {
	 		listener.exitQualifiedRule(this);
		}
	}
}


export class InnerQualifiedRuleContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public forgivingSelectorList(): ForgivingSelectorListContext {
		return this.getTypedRuleContext(ForgivingSelectorListContext, 0) as ForgivingSelectorListContext;
	}
	public LCURLY(): TerminalNode {
		return this.getToken(CssParser.LCURLY, 0);
	}
	public declarationList(): DeclarationListContext {
		return this.getTypedRuleContext(DeclarationListContext, 0) as DeclarationListContext;
	}
	public RCURLY(): TerminalNode {
		return this.getToken(CssParser.RCURLY, 0);
	}
	public WS_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.WS);
	}
	public WS(i: number): TerminalNode {
		return this.getToken(CssParser.WS, i);
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_innerQualifiedRule;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterInnerQualifiedRule) {
	 		listener.enterInnerQualifiedRule(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitInnerQualifiedRule) {
	 		listener.exitInnerQualifiedRule(this);
		}
	}
}


export class SimpleSelectorContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public classSelector(): ClassSelectorContext {
		return this.getTypedRuleContext(ClassSelectorContext, 0) as ClassSelectorContext;
	}
	public ID(): TerminalNode {
		return this.getToken(CssParser.ID, 0);
	}
	public COLOR_IDENT_START(): TerminalNode {
		return this.getToken(CssParser.COLOR_IDENT_START, 0);
	}
	public identifier(): IdentifierContext {
		return this.getTypedRuleContext(IdentifierContext, 0) as IdentifierContext;
	}
	public AMPERSAND(): TerminalNode {
		return this.getToken(CssParser.AMPERSAND, 0);
	}
	public STAR(): TerminalNode {
		return this.getToken(CssParser.STAR, 0);
	}
	public pseudoSelector(): PseudoSelectorContext {
		return this.getTypedRuleContext(PseudoSelectorContext, 0) as PseudoSelectorContext;
	}
	public attributeSelector(): AttributeSelectorContext {
		return this.getTypedRuleContext(AttributeSelectorContext, 0) as AttributeSelectorContext;
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_simpleSelector;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterSimpleSelector) {
	 		listener.enterSimpleSelector(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitSimpleSelector) {
	 		listener.exitSimpleSelector(this);
		}
	}
}


export class ClassSelectorContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public DOT(): TerminalNode {
		return this.getToken(CssParser.DOT, 0);
	}
	public identifier(): IdentifierContext {
		return this.getTypedRuleContext(IdentifierContext, 0) as IdentifierContext;
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_classSelector;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterClassSelector) {
	 		listener.enterClassSelector(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitClassSelector) {
	 		listener.exitClassSelector(this);
		}
	}
}


export class PseudoSelectorContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public NTH_PSEUDO_CLASS(): TerminalNode {
		return this.getToken(CssParser.NTH_PSEUDO_CLASS, 0);
	}
	public LPAREN(): TerminalNode {
		return this.getToken(CssParser.LPAREN, 0);
	}
	public nthValue(): NthValueContext {
		return this.getTypedRuleContext(NthValueContext, 0) as NthValueContext;
	}
	public RPAREN(): TerminalNode {
		return this.getToken(CssParser.RPAREN, 0);
	}
	public WS_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.WS);
	}
	public WS(i: number): TerminalNode {
		return this.getToken(CssParser.WS, i);
	}
	public FUNCTIONAL_PSEUDO_CLASS(): TerminalNode {
		return this.getToken(CssParser.FUNCTIONAL_PSEUDO_CLASS, 0);
	}
	public forgivingSelectorList(): ForgivingSelectorListContext {
		return this.getTypedRuleContext(ForgivingSelectorListContext, 0) as ForgivingSelectorListContext;
	}
	public COLON_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.COLON);
	}
	public COLON(i: number): TerminalNode {
		return this.getToken(CssParser.COLON, i);
	}
	public identifier(): IdentifierContext {
		return this.getTypedRuleContext(IdentifierContext, 0) as IdentifierContext;
	}
	public anyInnerValue_list(): AnyInnerValueContext[] {
		return this.getTypedRuleContexts(AnyInnerValueContext) as AnyInnerValueContext[];
	}
	public anyInnerValue(i: number): AnyInnerValueContext {
		return this.getTypedRuleContext(AnyInnerValueContext, i) as AnyInnerValueContext;
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_pseudoSelector;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterPseudoSelector) {
	 		listener.enterPseudoSelector(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitPseudoSelector) {
	 		listener.exitPseudoSelector(this);
		}
	}
}


export class NthValueContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public NTH_ODD(): TerminalNode {
		return this.getToken(CssParser.NTH_ODD, 0);
	}
	public NTH_EVEN(): TerminalNode {
		return this.getToken(CssParser.NTH_EVEN, 0);
	}
	public NTH_DIMENSION(): TerminalNode {
		return this.getToken(CssParser.NTH_DIMENSION, 0);
	}
	public NTH_DIMENSION_SIGNED(): TerminalNode {
		return this.getToken(CssParser.NTH_DIMENSION_SIGNED, 0);
	}
	public SIGNED_INTEGER(): TerminalNode {
		return this.getToken(CssParser.SIGNED_INTEGER, 0);
	}
	public MINUS(): TerminalNode {
		return this.getToken(CssParser.MINUS, 0);
	}
	public UNSIGNED_INTEGER(): TerminalNode {
		return this.getToken(CssParser.UNSIGNED_INTEGER, 0);
	}
	public OF(): TerminalNode {
		return this.getToken(CssParser.OF, 0);
	}
	public complexSelector(): ComplexSelectorContext {
		return this.getTypedRuleContext(ComplexSelectorContext, 0) as ComplexSelectorContext;
	}
	public WS_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.WS);
	}
	public WS(i: number): TerminalNode {
		return this.getToken(CssParser.WS, i);
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_nthValue;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterNthValue) {
	 		listener.enterNthValue(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitNthValue) {
	 		listener.exitNthValue(this);
		}
	}
}


export class AttributeSelectorContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public LSQUARE(): TerminalNode {
		return this.getToken(CssParser.LSQUARE, 0);
	}
	public identifier_list(): IdentifierContext[] {
		return this.getTypedRuleContexts(IdentifierContext) as IdentifierContext[];
	}
	public identifier(i: number): IdentifierContext {
		return this.getTypedRuleContext(IdentifierContext, i) as IdentifierContext;
	}
	public EQ(): TerminalNode {
		return this.getToken(CssParser.EQ, 0);
	}
	public RSQUARE(): TerminalNode {
		return this.getToken(CssParser.RSQUARE, 0);
	}
	public STRING(): TerminalNode {
		return this.getToken(CssParser.STRING, 0);
	}
	public WS_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.WS);
	}
	public WS(i: number): TerminalNode {
		return this.getToken(CssParser.WS, i);
	}
	public ATTRIBUTE_FLAG(): TerminalNode {
		return this.getToken(CssParser.ATTRIBUTE_FLAG, 0);
	}
	public STAR(): TerminalNode {
		return this.getToken(CssParser.STAR, 0);
	}
	public TILDE(): TerminalNode {
		return this.getToken(CssParser.TILDE, 0);
	}
	public CARET(): TerminalNode {
		return this.getToken(CssParser.CARET, 0);
	}
	public DOLLAR(): TerminalNode {
		return this.getToken(CssParser.DOLLAR, 0);
	}
	public PIPE(): TerminalNode {
		return this.getToken(CssParser.PIPE, 0);
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_attributeSelector;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterAttributeSelector) {
	 		listener.enterAttributeSelector(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitAttributeSelector) {
	 		listener.exitAttributeSelector(this);
		}
	}
}


export class CompoundSelectorContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public simpleSelector_list(): SimpleSelectorContext[] {
		return this.getTypedRuleContexts(SimpleSelectorContext) as SimpleSelectorContext[];
	}
	public simpleSelector(i: number): SimpleSelectorContext {
		return this.getTypedRuleContext(SimpleSelectorContext, i) as SimpleSelectorContext;
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_compoundSelector;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterCompoundSelector) {
	 		listener.enterCompoundSelector(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitCompoundSelector) {
	 		listener.exitCompoundSelector(this);
		}
	}
}


export class ComplexSelectorContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public compoundSelector_list(): CompoundSelectorContext[] {
		return this.getTypedRuleContexts(CompoundSelectorContext) as CompoundSelectorContext[];
	}
	public compoundSelector(i: number): CompoundSelectorContext {
		return this.getTypedRuleContext(CompoundSelectorContext, i) as CompoundSelectorContext;
	}
	public WS_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.WS);
	}
	public WS(i: number): TerminalNode {
		return this.getToken(CssParser.WS, i);
	}
	public combinator_list(): CombinatorContext[] {
		return this.getTypedRuleContexts(CombinatorContext) as CombinatorContext[];
	}
	public combinator(i: number): CombinatorContext {
		return this.getTypedRuleContext(CombinatorContext, i) as CombinatorContext;
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_complexSelector;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterComplexSelector) {
	 		listener.enterComplexSelector(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitComplexSelector) {
	 		listener.exitComplexSelector(this);
		}
	}
}


export class CombinatorContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public PLUS(): TerminalNode {
		return this.getToken(CssParser.PLUS, 0);
	}
	public TILDE(): TerminalNode {
		return this.getToken(CssParser.TILDE, 0);
	}
	public COLUMN(): TerminalNode {
		return this.getToken(CssParser.COLUMN, 0);
	}
	public GT(): TerminalNode {
		return this.getToken(CssParser.GT, 0);
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_combinator;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterCombinator) {
	 		listener.enterCombinator(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitCombinator) {
	 		listener.exitCombinator(this);
		}
	}
}


export class RelativeSelectorContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public complexSelector(): ComplexSelectorContext {
		return this.getTypedRuleContext(ComplexSelectorContext, 0) as ComplexSelectorContext;
	}
	public combinator(): CombinatorContext {
		return this.getTypedRuleContext(CombinatorContext, 0) as CombinatorContext;
	}
	public WS_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.WS);
	}
	public WS(i: number): TerminalNode {
		return this.getToken(CssParser.WS, i);
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_relativeSelector;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterRelativeSelector) {
	 		listener.enterRelativeSelector(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitRelativeSelector) {
	 		listener.exitRelativeSelector(this);
		}
	}
}


export class ForgivingSelectorListContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public relativeSelector_list(): RelativeSelectorContext[] {
		return this.getTypedRuleContexts(RelativeSelectorContext) as RelativeSelectorContext[];
	}
	public relativeSelector(i: number): RelativeSelectorContext {
		return this.getTypedRuleContext(RelativeSelectorContext, i) as RelativeSelectorContext;
	}
	public COMMA_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.COMMA);
	}
	public COMMA(i: number): TerminalNode {
		return this.getToken(CssParser.COMMA, i);
	}
	public WS_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.WS);
	}
	public WS(i: number): TerminalNode {
		return this.getToken(CssParser.WS, i);
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_forgivingSelectorList;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterForgivingSelectorList) {
	 		listener.enterForgivingSelectorList(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitForgivingSelectorList) {
	 		listener.exitForgivingSelectorList(this);
		}
	}
}


export class SelectorListContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public complexSelector_list(): ComplexSelectorContext[] {
		return this.getTypedRuleContexts(ComplexSelectorContext) as ComplexSelectorContext[];
	}
	public complexSelector(i: number): ComplexSelectorContext {
		return this.getTypedRuleContext(ComplexSelectorContext, i) as ComplexSelectorContext;
	}
	public COMMA_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.COMMA);
	}
	public COMMA(i: number): TerminalNode {
		return this.getToken(CssParser.COMMA, i);
	}
	public WS_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.WS);
	}
	public WS(i: number): TerminalNode {
		return this.getToken(CssParser.WS, i);
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_selectorList;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterSelectorList) {
	 		listener.enterSelectorList(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitSelectorList) {
	 		listener.exitSelectorList(this);
		}
	}
}


export class DeclarationListContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public innerAtRule(): InnerAtRuleContext {
		return this.getTypedRuleContext(InnerAtRuleContext, 0) as InnerAtRuleContext;
	}
	public declarationList_list(): DeclarationListContext[] {
		return this.getTypedRuleContexts(DeclarationListContext) as DeclarationListContext[];
	}
	public declarationList(i: number): DeclarationListContext {
		return this.getTypedRuleContext(DeclarationListContext, i) as DeclarationListContext;
	}
	public innerQualifiedRule(): InnerQualifiedRuleContext {
		return this.getTypedRuleContext(InnerQualifiedRuleContext, 0) as InnerQualifiedRuleContext;
	}
	public WS_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.WS);
	}
	public WS(i: number): TerminalNode {
		return this.getToken(CssParser.WS, i);
	}
	public declaration(): DeclarationContext {
		return this.getTypedRuleContext(DeclarationContext, 0) as DeclarationContext;
	}
	public SEMI_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.SEMI);
	}
	public SEMI(i: number): TerminalNode {
		return this.getToken(CssParser.SEMI, i);
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_declarationList;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterDeclarationList) {
	 		listener.enterDeclarationList(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitDeclarationList) {
	 		listener.exitDeclarationList(this);
		}
	}
}


export class DeclarationContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public identifier(): IdentifierContext {
		return this.getTypedRuleContext(IdentifierContext, 0) as IdentifierContext;
	}
	public COLON(): TerminalNode {
		return this.getToken(CssParser.COLON, 0);
	}
	public valueList(): ValueListContext {
		return this.getTypedRuleContext(ValueListContext, 0) as ValueListContext;
	}
	public WS_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.WS);
	}
	public WS(i: number): TerminalNode {
		return this.getToken(CssParser.WS, i);
	}
	public IMPORTANT(): TerminalNode {
		return this.getToken(CssParser.IMPORTANT, 0);
	}
	public CUSTOM_IDENT(): TerminalNode {
		return this.getToken(CssParser.CUSTOM_IDENT, 0);
	}
	public CUSTOM_VALUE_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.CUSTOM_VALUE);
	}
	public CUSTOM_VALUE(i: number): TerminalNode {
		return this.getToken(CssParser.CUSTOM_VALUE, i);
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_declaration;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterDeclaration) {
	 		listener.enterDeclaration(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitDeclaration) {
	 		listener.exitDeclaration(this);
		}
	}
}


export class ValueListContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public value_list(): ValueContext[] {
		return this.getTypedRuleContexts(ValueContext) as ValueContext[];
	}
	public value(i: number): ValueContext {
		return this.getTypedRuleContext(ValueContext, i) as ValueContext;
	}
	public COMMA_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.COMMA);
	}
	public COMMA(i: number): TerminalNode {
		return this.getToken(CssParser.COMMA, i);
	}
	public SLASH_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.SLASH);
	}
	public SLASH(i: number): TerminalNode {
		return this.getToken(CssParser.SLASH, i);
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_valueList;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterValueList) {
	 		listener.enterValueList(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitValueList) {
	 		listener.exitValueList(this);
		}
	}
}


export class ValueContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public WS(): TerminalNode {
		return this.getToken(CssParser.WS, 0);
	}
	public identifier(): IdentifierContext {
		return this.getTypedRuleContext(IdentifierContext, 0) as IdentifierContext;
	}
	public integer(): IntegerContext {
		return this.getTypedRuleContext(IntegerContext, 0) as IntegerContext;
	}
	public number_(): NumberContext {
		return this.getTypedRuleContext(NumberContext, 0) as NumberContext;
	}
	public dimension(): DimensionContext {
		return this.getTypedRuleContext(DimensionContext, 0) as DimensionContext;
	}
	public COLOR_IDENT_START(): TerminalNode {
		return this.getToken(CssParser.COLOR_IDENT_START, 0);
	}
	public COLOR_INT_START(): TerminalNode {
		return this.getToken(CssParser.COLOR_INT_START, 0);
	}
	public STRING(): TerminalNode {
		return this.getToken(CssParser.STRING, 0);
	}
	public function_(): FunctionContext {
		return this.getTypedRuleContext(FunctionContext, 0) as FunctionContext;
	}
	public LSQUARE(): TerminalNode {
		return this.getToken(CssParser.LSQUARE, 0);
	}
	public RSQUARE(): TerminalNode {
		return this.getToken(CssParser.RSQUARE, 0);
	}
	public unknownValue(): UnknownValueContext {
		return this.getTypedRuleContext(UnknownValueContext, 0) as UnknownValueContext;
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_value;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterValue) {
	 		listener.enterValue(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitValue) {
	 		listener.exitValue(this);
		}
	}
}


export class UnknownValueContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public COLON(): TerminalNode {
		return this.getToken(CssParser.COLON, 0);
	}
	public EQ(): TerminalNode {
		return this.getToken(CssParser.EQ, 0);
	}
	public DOT(): TerminalNode {
		return this.getToken(CssParser.DOT, 0);
	}
	public ID(): TerminalNode {
		return this.getToken(CssParser.ID, 0);
	}
	public UNKNOWN(): TerminalNode {
		return this.getToken(CssParser.UNKNOWN, 0);
	}
	public AT_RULE(): TerminalNode {
		return this.getToken(CssParser.AT_RULE, 0);
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_unknownValue;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterUnknownValue) {
	 		listener.enterUnknownValue(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitUnknownValue) {
	 		listener.exitUnknownValue(this);
		}
	}
}


export class MathSumContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public mathProduct_list(): MathProductContext[] {
		return this.getTypedRuleContexts(MathProductContext) as MathProductContext[];
	}
	public mathProduct(i: number): MathProductContext {
		return this.getTypedRuleContext(MathProductContext, i) as MathProductContext;
	}
	public PLUS_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.PLUS);
	}
	public PLUS(i: number): TerminalNode {
		return this.getToken(CssParser.PLUS, i);
	}
	public MINUS_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.MINUS);
	}
	public MINUS(i: number): TerminalNode {
		return this.getToken(CssParser.MINUS, i);
	}
	public WS_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.WS);
	}
	public WS(i: number): TerminalNode {
		return this.getToken(CssParser.WS, i);
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_mathSum;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterMathSum) {
	 		listener.enterMathSum(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitMathSum) {
	 		listener.exitMathSum(this);
		}
	}
}


export class MathProductContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public mathValue_list(): MathValueContext[] {
		return this.getTypedRuleContexts(MathValueContext) as MathValueContext[];
	}
	public mathValue(i: number): MathValueContext {
		return this.getTypedRuleContext(MathValueContext, i) as MathValueContext;
	}
	public STAR_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.STAR);
	}
	public STAR(i: number): TerminalNode {
		return this.getToken(CssParser.STAR, i);
	}
	public SLASH_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.SLASH);
	}
	public SLASH(i: number): TerminalNode {
		return this.getToken(CssParser.SLASH, i);
	}
	public WS_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.WS);
	}
	public WS(i: number): TerminalNode {
		return this.getToken(CssParser.WS, i);
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_mathProduct;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterMathProduct) {
	 		listener.enterMathProduct(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitMathProduct) {
	 		listener.exitMathProduct(this);
		}
	}
}


export class MathValueContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public number_(): NumberContext {
		return this.getTypedRuleContext(NumberContext, 0) as NumberContext;
	}
	public dimension(): DimensionContext {
		return this.getTypedRuleContext(DimensionContext, 0) as DimensionContext;
	}
	public percentage(): PercentageContext {
		return this.getTypedRuleContext(PercentageContext, 0) as PercentageContext;
	}
	public mathConstant(): MathConstantContext {
		return this.getTypedRuleContext(MathConstantContext, 0) as MathConstantContext;
	}
	public LPAREN(): TerminalNode {
		return this.getToken(CssParser.LPAREN, 0);
	}
	public mathSum(): MathSumContext {
		return this.getTypedRuleContext(MathSumContext, 0) as MathSumContext;
	}
	public RPAREN(): TerminalNode {
		return this.getToken(CssParser.RPAREN, 0);
	}
	public WS_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.WS);
	}
	public WS(i: number): TerminalNode {
		return this.getToken(CssParser.WS, i);
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_mathValue;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterMathValue) {
	 		listener.enterMathValue(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitMathValue) {
	 		listener.exitMathValue(this);
		}
	}
}


export class MathConstantContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public E(): TerminalNode {
		return this.getToken(CssParser.E, 0);
	}
	public PI(): TerminalNode {
		return this.getToken(CssParser.PI, 0);
	}
	public INFINITY(): TerminalNode {
		return this.getToken(CssParser.INFINITY, 0);
	}
	public MINUS(): TerminalNode {
		return this.getToken(CssParser.MINUS, 0);
	}
	public NAN(): TerminalNode {
		return this.getToken(CssParser.NAN, 0);
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_mathConstant;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterMathConstant) {
	 		listener.enterMathConstant(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitMathConstant) {
	 		listener.exitMathConstant(this);
		}
	}
}


export class FunctionContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public URL_FUNCTION(): TerminalNode {
		return this.getToken(CssParser.URL_FUNCTION, 0);
	}
	public VAR_FUNCTION(): TerminalNode {
		return this.getToken(CssParser.VAR_FUNCTION, 0);
	}
	public LPAREN(): TerminalNode {
		return this.getToken(CssParser.LPAREN, 0);
	}
	public CUSTOM_IDENT(): TerminalNode {
		return this.getToken(CssParser.CUSTOM_IDENT, 0);
	}
	public RPAREN(): TerminalNode {
		return this.getToken(CssParser.RPAREN, 0);
	}
	public WS_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.WS);
	}
	public WS(i: number): TerminalNode {
		return this.getToken(CssParser.WS, i);
	}
	public COMMA(): TerminalNode {
		return this.getToken(CssParser.COMMA, 0);
	}
	public valueList(): ValueListContext {
		return this.getTypedRuleContext(ValueListContext, 0) as ValueListContext;
	}
	public CALC_FUNCTION(): TerminalNode {
		return this.getToken(CssParser.CALC_FUNCTION, 0);
	}
	public mathSum(): MathSumContext {
		return this.getTypedRuleContext(MathSumContext, 0) as MathSumContext;
	}
	public identifier(): IdentifierContext {
		return this.getTypedRuleContext(IdentifierContext, 0) as IdentifierContext;
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_function;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterFunction) {
	 		listener.enterFunction(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitFunction) {
	 		listener.exitFunction(this);
		}
	}
}


export class IntegerContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public UNSIGNED_INTEGER(): TerminalNode {
		return this.getToken(CssParser.UNSIGNED_INTEGER, 0);
	}
	public SIGNED_INTEGER(): TerminalNode {
		return this.getToken(CssParser.SIGNED_INTEGER, 0);
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_integer;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterInteger) {
	 		listener.enterInteger(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitInteger) {
	 		listener.exitInteger(this);
		}
	}
}


export class NumberContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public UNSIGNED_NUMBER(): TerminalNode {
		return this.getToken(CssParser.UNSIGNED_NUMBER, 0);
	}
	public SIGNED_NUMBER(): TerminalNode {
		return this.getToken(CssParser.SIGNED_NUMBER, 0);
	}
	public UNSIGNED_INTEGER(): TerminalNode {
		return this.getToken(CssParser.UNSIGNED_INTEGER, 0);
	}
	public SIGNED_INTEGER(): TerminalNode {
		return this.getToken(CssParser.SIGNED_INTEGER, 0);
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_number;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterNumber) {
	 		listener.enterNumber(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitNumber) {
	 		listener.exitNumber(this);
		}
	}
}


export class DimensionContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public UNSIGNED_DIMENSION(): TerminalNode {
		return this.getToken(CssParser.UNSIGNED_DIMENSION, 0);
	}
	public SIGNED_DIMENSION(): TerminalNode {
		return this.getToken(CssParser.SIGNED_DIMENSION, 0);
	}
	public NTH_DIMENSION(): TerminalNode {
		return this.getToken(CssParser.NTH_DIMENSION, 0);
	}
	public NTH_DIMENSION_SIGNED(): TerminalNode {
		return this.getToken(CssParser.NTH_DIMENSION_SIGNED, 0);
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_dimension;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterDimension) {
	 		listener.enterDimension(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitDimension) {
	 		listener.exitDimension(this);
		}
	}
}


export class PercentageContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public UNSIGNED_PERCENTAGE(): TerminalNode {
		return this.getToken(CssParser.UNSIGNED_PERCENTAGE, 0);
	}
	public SIGNED_PERCENTAGE(): TerminalNode {
		return this.getToken(CssParser.SIGNED_PERCENTAGE, 0);
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_percentage;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterPercentage) {
	 		listener.enterPercentage(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitPercentage) {
	 		listener.exitPercentage(this);
		}
	}
}


export class AtRuleContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public importAtRule(): ImportAtRuleContext {
		return this.getTypedRuleContext(ImportAtRuleContext, 0) as ImportAtRuleContext;
	}
	public mediaAtRule(): MediaAtRuleContext {
		return this.getTypedRuleContext(MediaAtRuleContext, 0) as MediaAtRuleContext;
	}
	public unknownAtRule(): UnknownAtRuleContext {
		return this.getTypedRuleContext(UnknownAtRuleContext, 0) as UnknownAtRuleContext;
	}
	public pageAtRule(): PageAtRuleContext {
		return this.getTypedRuleContext(PageAtRuleContext, 0) as PageAtRuleContext;
	}
	public fontFaceAtRule(): FontFaceAtRuleContext {
		return this.getTypedRuleContext(FontFaceAtRuleContext, 0) as FontFaceAtRuleContext;
	}
	public supportsAtRule(): SupportsAtRuleContext {
		return this.getTypedRuleContext(SupportsAtRuleContext, 0) as SupportsAtRuleContext;
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_atRule;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterAtRule) {
	 		listener.enterAtRule(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitAtRule) {
	 		listener.exitAtRule(this);
		}
	}
}


export class InnerAtRuleContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public innerMediaAtRule(): InnerMediaAtRuleContext {
		return this.getTypedRuleContext(InnerMediaAtRuleContext, 0) as InnerMediaAtRuleContext;
	}
	public unknownAtRule(): UnknownAtRuleContext {
		return this.getTypedRuleContext(UnknownAtRuleContext, 0) as UnknownAtRuleContext;
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_innerAtRule;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterInnerAtRule) {
	 		listener.enterInnerAtRule(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitInnerAtRule) {
	 		listener.exitInnerAtRule(this);
		}
	}
}


export class MediaAtRuleContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public MEDIA_RULE(): TerminalNode {
		return this.getToken(CssParser.MEDIA_RULE, 0);
	}
	public mediaQuery(): MediaQueryContext {
		return this.getTypedRuleContext(MediaQueryContext, 0) as MediaQueryContext;
	}
	public LCURLY(): TerminalNode {
		return this.getToken(CssParser.LCURLY, 0);
	}
	public main(): MainContext {
		return this.getTypedRuleContext(MainContext, 0) as MainContext;
	}
	public RCURLY(): TerminalNode {
		return this.getToken(CssParser.RCURLY, 0);
	}
	public WS_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.WS);
	}
	public WS(i: number): TerminalNode {
		return this.getToken(CssParser.WS, i);
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_mediaAtRule;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterMediaAtRule) {
	 		listener.enterMediaAtRule(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitMediaAtRule) {
	 		listener.exitMediaAtRule(this);
		}
	}
}


export class InnerMediaAtRuleContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public MEDIA_RULE(): TerminalNode {
		return this.getToken(CssParser.MEDIA_RULE, 0);
	}
	public mediaQuery(): MediaQueryContext {
		return this.getTypedRuleContext(MediaQueryContext, 0) as MediaQueryContext;
	}
	public LCURLY(): TerminalNode {
		return this.getToken(CssParser.LCURLY, 0);
	}
	public declarationList(): DeclarationListContext {
		return this.getTypedRuleContext(DeclarationListContext, 0) as DeclarationListContext;
	}
	public RCURLY(): TerminalNode {
		return this.getToken(CssParser.RCURLY, 0);
	}
	public WS_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.WS);
	}
	public WS(i: number): TerminalNode {
		return this.getToken(CssParser.WS, i);
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_innerMediaAtRule;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterInnerMediaAtRule) {
	 		listener.enterInnerMediaAtRule(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitInnerMediaAtRule) {
	 		listener.exitInnerMediaAtRule(this);
		}
	}
}


export class MediaQueryContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public mediaCondition(): MediaConditionContext {
		return this.getTypedRuleContext(MediaConditionContext, 0) as MediaConditionContext;
	}
	public mediaType(): MediaTypeContext {
		return this.getTypedRuleContext(MediaTypeContext, 0) as MediaTypeContext;
	}
	public AND(): TerminalNode {
		return this.getToken(CssParser.AND, 0);
	}
	public mediaConditionWithoutOr(): MediaConditionWithoutOrContext {
		return this.getTypedRuleContext(MediaConditionWithoutOrContext, 0) as MediaConditionWithoutOrContext;
	}
	public NOT(): TerminalNode {
		return this.getToken(CssParser.NOT, 0);
	}
	public ONLY(): TerminalNode {
		return this.getToken(CssParser.ONLY, 0);
	}
	public WS_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.WS);
	}
	public WS(i: number): TerminalNode {
		return this.getToken(CssParser.WS, i);
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_mediaQuery;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterMediaQuery) {
	 		listener.enterMediaQuery(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitMediaQuery) {
	 		listener.exitMediaQuery(this);
		}
	}
}


export class MediaTypeContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public IDENT(): TerminalNode {
		return this.getToken(CssParser.IDENT, 0);
	}
	public SCREEN(): TerminalNode {
		return this.getToken(CssParser.SCREEN, 0);
	}
	public PRINT(): TerminalNode {
		return this.getToken(CssParser.PRINT, 0);
	}
	public ALL(): TerminalNode {
		return this.getToken(CssParser.ALL, 0);
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_mediaType;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterMediaType) {
	 		listener.enterMediaType(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitMediaType) {
	 		listener.exitMediaType(this);
		}
	}
}


export class MediaConditionContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public mediaNot(): MediaNotContext {
		return this.getTypedRuleContext(MediaNotContext, 0) as MediaNotContext;
	}
	public mediaInParens(): MediaInParensContext {
		return this.getTypedRuleContext(MediaInParensContext, 0) as MediaInParensContext;
	}
	public WS_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.WS);
	}
	public WS(i: number): TerminalNode {
		return this.getToken(CssParser.WS, i);
	}
	public mediaAnd_list(): MediaAndContext[] {
		return this.getTypedRuleContexts(MediaAndContext) as MediaAndContext[];
	}
	public mediaAnd(i: number): MediaAndContext {
		return this.getTypedRuleContext(MediaAndContext, i) as MediaAndContext;
	}
	public mediaOr_list(): MediaOrContext[] {
		return this.getTypedRuleContexts(MediaOrContext) as MediaOrContext[];
	}
	public mediaOr(i: number): MediaOrContext {
		return this.getTypedRuleContext(MediaOrContext, i) as MediaOrContext;
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_mediaCondition;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterMediaCondition) {
	 		listener.enterMediaCondition(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitMediaCondition) {
	 		listener.exitMediaCondition(this);
		}
	}
}


export class MediaConditionWithoutOrContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public mediaNot(): MediaNotContext {
		return this.getTypedRuleContext(MediaNotContext, 0) as MediaNotContext;
	}
	public mediaInParens(): MediaInParensContext {
		return this.getTypedRuleContext(MediaInParensContext, 0) as MediaInParensContext;
	}
	public mediaAnd_list(): MediaAndContext[] {
		return this.getTypedRuleContexts(MediaAndContext) as MediaAndContext[];
	}
	public mediaAnd(i: number): MediaAndContext {
		return this.getTypedRuleContext(MediaAndContext, i) as MediaAndContext;
	}
	public WS_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.WS);
	}
	public WS(i: number): TerminalNode {
		return this.getToken(CssParser.WS, i);
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_mediaConditionWithoutOr;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterMediaConditionWithoutOr) {
	 		listener.enterMediaConditionWithoutOr(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitMediaConditionWithoutOr) {
	 		listener.exitMediaConditionWithoutOr(this);
		}
	}
}


export class MediaNotContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public NOT(): TerminalNode {
		return this.getToken(CssParser.NOT, 0);
	}
	public mediaInParens(): MediaInParensContext {
		return this.getTypedRuleContext(MediaInParensContext, 0) as MediaInParensContext;
	}
	public WS_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.WS);
	}
	public WS(i: number): TerminalNode {
		return this.getToken(CssParser.WS, i);
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_mediaNot;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterMediaNot) {
	 		listener.enterMediaNot(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitMediaNot) {
	 		listener.exitMediaNot(this);
		}
	}
}


export class MediaAndContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public AND(): TerminalNode {
		return this.getToken(CssParser.AND, 0);
	}
	public mediaInParens(): MediaInParensContext {
		return this.getTypedRuleContext(MediaInParensContext, 0) as MediaInParensContext;
	}
	public WS_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.WS);
	}
	public WS(i: number): TerminalNode {
		return this.getToken(CssParser.WS, i);
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_mediaAnd;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterMediaAnd) {
	 		listener.enterMediaAnd(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitMediaAnd) {
	 		listener.exitMediaAnd(this);
		}
	}
}


export class MediaOrContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public OR(): TerminalNode {
		return this.getToken(CssParser.OR, 0);
	}
	public mediaInParens(): MediaInParensContext {
		return this.getTypedRuleContext(MediaInParensContext, 0) as MediaInParensContext;
	}
	public WS_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.WS);
	}
	public WS(i: number): TerminalNode {
		return this.getToken(CssParser.WS, i);
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_mediaOr;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterMediaOr) {
	 		listener.enterMediaOr(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitMediaOr) {
	 		listener.exitMediaOr(this);
		}
	}
}


export class MediaInParensContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public LPAREN(): TerminalNode {
		return this.getToken(CssParser.LPAREN, 0);
	}
	public RPAREN(): TerminalNode {
		return this.getToken(CssParser.RPAREN, 0);
	}
	public mediaCondition(): MediaConditionContext {
		return this.getTypedRuleContext(MediaConditionContext, 0) as MediaConditionContext;
	}
	public mediaFeature(): MediaFeatureContext {
		return this.getTypedRuleContext(MediaFeatureContext, 0) as MediaFeatureContext;
	}
	public WS_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.WS);
	}
	public WS(i: number): TerminalNode {
		return this.getToken(CssParser.WS, i);
	}
	public generalEnclosed(): GeneralEnclosedContext {
		return this.getTypedRuleContext(GeneralEnclosedContext, 0) as GeneralEnclosedContext;
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_mediaInParens;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterMediaInParens) {
	 		listener.enterMediaInParens(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitMediaInParens) {
	 		listener.exitMediaInParens(this);
		}
	}
}


export class MediaFeatureContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public identifier(): IdentifierContext {
		return this.getTypedRuleContext(IdentifierContext, 0) as IdentifierContext;
	}
	public COLON(): TerminalNode {
		return this.getToken(CssParser.COLON, 0);
	}
	public mfValue(): MfValueContext {
		return this.getTypedRuleContext(MfValueContext, 0) as MfValueContext;
	}
	public mediaRange(): MediaRangeContext {
		return this.getTypedRuleContext(MediaRangeContext, 0) as MediaRangeContext;
	}
	public mfComparison(): MfComparisonContext {
		return this.getTypedRuleContext(MfComparisonContext, 0) as MfComparisonContext;
	}
	public mfNonIdentifierValue(): MfNonIdentifierValueContext {
		return this.getTypedRuleContext(MfNonIdentifierValueContext, 0) as MfNonIdentifierValueContext;
	}
	public WS_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.WS);
	}
	public WS(i: number): TerminalNode {
		return this.getToken(CssParser.WS, i);
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_mediaFeature;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterMediaFeature) {
	 		listener.enterMediaFeature(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitMediaFeature) {
	 		listener.exitMediaFeature(this);
		}
	}
}


export class MediaRangeContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public mfLt_list(): MfLtContext[] {
		return this.getTypedRuleContexts(MfLtContext) as MfLtContext[];
	}
	public mfLt(i: number): MfLtContext {
		return this.getTypedRuleContext(MfLtContext, i) as MfLtContext;
	}
	public identifier(): IdentifierContext {
		return this.getTypedRuleContext(IdentifierContext, 0) as IdentifierContext;
	}
	public WS_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.WS);
	}
	public WS(i: number): TerminalNode {
		return this.getToken(CssParser.WS, i);
	}
	public mfValue(): MfValueContext {
		return this.getTypedRuleContext(MfValueContext, 0) as MfValueContext;
	}
	public mfGt_list(): MfGtContext[] {
		return this.getTypedRuleContexts(MfGtContext) as MfGtContext[];
	}
	public mfGt(i: number): MfGtContext {
		return this.getTypedRuleContext(MfGtContext, i) as MfGtContext;
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_mediaRange;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterMediaRange) {
	 		listener.enterMediaRange(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitMediaRange) {
	 		listener.exitMediaRange(this);
		}
	}
}


export class MfNonIdentifierValueContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public number__list(): NumberContext[] {
		return this.getTypedRuleContexts(NumberContext) as NumberContext[];
	}
	public number_(i: number): NumberContext {
		return this.getTypedRuleContext(NumberContext, i) as NumberContext;
	}
	public SLASH(): TerminalNode {
		return this.getToken(CssParser.SLASH, 0);
	}
	public WS_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.WS);
	}
	public WS(i: number): TerminalNode {
		return this.getToken(CssParser.WS, i);
	}
	public dimension(): DimensionContext {
		return this.getTypedRuleContext(DimensionContext, 0) as DimensionContext;
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_mfNonIdentifierValue;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterMfNonIdentifierValue) {
	 		listener.enterMfNonIdentifierValue(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitMfNonIdentifierValue) {
	 		listener.exitMfNonIdentifierValue(this);
		}
	}
}


export class MfValueContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public mfNonIdentifierValue(): MfNonIdentifierValueContext {
		return this.getTypedRuleContext(MfNonIdentifierValueContext, 0) as MfNonIdentifierValueContext;
	}
	public identifier(): IdentifierContext {
		return this.getTypedRuleContext(IdentifierContext, 0) as IdentifierContext;
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_mfValue;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterMfValue) {
	 		listener.enterMfValue(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitMfValue) {
	 		listener.exitMfValue(this);
		}
	}
}


export class MfLtContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public LT(): TerminalNode {
		return this.getToken(CssParser.LT, 0);
	}
	public EQ(): TerminalNode {
		return this.getToken(CssParser.EQ, 0);
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_mfLt;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterMfLt) {
	 		listener.enterMfLt(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitMfLt) {
	 		listener.exitMfLt(this);
		}
	}
}


export class MfGtContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public GT(): TerminalNode {
		return this.getToken(CssParser.GT, 0);
	}
	public EQ(): TerminalNode {
		return this.getToken(CssParser.EQ, 0);
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_mfGt;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterMfGt) {
	 		listener.enterMfGt(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitMfGt) {
	 		listener.exitMfGt(this);
		}
	}
}


export class MfEqContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public EQ(): TerminalNode {
		return this.getToken(CssParser.EQ, 0);
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_mfEq;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterMfEq) {
	 		listener.enterMfEq(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitMfEq) {
	 		listener.exitMfEq(this);
		}
	}
}


export class MfComparisonContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public mfLt(): MfLtContext {
		return this.getTypedRuleContext(MfLtContext, 0) as MfLtContext;
	}
	public mfGt(): MfGtContext {
		return this.getTypedRuleContext(MfGtContext, 0) as MfGtContext;
	}
	public mfEq(): MfEqContext {
		return this.getTypedRuleContext(MfEqContext, 0) as MfEqContext;
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_mfComparison;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterMfComparison) {
	 		listener.enterMfComparison(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitMfComparison) {
	 		listener.exitMfComparison(this);
		}
	}
}


export class GeneralEnclosedContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public function_(): FunctionContext {
		return this.getTypedRuleContext(FunctionContext, 0) as FunctionContext;
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_generalEnclosed;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterGeneralEnclosed) {
	 		listener.enterGeneralEnclosed(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitGeneralEnclosed) {
	 		listener.exitGeneralEnclosed(this);
		}
	}
}


export class RatioContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public number__list(): NumberContext[] {
		return this.getTypedRuleContexts(NumberContext) as NumberContext[];
	}
	public number_(i: number): NumberContext {
		return this.getTypedRuleContext(NumberContext, i) as NumberContext;
	}
	public SLASH(): TerminalNode {
		return this.getToken(CssParser.SLASH, 0);
	}
	public WS_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.WS);
	}
	public WS(i: number): TerminalNode {
		return this.getToken(CssParser.WS, i);
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_ratio;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterRatio) {
	 		listener.enterRatio(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitRatio) {
	 		listener.exitRatio(this);
		}
	}
}


export class PageAtRuleContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public PAGE_RULE(): TerminalNode {
		return this.getToken(CssParser.PAGE_RULE, 0);
	}
	public LCURLY(): TerminalNode {
		return this.getToken(CssParser.LCURLY, 0);
	}
	public declarationList(): DeclarationListContext {
		return this.getTypedRuleContext(DeclarationListContext, 0) as DeclarationListContext;
	}
	public RCURLY(): TerminalNode {
		return this.getToken(CssParser.RCURLY, 0);
	}
	public WS_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.WS);
	}
	public WS(i: number): TerminalNode {
		return this.getToken(CssParser.WS, i);
	}
	public PAGE_PSEUDO_CLASS(): TerminalNode {
		return this.getToken(CssParser.PAGE_PSEUDO_CLASS, 0);
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_pageAtRule;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterPageAtRule) {
	 		listener.enterPageAtRule(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitPageAtRule) {
	 		listener.exitPageAtRule(this);
		}
	}
}


export class FontFaceAtRuleContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public FONT_FACE_RULE(): TerminalNode {
		return this.getToken(CssParser.FONT_FACE_RULE, 0);
	}
	public LCURLY(): TerminalNode {
		return this.getToken(CssParser.LCURLY, 0);
	}
	public declarationList(): DeclarationListContext {
		return this.getTypedRuleContext(DeclarationListContext, 0) as DeclarationListContext;
	}
	public RCURLY(): TerminalNode {
		return this.getToken(CssParser.RCURLY, 0);
	}
	public WS_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.WS);
	}
	public WS(i: number): TerminalNode {
		return this.getToken(CssParser.WS, i);
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_fontFaceAtRule;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterFontFaceAtRule) {
	 		listener.enterFontFaceAtRule(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitFontFaceAtRule) {
	 		listener.exitFontFaceAtRule(this);
		}
	}
}


export class SupportsAtRuleContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public SUPPORTS_RULE(): TerminalNode {
		return this.getToken(CssParser.SUPPORTS_RULE, 0);
	}
	public supportsCondition(): SupportsConditionContext {
		return this.getTypedRuleContext(SupportsConditionContext, 0) as SupportsConditionContext;
	}
	public LCURLY(): TerminalNode {
		return this.getToken(CssParser.LCURLY, 0);
	}
	public main(): MainContext {
		return this.getTypedRuleContext(MainContext, 0) as MainContext;
	}
	public RCURLY(): TerminalNode {
		return this.getToken(CssParser.RCURLY, 0);
	}
	public WS_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.WS);
	}
	public WS(i: number): TerminalNode {
		return this.getToken(CssParser.WS, i);
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_supportsAtRule;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterSupportsAtRule) {
	 		listener.enterSupportsAtRule(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitSupportsAtRule) {
	 		listener.exitSupportsAtRule(this);
		}
	}
}


export class SupportsConditionContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public NOT(): TerminalNode {
		return this.getToken(CssParser.NOT, 0);
	}
	public supportsInParens_list(): SupportsInParensContext[] {
		return this.getTypedRuleContexts(SupportsInParensContext) as SupportsInParensContext[];
	}
	public supportsInParens(i: number): SupportsInParensContext {
		return this.getTypedRuleContext(SupportsInParensContext, i) as SupportsInParensContext;
	}
	public AND_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.AND);
	}
	public AND(i: number): TerminalNode {
		return this.getToken(CssParser.AND, i);
	}
	public WS_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.WS);
	}
	public WS(i: number): TerminalNode {
		return this.getToken(CssParser.WS, i);
	}
	public OR_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.OR);
	}
	public OR(i: number): TerminalNode {
		return this.getToken(CssParser.OR, i);
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_supportsCondition;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterSupportsCondition) {
	 		listener.enterSupportsCondition(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitSupportsCondition) {
	 		listener.exitSupportsCondition(this);
		}
	}
}


export class SupportsInParensContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public LPAREN(): TerminalNode {
		return this.getToken(CssParser.LPAREN, 0);
	}
	public supportsCondition(): SupportsConditionContext {
		return this.getTypedRuleContext(SupportsConditionContext, 0) as SupportsConditionContext;
	}
	public RPAREN(): TerminalNode {
		return this.getToken(CssParser.RPAREN, 0);
	}
	public WS_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.WS);
	}
	public WS(i: number): TerminalNode {
		return this.getToken(CssParser.WS, i);
	}
	public declaration(): DeclarationContext {
		return this.getTypedRuleContext(DeclarationContext, 0) as DeclarationContext;
	}
	public generalEnclosed(): GeneralEnclosedContext {
		return this.getTypedRuleContext(GeneralEnclosedContext, 0) as GeneralEnclosedContext;
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_supportsInParens;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterSupportsInParens) {
	 		listener.enterSupportsInParens(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitSupportsInParens) {
	 		listener.exitSupportsInParens(this);
		}
	}
}


export class ImportAtRuleContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public IMPORT_RULE(): TerminalNode {
		return this.getToken(CssParser.IMPORT_RULE, 0);
	}
	public SEMI(): TerminalNode {
		return this.getToken(CssParser.SEMI, 0);
	}
	public URL_FUNCTION(): TerminalNode {
		return this.getToken(CssParser.URL_FUNCTION, 0);
	}
	public STRING(): TerminalNode {
		return this.getToken(CssParser.STRING, 0);
	}
	public WS_list(): TerminalNode[] {
	    	return this.getTokens(CssParser.WS);
	}
	public WS(i: number): TerminalNode {
		return this.getToken(CssParser.WS, i);
	}
	public SUPPORTS_FUNCTION(): TerminalNode {
		return this.getToken(CssParser.SUPPORTS_FUNCTION, 0);
	}
	public mediaQuery(): MediaQueryContext {
		return this.getTypedRuleContext(MediaQueryContext, 0) as MediaQueryContext;
	}
	public supportsCondition(): SupportsConditionContext {
		return this.getTypedRuleContext(SupportsConditionContext, 0) as SupportsConditionContext;
	}
	public declaration(): DeclarationContext {
		return this.getTypedRuleContext(DeclarationContext, 0) as DeclarationContext;
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_importAtRule;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterImportAtRule) {
	 		listener.enterImportAtRule(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitImportAtRule) {
	 		listener.exitImportAtRule(this);
		}
	}
}


export class UnknownAtRuleContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public AT_RULE(): TerminalNode {
		return this.getToken(CssParser.AT_RULE, 0);
	}
	public SEMI(): TerminalNode {
		return this.getToken(CssParser.SEMI, 0);
	}
	public LCURLY(): TerminalNode {
		return this.getToken(CssParser.LCURLY, 0);
	}
	public RCURLY(): TerminalNode {
		return this.getToken(CssParser.RCURLY, 0);
	}
	public anyOuterValue_list(): AnyOuterValueContext[] {
		return this.getTypedRuleContexts(AnyOuterValueContext) as AnyOuterValueContext[];
	}
	public anyOuterValue(i: number): AnyOuterValueContext {
		return this.getTypedRuleContext(AnyOuterValueContext, i) as AnyOuterValueContext;
	}
	public anyInnerValue_list(): AnyInnerValueContext[] {
		return this.getTypedRuleContexts(AnyInnerValueContext) as AnyInnerValueContext[];
	}
	public anyInnerValue(i: number): AnyInnerValueContext {
		return this.getTypedRuleContext(AnyInnerValueContext, i) as AnyInnerValueContext;
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_unknownAtRule;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterUnknownAtRule) {
	 		listener.enterUnknownAtRule(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitUnknownAtRule) {
	 		listener.exitUnknownAtRule(this);
		}
	}
}


export class IdentifierContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public IDENT(): TerminalNode {
		return this.getToken(CssParser.IDENT, 0);
	}
	public AND(): TerminalNode {
		return this.getToken(CssParser.AND, 0);
	}
	public NOT(): TerminalNode {
		return this.getToken(CssParser.NOT, 0);
	}
	public ONLY(): TerminalNode {
		return this.getToken(CssParser.ONLY, 0);
	}
	public OR(): TerminalNode {
		return this.getToken(CssParser.OR, 0);
	}
	public SCREEN(): TerminalNode {
		return this.getToken(CssParser.SCREEN, 0);
	}
	public PRINT(): TerminalNode {
		return this.getToken(CssParser.PRINT, 0);
	}
	public ALL(): TerminalNode {
		return this.getToken(CssParser.ALL, 0);
	}
	public OF(): TerminalNode {
		return this.getToken(CssParser.OF, 0);
	}
	public ATTRIBUTE_FLAG(): TerminalNode {
		return this.getToken(CssParser.ATTRIBUTE_FLAG, 0);
	}
	public E(): TerminalNode {
		return this.getToken(CssParser.E, 0);
	}
	public PI(): TerminalNode {
		return this.getToken(CssParser.PI, 0);
	}
	public INFINITY(): TerminalNode {
		return this.getToken(CssParser.INFINITY, 0);
	}
	public NAN(): TerminalNode {
		return this.getToken(CssParser.NAN, 0);
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_identifier;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterIdentifier) {
	 		listener.enterIdentifier(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitIdentifier) {
	 		listener.exitIdentifier(this);
		}
	}
}


export class AnyOuterValueContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public value(): ValueContext {
		return this.getTypedRuleContext(ValueContext, 0) as ValueContext;
	}
	public COMMA(): TerminalNode {
		return this.getToken(CssParser.COMMA, 0);
	}
	public LPAREN(): TerminalNode {
		return this.getToken(CssParser.LPAREN, 0);
	}
	public RPAREN(): TerminalNode {
		return this.getToken(CssParser.RPAREN, 0);
	}
	public anyInnerValue_list(): AnyInnerValueContext[] {
		return this.getTypedRuleContexts(AnyInnerValueContext) as AnyInnerValueContext[];
	}
	public anyInnerValue(i: number): AnyInnerValueContext {
		return this.getTypedRuleContext(AnyInnerValueContext, i) as AnyInnerValueContext;
	}
	public LSQUARE(): TerminalNode {
		return this.getToken(CssParser.LSQUARE, 0);
	}
	public RSQUARE(): TerminalNode {
		return this.getToken(CssParser.RSQUARE, 0);
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_anyOuterValue;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterAnyOuterValue) {
	 		listener.enterAnyOuterValue(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitAnyOuterValue) {
	 		listener.exitAnyOuterValue(this);
		}
	}
}


export class AnyInnerValueContext extends ParserRuleContext {
	constructor(parser?: CssParser, parent?: ParserRuleContext, invokingState?: number) {
		super(parent, invokingState);
    	this.parser = parser;
	}
	public anyOuterValue(): AnyOuterValueContext {
		return this.getTypedRuleContext(AnyOuterValueContext, 0) as AnyOuterValueContext;
	}
	public LCURLY(): TerminalNode {
		return this.getToken(CssParser.LCURLY, 0);
	}
	public RCURLY(): TerminalNode {
		return this.getToken(CssParser.RCURLY, 0);
	}
	public anyInnerValue_list(): AnyInnerValueContext[] {
		return this.getTypedRuleContexts(AnyInnerValueContext) as AnyInnerValueContext[];
	}
	public anyInnerValue(i: number): AnyInnerValueContext {
		return this.getTypedRuleContext(AnyInnerValueContext, i) as AnyInnerValueContext;
	}
	public ID(): TerminalNode {
		return this.getToken(CssParser.ID, 0);
	}
	public SEMI(): TerminalNode {
		return this.getToken(CssParser.SEMI, 0);
	}
	public pseudoSelector(): PseudoSelectorContext {
		return this.getTypedRuleContext(PseudoSelectorContext, 0) as PseudoSelectorContext;
	}
    public get ruleIndex(): number {
    	return CssParser.RULE_anyInnerValue;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterAnyInnerValue) {
	 		listener.enterAnyInnerValue(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitAnyInnerValue) {
	 		listener.exitAnyInnerValue(this);
		}
	}
}
