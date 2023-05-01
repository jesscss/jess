// Generated from ../grammar/CssParser.g4 by ANTLR 4.12.0

import {ParseTreeListener} from "antlr4";


import { StylesheetContext } from "./CssParser";
import { MainContext } from "./CssParser";
import { QualifiedRuleContext } from "./CssParser";
import { InnerQualifiedRuleContext } from "./CssParser";
import { SimpleSelectorContext } from "./CssParser";
import { ClassSelectorContext } from "./CssParser";
import { PseudoSelectorContext } from "./CssParser";
import { NthValueContext } from "./CssParser";
import { AttributeSelectorContext } from "./CssParser";
import { CompoundSelectorContext } from "./CssParser";
import { ComplexSelectorContext } from "./CssParser";
import { CombinatorContext } from "./CssParser";
import { RelativeSelectorContext } from "./CssParser";
import { ForgivingSelectorListContext } from "./CssParser";
import { SelectorListContext } from "./CssParser";
import { DeclarationListContext } from "./CssParser";
import { DeclarationContext } from "./CssParser";
import { ValueListContext } from "./CssParser";
import { ValueContext } from "./CssParser";
import { UnknownValueContext } from "./CssParser";
import { MathSumContext } from "./CssParser";
import { MathProductContext } from "./CssParser";
import { MathValueContext } from "./CssParser";
import { MathConstantContext } from "./CssParser";
import { FunctionContext } from "./CssParser";
import { IntegerContext } from "./CssParser";
import { NumberContext } from "./CssParser";
import { DimensionContext } from "./CssParser";
import { PercentageContext } from "./CssParser";
import { AtRuleContext } from "./CssParser";
import { InnerAtRuleContext } from "./CssParser";
import { MediaAtRuleContext } from "./CssParser";
import { Inner_MediaAtRuleContext } from "./CssParser";
import { MediaQueryContext } from "./CssParser";
import { MediaTypeContext } from "./CssParser";
import { MediaConditionContext } from "./CssParser";
import { MediaConditionWithoutOrContext } from "./CssParser";
import { MediaNotContext } from "./CssParser";
import { MediaAndContext } from "./CssParser";
import { MediaOrContext } from "./CssParser";
import { MediaInParensContext } from "./CssParser";
import { MediaFeatureContext } from "./CssParser";
import { MediaRangeContext } from "./CssParser";
import { MfNonIdentifierValueContext } from "./CssParser";
import { MfValueContext } from "./CssParser";
import { MfLtContext } from "./CssParser";
import { MfGtContext } from "./CssParser";
import { MfEqContext } from "./CssParser";
import { MfComparisonContext } from "./CssParser";
import { GeneralEnclosedContext } from "./CssParser";
import { RatioContext } from "./CssParser";
import { PageAtRuleContext } from "./CssParser";
import { Inner_PageAtRuleContext } from "./CssParser";
import { FontFaceAtRuleContext } from "./CssParser";
import { SupportsAtRuleContext } from "./CssParser";
import { SupportsConditionContext } from "./CssParser";
import { SupportsInParensContext } from "./CssParser";
import { ImportAtRuleContext } from "./CssParser";
import { UnknownAtRuleContext } from "./CssParser";
import { IdentifierContext } from "./CssParser";
import { AnyOuterValueContext } from "./CssParser";
import { AnyInnerValueContext } from "./CssParser";


/**
 * This interface defines a complete listener for a parse tree produced by
 * `CssParser`.
 */
