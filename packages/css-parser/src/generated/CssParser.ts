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
	public static readonly RULE_inner_MediaAtRule = 32;
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
	public static readonly RULE_inner_PageAtRule = 52;
	public static readonly RULE_fontFaceAtRule = 53;
	public static readonly RULE_supportsAtRule = 54;
	public static readonly RULE_supportsCondition = 55;
	public static readonly RULE_supportsInParens = 56;
	public static readonly RULE_importAtRule = 57;
	public static readonly RULE_unknownAtRule = 58;
	public static readonly RULE_identifier = 59;
	public static readonly RULE_anyOuterValue = 60;
	public static readonly RULE_anyInnerValue = 61;
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
		"innerAtRule", "mediaAtRule", "inner_MediaAtRule", "mediaQuery", "mediaType", 
		"mediaCondition", "mediaConditionWithoutOr", "mediaNot", "mediaAnd", "mediaOr", 
		"mediaInParens", "mediaFeature", "mediaRange", "mfNonIdentifierValue", 
		"mfValue", "mfLt", "mfGt", "mfEq", "mfComparison", "generalEnclosed", 
		"ratio", "pageAtRule", "inner_PageAtRule", "fontFaceAtRule", "supportsAtRule", 
		"supportsCondition", "supportsInParens", "importAtRule", "unknownAtRule", 
		"identifier", "anyOuterValue", "anyInnerValue",
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
			this.state = 125;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===55) {
				{
				this.state = 124;
				this.match(CssParser.CHARSET);
				}
			}

			this.state = 127;
			this.main();
			this.state = 128;
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
			this.state = 135;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while ((((_la) & ~0x1F) === 0 && ((1 << _la) & 397411070) !== 0) || ((((_la - 42)) & ~0x1F) === 0 && ((1 << (_la - 42)) & 3255781633) !== 0) || ((((_la - 74)) & ~0x1F) === 0 && ((1 << (_la - 74)) & 275) !== 0)) {
				{
				this.state = 133;
				this._errHandler.sync(this);
				switch (this._input.LA(1)) {
				case 78:
					{
					this.state = 130;
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
					this.state = 131;
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
					this.state = 132;
					this.atRule();
					}
					break;
				default:
					throw new NoViableAltException(this);
				}
				}
				this.state = 137;
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
			this.state = 138;
			this.selectorList();
			this.state = 142;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===78) {
				{
				{
				this.state = 139;
				this.match(CssParser.WS);
				}
				}
				this.state = 144;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 145;
			this.match(CssParser.LCURLY);
			this.state = 146;
			this.declarationList();
			this.state = 147;
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
			this.state = 149;
			this.forgivingSelectorList();
			this.state = 153;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===78) {
				{
				{
				this.state = 150;
				this.match(CssParser.WS);
				}
				}
				this.state = 155;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 156;
			this.match(CssParser.LCURLY);
			this.state = 157;
			this.declarationList();
			this.state = 158;
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
			this.state = 168;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 53:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 160;
				this.classSelector();
				}
				break;
			case 23:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 161;
				this.match(CssParser.ID);
				}
				break;
			case 21:
				this.enterOuterAlt(localctx, 3);
				{
				this.state = 162;
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
				this.state = 163;
				this.identifier();
				}
				break;
			case 20:
				this.enterOuterAlt(localctx, 5);
				{
				this.state = 164;
				this.match(CssParser.AMPERSAND);
				}
				break;
			case 28:
				this.enterOuterAlt(localctx, 6);
				{
				this.state = 165;
				this.match(CssParser.STAR);
				}
				break;
			case 24:
			case 26:
			case 42:
				this.enterOuterAlt(localctx, 7);
				{
				this.state = 166;
				this.pseudoSelector();
				}
				break;
			case 50:
				this.enterOuterAlt(localctx, 8);
				{
				this.state = 167;
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
			this.state = 170;
			this.match(CssParser.DOT);
			this.state = 171;
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
			this.state = 222;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 24:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 173;
				this.match(CssParser.NTH_PSEUDO_CLASS);
				this.state = 174;
				this.match(CssParser.LPAREN);
				this.state = 178;
				this._errHandler.sync(this);
				_alt = this._interp.adaptivePredict(this._input, 6, this._ctx);
				while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
					if (_alt === 1) {
						{
						{
						this.state = 175;
						this.match(CssParser.WS);
						}
						}
					}
					this.state = 180;
					this._errHandler.sync(this);
					_alt = this._interp.adaptivePredict(this._input, 6, this._ctx);
				}
				this.state = 181;
				this.nthValue();
				this.state = 185;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 182;
					this.match(CssParser.WS);
					}
					}
					this.state = 187;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 188;
				this.match(CssParser.RPAREN);
				}
				break;
			case 26:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 190;
				this.match(CssParser.FUNCTIONAL_PSEUDO_CLASS);
				this.state = 191;
				this.match(CssParser.LPAREN);
				this.state = 195;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 192;
					this.match(CssParser.WS);
					}
					}
					this.state = 197;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 198;
				this.forgivingSelectorList();
				this.state = 202;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 199;
					this.match(CssParser.WS);
					}
					}
					this.state = 204;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 205;
				this.match(CssParser.RPAREN);
				}
				break;
			case 42:
				this.enterOuterAlt(localctx, 3);
				{
				this.state = 207;
				this.match(CssParser.COLON);
				this.state = 209;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if (_la===42) {
					{
					this.state = 208;
					this.match(CssParser.COLON);
					}
				}

				this.state = 211;
				this.identifier();
				this.state = 220;
				this._errHandler.sync(this);
				switch ( this._interp.adaptivePredict(this._input, 12, this._ctx) ) {
				case 1:
					{
					this.state = 212;
					this.match(CssParser.LPAREN);
					this.state = 216;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while ((((_la) & ~0x1F) === 0 && ((1 << _la) & 132382462) !== 0) || ((((_la - 35)) & ~0x1F) === 0 && ((1 << (_la - 35)) & 961665) !== 0) || ((((_la - 67)) & ~0x1F) === 0 && ((1 << (_la - 67)) & 100859) !== 0)) {
						{
						{
						this.state = 213;
						this.anyInnerValue();
						}
						}
						this.state = 218;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 219;
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
			this.state = 257;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 43:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 224;
				this.match(CssParser.NTH_ODD);
				}
				break;
			case 44:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 225;
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
				this.state = 229;
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
					this.state = 227;
					this.match(CssParser.NTH_DIMENSION);
					}
					break;
				case 15:
					{
					this.state = 228;
					this.match(CssParser.NTH_DIMENSION_SIGNED);
					}
					break;
				default:
					throw new NoViableAltException(this);
				}
				this.state = 239;
				this._errHandler.sync(this);
				switch (this._input.LA(1)) {
				case 11:
					{
					this.state = 231;
					this.match(CssParser.SIGNED_INTEGER);
					}
					break;
				case 37:
					{
					this.state = 232;
					this.match(CssParser.MINUS);
					this.state = 234;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					do {
						{
						{
						this.state = 233;
						this.match(CssParser.WS);
						}
						}
						this.state = 236;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					} while (_la===78);
					this.state = 238;
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
				this.state = 255;
				this._errHandler.sync(this);
				switch ( this._interp.adaptivePredict(this._input, 19, this._ctx) ) {
				case 1:
					{
					this.state = 244;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 241;
						this.match(CssParser.WS);
						}
						}
						this.state = 246;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 247;
					this.match(CssParser.OF);
					this.state = 251;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 248;
						this.match(CssParser.WS);
						}
						}
						this.state = 253;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 254;
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
			this.state = 259;
			this.match(CssParser.LSQUARE);
			this.state = 263;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===78) {
				{
				{
				this.state = 260;
				this.match(CssParser.WS);
				}
				}
				this.state = 265;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 266;
			this.identifier();
			this.state = 268;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (((((_la - 28)) & ~0x1F) === 0 && ((1 << (_la - 28)) & 14341) !== 0)) {
				{
				this.state = 267;
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

			this.state = 270;
			this.match(CssParser.EQ);
			this.state = 274;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===78) {
				{
				{
				this.state = 271;
				this.match(CssParser.WS);
				}
				}
				this.state = 276;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 279;
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
				this.state = 277;
				this.identifier();
				}
				break;
			case 54:
				{
				this.state = 278;
				this.match(CssParser.STRING);
				}
				break;
			default:
				throw new NoViableAltException(this);
			}
			this.state = 284;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===78) {
				{
				{
				this.state = 281;
				this.match(CssParser.WS);
				}
				}
				this.state = 286;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 294;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===9) {
				{
				this.state = 287;
				this.match(CssParser.ATTRIBUTE_FLAG);
				this.state = 291;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 288;
					this.match(CssParser.WS);
					}
					}
					this.state = 293;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				}
			}

			this.state = 296;
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
			this.state = 299;
			this._errHandler.sync(this);
			_alt = 1;
			do {
				switch (_alt) {
				case 1:
					{
					{
					this.state = 298;
					this.simpleSelector();
					}
					}
					break;
				default:
					throw new NoViableAltException(this);
				}
				this.state = 301;
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
			this.state = 303;
			this.compoundSelector();
			this.state = 322;
			this._errHandler.sync(this);
			_alt = this._interp.adaptivePredict(this._input, 32, this._ctx);
			while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
				if (_alt === 1) {
					{
					{
					this.state = 307;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 304;
						this.match(CssParser.WS);
						}
						}
						this.state = 309;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 317;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					if (((((_la - 30)) & ~0x1F) === 0 && ((1 << (_la - 30)) & 323) !== 0)) {
						{
						this.state = 310;
						this.combinator();
						this.state = 314;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
						while (_la===78) {
							{
							{
							this.state = 311;
							this.match(CssParser.WS);
							}
							}
							this.state = 316;
							this._errHandler.sync(this);
							_la = this._input.LA(1);
						}
						}
					}

					this.state = 319;
					this.compoundSelector();
					}
					}
				}
				this.state = 324;
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
			this.state = 325;
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
			this.state = 334;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (((((_la - 30)) & ~0x1F) === 0 && ((1 << (_la - 30)) & 323) !== 0)) {
				{
				this.state = 327;
				this.combinator();
				this.state = 331;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 328;
					this.match(CssParser.WS);
					}
					}
					this.state = 333;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				}
			}

			this.state = 336;
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
			this.state = 338;
			this.relativeSelector();
			this.state = 355;
			this._errHandler.sync(this);
			_alt = this._interp.adaptivePredict(this._input, 37, this._ctx);
			while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
				if (_alt === 1) {
					{
					{
					this.state = 342;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 339;
						this.match(CssParser.WS);
						}
						}
						this.state = 344;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 345;
					this.match(CssParser.COMMA);
					this.state = 349;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 346;
						this.match(CssParser.WS);
						}
						}
						this.state = 351;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 352;
					this.relativeSelector();
					}
					}
				}
				this.state = 357;
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
			this.state = 358;
			this.complexSelector();
			this.state = 375;
			this._errHandler.sync(this);
			_alt = this._interp.adaptivePredict(this._input, 40, this._ctx);
			while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
				if (_alt === 1) {
					{
					{
					this.state = 362;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 359;
						this.match(CssParser.WS);
						}
						}
						this.state = 364;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 365;
					this.match(CssParser.COMMA);
					this.state = 369;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 366;
						this.match(CssParser.WS);
						}
						}
						this.state = 371;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 372;
					this.complexSelector();
					}
					}
				}
				this.state = 377;
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
			this.state = 381;
			this._errHandler.sync(this);
			_alt = this._interp.adaptivePredict(this._input, 41, this._ctx);
			while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
				if (_alt === 1) {
					{
					{
					this.state = 378;
					this.match(CssParser.WS);
					}
					}
				}
				this.state = 383;
				this._errHandler.sync(this);
				_alt = this._interp.adaptivePredict(this._input, 41, this._ctx);
			}
			this.state = 406;
			this._errHandler.sync(this);
			switch ( this._interp.adaptivePredict(this._input, 45, this._ctx) ) {
			case 1:
				{
				this.state = 385;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if ((((_la) & ~0x1F) === 0 && ((1 << _la) & 33555198) !== 0) || ((((_la - 72)) & ~0x1F) === 0 && ((1 << (_la - 72)) & 1055) !== 0)) {
					{
					this.state = 384;
					this.declaration();
					}
				}

				this.state = 397;
				this._errHandler.sync(this);
				_alt = this._interp.adaptivePredict(this._input, 44, this._ctx);
				while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
					if (_alt === 1) {
						{
						{
						this.state = 390;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
						while (_la===78) {
							{
							{
							this.state = 387;
							this.match(CssParser.WS);
							}
							}
							this.state = 392;
							this._errHandler.sync(this);
							_la = this._input.LA(1);
						}
						this.state = 393;
						this.match(CssParser.SEMI);
						this.state = 394;
						this.declarationList();
						}
						}
					}
					this.state = 399;
					this._errHandler.sync(this);
					_alt = this._interp.adaptivePredict(this._input, 44, this._ctx);
				}
				}
				break;
			case 2:
				{
				this.state = 400;
				this.innerAtRule();
				this.state = 401;
				this.declarationList();
				}
				break;
			case 3:
				{
				this.state = 403;
				this.innerQualifiedRule();
				this.state = 404;
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
			this.state = 446;
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
				this.state = 408;
				this.identifier();
				this.state = 412;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 409;
					this.match(CssParser.WS);
					}
					}
					this.state = 414;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 415;
				this.match(CssParser.COLON);
				this.state = 419;
				this._errHandler.sync(this);
				_alt = this._interp.adaptivePredict(this._input, 47, this._ctx);
				while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
					if (_alt === 1) {
						{
						{
						this.state = 416;
						this.match(CssParser.WS);
						}
						}
					}
					this.state = 421;
					this._errHandler.sync(this);
					_alt = this._interp.adaptivePredict(this._input, 47, this._ctx);
				}
				this.state = 422;
				this.valueList();
				this.state = 430;
				this._errHandler.sync(this);
				switch ( this._interp.adaptivePredict(this._input, 49, this._ctx) ) {
				case 1:
					{
					this.state = 426;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 423;
						this.match(CssParser.WS);
						}
						}
						this.state = 428;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 429;
					this.match(CssParser.IMPORTANT);
					}
					break;
				}
				}
				break;
			case 76:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 432;
				this.match(CssParser.CUSTOM_IDENT);
				this.state = 436;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 433;
					this.match(CssParser.WS);
					}
					}
					this.state = 438;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 439;
				this.match(CssParser.COLON);
				this.state = 443;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===84) {
					{
					{
					this.state = 440;
					this.match(CssParser.CUSTOM_VALUE);
					}
					}
					this.state = 445;
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
			this.state = 449;
			this._errHandler.sync(this);
			_alt = 1;
			do {
				switch (_alt) {
				case 1:
					{
					{
					this.state = 448;
					this.value();
					}
					}
					break;
				default:
					throw new NoViableAltException(this);
				}
				this.state = 451;
				this._errHandler.sync(this);
				_alt = this._interp.adaptivePredict(this._input, 53, this._ctx);
			} while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER);
			this.state = 461;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===29 || _la===52) {
				{
				{
				this.state = 453;
				_la = this._input.LA(1);
				if(!(_la===29 || _la===52)) {
				this._errHandler.recoverInline(this);
				}
				else {
					this._errHandler.reportMatch(this);
				    this.consume();
				}
				this.state = 455;
				this._errHandler.sync(this);
				_alt = 1;
				do {
					switch (_alt) {
					case 1:
						{
						{
						this.state = 454;
						this.value();
						}
						}
						break;
					default:
						throw new NoViableAltException(this);
					}
					this.state = 457;
					this._errHandler.sync(this);
					_alt = this._interp.adaptivePredict(this._input, 54, this._ctx);
				} while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER);
				}
				}
				this.state = 463;
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
			this.state = 478;
			this._errHandler.sync(this);
			switch ( this._interp.adaptivePredict(this._input, 56, this._ctx) ) {
			case 1:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 464;
				this.match(CssParser.WS);
				}
				break;
			case 2:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 465;
				this.identifier();
				}
				break;
			case 3:
				this.enterOuterAlt(localctx, 3);
				{
				this.state = 466;
				this.integer();
				}
				break;
			case 4:
				this.enterOuterAlt(localctx, 4);
				{
				this.state = 467;
				this.number_();
				}
				break;
			case 5:
				this.enterOuterAlt(localctx, 5);
				{
				this.state = 468;
				this.dimension();
				}
				break;
			case 6:
				this.enterOuterAlt(localctx, 6);
				{
				this.state = 469;
				this.match(CssParser.COLOR_IDENT_START);
				}
				break;
			case 7:
				this.enterOuterAlt(localctx, 7);
				{
				this.state = 470;
				this.match(CssParser.COLOR_INT_START);
				}
				break;
			case 8:
				this.enterOuterAlt(localctx, 8);
				{
				this.state = 471;
				this.match(CssParser.STRING);
				}
				break;
			case 9:
				this.enterOuterAlt(localctx, 9);
				{
				this.state = 472;
				this.function_();
				}
				break;
			case 10:
				this.enterOuterAlt(localctx, 10);
				{
				this.state = 473;
				this.match(CssParser.LSQUARE);
				this.state = 474;
				this.identifier();
				this.state = 475;
				this.match(CssParser.RSQUARE);
				}
				break;
			case 11:
				this.enterOuterAlt(localctx, 11);
				{
				this.state = 477;
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
			this.state = 480;
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
			this.state = 482;
			this.mathProduct();
			this.state = 499;
			this._errHandler.sync(this);
			_alt = this._interp.adaptivePredict(this._input, 59, this._ctx);
			while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
				if (_alt === 1) {
					{
					{
					this.state = 486;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 483;
						this.match(CssParser.WS);
						}
						}
						this.state = 488;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 489;
					_la = this._input.LA(1);
					if(!(_la===36 || _la===37)) {
					this._errHandler.recoverInline(this);
					}
					else {
						this._errHandler.reportMatch(this);
					    this.consume();
					}
					this.state = 493;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 490;
						this.match(CssParser.WS);
						}
						}
						this.state = 495;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 496;
					this.mathProduct();
					}
					}
				}
				this.state = 501;
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
			this.state = 502;
			this.mathValue();
			this.state = 519;
			this._errHandler.sync(this);
			_alt = this._interp.adaptivePredict(this._input, 62, this._ctx);
			while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
				if (_alt === 1) {
					{
					{
					this.state = 506;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 503;
						this.match(CssParser.WS);
						}
						}
						this.state = 508;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 509;
					_la = this._input.LA(1);
					if(!(_la===28 || _la===29)) {
					this._errHandler.recoverInline(this);
					}
					else {
						this._errHandler.reportMatch(this);
					    this.consume();
					}
					this.state = 513;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 510;
						this.match(CssParser.WS);
						}
						}
						this.state = 515;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 516;
					this.mathValue();
					}
					}
				}
				this.state = 521;
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
			this.state = 542;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 10:
			case 11:
			case 12:
			case 13:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 522;
				this.number_();
				}
				break;
			case 14:
			case 15:
			case 16:
			case 17:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 523;
				this.dimension();
				}
				break;
			case 18:
			case 19:
				this.enterOuterAlt(localctx, 3);
				{
				this.state = 524;
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
				this.state = 525;
				this.mathConstant();
				}
				break;
			case 48:
				this.enterOuterAlt(localctx, 5);
				{
				this.state = 526;
				this.match(CssParser.LPAREN);
				this.state = 530;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 527;
					this.match(CssParser.WS);
					}
					}
					this.state = 532;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 533;
				this.mathSum();
				this.state = 537;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 534;
					this.match(CssParser.WS);
					}
					}
					this.state = 539;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 540;
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
			this.state = 551;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 72:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 544;
				this.match(CssParser.E);
				}
				break;
			case 73:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 545;
				this.match(CssParser.PI);
				}
				break;
			case 37:
			case 74:
				this.enterOuterAlt(localctx, 3);
				{
				this.state = 547;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if (_la===37) {
					{
					this.state = 546;
					this.match(CssParser.MINUS);
					}
				}

				this.state = 549;
				this.match(CssParser.INFINITY);
				}
				break;
			case 75:
				this.enterOuterAlt(localctx, 4);
				{
				this.state = 550;
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
			this.state = 602;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 68:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 553;
				this.match(CssParser.URL_FUNCTION);
				}
				break;
			case 70:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 554;
				this.match(CssParser.VAR_FUNCTION);
				this.state = 555;
				this.match(CssParser.LPAREN);
				this.state = 559;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 556;
					this.match(CssParser.WS);
					}
					}
					this.state = 561;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 562;
				this.match(CssParser.CUSTOM_IDENT);
				this.state = 577;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if (_la===52 || _la===78) {
					{
					this.state = 566;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 563;
						this.match(CssParser.WS);
						}
						}
						this.state = 568;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 569;
					this.match(CssParser.COMMA);
					this.state = 573;
					this._errHandler.sync(this);
					_alt = this._interp.adaptivePredict(this._input, 70, this._ctx);
					while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
						if (_alt === 1) {
							{
							{
							this.state = 570;
							this.match(CssParser.WS);
							}
							}
						}
						this.state = 575;
						this._errHandler.sync(this);
						_alt = this._interp.adaptivePredict(this._input, 70, this._ctx);
					}
					this.state = 576;
					this.valueList();
					}
				}

				this.state = 579;
				this.match(CssParser.RPAREN);
				}
				break;
			case 71:
				this.enterOuterAlt(localctx, 3);
				{
				this.state = 580;
				this.match(CssParser.CALC_FUNCTION);
				this.state = 581;
				this.match(CssParser.LPAREN);
				this.state = 585;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 582;
					this.match(CssParser.WS);
					}
					}
					this.state = 587;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 588;
				this.mathSum();
				this.state = 592;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 589;
					this.match(CssParser.WS);
					}
					}
					this.state = 594;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 595;
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
				this.state = 597;
				this.identifier();
				this.state = 598;
				this.match(CssParser.LPAREN);
				this.state = 599;
				this.valueList();
				this.state = 600;
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
			this.state = 604;
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
			this.state = 606;
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
			this.state = 608;
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
			this.state = 610;
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
			this.state = 618;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 56:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 612;
				this.importAtRule();
				}
				break;
			case 58:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 613;
				this.mediaAtRule();
				}
				break;
			case 67:
				this.enterOuterAlt(localctx, 3);
				{
				this.state = 614;
				this.unknownAtRule();
				}
				break;
			case 60:
				this.enterOuterAlt(localctx, 4);
				{
				this.state = 615;
				this.pageAtRule();
				}
				break;
			case 61:
				this.enterOuterAlt(localctx, 5);
				{
				this.state = 616;
				this.fontFaceAtRule();
				}
				break;
			case 59:
				this.enterOuterAlt(localctx, 6);
				{
				this.state = 617;
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
			this.state = 623;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 58:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 620;
				this.inner_MediaAtRule();
				}
				break;
			case 60:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 621;
				this.inner_PageAtRule();
				}
				break;
			case 67:
				this.enterOuterAlt(localctx, 3);
				{
				this.state = 622;
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
			this.state = 625;
			this.match(CssParser.MEDIA_RULE);
			this.state = 629;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===78) {
				{
				{
				this.state = 626;
				this.match(CssParser.WS);
				}
				}
				this.state = 631;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 632;
			this.mediaQuery();
			this.state = 636;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===78) {
				{
				{
				this.state = 633;
				this.match(CssParser.WS);
				}
				}
				this.state = 638;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 639;
			this.match(CssParser.LCURLY);
			this.state = 640;
			this.main();
			this.state = 641;
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
	public inner_MediaAtRule(): Inner_MediaAtRuleContext {
		let localctx: Inner_MediaAtRuleContext = new Inner_MediaAtRuleContext(this, this._ctx, this.state);
		this.enterRule(localctx, 64, CssParser.RULE_inner_MediaAtRule);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 643;
			this.match(CssParser.MEDIA_RULE);
			this.state = 647;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===78) {
				{
				{
				this.state = 644;
				this.match(CssParser.WS);
				}
				}
				this.state = 649;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 650;
			this.mediaQuery();
			this.state = 654;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===78) {
				{
				{
				this.state = 651;
				this.match(CssParser.WS);
				}
				}
				this.state = 656;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 657;
			this.match(CssParser.LCURLY);
			this.state = 658;
			this.declarationList();
			this.state = 659;
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
			this.state = 688;
			this._errHandler.sync(this);
			switch ( this._interp.adaptivePredict(this._input, 86, this._ctx) ) {
			case 1:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 661;
				this.mediaCondition();
				}
				break;
			case 2:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 669;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if (_la===3 || _la===4) {
					{
					this.state = 662;
					_la = this._input.LA(1);
					if(!(_la===3 || _la===4)) {
					this._errHandler.recoverInline(this);
					}
					else {
						this._errHandler.reportMatch(this);
					    this.consume();
					}
					this.state = 666;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 663;
						this.match(CssParser.WS);
						}
						}
						this.state = 668;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					}
				}

				this.state = 671;
				this.mediaType();
				this.state = 686;
				this._errHandler.sync(this);
				switch ( this._interp.adaptivePredict(this._input, 85, this._ctx) ) {
				case 1:
					{
					this.state = 675;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 672;
						this.match(CssParser.WS);
						}
						}
						this.state = 677;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 678;
					this.match(CssParser.AND);
					this.state = 682;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 679;
						this.match(CssParser.WS);
						}
						}
						this.state = 684;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 685;
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
			this.state = 690;
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
			this.state = 714;
			this._errHandler.sync(this);
			switch ( this._interp.adaptivePredict(this._input, 91, this._ctx) ) {
			case 1:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 692;
				this.mediaNot();
				}
				break;
			case 2:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 693;
				this.mediaInParens();
				{
				this.state = 697;
				this._errHandler.sync(this);
				_alt = this._interp.adaptivePredict(this._input, 87, this._ctx);
				while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
					if (_alt === 1) {
						{
						{
						this.state = 694;
						this.match(CssParser.WS);
						}
						}
					}
					this.state = 699;
					this._errHandler.sync(this);
					_alt = this._interp.adaptivePredict(this._input, 87, this._ctx);
				}
				this.state = 712;
				this._errHandler.sync(this);
				switch ( this._interp.adaptivePredict(this._input, 90, this._ctx) ) {
				case 1:
					{
					this.state = 703;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===1) {
						{
						{
						this.state = 700;
						this.mediaAnd();
						}
						}
						this.state = 705;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					}
					break;
				case 2:
					{
					this.state = 709;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===2) {
						{
						{
						this.state = 706;
						this.mediaOr();
						}
						}
						this.state = 711;
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
			this.state = 730;
			this._errHandler.sync(this);
			switch ( this._interp.adaptivePredict(this._input, 94, this._ctx) ) {
			case 1:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 716;
				this.mediaNot();
				}
				break;
			case 2:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 717;
				this.mediaInParens();
				this.state = 727;
				this._errHandler.sync(this);
				_alt = this._interp.adaptivePredict(this._input, 93, this._ctx);
				while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
					if (_alt === 1) {
						{
						{
						this.state = 721;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
						while (_la===78) {
							{
							{
							this.state = 718;
							this.match(CssParser.WS);
							}
							}
							this.state = 723;
							this._errHandler.sync(this);
							_la = this._input.LA(1);
						}
						this.state = 724;
						this.mediaAnd();
						}
						}
					}
					this.state = 729;
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
			this.state = 732;
			this.match(CssParser.NOT);
			this.state = 736;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===78) {
				{
				{
				this.state = 733;
				this.match(CssParser.WS);
				}
				}
				this.state = 738;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 739;
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
			this.state = 741;
			this.match(CssParser.AND);
			this.state = 745;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===78) {
				{
				{
				this.state = 742;
				this.match(CssParser.WS);
				}
				}
				this.state = 747;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 748;
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
			this.state = 750;
			this.match(CssParser.OR);
			this.state = 754;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===78) {
				{
				{
				this.state = 751;
				this.match(CssParser.WS);
				}
				}
				this.state = 756;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 757;
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
			this.state = 779;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 48:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 759;
				this.match(CssParser.LPAREN);
				this.state = 763;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 760;
					this.match(CssParser.WS);
					}
					}
					this.state = 765;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 768;
				this._errHandler.sync(this);
				switch ( this._interp.adaptivePredict(this._input, 99, this._ctx) ) {
				case 1:
					{
					this.state = 766;
					this.mediaCondition();
					}
					break;
				case 2:
					{
					this.state = 767;
					this.mediaFeature();
					}
					break;
				}
				this.state = 773;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 770;
					this.match(CssParser.WS);
					}
					}
					this.state = 775;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 776;
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
				this.state = 778;
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
			this.state = 829;
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
				this.state = 781;
				this.identifier();
				this.state = 808;
				this._errHandler.sync(this);
				switch ( this._interp.adaptivePredict(this._input, 106, this._ctx) ) {
				case 1:
					{
					this.state = 785;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 782;
						this.match(CssParser.WS);
						}
						}
						this.state = 787;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 806;
					this._errHandler.sync(this);
					switch ( this._interp.adaptivePredict(this._input, 105, this._ctx) ) {
					case 1:
						{
						this.state = 788;
						this.match(CssParser.COLON);
						this.state = 792;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
						while (_la===78) {
							{
							{
							this.state = 789;
							this.match(CssParser.WS);
							}
							}
							this.state = 794;
							this._errHandler.sync(this);
							_la = this._input.LA(1);
						}
						this.state = 795;
						this.mfValue();
						}
						break;
					case 2:
						{
						this.state = 796;
						this.mediaRange();
						}
						break;
					case 3:
						{
						this.state = 797;
						this.mfComparison();
						this.state = 801;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
						while (_la===78) {
							{
							{
							this.state = 798;
							this.match(CssParser.WS);
							}
							}
							this.state = 803;
							this._errHandler.sync(this);
							_la = this._input.LA(1);
						}
						this.state = 804;
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
				this.state = 810;
				this.mfNonIdentifierValue();
				this.state = 814;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 811;
					this.match(CssParser.WS);
					}
					}
					this.state = 816;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 827;
				this._errHandler.sync(this);
				switch ( this._interp.adaptivePredict(this._input, 109, this._ctx) ) {
				case 1:
					{
					this.state = 817;
					this.mfComparison();
					this.state = 821;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 818;
						this.match(CssParser.WS);
						}
						}
						this.state = 823;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 824;
					this.identifier();
					}
					break;
				case 2:
					{
					this.state = 826;
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
			this.state = 881;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 32:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 831;
				this.mfLt();
				this.state = 835;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 832;
					this.match(CssParser.WS);
					}
					}
					this.state = 837;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 838;
				this.identifier();
				this.state = 854;
				this._errHandler.sync(this);
				switch ( this._interp.adaptivePredict(this._input, 114, this._ctx) ) {
				case 1:
					{
					this.state = 842;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 839;
						this.match(CssParser.WS);
						}
						}
						this.state = 844;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 845;
					this.mfLt();
					this.state = 849;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 846;
						this.match(CssParser.WS);
						}
						}
						this.state = 851;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 852;
					this.mfValue();
					}
					break;
				}
				}
				break;
			case 31:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 856;
				this.mfGt();
				this.state = 860;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 857;
					this.match(CssParser.WS);
					}
					}
					this.state = 862;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 863;
				this.identifier();
				this.state = 879;
				this._errHandler.sync(this);
				switch ( this._interp.adaptivePredict(this._input, 118, this._ctx) ) {
				case 1:
					{
					this.state = 867;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 864;
						this.match(CssParser.WS);
						}
						}
						this.state = 869;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 870;
					this.mfGt();
					this.state = 874;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 871;
						this.match(CssParser.WS);
						}
						}
						this.state = 876;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 877;
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
			this.state = 901;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 10:
			case 11:
			case 12:
			case 13:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 883;
				this.number_();
				this.state = 898;
				this._errHandler.sync(this);
				switch ( this._interp.adaptivePredict(this._input, 122, this._ctx) ) {
				case 1:
					{
					this.state = 887;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 884;
						this.match(CssParser.WS);
						}
						}
						this.state = 889;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 890;
					this.match(CssParser.SLASH);
					this.state = 894;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
					while (_la===78) {
						{
						{
						this.state = 891;
						this.match(CssParser.WS);
						}
						}
						this.state = 896;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
					}
					this.state = 897;
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
				this.state = 900;
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
			this.state = 905;
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
				this.state = 903;
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
				this.state = 904;
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
			this.state = 907;
			this.match(CssParser.LT);
			this.state = 909;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===35) {
				{
				this.state = 908;
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
			this.state = 911;
			this.match(CssParser.GT);
			this.state = 913;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===35) {
				{
				this.state = 912;
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
			this.state = 915;
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
			this.state = 920;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 32:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 917;
				this.mfLt();
				}
				break;
			case 31:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 918;
				this.mfGt();
				}
				break;
			case 35:
				this.enterOuterAlt(localctx, 3);
				{
				this.state = 919;
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
			this.state = 922;
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
			this.state = 924;
			this.number_();
			this.state = 928;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===78) {
				{
				{
				this.state = 925;
				this.match(CssParser.WS);
				}
				}
				this.state = 930;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 931;
			this.match(CssParser.SLASH);
			this.state = 935;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===78) {
				{
				{
				this.state = 932;
				this.match(CssParser.WS);
				}
				}
				this.state = 937;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 938;
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
			this.state = 940;
			this.match(CssParser.PAGE_RULE);
			this.state = 944;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===78) {
				{
				{
				this.state = 941;
				this.match(CssParser.WS);
				}
				}
				this.state = 946;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 954;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===27) {
				{
				this.state = 947;
				this.match(CssParser.PAGE_PSEUDO_CLASS);
				this.state = 951;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 948;
					this.match(CssParser.WS);
					}
					}
					this.state = 953;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				}
			}

			this.state = 956;
			this.match(CssParser.LCURLY);
			this.state = 957;
			this.main();
			this.state = 958;
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
	public inner_PageAtRule(): Inner_PageAtRuleContext {
		let localctx: Inner_PageAtRuleContext = new Inner_PageAtRuleContext(this, this._ctx, this.state);
		this.enterRule(localctx, 104, CssParser.RULE_inner_PageAtRule);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 960;
			this.match(CssParser.PAGE_RULE);
			this.state = 964;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===78) {
				{
				{
				this.state = 961;
				this.match(CssParser.WS);
				}
				}
				this.state = 966;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 974;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===27) {
				{
				this.state = 967;
				this.match(CssParser.PAGE_PSEUDO_CLASS);
				this.state = 971;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 968;
					this.match(CssParser.WS);
					}
					}
					this.state = 973;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				}
			}

			this.state = 976;
			this.match(CssParser.LCURLY);
			this.state = 977;
			this.declarationList();
			this.state = 978;
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
		this.enterRule(localctx, 106, CssParser.RULE_fontFaceAtRule);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 980;
			this.match(CssParser.FONT_FACE_RULE);
			this.state = 984;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===78) {
				{
				{
				this.state = 981;
				this.match(CssParser.WS);
				}
				}
				this.state = 986;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 987;
			this.match(CssParser.LCURLY);
			this.state = 988;
			this.declarationList();
			this.state = 989;
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
		this.enterRule(localctx, 108, CssParser.RULE_supportsAtRule);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 991;
			this.match(CssParser.SUPPORTS_RULE);
			this.state = 995;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===78) {
				{
				{
				this.state = 992;
				this.match(CssParser.WS);
				}
				}
				this.state = 997;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 998;
			this.supportsCondition();
			this.state = 1002;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===78) {
				{
				{
				this.state = 999;
				this.match(CssParser.WS);
				}
				}
				this.state = 1004;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 1005;
			this.match(CssParser.LCURLY);
			this.state = 1006;
			this.main();
			this.state = 1007;
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
		this.enterRule(localctx, 110, CssParser.RULE_supportsCondition);
		let _la: number;
		try {
			let _alt: number;
			this.state = 1039;
			this._errHandler.sync(this);
			switch ( this._interp.adaptivePredict(this._input, 143, this._ctx) ) {
			case 1:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 1009;
				this.match(CssParser.NOT);
				this.state = 1010;
				this.supportsInParens();
				}
				break;
			case 2:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 1011;
				this.supportsInParens();
				this.state = 1022;
				this._errHandler.sync(this);
				_alt = this._interp.adaptivePredict(this._input, 140, this._ctx);
				while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
					if (_alt === 1) {
						{
						{
						this.state = 1015;
						this._errHandler.sync(this);
						_la = this._input.LA(1);
						while (_la===78) {
							{
							{
							this.state = 1012;
							this.match(CssParser.WS);
							}
							}
							this.state = 1017;
							this._errHandler.sync(this);
							_la = this._input.LA(1);
						}
						this.state = 1018;
						this.match(CssParser.AND);
						this.state = 1019;
						this.supportsInParens();
						}
						}
					}
					this.state = 1024;
					this._errHandler.sync(this);
					_alt = this._interp.adaptivePredict(this._input, 140, this._ctx);
				}
				}
				break;
			case 3:
				this.enterOuterAlt(localctx, 3);
				{
				this.state = 1025;
				this.supportsInParens();
				this.state = 1036;
				this._errHandler.sync(this);
				_alt = this._interp.adaptivePredict(this._input, 142, this._ctx);
				while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
					if (_alt === 1) {
						{
						{
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
						this.match(CssParser.OR);
						this.state = 1033;
						this.supportsInParens();
						}
						}
					}
					this.state = 1038;
					this._errHandler.sync(this);
					_alt = this._interp.adaptivePredict(this._input, 142, this._ctx);
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
		this.enterRule(localctx, 112, CssParser.RULE_supportsInParens);
		let _la: number;
		try {
			this.state = 1074;
			this._errHandler.sync(this);
			switch ( this._interp.adaptivePredict(this._input, 148, this._ctx) ) {
			case 1:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 1041;
				this.match(CssParser.LPAREN);
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
				this.supportsCondition();
				this.state = 1052;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 1049;
					this.match(CssParser.WS);
					}
					}
					this.state = 1054;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 1055;
				this.match(CssParser.RPAREN);
				}
				break;
			case 2:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 1057;
				this.match(CssParser.LPAREN);
				this.state = 1061;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 1058;
					this.match(CssParser.WS);
					}
					}
					this.state = 1063;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 1064;
				this.declaration();
				this.state = 1068;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 1065;
					this.match(CssParser.WS);
					}
					}
					this.state = 1070;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 1071;
				this.match(CssParser.RPAREN);
				}
				break;
			case 3:
				this.enterOuterAlt(localctx, 3);
				{
				this.state = 1073;
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
		this.enterRule(localctx, 114, CssParser.RULE_importAtRule);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 1076;
			this.match(CssParser.IMPORT_RULE);
			this.state = 1080;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===78) {
				{
				{
				this.state = 1077;
				this.match(CssParser.WS);
				}
				}
				this.state = 1082;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 1083;
			_la = this._input.LA(1);
			if(!(_la===54 || _la===68)) {
			this._errHandler.recoverInline(this);
			}
			else {
				this._errHandler.reportMatch(this);
			    this.consume();
			}
			this.state = 1101;
			this._errHandler.sync(this);
			switch ( this._interp.adaptivePredict(this._input, 153, this._ctx) ) {
			case 1:
				{
				this.state = 1087;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 1084;
					this.match(CssParser.WS);
					}
					}
					this.state = 1089;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 1090;
				this.match(CssParser.SUPPORTS_FUNCTION);
				this.state = 1094;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 1091;
					this.match(CssParser.WS);
					}
					}
					this.state = 1096;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 1099;
				this._errHandler.sync(this);
				switch ( this._interp.adaptivePredict(this._input, 152, this._ctx) ) {
				case 1:
					{
					this.state = 1097;
					this.supportsCondition();
					}
					break;
				case 2:
					{
					this.state = 1098;
					this.declaration();
					}
					break;
				}
				}
				break;
			}
			this.state = 1110;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if ((((_la) & ~0x1F) === 0 && ((1 << _la) & 33555198) !== 0) || ((((_la - 48)) & ~0x1F) === 0 && ((1 << (_la - 48)) & 1339031553) !== 0) || _la===82) {
				{
				this.state = 1106;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while (_la===78) {
					{
					{
					this.state = 1103;
					this.match(CssParser.WS);
					}
					}
					this.state = 1108;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 1109;
				this.mediaQuery();
				}
			}

			this.state = 1112;
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
		this.enterRule(localctx, 116, CssParser.RULE_unknownAtRule);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 1114;
			this.match(CssParser.AT_RULE);
			this.state = 1118;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while ((((_la) & ~0x1F) === 0 && ((1 << _la) & 48496382) !== 0) || ((((_la - 35)) & ~0x1F) === 0 && ((1 << (_la - 35)) & 958593) !== 0) || ((((_la - 67)) & ~0x1F) === 0 && ((1 << (_la - 67)) & 100859) !== 0)) {
				{
				{
				this.state = 1115;
				this.anyOuterValue();
				}
				}
				this.state = 1120;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 1130;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case 45:
				{
				this.state = 1121;
				this.match(CssParser.SEMI);
				}
				break;
			case 46:
				{
				this.state = 1122;
				this.match(CssParser.LCURLY);
				this.state = 1126;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while ((((_la) & ~0x1F) === 0 && ((1 << _la) & 132382462) !== 0) || ((((_la - 35)) & ~0x1F) === 0 && ((1 << (_la - 35)) & 961665) !== 0) || ((((_la - 67)) & ~0x1F) === 0 && ((1 << (_la - 67)) & 100859) !== 0)) {
					{
					{
					this.state = 1123;
					this.anyInnerValue();
					}
					}
					this.state = 1128;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 1129;
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
		this.enterRule(localctx, 118, CssParser.RULE_identifier);
		let _la: number;
		try {
			this.enterOuterAlt(localctx, 1);
			{
			this.state = 1132;
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
		this.enterRule(localctx, 120, CssParser.RULE_anyOuterValue);
		let _la: number;
		try {
			this.state = 1152;
			this._errHandler.sync(this);
			switch ( this._interp.adaptivePredict(this._input, 161, this._ctx) ) {
			case 1:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 1134;
				this.value();
				}
				break;
			case 2:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 1135;
				this.match(CssParser.COMMA);
				}
				break;
			case 3:
				this.enterOuterAlt(localctx, 3);
				{
				this.state = 1136;
				this.match(CssParser.LPAREN);
				this.state = 1140;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while ((((_la) & ~0x1F) === 0 && ((1 << _la) & 132382462) !== 0) || ((((_la - 35)) & ~0x1F) === 0 && ((1 << (_la - 35)) & 961665) !== 0) || ((((_la - 67)) & ~0x1F) === 0 && ((1 << (_la - 67)) & 100859) !== 0)) {
					{
					{
					this.state = 1137;
					this.anyInnerValue();
					}
					}
					this.state = 1142;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 1143;
				this.match(CssParser.RPAREN);
				}
				break;
			case 4:
				this.enterOuterAlt(localctx, 4);
				{
				this.state = 1144;
				this.match(CssParser.LSQUARE);
				this.state = 1148;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while ((((_la) & ~0x1F) === 0 && ((1 << _la) & 132382462) !== 0) || ((((_la - 35)) & ~0x1F) === 0 && ((1 << (_la - 35)) & 961665) !== 0) || ((((_la - 67)) & ~0x1F) === 0 && ((1 << (_la - 67)) & 100859) !== 0)) {
					{
					{
					this.state = 1145;
					this.anyInnerValue();
					}
					}
					this.state = 1150;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 1151;
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
		this.enterRule(localctx, 122, CssParser.RULE_anyInnerValue);
		let _la: number;
		try {
			this.state = 1166;
			this._errHandler.sync(this);
			switch ( this._interp.adaptivePredict(this._input, 163, this._ctx) ) {
			case 1:
				this.enterOuterAlt(localctx, 1);
				{
				this.state = 1154;
				this.anyOuterValue();
				}
				break;
			case 2:
				this.enterOuterAlt(localctx, 2);
				{
				this.state = 1155;
				this.match(CssParser.LCURLY);
				this.state = 1159;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				while ((((_la) & ~0x1F) === 0 && ((1 << _la) & 132382462) !== 0) || ((((_la - 35)) & ~0x1F) === 0 && ((1 << (_la - 35)) & 961665) !== 0) || ((((_la - 67)) & ~0x1F) === 0 && ((1 << (_la - 67)) & 100859) !== 0)) {
					{
					{
					this.state = 1156;
					this.anyInnerValue();
					}
					}
					this.state = 1161;
					this._errHandler.sync(this);
					_la = this._input.LA(1);
				}
				this.state = 1162;
				this.match(CssParser.RCURLY);
				}
				break;
			case 3:
				this.enterOuterAlt(localctx, 3);
				{
				this.state = 1163;
				this.match(CssParser.ID);
				}
				break;
			case 4:
				this.enterOuterAlt(localctx, 4);
				{
				this.state = 1164;
				this.match(CssParser.SEMI);
				}
				break;
			case 5:
				this.enterOuterAlt(localctx, 5);
				{
				this.state = 1165;
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

	public static readonly _serializedATN: number[] = [4,1,84,1169,2,0,7,0,
	2,1,7,1,2,2,7,2,2,3,7,3,2,4,7,4,2,5,7,5,2,6,7,6,2,7,7,7,2,8,7,8,2,9,7,9,
	2,10,7,10,2,11,7,11,2,12,7,12,2,13,7,13,2,14,7,14,2,15,7,15,2,16,7,16,2,
	17,7,17,2,18,7,18,2,19,7,19,2,20,7,20,2,21,7,21,2,22,7,22,2,23,7,23,2,24,
	7,24,2,25,7,25,2,26,7,26,2,27,7,27,2,28,7,28,2,29,7,29,2,30,7,30,2,31,7,
	31,2,32,7,32,2,33,7,33,2,34,7,34,2,35,7,35,2,36,7,36,2,37,7,37,2,38,7,38,
	2,39,7,39,2,40,7,40,2,41,7,41,2,42,7,42,2,43,7,43,2,44,7,44,2,45,7,45,2,
	46,7,46,2,47,7,47,2,48,7,48,2,49,7,49,2,50,7,50,2,51,7,51,2,52,7,52,2,53,
	7,53,2,54,7,54,2,55,7,55,2,56,7,56,2,57,7,57,2,58,7,58,2,59,7,59,2,60,7,
	60,2,61,7,61,1,0,3,0,126,8,0,1,0,1,0,1,0,1,1,1,1,1,1,5,1,134,8,1,10,1,12,
	1,137,9,1,1,2,1,2,5,2,141,8,2,10,2,12,2,144,9,2,1,2,1,2,1,2,1,2,1,3,1,3,
	5,3,152,8,3,10,3,12,3,155,9,3,1,3,1,3,1,3,1,3,1,4,1,4,1,4,1,4,1,4,1,4,1,
	4,1,4,3,4,169,8,4,1,5,1,5,1,5,1,6,1,6,1,6,5,6,177,8,6,10,6,12,6,180,9,6,
	1,6,1,6,5,6,184,8,6,10,6,12,6,187,9,6,1,6,1,6,1,6,1,6,1,6,5,6,194,8,6,10,
	6,12,6,197,9,6,1,6,1,6,5,6,201,8,6,10,6,12,6,204,9,6,1,6,1,6,1,6,1,6,3,
	6,210,8,6,1,6,1,6,1,6,5,6,215,8,6,10,6,12,6,218,9,6,1,6,3,6,221,8,6,3,6,
	223,8,6,1,7,1,7,1,7,1,7,1,7,3,7,230,8,7,1,7,1,7,1,7,4,7,235,8,7,11,7,12,
	7,236,1,7,3,7,240,8,7,1,7,5,7,243,8,7,10,7,12,7,246,9,7,1,7,1,7,5,7,250,
	8,7,10,7,12,7,253,9,7,1,7,3,7,256,8,7,3,7,258,8,7,1,8,1,8,5,8,262,8,8,10,
	8,12,8,265,9,8,1,8,1,8,3,8,269,8,8,1,8,1,8,5,8,273,8,8,10,8,12,8,276,9,
	8,1,8,1,8,3,8,280,8,8,1,8,5,8,283,8,8,10,8,12,8,286,9,8,1,8,1,8,5,8,290,
	8,8,10,8,12,8,293,9,8,3,8,295,8,8,1,8,1,8,1,9,4,9,300,8,9,11,9,12,9,301,
	1,10,1,10,5,10,306,8,10,10,10,12,10,309,9,10,1,10,1,10,5,10,313,8,10,10,
	10,12,10,316,9,10,3,10,318,8,10,1,10,5,10,321,8,10,10,10,12,10,324,9,10,
	1,11,1,11,1,12,1,12,5,12,330,8,12,10,12,12,12,333,9,12,3,12,335,8,12,1,
	12,1,12,1,13,1,13,5,13,341,8,13,10,13,12,13,344,9,13,1,13,1,13,5,13,348,
	8,13,10,13,12,13,351,9,13,1,13,5,13,354,8,13,10,13,12,13,357,9,13,1,14,
	1,14,5,14,361,8,14,10,14,12,14,364,9,14,1,14,1,14,5,14,368,8,14,10,14,12,
	14,371,9,14,1,14,5,14,374,8,14,10,14,12,14,377,9,14,1,15,5,15,380,8,15,
	10,15,12,15,383,9,15,1,15,3,15,386,8,15,1,15,5,15,389,8,15,10,15,12,15,
	392,9,15,1,15,1,15,5,15,396,8,15,10,15,12,15,399,9,15,1,15,1,15,1,15,1,
	15,1,15,1,15,3,15,407,8,15,1,16,1,16,5,16,411,8,16,10,16,12,16,414,9,16,
	1,16,1,16,5,16,418,8,16,10,16,12,16,421,9,16,1,16,1,16,5,16,425,8,16,10,
	16,12,16,428,9,16,1,16,3,16,431,8,16,1,16,1,16,5,16,435,8,16,10,16,12,16,
	438,9,16,1,16,1,16,5,16,442,8,16,10,16,12,16,445,9,16,3,16,447,8,16,1,17,
	4,17,450,8,17,11,17,12,17,451,1,17,1,17,4,17,456,8,17,11,17,12,17,457,5,
	17,460,8,17,10,17,12,17,463,9,17,1,18,1,18,1,18,1,18,1,18,1,18,1,18,1,18,
	1,18,1,18,1,18,1,18,1,18,1,18,3,18,479,8,18,1,19,1,19,1,20,1,20,5,20,485,
	8,20,10,20,12,20,488,9,20,1,20,1,20,5,20,492,8,20,10,20,12,20,495,9,20,
	1,20,5,20,498,8,20,10,20,12,20,501,9,20,1,21,1,21,5,21,505,8,21,10,21,12,
	21,508,9,21,1,21,1,21,5,21,512,8,21,10,21,12,21,515,9,21,1,21,5,21,518,
	8,21,10,21,12,21,521,9,21,1,22,1,22,1,22,1,22,1,22,1,22,5,22,529,8,22,10,
	22,12,22,532,9,22,1,22,1,22,5,22,536,8,22,10,22,12,22,539,9,22,1,22,1,22,
	3,22,543,8,22,1,23,1,23,1,23,3,23,548,8,23,1,23,1,23,3,23,552,8,23,1,24,
	1,24,1,24,1,24,5,24,558,8,24,10,24,12,24,561,9,24,1,24,1,24,5,24,565,8,
	24,10,24,12,24,568,9,24,1,24,1,24,5,24,572,8,24,10,24,12,24,575,9,24,1,
	24,3,24,578,8,24,1,24,1,24,1,24,1,24,5,24,584,8,24,10,24,12,24,587,9,24,
	1,24,1,24,5,24,591,8,24,10,24,12,24,594,9,24,1,24,1,24,1,24,1,24,1,24,1,
	24,1,24,3,24,603,8,24,1,25,1,25,1,26,1,26,1,27,1,27,1,28,1,28,1,29,1,29,
	1,29,1,29,1,29,1,29,3,29,619,8,29,1,30,1,30,1,30,3,30,624,8,30,1,31,1,31,
	5,31,628,8,31,10,31,12,31,631,9,31,1,31,1,31,5,31,635,8,31,10,31,12,31,
	638,9,31,1,31,1,31,1,31,1,31,1,32,1,32,5,32,646,8,32,10,32,12,32,649,9,
	32,1,32,1,32,5,32,653,8,32,10,32,12,32,656,9,32,1,32,1,32,1,32,1,32,1,33,
	1,33,1,33,5,33,665,8,33,10,33,12,33,668,9,33,3,33,670,8,33,1,33,1,33,5,
	33,674,8,33,10,33,12,33,677,9,33,1,33,1,33,5,33,681,8,33,10,33,12,33,684,
	9,33,1,33,3,33,687,8,33,3,33,689,8,33,1,34,1,34,1,35,1,35,1,35,5,35,696,
	8,35,10,35,12,35,699,9,35,1,35,5,35,702,8,35,10,35,12,35,705,9,35,1,35,
	5,35,708,8,35,10,35,12,35,711,9,35,3,35,713,8,35,3,35,715,8,35,1,36,1,36,
	1,36,5,36,720,8,36,10,36,12,36,723,9,36,1,36,5,36,726,8,36,10,36,12,36,
	729,9,36,3,36,731,8,36,1,37,1,37,5,37,735,8,37,10,37,12,37,738,9,37,1,37,
	1,37,1,38,1,38,5,38,744,8,38,10,38,12,38,747,9,38,1,38,1,38,1,39,1,39,5,
	39,753,8,39,10,39,12,39,756,9,39,1,39,1,39,1,40,1,40,5,40,762,8,40,10,40,
	12,40,765,9,40,1,40,1,40,3,40,769,8,40,1,40,5,40,772,8,40,10,40,12,40,775,
	9,40,1,40,1,40,1,40,3,40,780,8,40,1,41,1,41,5,41,784,8,41,10,41,12,41,787,
	9,41,1,41,1,41,5,41,791,8,41,10,41,12,41,794,9,41,1,41,1,41,1,41,1,41,5,
	41,800,8,41,10,41,12,41,803,9,41,1,41,1,41,3,41,807,8,41,3,41,809,8,41,
	1,41,1,41,5,41,813,8,41,10,41,12,41,816,9,41,1,41,1,41,5,41,820,8,41,10,
	41,12,41,823,9,41,1,41,1,41,1,41,3,41,828,8,41,3,41,830,8,41,1,42,1,42,
	5,42,834,8,42,10,42,12,42,837,9,42,1,42,1,42,5,42,841,8,42,10,42,12,42,
	844,9,42,1,42,1,42,5,42,848,8,42,10,42,12,42,851,9,42,1,42,1,42,3,42,855,
	8,42,1,42,1,42,5,42,859,8,42,10,42,12,42,862,9,42,1,42,1,42,5,42,866,8,
	42,10,42,12,42,869,9,42,1,42,1,42,5,42,873,8,42,10,42,12,42,876,9,42,1,
	42,1,42,3,42,880,8,42,3,42,882,8,42,1,43,1,43,5,43,886,8,43,10,43,12,43,
	889,9,43,1,43,1,43,5,43,893,8,43,10,43,12,43,896,9,43,1,43,3,43,899,8,43,
	1,43,3,43,902,8,43,1,44,1,44,3,44,906,8,44,1,45,1,45,3,45,910,8,45,1,46,
	1,46,3,46,914,8,46,1,47,1,47,1,48,1,48,1,48,3,48,921,8,48,1,49,1,49,1,50,
	1,50,5,50,927,8,50,10,50,12,50,930,9,50,1,50,1,50,5,50,934,8,50,10,50,12,
	50,937,9,50,1,50,1,50,1,51,1,51,5,51,943,8,51,10,51,12,51,946,9,51,1,51,
	1,51,5,51,950,8,51,10,51,12,51,953,9,51,3,51,955,8,51,1,51,1,51,1,51,1,
	51,1,52,1,52,5,52,963,8,52,10,52,12,52,966,9,52,1,52,1,52,5,52,970,8,52,
	10,52,12,52,973,9,52,3,52,975,8,52,1,52,1,52,1,52,1,52,1,53,1,53,5,53,983,
	8,53,10,53,12,53,986,9,53,1,53,1,53,1,53,1,53,1,54,1,54,5,54,994,8,54,10,
	54,12,54,997,9,54,1,54,1,54,5,54,1001,8,54,10,54,12,54,1004,9,54,1,54,1,
	54,1,54,1,54,1,55,1,55,1,55,1,55,5,55,1014,8,55,10,55,12,55,1017,9,55,1,
	55,1,55,5,55,1021,8,55,10,55,12,55,1024,9,55,1,55,1,55,5,55,1028,8,55,10,
	55,12,55,1031,9,55,1,55,1,55,5,55,1035,8,55,10,55,12,55,1038,9,55,3,55,
	1040,8,55,1,56,1,56,5,56,1044,8,56,10,56,12,56,1047,9,56,1,56,1,56,5,56,
	1051,8,56,10,56,12,56,1054,9,56,1,56,1,56,1,56,1,56,5,56,1060,8,56,10,56,
	12,56,1063,9,56,1,56,1,56,5,56,1067,8,56,10,56,12,56,1070,9,56,1,56,1,56,
	1,56,3,56,1075,8,56,1,57,1,57,5,57,1079,8,57,10,57,12,57,1082,9,57,1,57,
	1,57,5,57,1086,8,57,10,57,12,57,1089,9,57,1,57,1,57,5,57,1093,8,57,10,57,
	12,57,1096,9,57,1,57,1,57,3,57,1100,8,57,3,57,1102,8,57,1,57,5,57,1105,
	8,57,10,57,12,57,1108,9,57,1,57,3,57,1111,8,57,1,57,1,57,1,58,1,58,5,58,
	1117,8,58,10,58,12,58,1120,9,58,1,58,1,58,1,58,5,58,1125,8,58,10,58,12,
	58,1128,9,58,1,58,3,58,1131,8,58,1,59,1,59,1,60,1,60,1,60,1,60,5,60,1139,
	8,60,10,60,12,60,1142,9,60,1,60,1,60,1,60,5,60,1147,8,60,10,60,12,60,1150,
	9,60,1,60,3,60,1153,8,60,1,61,1,61,1,61,5,61,1158,8,61,10,61,12,61,1161,
	9,61,1,61,1,61,1,61,1,61,3,61,1167,8,61,1,61,0,0,62,0,2,4,6,8,10,12,14,
	16,18,20,22,24,26,28,30,32,34,36,38,40,42,44,46,48,50,52,54,56,58,60,62,
	64,66,68,70,72,74,76,78,80,82,84,86,88,90,92,94,96,98,100,102,104,106,108,
	110,112,114,116,118,120,122,0,14,3,0,28,28,30,30,39,41,3,0,30,31,36,36,
	38,38,2,0,29,29,52,52,6,0,23,23,35,35,42,42,53,53,67,67,83,83,1,0,36,37,
	1,0,28,29,1,0,10,11,1,0,10,13,1,0,14,17,1,0,18,19,1,0,3,4,2,0,5,7,82,82,
	2,0,54,54,68,68,5,0,1,7,9,9,25,25,72,75,82,82,1312,0,125,1,0,0,0,2,135,
	1,0,0,0,4,138,1,0,0,0,6,149,1,0,0,0,8,168,1,0,0,0,10,170,1,0,0,0,12,222,
	1,0,0,0,14,257,1,0,0,0,16,259,1,0,0,0,18,299,1,0,0,0,20,303,1,0,0,0,22,
	325,1,0,0,0,24,334,1,0,0,0,26,338,1,0,0,0,28,358,1,0,0,0,30,381,1,0,0,0,
	32,446,1,0,0,0,34,449,1,0,0,0,36,478,1,0,0,0,38,480,1,0,0,0,40,482,1,0,
	0,0,42,502,1,0,0,0,44,542,1,0,0,0,46,551,1,0,0,0,48,602,1,0,0,0,50,604,
	1,0,0,0,52,606,1,0,0,0,54,608,1,0,0,0,56,610,1,0,0,0,58,618,1,0,0,0,60,
	623,1,0,0,0,62,625,1,0,0,0,64,643,1,0,0,0,66,688,1,0,0,0,68,690,1,0,0,0,
	70,714,1,0,0,0,72,730,1,0,0,0,74,732,1,0,0,0,76,741,1,0,0,0,78,750,1,0,
	0,0,80,779,1,0,0,0,82,829,1,0,0,0,84,881,1,0,0,0,86,901,1,0,0,0,88,905,
	1,0,0,0,90,907,1,0,0,0,92,911,1,0,0,0,94,915,1,0,0,0,96,920,1,0,0,0,98,
	922,1,0,0,0,100,924,1,0,0,0,102,940,1,0,0,0,104,960,1,0,0,0,106,980,1,0,
	0,0,108,991,1,0,0,0,110,1039,1,0,0,0,112,1074,1,0,0,0,114,1076,1,0,0,0,
	116,1114,1,0,0,0,118,1132,1,0,0,0,120,1152,1,0,0,0,122,1166,1,0,0,0,124,
	126,5,55,0,0,125,124,1,0,0,0,125,126,1,0,0,0,126,127,1,0,0,0,127,128,3,
	2,1,0,128,129,5,0,0,1,129,1,1,0,0,0,130,134,5,78,0,0,131,134,3,4,2,0,132,
	134,3,58,29,0,133,130,1,0,0,0,133,131,1,0,0,0,133,132,1,0,0,0,134,137,1,
	0,0,0,135,133,1,0,0,0,135,136,1,0,0,0,136,3,1,0,0,0,137,135,1,0,0,0,138,
	142,3,28,14,0,139,141,5,78,0,0,140,139,1,0,0,0,141,144,1,0,0,0,142,140,
	1,0,0,0,142,143,1,0,0,0,143,145,1,0,0,0,144,142,1,0,0,0,145,146,5,46,0,
	0,146,147,3,30,15,0,147,148,5,47,0,0,148,5,1,0,0,0,149,153,3,26,13,0,150,
	152,5,78,0,0,151,150,1,0,0,0,152,155,1,0,0,0,153,151,1,0,0,0,153,154,1,
	0,0,0,154,156,1,0,0,0,155,153,1,0,0,0,156,157,5,46,0,0,157,158,3,30,15,
	0,158,159,5,47,0,0,159,7,1,0,0,0,160,169,3,10,5,0,161,169,5,23,0,0,162,
	169,5,21,0,0,163,169,3,118,59,0,164,169,5,20,0,0,165,169,5,28,0,0,166,169,
	3,12,6,0,167,169,3,16,8,0,168,160,1,0,0,0,168,161,1,0,0,0,168,162,1,0,0,
	0,168,163,1,0,0,0,168,164,1,0,0,0,168,165,1,0,0,0,168,166,1,0,0,0,168,167,
	1,0,0,0,169,9,1,0,0,0,170,171,5,53,0,0,171,172,3,118,59,0,172,11,1,0,0,
	0,173,174,5,24,0,0,174,178,5,48,0,0,175,177,5,78,0,0,176,175,1,0,0,0,177,
	180,1,0,0,0,178,176,1,0,0,0,178,179,1,0,0,0,179,181,1,0,0,0,180,178,1,0,
	0,0,181,185,3,14,7,0,182,184,5,78,0,0,183,182,1,0,0,0,184,187,1,0,0,0,185,
	183,1,0,0,0,185,186,1,0,0,0,186,188,1,0,0,0,187,185,1,0,0,0,188,189,5,49,
	0,0,189,223,1,0,0,0,190,191,5,26,0,0,191,195,5,48,0,0,192,194,5,78,0,0,
	193,192,1,0,0,0,194,197,1,0,0,0,195,193,1,0,0,0,195,196,1,0,0,0,196,198,
	1,0,0,0,197,195,1,0,0,0,198,202,3,26,13,0,199,201,5,78,0,0,200,199,1,0,
	0,0,201,204,1,0,0,0,202,200,1,0,0,0,202,203,1,0,0,0,203,205,1,0,0,0,204,
	202,1,0,0,0,205,206,5,49,0,0,206,223,1,0,0,0,207,209,5,42,0,0,208,210,5,
	42,0,0,209,208,1,0,0,0,209,210,1,0,0,0,210,211,1,0,0,0,211,220,3,118,59,
	0,212,216,5,48,0,0,213,215,3,122,61,0,214,213,1,0,0,0,215,218,1,0,0,0,216,
	214,1,0,0,0,216,217,1,0,0,0,217,219,1,0,0,0,218,216,1,0,0,0,219,221,5,49,
	0,0,220,212,1,0,0,0,220,221,1,0,0,0,221,223,1,0,0,0,222,173,1,0,0,0,222,
	190,1,0,0,0,222,207,1,0,0,0,223,13,1,0,0,0,224,258,5,43,0,0,225,258,5,44,
	0,0,226,230,1,0,0,0,227,230,5,14,0,0,228,230,5,15,0,0,229,226,1,0,0,0,229,
	227,1,0,0,0,229,228,1,0,0,0,230,239,1,0,0,0,231,240,5,11,0,0,232,234,5,
	37,0,0,233,235,5,78,0,0,234,233,1,0,0,0,235,236,1,0,0,0,236,234,1,0,0,0,
	236,237,1,0,0,0,237,238,1,0,0,0,238,240,5,10,0,0,239,231,1,0,0,0,239,232,
	1,0,0,0,239,240,1,0,0,0,240,255,1,0,0,0,241,243,5,78,0,0,242,241,1,0,0,
	0,243,246,1,0,0,0,244,242,1,0,0,0,244,245,1,0,0,0,245,247,1,0,0,0,246,244,
	1,0,0,0,247,251,5,25,0,0,248,250,5,78,0,0,249,248,1,0,0,0,250,253,1,0,0,
	0,251,249,1,0,0,0,251,252,1,0,0,0,252,254,1,0,0,0,253,251,1,0,0,0,254,256,
	3,20,10,0,255,244,1,0,0,0,255,256,1,0,0,0,256,258,1,0,0,0,257,224,1,0,0,
	0,257,225,1,0,0,0,257,229,1,0,0,0,258,15,1,0,0,0,259,263,5,50,0,0,260,262,
	5,78,0,0,261,260,1,0,0,0,262,265,1,0,0,0,263,261,1,0,0,0,263,264,1,0,0,
	0,264,266,1,0,0,0,265,263,1,0,0,0,266,268,3,118,59,0,267,269,7,0,0,0,268,
	267,1,0,0,0,268,269,1,0,0,0,269,270,1,0,0,0,270,274,5,35,0,0,271,273,5,
	78,0,0,272,271,1,0,0,0,273,276,1,0,0,0,274,272,1,0,0,0,274,275,1,0,0,0,
	275,279,1,0,0,0,276,274,1,0,0,0,277,280,3,118,59,0,278,280,5,54,0,0,279,
	277,1,0,0,0,279,278,1,0,0,0,280,284,1,0,0,0,281,283,5,78,0,0,282,281,1,
	0,0,0,283,286,1,0,0,0,284,282,1,0,0,0,284,285,1,0,0,0,285,294,1,0,0,0,286,
	284,1,0,0,0,287,291,5,9,0,0,288,290,5,78,0,0,289,288,1,0,0,0,290,293,1,
	0,0,0,291,289,1,0,0,0,291,292,1,0,0,0,292,295,1,0,0,0,293,291,1,0,0,0,294,
	287,1,0,0,0,294,295,1,0,0,0,295,296,1,0,0,0,296,297,5,51,0,0,297,17,1,0,
	0,0,298,300,3,8,4,0,299,298,1,0,0,0,300,301,1,0,0,0,301,299,1,0,0,0,301,
	302,1,0,0,0,302,19,1,0,0,0,303,322,3,18,9,0,304,306,5,78,0,0,305,304,1,
	0,0,0,306,309,1,0,0,0,307,305,1,0,0,0,307,308,1,0,0,0,308,317,1,0,0,0,309,
	307,1,0,0,0,310,314,3,22,11,0,311,313,5,78,0,0,312,311,1,0,0,0,313,316,
	1,0,0,0,314,312,1,0,0,0,314,315,1,0,0,0,315,318,1,0,0,0,316,314,1,0,0,0,
	317,310,1,0,0,0,317,318,1,0,0,0,318,319,1,0,0,0,319,321,3,18,9,0,320,307,
	1,0,0,0,321,324,1,0,0,0,322,320,1,0,0,0,322,323,1,0,0,0,323,21,1,0,0,0,
	324,322,1,0,0,0,325,326,7,1,0,0,326,23,1,0,0,0,327,331,3,22,11,0,328,330,
	5,78,0,0,329,328,1,0,0,0,330,333,1,0,0,0,331,329,1,0,0,0,331,332,1,0,0,
	0,332,335,1,0,0,0,333,331,1,0,0,0,334,327,1,0,0,0,334,335,1,0,0,0,335,336,
	1,0,0,0,336,337,3,20,10,0,337,25,1,0,0,0,338,355,3,24,12,0,339,341,5,78,
	0,0,340,339,1,0,0,0,341,344,1,0,0,0,342,340,1,0,0,0,342,343,1,0,0,0,343,
	345,1,0,0,0,344,342,1,0,0,0,345,349,5,52,0,0,346,348,5,78,0,0,347,346,1,
	0,0,0,348,351,1,0,0,0,349,347,1,0,0,0,349,350,1,0,0,0,350,352,1,0,0,0,351,
	349,1,0,0,0,352,354,3,24,12,0,353,342,1,0,0,0,354,357,1,0,0,0,355,353,1,
	0,0,0,355,356,1,0,0,0,356,27,1,0,0,0,357,355,1,0,0,0,358,375,3,20,10,0,
	359,361,5,78,0,0,360,359,1,0,0,0,361,364,1,0,0,0,362,360,1,0,0,0,362,363,
	1,0,0,0,363,365,1,0,0,0,364,362,1,0,0,0,365,369,5,52,0,0,366,368,5,78,0,
	0,367,366,1,0,0,0,368,371,1,0,0,0,369,367,1,0,0,0,369,370,1,0,0,0,370,372,
	1,0,0,0,371,369,1,0,0,0,372,374,3,20,10,0,373,362,1,0,0,0,374,377,1,0,0,
	0,375,373,1,0,0,0,375,376,1,0,0,0,376,29,1,0,0,0,377,375,1,0,0,0,378,380,
	5,78,0,0,379,378,1,0,0,0,380,383,1,0,0,0,381,379,1,0,0,0,381,382,1,0,0,
	0,382,406,1,0,0,0,383,381,1,0,0,0,384,386,3,32,16,0,385,384,1,0,0,0,385,
	386,1,0,0,0,386,397,1,0,0,0,387,389,5,78,0,0,388,387,1,0,0,0,389,392,1,
	0,0,0,390,388,1,0,0,0,390,391,1,0,0,0,391,393,1,0,0,0,392,390,1,0,0,0,393,
	394,5,45,0,0,394,396,3,30,15,0,395,390,1,0,0,0,396,399,1,0,0,0,397,395,
	1,0,0,0,397,398,1,0,0,0,398,407,1,0,0,0,399,397,1,0,0,0,400,401,3,60,30,
	0,401,402,3,30,15,0,402,407,1,0,0,0,403,404,3,6,3,0,404,405,3,30,15,0,405,
	407,1,0,0,0,406,385,1,0,0,0,406,400,1,0,0,0,406,403,1,0,0,0,407,31,1,0,
	0,0,408,412,3,118,59,0,409,411,5,78,0,0,410,409,1,0,0,0,411,414,1,0,0,0,
	412,410,1,0,0,0,412,413,1,0,0,0,413,415,1,0,0,0,414,412,1,0,0,0,415,419,
	5,42,0,0,416,418,5,78,0,0,417,416,1,0,0,0,418,421,1,0,0,0,419,417,1,0,0,
	0,419,420,1,0,0,0,420,422,1,0,0,0,421,419,1,0,0,0,422,430,3,34,17,0,423,
	425,5,78,0,0,424,423,1,0,0,0,425,428,1,0,0,0,426,424,1,0,0,0,426,427,1,
	0,0,0,427,429,1,0,0,0,428,426,1,0,0,0,429,431,5,8,0,0,430,426,1,0,0,0,430,
	431,1,0,0,0,431,447,1,0,0,0,432,436,5,76,0,0,433,435,5,78,0,0,434,433,1,
	0,0,0,435,438,1,0,0,0,436,434,1,0,0,0,436,437,1,0,0,0,437,439,1,0,0,0,438,
	436,1,0,0,0,439,443,5,42,0,0,440,442,5,84,0,0,441,440,1,0,0,0,442,445,1,
	0,0,0,443,441,1,0,0,0,443,444,1,0,0,0,444,447,1,0,0,0,445,443,1,0,0,0,446,
	408,1,0,0,0,446,432,1,0,0,0,447,33,1,0,0,0,448,450,3,36,18,0,449,448,1,
	0,0,0,450,451,1,0,0,0,451,449,1,0,0,0,451,452,1,0,0,0,452,461,1,0,0,0,453,
	455,7,2,0,0,454,456,3,36,18,0,455,454,1,0,0,0,456,457,1,0,0,0,457,455,1,
	0,0,0,457,458,1,0,0,0,458,460,1,0,0,0,459,453,1,0,0,0,460,463,1,0,0,0,461,
	459,1,0,0,0,461,462,1,0,0,0,462,35,1,0,0,0,463,461,1,0,0,0,464,479,5,78,
	0,0,465,479,3,118,59,0,466,479,3,50,25,0,467,479,3,52,26,0,468,479,3,54,
	27,0,469,479,5,21,0,0,470,479,5,22,0,0,471,479,5,54,0,0,472,479,3,48,24,
	0,473,474,5,50,0,0,474,475,3,118,59,0,475,476,5,51,0,0,476,479,1,0,0,0,
	477,479,3,38,19,0,478,464,1,0,0,0,478,465,1,0,0,0,478,466,1,0,0,0,478,467,
	1,0,0,0,478,468,1,0,0,0,478,469,1,0,0,0,478,470,1,0,0,0,478,471,1,0,0,0,
	478,472,1,0,0,0,478,473,1,0,0,0,478,477,1,0,0,0,479,37,1,0,0,0,480,481,
	7,3,0,0,481,39,1,0,0,0,482,499,3,42,21,0,483,485,5,78,0,0,484,483,1,0,0,
	0,485,488,1,0,0,0,486,484,1,0,0,0,486,487,1,0,0,0,487,489,1,0,0,0,488,486,
	1,0,0,0,489,493,7,4,0,0,490,492,5,78,0,0,491,490,1,0,0,0,492,495,1,0,0,
	0,493,491,1,0,0,0,493,494,1,0,0,0,494,496,1,0,0,0,495,493,1,0,0,0,496,498,
	3,42,21,0,497,486,1,0,0,0,498,501,1,0,0,0,499,497,1,0,0,0,499,500,1,0,0,
	0,500,41,1,0,0,0,501,499,1,0,0,0,502,519,3,44,22,0,503,505,5,78,0,0,504,
	503,1,0,0,0,505,508,1,0,0,0,506,504,1,0,0,0,506,507,1,0,0,0,507,509,1,0,
	0,0,508,506,1,0,0,0,509,513,7,5,0,0,510,512,5,78,0,0,511,510,1,0,0,0,512,
	515,1,0,0,0,513,511,1,0,0,0,513,514,1,0,0,0,514,516,1,0,0,0,515,513,1,0,
	0,0,516,518,3,44,22,0,517,506,1,0,0,0,518,521,1,0,0,0,519,517,1,0,0,0,519,
	520,1,0,0,0,520,43,1,0,0,0,521,519,1,0,0,0,522,543,3,52,26,0,523,543,3,
	54,27,0,524,543,3,56,28,0,525,543,3,46,23,0,526,530,5,48,0,0,527,529,5,
	78,0,0,528,527,1,0,0,0,529,532,1,0,0,0,530,528,1,0,0,0,530,531,1,0,0,0,
	531,533,1,0,0,0,532,530,1,0,0,0,533,537,3,40,20,0,534,536,5,78,0,0,535,
	534,1,0,0,0,536,539,1,0,0,0,537,535,1,0,0,0,537,538,1,0,0,0,538,540,1,0,
	0,0,539,537,1,0,0,0,540,541,5,49,0,0,541,543,1,0,0,0,542,522,1,0,0,0,542,
	523,1,0,0,0,542,524,1,0,0,0,542,525,1,0,0,0,542,526,1,0,0,0,543,45,1,0,
	0,0,544,552,5,72,0,0,545,552,5,73,0,0,546,548,5,37,0,0,547,546,1,0,0,0,
	547,548,1,0,0,0,548,549,1,0,0,0,549,552,5,74,0,0,550,552,5,75,0,0,551,544,
	1,0,0,0,551,545,1,0,0,0,551,547,1,0,0,0,551,550,1,0,0,0,552,47,1,0,0,0,
	553,603,5,68,0,0,554,555,5,70,0,0,555,559,5,48,0,0,556,558,5,78,0,0,557,
	556,1,0,0,0,558,561,1,0,0,0,559,557,1,0,0,0,559,560,1,0,0,0,560,562,1,0,
	0,0,561,559,1,0,0,0,562,577,5,76,0,0,563,565,5,78,0,0,564,563,1,0,0,0,565,
	568,1,0,0,0,566,564,1,0,0,0,566,567,1,0,0,0,567,569,1,0,0,0,568,566,1,0,
	0,0,569,573,5,52,0,0,570,572,5,78,0,0,571,570,1,0,0,0,572,575,1,0,0,0,573,
	571,1,0,0,0,573,574,1,0,0,0,574,576,1,0,0,0,575,573,1,0,0,0,576,578,3,34,
	17,0,577,566,1,0,0,0,577,578,1,0,0,0,578,579,1,0,0,0,579,603,5,49,0,0,580,
	581,5,71,0,0,581,585,5,48,0,0,582,584,5,78,0,0,583,582,1,0,0,0,584,587,
	1,0,0,0,585,583,1,0,0,0,585,586,1,0,0,0,586,588,1,0,0,0,587,585,1,0,0,0,
	588,592,3,40,20,0,589,591,5,78,0,0,590,589,1,0,0,0,591,594,1,0,0,0,592,
	590,1,0,0,0,592,593,1,0,0,0,593,595,1,0,0,0,594,592,1,0,0,0,595,596,5,49,
	0,0,596,603,1,0,0,0,597,598,3,118,59,0,598,599,5,48,0,0,599,600,3,34,17,
	0,600,601,5,49,0,0,601,603,1,0,0,0,602,553,1,0,0,0,602,554,1,0,0,0,602,
	580,1,0,0,0,602,597,1,0,0,0,603,49,1,0,0,0,604,605,7,6,0,0,605,51,1,0,0,
	0,606,607,7,7,0,0,607,53,1,0,0,0,608,609,7,8,0,0,609,55,1,0,0,0,610,611,
	7,9,0,0,611,57,1,0,0,0,612,619,3,114,57,0,613,619,3,62,31,0,614,619,3,116,
	58,0,615,619,3,102,51,0,616,619,3,106,53,0,617,619,3,108,54,0,618,612,1,
	0,0,0,618,613,1,0,0,0,618,614,1,0,0,0,618,615,1,0,0,0,618,616,1,0,0,0,618,
	617,1,0,0,0,619,59,1,0,0,0,620,624,3,64,32,0,621,624,3,104,52,0,622,624,
	3,116,58,0,623,620,1,0,0,0,623,621,1,0,0,0,623,622,1,0,0,0,624,61,1,0,0,
	0,625,629,5,58,0,0,626,628,5,78,0,0,627,626,1,0,0,0,628,631,1,0,0,0,629,
	627,1,0,0,0,629,630,1,0,0,0,630,632,1,0,0,0,631,629,1,0,0,0,632,636,3,66,
	33,0,633,635,5,78,0,0,634,633,1,0,0,0,635,638,1,0,0,0,636,634,1,0,0,0,636,
	637,1,0,0,0,637,639,1,0,0,0,638,636,1,0,0,0,639,640,5,46,0,0,640,641,3,
	2,1,0,641,642,5,47,0,0,642,63,1,0,0,0,643,647,5,58,0,0,644,646,5,78,0,0,
	645,644,1,0,0,0,646,649,1,0,0,0,647,645,1,0,0,0,647,648,1,0,0,0,648,650,
	1,0,0,0,649,647,1,0,0,0,650,654,3,66,33,0,651,653,5,78,0,0,652,651,1,0,
	0,0,653,656,1,0,0,0,654,652,1,0,0,0,654,655,1,0,0,0,655,657,1,0,0,0,656,
	654,1,0,0,0,657,658,5,46,0,0,658,659,3,30,15,0,659,660,5,47,0,0,660,65,
	1,0,0,0,661,689,3,70,35,0,662,666,7,10,0,0,663,665,5,78,0,0,664,663,1,0,
	0,0,665,668,1,0,0,0,666,664,1,0,0,0,666,667,1,0,0,0,667,670,1,0,0,0,668,
	666,1,0,0,0,669,662,1,0,0,0,669,670,1,0,0,0,670,671,1,0,0,0,671,686,3,68,
	34,0,672,674,5,78,0,0,673,672,1,0,0,0,674,677,1,0,0,0,675,673,1,0,0,0,675,
	676,1,0,0,0,676,678,1,0,0,0,677,675,1,0,0,0,678,682,5,1,0,0,679,681,5,78,
	0,0,680,679,1,0,0,0,681,684,1,0,0,0,682,680,1,0,0,0,682,683,1,0,0,0,683,
	685,1,0,0,0,684,682,1,0,0,0,685,687,3,72,36,0,686,675,1,0,0,0,686,687,1,
	0,0,0,687,689,1,0,0,0,688,661,1,0,0,0,688,669,1,0,0,0,689,67,1,0,0,0,690,
	691,7,11,0,0,691,69,1,0,0,0,692,715,3,74,37,0,693,697,3,80,40,0,694,696,
	5,78,0,0,695,694,1,0,0,0,696,699,1,0,0,0,697,695,1,0,0,0,697,698,1,0,0,
	0,698,712,1,0,0,0,699,697,1,0,0,0,700,702,3,76,38,0,701,700,1,0,0,0,702,
	705,1,0,0,0,703,701,1,0,0,0,703,704,1,0,0,0,704,713,1,0,0,0,705,703,1,0,
	0,0,706,708,3,78,39,0,707,706,1,0,0,0,708,711,1,0,0,0,709,707,1,0,0,0,709,
	710,1,0,0,0,710,713,1,0,0,0,711,709,1,0,0,0,712,703,1,0,0,0,712,709,1,0,
	0,0,713,715,1,0,0,0,714,692,1,0,0,0,714,693,1,0,0,0,715,71,1,0,0,0,716,
	731,3,74,37,0,717,727,3,80,40,0,718,720,5,78,0,0,719,718,1,0,0,0,720,723,
	1,0,0,0,721,719,1,0,0,0,721,722,1,0,0,0,722,724,1,0,0,0,723,721,1,0,0,0,
	724,726,3,76,38,0,725,721,1,0,0,0,726,729,1,0,0,0,727,725,1,0,0,0,727,728,
	1,0,0,0,728,731,1,0,0,0,729,727,1,0,0,0,730,716,1,0,0,0,730,717,1,0,0,0,
	731,73,1,0,0,0,732,736,5,3,0,0,733,735,5,78,0,0,734,733,1,0,0,0,735,738,
	1,0,0,0,736,734,1,0,0,0,736,737,1,0,0,0,737,739,1,0,0,0,738,736,1,0,0,0,
	739,740,3,80,40,0,740,75,1,0,0,0,741,745,5,1,0,0,742,744,5,78,0,0,743,742,
	1,0,0,0,744,747,1,0,0,0,745,743,1,0,0,0,745,746,1,0,0,0,746,748,1,0,0,0,
	747,745,1,0,0,0,748,749,3,80,40,0,749,77,1,0,0,0,750,754,5,2,0,0,751,753,
	5,78,0,0,752,751,1,0,0,0,753,756,1,0,0,0,754,752,1,0,0,0,754,755,1,0,0,
	0,755,757,1,0,0,0,756,754,1,0,0,0,757,758,3,80,40,0,758,79,1,0,0,0,759,
	763,5,48,0,0,760,762,5,78,0,0,761,760,1,0,0,0,762,765,1,0,0,0,763,761,1,
	0,0,0,763,764,1,0,0,0,764,768,1,0,0,0,765,763,1,0,0,0,766,769,3,70,35,0,
	767,769,3,82,41,0,768,766,1,0,0,0,768,767,1,0,0,0,769,773,1,0,0,0,770,772,
	5,78,0,0,771,770,1,0,0,0,772,775,1,0,0,0,773,771,1,0,0,0,773,774,1,0,0,
	0,774,776,1,0,0,0,775,773,1,0,0,0,776,777,5,49,0,0,777,780,1,0,0,0,778,
	780,3,98,49,0,779,759,1,0,0,0,779,778,1,0,0,0,780,81,1,0,0,0,781,808,3,
	118,59,0,782,784,5,78,0,0,783,782,1,0,0,0,784,787,1,0,0,0,785,783,1,0,0,
	0,785,786,1,0,0,0,786,806,1,0,0,0,787,785,1,0,0,0,788,792,5,42,0,0,789,
	791,5,78,0,0,790,789,1,0,0,0,791,794,1,0,0,0,792,790,1,0,0,0,792,793,1,
	0,0,0,793,795,1,0,0,0,794,792,1,0,0,0,795,807,3,88,44,0,796,807,3,84,42,
	0,797,801,3,96,48,0,798,800,5,78,0,0,799,798,1,0,0,0,800,803,1,0,0,0,801,
	799,1,0,0,0,801,802,1,0,0,0,802,804,1,0,0,0,803,801,1,0,0,0,804,805,3,86,
	43,0,805,807,1,0,0,0,806,788,1,0,0,0,806,796,1,0,0,0,806,797,1,0,0,0,807,
	809,1,0,0,0,808,785,1,0,0,0,808,809,1,0,0,0,809,830,1,0,0,0,810,814,3,86,
	43,0,811,813,5,78,0,0,812,811,1,0,0,0,813,816,1,0,0,0,814,812,1,0,0,0,814,
	815,1,0,0,0,815,827,1,0,0,0,816,814,1,0,0,0,817,821,3,96,48,0,818,820,5,
	78,0,0,819,818,1,0,0,0,820,823,1,0,0,0,821,819,1,0,0,0,821,822,1,0,0,0,
	822,824,1,0,0,0,823,821,1,0,0,0,824,825,3,118,59,0,825,828,1,0,0,0,826,
	828,3,84,42,0,827,817,1,0,0,0,827,826,1,0,0,0,828,830,1,0,0,0,829,781,1,
	0,0,0,829,810,1,0,0,0,830,83,1,0,0,0,831,835,3,90,45,0,832,834,5,78,0,0,
	833,832,1,0,0,0,834,837,1,0,0,0,835,833,1,0,0,0,835,836,1,0,0,0,836,838,
	1,0,0,0,837,835,1,0,0,0,838,854,3,118,59,0,839,841,5,78,0,0,840,839,1,0,
	0,0,841,844,1,0,0,0,842,840,1,0,0,0,842,843,1,0,0,0,843,845,1,0,0,0,844,
	842,1,0,0,0,845,849,3,90,45,0,846,848,5,78,0,0,847,846,1,0,0,0,848,851,
	1,0,0,0,849,847,1,0,0,0,849,850,1,0,0,0,850,852,1,0,0,0,851,849,1,0,0,0,
	852,853,3,88,44,0,853,855,1,0,0,0,854,842,1,0,0,0,854,855,1,0,0,0,855,882,
	1,0,0,0,856,860,3,92,46,0,857,859,5,78,0,0,858,857,1,0,0,0,859,862,1,0,
	0,0,860,858,1,0,0,0,860,861,1,0,0,0,861,863,1,0,0,0,862,860,1,0,0,0,863,
	879,3,118,59,0,864,866,5,78,0,0,865,864,1,0,0,0,866,869,1,0,0,0,867,865,
	1,0,0,0,867,868,1,0,0,0,868,870,1,0,0,0,869,867,1,0,0,0,870,874,3,92,46,
	0,871,873,5,78,0,0,872,871,1,0,0,0,873,876,1,0,0,0,874,872,1,0,0,0,874,
	875,1,0,0,0,875,877,1,0,0,0,876,874,1,0,0,0,877,878,3,88,44,0,878,880,1,
	0,0,0,879,867,1,0,0,0,879,880,1,0,0,0,880,882,1,0,0,0,881,831,1,0,0,0,881,
	856,1,0,0,0,882,85,1,0,0,0,883,898,3,52,26,0,884,886,5,78,0,0,885,884,1,
	0,0,0,886,889,1,0,0,0,887,885,1,0,0,0,887,888,1,0,0,0,888,890,1,0,0,0,889,
	887,1,0,0,0,890,894,5,29,0,0,891,893,5,78,0,0,892,891,1,0,0,0,893,896,1,
	0,0,0,894,892,1,0,0,0,894,895,1,0,0,0,895,897,1,0,0,0,896,894,1,0,0,0,897,
	899,3,52,26,0,898,887,1,0,0,0,898,899,1,0,0,0,899,902,1,0,0,0,900,902,3,
	54,27,0,901,883,1,0,0,0,901,900,1,0,0,0,902,87,1,0,0,0,903,906,3,86,43,
	0,904,906,3,118,59,0,905,903,1,0,0,0,905,904,1,0,0,0,906,89,1,0,0,0,907,
	909,5,32,0,0,908,910,5,35,0,0,909,908,1,0,0,0,909,910,1,0,0,0,910,91,1,
	0,0,0,911,913,5,31,0,0,912,914,5,35,0,0,913,912,1,0,0,0,913,914,1,0,0,0,
	914,93,1,0,0,0,915,916,5,35,0,0,916,95,1,0,0,0,917,921,3,90,45,0,918,921,
	3,92,46,0,919,921,3,94,47,0,920,917,1,0,0,0,920,918,1,0,0,0,920,919,1,0,
	0,0,921,97,1,0,0,0,922,923,3,48,24,0,923,99,1,0,0,0,924,928,3,52,26,0,925,
	927,5,78,0,0,926,925,1,0,0,0,927,930,1,0,0,0,928,926,1,0,0,0,928,929,1,
	0,0,0,929,931,1,0,0,0,930,928,1,0,0,0,931,935,5,29,0,0,932,934,5,78,0,0,
	933,932,1,0,0,0,934,937,1,0,0,0,935,933,1,0,0,0,935,936,1,0,0,0,936,938,
	1,0,0,0,937,935,1,0,0,0,938,939,3,52,26,0,939,101,1,0,0,0,940,944,5,60,
	0,0,941,943,5,78,0,0,942,941,1,0,0,0,943,946,1,0,0,0,944,942,1,0,0,0,944,
	945,1,0,0,0,945,954,1,0,0,0,946,944,1,0,0,0,947,951,5,27,0,0,948,950,5,
	78,0,0,949,948,1,0,0,0,950,953,1,0,0,0,951,949,1,0,0,0,951,952,1,0,0,0,
	952,955,1,0,0,0,953,951,1,0,0,0,954,947,1,0,0,0,954,955,1,0,0,0,955,956,
	1,0,0,0,956,957,5,46,0,0,957,958,3,2,1,0,958,959,5,47,0,0,959,103,1,0,0,
	0,960,964,5,60,0,0,961,963,5,78,0,0,962,961,1,0,0,0,963,966,1,0,0,0,964,
	962,1,0,0,0,964,965,1,0,0,0,965,974,1,0,0,0,966,964,1,0,0,0,967,971,5,27,
	0,0,968,970,5,78,0,0,969,968,1,0,0,0,970,973,1,0,0,0,971,969,1,0,0,0,971,
	972,1,0,0,0,972,975,1,0,0,0,973,971,1,0,0,0,974,967,1,0,0,0,974,975,1,0,
	0,0,975,976,1,0,0,0,976,977,5,46,0,0,977,978,3,30,15,0,978,979,5,47,0,0,
	979,105,1,0,0,0,980,984,5,61,0,0,981,983,5,78,0,0,982,981,1,0,0,0,983,986,
	1,0,0,0,984,982,1,0,0,0,984,985,1,0,0,0,985,987,1,0,0,0,986,984,1,0,0,0,
	987,988,5,46,0,0,988,989,3,30,15,0,989,990,5,47,0,0,990,107,1,0,0,0,991,
	995,5,59,0,0,992,994,5,78,0,0,993,992,1,0,0,0,994,997,1,0,0,0,995,993,1,
	0,0,0,995,996,1,0,0,0,996,998,1,0,0,0,997,995,1,0,0,0,998,1002,3,110,55,
	0,999,1001,5,78,0,0,1000,999,1,0,0,0,1001,1004,1,0,0,0,1002,1000,1,0,0,
	0,1002,1003,1,0,0,0,1003,1005,1,0,0,0,1004,1002,1,0,0,0,1005,1006,5,46,
	0,0,1006,1007,3,2,1,0,1007,1008,5,47,0,0,1008,109,1,0,0,0,1009,1010,5,3,
	0,0,1010,1040,3,112,56,0,1011,1022,3,112,56,0,1012,1014,5,78,0,0,1013,1012,
	1,0,0,0,1014,1017,1,0,0,0,1015,1013,1,0,0,0,1015,1016,1,0,0,0,1016,1018,
	1,0,0,0,1017,1015,1,0,0,0,1018,1019,5,1,0,0,1019,1021,3,112,56,0,1020,1015,
	1,0,0,0,1021,1024,1,0,0,0,1022,1020,1,0,0,0,1022,1023,1,0,0,0,1023,1040,
	1,0,0,0,1024,1022,1,0,0,0,1025,1036,3,112,56,0,1026,1028,5,78,0,0,1027,
	1026,1,0,0,0,1028,1031,1,0,0,0,1029,1027,1,0,0,0,1029,1030,1,0,0,0,1030,
	1032,1,0,0,0,1031,1029,1,0,0,0,1032,1033,5,2,0,0,1033,1035,3,112,56,0,1034,
	1029,1,0,0,0,1035,1038,1,0,0,0,1036,1034,1,0,0,0,1036,1037,1,0,0,0,1037,
	1040,1,0,0,0,1038,1036,1,0,0,0,1039,1009,1,0,0,0,1039,1011,1,0,0,0,1039,
	1025,1,0,0,0,1040,111,1,0,0,0,1041,1045,5,48,0,0,1042,1044,5,78,0,0,1043,
	1042,1,0,0,0,1044,1047,1,0,0,0,1045,1043,1,0,0,0,1045,1046,1,0,0,0,1046,
	1048,1,0,0,0,1047,1045,1,0,0,0,1048,1052,3,110,55,0,1049,1051,5,78,0,0,
	1050,1049,1,0,0,0,1051,1054,1,0,0,0,1052,1050,1,0,0,0,1052,1053,1,0,0,0,
	1053,1055,1,0,0,0,1054,1052,1,0,0,0,1055,1056,5,49,0,0,1056,1075,1,0,0,
	0,1057,1061,5,48,0,0,1058,1060,5,78,0,0,1059,1058,1,0,0,0,1060,1063,1,0,
	0,0,1061,1059,1,0,0,0,1061,1062,1,0,0,0,1062,1064,1,0,0,0,1063,1061,1,0,
	0,0,1064,1068,3,32,16,0,1065,1067,5,78,0,0,1066,1065,1,0,0,0,1067,1070,
	1,0,0,0,1068,1066,1,0,0,0,1068,1069,1,0,0,0,1069,1071,1,0,0,0,1070,1068,
	1,0,0,0,1071,1072,5,49,0,0,1072,1075,1,0,0,0,1073,1075,3,98,49,0,1074,1041,
	1,0,0,0,1074,1057,1,0,0,0,1074,1073,1,0,0,0,1075,113,1,0,0,0,1076,1080,
	5,56,0,0,1077,1079,5,78,0,0,1078,1077,1,0,0,0,1079,1082,1,0,0,0,1080,1078,
	1,0,0,0,1080,1081,1,0,0,0,1081,1083,1,0,0,0,1082,1080,1,0,0,0,1083,1101,
	7,12,0,0,1084,1086,5,78,0,0,1085,1084,1,0,0,0,1086,1089,1,0,0,0,1087,1085,
	1,0,0,0,1087,1088,1,0,0,0,1088,1090,1,0,0,0,1089,1087,1,0,0,0,1090,1094,
	5,69,0,0,1091,1093,5,78,0,0,1092,1091,1,0,0,0,1093,1096,1,0,0,0,1094,1092,
	1,0,0,0,1094,1095,1,0,0,0,1095,1099,1,0,0,0,1096,1094,1,0,0,0,1097,1100,
	3,110,55,0,1098,1100,3,32,16,0,1099,1097,1,0,0,0,1099,1098,1,0,0,0,1100,
	1102,1,0,0,0,1101,1087,1,0,0,0,1101,1102,1,0,0,0,1102,1110,1,0,0,0,1103,
	1105,5,78,0,0,1104,1103,1,0,0,0,1105,1108,1,0,0,0,1106,1104,1,0,0,0,1106,
	1107,1,0,0,0,1107,1109,1,0,0,0,1108,1106,1,0,0,0,1109,1111,3,66,33,0,1110,
	1106,1,0,0,0,1110,1111,1,0,0,0,1111,1112,1,0,0,0,1112,1113,5,45,0,0,1113,
	115,1,0,0,0,1114,1118,5,67,0,0,1115,1117,3,120,60,0,1116,1115,1,0,0,0,1117,
	1120,1,0,0,0,1118,1116,1,0,0,0,1118,1119,1,0,0,0,1119,1130,1,0,0,0,1120,
	1118,1,0,0,0,1121,1131,5,45,0,0,1122,1126,5,46,0,0,1123,1125,3,122,61,0,
	1124,1123,1,0,0,0,1125,1128,1,0,0,0,1126,1124,1,0,0,0,1126,1127,1,0,0,0,
	1127,1129,1,0,0,0,1128,1126,1,0,0,0,1129,1131,5,47,0,0,1130,1121,1,0,0,
	0,1130,1122,1,0,0,0,1131,117,1,0,0,0,1132,1133,7,13,0,0,1133,119,1,0,0,
	0,1134,1153,3,36,18,0,1135,1153,5,52,0,0,1136,1140,5,48,0,0,1137,1139,3,
	122,61,0,1138,1137,1,0,0,0,1139,1142,1,0,0,0,1140,1138,1,0,0,0,1140,1141,
	1,0,0,0,1141,1143,1,0,0,0,1142,1140,1,0,0,0,1143,1153,5,49,0,0,1144,1148,
	5,50,0,0,1145,1147,3,122,61,0,1146,1145,1,0,0,0,1147,1150,1,0,0,0,1148,
	1146,1,0,0,0,1148,1149,1,0,0,0,1149,1151,1,0,0,0,1150,1148,1,0,0,0,1151,
	1153,5,51,0,0,1152,1134,1,0,0,0,1152,1135,1,0,0,0,1152,1136,1,0,0,0,1152,
	1144,1,0,0,0,1153,121,1,0,0,0,1154,1167,3,120,60,0,1155,1159,5,46,0,0,1156,
	1158,3,122,61,0,1157,1156,1,0,0,0,1158,1161,1,0,0,0,1159,1157,1,0,0,0,1159,
	1160,1,0,0,0,1160,1162,1,0,0,0,1161,1159,1,0,0,0,1162,1167,5,47,0,0,1163,
	1167,5,23,0,0,1164,1167,5,45,0,0,1165,1167,3,12,6,0,1166,1154,1,0,0,0,1166,
	1155,1,0,0,0,1166,1163,1,0,0,0,1166,1164,1,0,0,0,1166,1165,1,0,0,0,1167,
	123,1,0,0,0,164,125,133,135,142,153,168,178,185,195,202,209,216,220,222,
	229,236,239,244,251,255,257,263,268,274,279,284,291,294,301,307,314,317,
	322,331,334,342,349,355,362,369,375,381,385,390,397,406,412,419,426,430,
	436,443,446,451,457,461,478,486,493,499,506,513,519,530,537,542,547,551,
	559,566,573,577,585,592,602,618,623,629,636,647,654,666,669,675,682,686,
	688,697,703,709,712,714,721,727,730,736,745,754,763,768,773,779,785,792,
	801,806,808,814,821,827,829,835,842,849,854,860,867,874,879,881,887,894,
	898,901,905,909,913,920,928,935,944,951,954,964,971,974,984,995,1002,1015,
	1022,1029,1036,1039,1045,1052,1061,1068,1074,1080,1087,1094,1099,1101,1106,
	1110,1118,1126,1130,1140,1148,1152,1159,1166];

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
	public inner_MediaAtRule(): Inner_MediaAtRuleContext {
		return this.getTypedRuleContext(Inner_MediaAtRuleContext, 0) as Inner_MediaAtRuleContext;
	}
	public inner_PageAtRule(): Inner_PageAtRuleContext {
		return this.getTypedRuleContext(Inner_PageAtRuleContext, 0) as Inner_PageAtRuleContext;
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


export class Inner_MediaAtRuleContext extends ParserRuleContext {
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
    	return CssParser.RULE_inner_MediaAtRule;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterInner_MediaAtRule) {
	 		listener.enterInner_MediaAtRule(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitInner_MediaAtRule) {
	 		listener.exitInner_MediaAtRule(this);
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


export class Inner_PageAtRuleContext extends ParserRuleContext {
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
    	return CssParser.RULE_inner_PageAtRule;
	}
	public enterRule(listener: CssParserListener): void {
	    if(listener.enterInner_PageAtRule) {
	 		listener.enterInner_PageAtRule(this);
		}
	}
	public exitRule(listener: CssParserListener): void {
	    if(listener.exitInner_PageAtRule) {
	 		listener.exitInner_PageAtRule(this);
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