export default class CssParserListener extends ParseTreeListener {
	/**
	 * Enter a parse tree produced by `CssParser.stylesheet`.
	 * @param ctx the parse tree
	 */
	enterStylesheet?: (ctx: StylesheetContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.stylesheet`.
	 * @param ctx the parse tree
	 */
	exitStylesheet?: (ctx: StylesheetContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.main`.
	 * @param ctx the parse tree
	 */
	enterMain?: (ctx: MainContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.main`.
	 * @param ctx the parse tree
	 */
	exitMain?: (ctx: MainContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.qualifiedRule`.
	 * @param ctx the parse tree
	 */
	enterQualifiedRule?: (ctx: QualifiedRuleContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.qualifiedRule`.
	 * @param ctx the parse tree
	 */
	exitQualifiedRule?: (ctx: QualifiedRuleContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.innerQualifiedRule`.
	 * @param ctx the parse tree
	 */
	enterInnerQualifiedRule?: (ctx: InnerQualifiedRuleContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.innerQualifiedRule`.
	 * @param ctx the parse tree
	 */
	exitInnerQualifiedRule?: (ctx: InnerQualifiedRuleContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.simpleSelector`.
	 * @param ctx the parse tree
	 */
	enterSimpleSelector?: (ctx: SimpleSelectorContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.simpleSelector`.
	 * @param ctx the parse tree
	 */
	exitSimpleSelector?: (ctx: SimpleSelectorContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.classSelector`.
	 * @param ctx the parse tree
	 */
	enterClassSelector?: (ctx: ClassSelectorContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.classSelector`.
	 * @param ctx the parse tree
	 */
	exitClassSelector?: (ctx: ClassSelectorContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.pseudoSelector`.
	 * @param ctx the parse tree
	 */
	enterPseudoSelector?: (ctx: PseudoSelectorContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.pseudoSelector`.
	 * @param ctx the parse tree
	 */
	exitPseudoSelector?: (ctx: PseudoSelectorContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.nthValue`.
	 * @param ctx the parse tree
	 */
	enterNthValue?: (ctx: NthValueContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.nthValue`.
	 * @param ctx the parse tree
	 */
	exitNthValue?: (ctx: NthValueContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.attributeSelector`.
	 * @param ctx the parse tree
	 */
	enterAttributeSelector?: (ctx: AttributeSelectorContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.attributeSelector`.
	 * @param ctx the parse tree
	 */
	exitAttributeSelector?: (ctx: AttributeSelectorContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.compoundSelector`.
	 * @param ctx the parse tree
	 */
	enterCompoundSelector?: (ctx: CompoundSelectorContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.compoundSelector`.
	 * @param ctx the parse tree
	 */
	exitCompoundSelector?: (ctx: CompoundSelectorContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.complexSelector`.
	 * @param ctx the parse tree
	 */
	enterComplexSelector?: (ctx: ComplexSelectorContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.complexSelector`.
	 * @param ctx the parse tree
	 */
	exitComplexSelector?: (ctx: ComplexSelectorContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.combinator`.
	 * @param ctx the parse tree
	 */
	enterCombinator?: (ctx: CombinatorContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.combinator`.
	 * @param ctx the parse tree
	 */
	exitCombinator?: (ctx: CombinatorContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.relativeSelector`.
	 * @param ctx the parse tree
	 */
	enterRelativeSelector?: (ctx: RelativeSelectorContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.relativeSelector`.
	 * @param ctx the parse tree
	 */
	exitRelativeSelector?: (ctx: RelativeSelectorContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.forgivingSelectorList`.
	 * @param ctx the parse tree
	 */
	enterForgivingSelectorList?: (ctx: ForgivingSelectorListContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.forgivingSelectorList`.
	 * @param ctx the parse tree
	 */
	exitForgivingSelectorList?: (ctx: ForgivingSelectorListContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.selectorList`.
	 * @param ctx the parse tree
	 */
	enterSelectorList?: (ctx: SelectorListContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.selectorList`.
	 * @param ctx the parse tree
	 */
	exitSelectorList?: (ctx: SelectorListContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.declarationList`.
	 * @param ctx the parse tree
	 */
	enterDeclarationList?: (ctx: DeclarationListContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.declarationList`.
	 * @param ctx the parse tree
	 */
	exitDeclarationList?: (ctx: DeclarationListContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.declaration`.
	 * @param ctx the parse tree
	 */
	enterDeclaration?: (ctx: DeclarationContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.declaration`.
	 * @param ctx the parse tree
	 */
	exitDeclaration?: (ctx: DeclarationContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.valueList`.
	 * @param ctx the parse tree
	 */
	enterValueList?: (ctx: ValueListContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.valueList`.
	 * @param ctx the parse tree
	 */
	exitValueList?: (ctx: ValueListContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.value`.
	 * @param ctx the parse tree
	 */
	enterValue?: (ctx: ValueContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.value`.
	 * @param ctx the parse tree
	 */
	exitValue?: (ctx: ValueContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.unknownValue`.
	 * @param ctx the parse tree
	 */
	enterUnknownValue?: (ctx: UnknownValueContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.unknownValue`.
	 * @param ctx the parse tree
	 */
	exitUnknownValue?: (ctx: UnknownValueContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.mathSum`.
	 * @param ctx the parse tree
	 */
	enterMathSum?: (ctx: MathSumContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.mathSum`.
	 * @param ctx the parse tree
	 */
	exitMathSum?: (ctx: MathSumContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.mathProduct`.
	 * @param ctx the parse tree
	 */
	enterMathProduct?: (ctx: MathProductContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.mathProduct`.
	 * @param ctx the parse tree
	 */
	exitMathProduct?: (ctx: MathProductContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.mathValue`.
	 * @param ctx the parse tree
	 */
	enterMathValue?: (ctx: MathValueContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.mathValue`.
	 * @param ctx the parse tree
	 */
	exitMathValue?: (ctx: MathValueContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.mathConstant`.
	 * @param ctx the parse tree
	 */
	enterMathConstant?: (ctx: MathConstantContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.mathConstant`.
	 * @param ctx the parse tree
	 */
	exitMathConstant?: (ctx: MathConstantContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.function`.
	 * @param ctx the parse tree
	 */
	enterFunction?: (ctx: FunctionContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.function`.
	 * @param ctx the parse tree
	 */
	exitFunction?: (ctx: FunctionContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.integer`.
	 * @param ctx the parse tree
	 */
	enterInteger?: (ctx: IntegerContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.integer`.
	 * @param ctx the parse tree
	 */
	exitInteger?: (ctx: IntegerContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.number`.
	 * @param ctx the parse tree
	 */
	enterNumber?: (ctx: NumberContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.number`.
	 * @param ctx the parse tree
	 */
	exitNumber?: (ctx: NumberContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.dimension`.
	 * @param ctx the parse tree
	 */
	enterDimension?: (ctx: DimensionContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.dimension`.
	 * @param ctx the parse tree
	 */
	exitDimension?: (ctx: DimensionContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.percentage`.
	 * @param ctx the parse tree
	 */
	enterPercentage?: (ctx: PercentageContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.percentage`.
	 * @param ctx the parse tree
	 */
	exitPercentage?: (ctx: PercentageContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.atRule`.
	 * @param ctx the parse tree
	 */
	enterAtRule?: (ctx: AtRuleContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.atRule`.
	 * @param ctx the parse tree
	 */
	exitAtRule?: (ctx: AtRuleContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.innerAtRule`.
	 * @param ctx the parse tree
	 */
	enterInnerAtRule?: (ctx: InnerAtRuleContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.innerAtRule`.
	 * @param ctx the parse tree
	 */
	exitInnerAtRule?: (ctx: InnerAtRuleContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.mediaAtRule`.
	 * @param ctx the parse tree
	 */
	enterMediaAtRule?: (ctx: MediaAtRuleContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.mediaAtRule`.
	 * @param ctx the parse tree
	 */
	exitMediaAtRule?: (ctx: MediaAtRuleContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.inner_MediaAtRule`.
	 * @param ctx the parse tree
	 */
	enterInner_MediaAtRule?: (ctx: Inner_MediaAtRuleContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.inner_MediaAtRule`.
	 * @param ctx the parse tree
	 */
	exitInner_MediaAtRule?: (ctx: Inner_MediaAtRuleContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.mediaQuery`.
	 * @param ctx the parse tree
	 */
	enterMediaQuery?: (ctx: MediaQueryContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.mediaQuery`.
	 * @param ctx the parse tree
	 */
	exitMediaQuery?: (ctx: MediaQueryContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.mediaType`.
	 * @param ctx the parse tree
	 */
	enterMediaType?: (ctx: MediaTypeContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.mediaType`.
	 * @param ctx the parse tree
	 */
	exitMediaType?: (ctx: MediaTypeContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.mediaCondition`.
	 * @param ctx the parse tree
	 */
	enterMediaCondition?: (ctx: MediaConditionContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.mediaCondition`.
	 * @param ctx the parse tree
	 */
	exitMediaCondition?: (ctx: MediaConditionContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.mediaConditionWithoutOr`.
	 * @param ctx the parse tree
	 */
	enterMediaConditionWithoutOr?: (ctx: MediaConditionWithoutOrContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.mediaConditionWithoutOr`.
	 * @param ctx the parse tree
	 */
	exitMediaConditionWithoutOr?: (ctx: MediaConditionWithoutOrContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.mediaNot`.
	 * @param ctx the parse tree
	 */
	enterMediaNot?: (ctx: MediaNotContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.mediaNot`.
	 * @param ctx the parse tree
	 */
	exitMediaNot?: (ctx: MediaNotContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.mediaAnd`.
	 * @param ctx the parse tree
	 */
	enterMediaAnd?: (ctx: MediaAndContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.mediaAnd`.
	 * @param ctx the parse tree
	 */
	exitMediaAnd?: (ctx: MediaAndContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.mediaOr`.
	 * @param ctx the parse tree
	 */
	enterMediaOr?: (ctx: MediaOrContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.mediaOr`.
	 * @param ctx the parse tree
	 */
	exitMediaOr?: (ctx: MediaOrContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.mediaInParens`.
	 * @param ctx the parse tree
	 */
	enterMediaInParens?: (ctx: MediaInParensContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.mediaInParens`.
	 * @param ctx the parse tree
	 */
	exitMediaInParens?: (ctx: MediaInParensContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.mediaFeature`.
	 * @param ctx the parse tree
	 */
	enterMediaFeature?: (ctx: MediaFeatureContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.mediaFeature`.
	 * @param ctx the parse tree
	 */
	exitMediaFeature?: (ctx: MediaFeatureContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.mediaRange`.
	 * @param ctx the parse tree
	 */
	enterMediaRange?: (ctx: MediaRangeContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.mediaRange`.
	 * @param ctx the parse tree
	 */
	exitMediaRange?: (ctx: MediaRangeContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.mfNonIdentifierValue`.
	 * @param ctx the parse tree
	 */
	enterMfNonIdentifierValue?: (ctx: MfNonIdentifierValueContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.mfNonIdentifierValue`.
	 * @param ctx the parse tree
	 */
	exitMfNonIdentifierValue?: (ctx: MfNonIdentifierValueContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.mfValue`.
	 * @param ctx the parse tree
	 */
	enterMfValue?: (ctx: MfValueContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.mfValue`.
	 * @param ctx the parse tree
	 */
	exitMfValue?: (ctx: MfValueContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.mfLt`.
	 * @param ctx the parse tree
	 */
	enterMfLt?: (ctx: MfLtContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.mfLt`.
	 * @param ctx the parse tree
	 */
	exitMfLt?: (ctx: MfLtContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.mfGt`.
	 * @param ctx the parse tree
	 */
	enterMfGt?: (ctx: MfGtContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.mfGt`.
	 * @param ctx the parse tree
	 */
	exitMfGt?: (ctx: MfGtContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.mfEq`.
	 * @param ctx the parse tree
	 */
	enterMfEq?: (ctx: MfEqContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.mfEq`.
	 * @param ctx the parse tree
	 */
	exitMfEq?: (ctx: MfEqContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.mfComparison`.
	 * @param ctx the parse tree
	 */
	enterMfComparison?: (ctx: MfComparisonContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.mfComparison`.
	 * @param ctx the parse tree
	 */
	exitMfComparison?: (ctx: MfComparisonContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.generalEnclosed`.
	 * @param ctx the parse tree
	 */
	enterGeneralEnclosed?: (ctx: GeneralEnclosedContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.generalEnclosed`.
	 * @param ctx the parse tree
	 */
	exitGeneralEnclosed?: (ctx: GeneralEnclosedContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.ratio`.
	 * @param ctx the parse tree
	 */
	enterRatio?: (ctx: RatioContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.ratio`.
	 * @param ctx the parse tree
	 */
	exitRatio?: (ctx: RatioContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.pageAtRule`.
	 * @param ctx the parse tree
	 */
	enterPageAtRule?: (ctx: PageAtRuleContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.pageAtRule`.
	 * @param ctx the parse tree
	 */
	exitPageAtRule?: (ctx: PageAtRuleContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.inner_PageAtRule`.
	 * @param ctx the parse tree
	 */
	enterInner_PageAtRule?: (ctx: Inner_PageAtRuleContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.inner_PageAtRule`.
	 * @param ctx the parse tree
	 */
	exitInner_PageAtRule?: (ctx: Inner_PageAtRuleContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.fontFaceAtRule`.
	 * @param ctx the parse tree
	 */
	enterFontFaceAtRule?: (ctx: FontFaceAtRuleContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.fontFaceAtRule`.
	 * @param ctx the parse tree
	 */
	exitFontFaceAtRule?: (ctx: FontFaceAtRuleContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.supportsAtRule`.
	 * @param ctx the parse tree
	 */
	enterSupportsAtRule?: (ctx: SupportsAtRuleContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.supportsAtRule`.
	 * @param ctx the parse tree
	 */
	exitSupportsAtRule?: (ctx: SupportsAtRuleContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.supportsCondition`.
	 * @param ctx the parse tree
	 */
	enterSupportsCondition?: (ctx: SupportsConditionContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.supportsCondition`.
	 * @param ctx the parse tree
	 */
	exitSupportsCondition?: (ctx: SupportsConditionContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.supportsInParens`.
	 * @param ctx the parse tree
	 */
	enterSupportsInParens?: (ctx: SupportsInParensContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.supportsInParens`.
	 * @param ctx the parse tree
	 */
	exitSupportsInParens?: (ctx: SupportsInParensContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.importAtRule`.
	 * @param ctx the parse tree
	 */
	enterImportAtRule?: (ctx: ImportAtRuleContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.importAtRule`.
	 * @param ctx the parse tree
	 */
	exitImportAtRule?: (ctx: ImportAtRuleContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.unknownAtRule`.
	 * @param ctx the parse tree
	 */
	enterUnknownAtRule?: (ctx: UnknownAtRuleContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.unknownAtRule`.
	 * @param ctx the parse tree
	 */
	exitUnknownAtRule?: (ctx: UnknownAtRuleContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.identifier`.
	 * @param ctx the parse tree
	 */
	enterIdentifier?: (ctx: IdentifierContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.identifier`.
	 * @param ctx the parse tree
	 */
	exitIdentifier?: (ctx: IdentifierContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.anyOuterValue`.
	 * @param ctx the parse tree
	 */
	enterAnyOuterValue?: (ctx: AnyOuterValueContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.anyOuterValue`.
	 * @param ctx the parse tree
	 */
	exitAnyOuterValue?: (ctx: AnyOuterValueContext) => void;
	/**
	 * Enter a parse tree produced by `CssParser.anyInnerValue`.
	 * @param ctx the parse tree
	 */
	enterAnyInnerValue?: (ctx: AnyInnerValueContext) => void;
	/**
	 * Exit a parse tree produced by `CssParser.anyInnerValue`.
	 * @param ctx the parse tree
	 */
	exitAnyInnerValue?: (ctx: AnyInnerValueContext) => void;
}

