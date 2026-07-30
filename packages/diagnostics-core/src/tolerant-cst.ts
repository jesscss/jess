import { parseCssDiagnosticCst, parseCssDiagnosticDoc, type CssCstChild, type CssCstNode, type CssCstParseResult, type ParseDoc } from '@jesscss/css-parser';
import { namedColor } from '@jesscss/core';
import { parseJessDiagnosticCst, parseJessDiagnosticDoc } from '@jesscss/jess-parser/cst';
import { parseLessDiagnosticCst, parseLessDiagnosticDoc } from '@jesscss/less-parser/cst';
import { parseScssDiagnosticCst, parseScssDiagnosticDoc } from '@jesscss/scss-parser/cst';
import { defaultCssDiagnosticMetadata } from './metadata.js';
import type {
  CollectDiagnosticsInput,
  CollectDiagnosticsResult,
  CssDiagnosticMetadata,
  CssMediaFeatureValueFact,
  CssPropertyValueFact,
  DiagnosticSeverityName,
  JessLanguage,
  SourceDiagnostic
} from './types.js';

export const LINT_CODES = {
  emptyRules: 'lint/empty-rules',
  unknownProperties: 'lint/unknown-property',
  unknownPropertyValues: 'lint/unknown-property-value',
  unknownAtRules: 'lint/unknown-at-rule',
  unknownAtRuleDescriptors: 'lint/at-rule-descriptor-no-unknown',
  unknownAtRuleDescriptorValues: 'lint/at-rule-descriptor-value-no-unknown',
  duplicateProperties: 'lint/duplicate-property',
  shorthandPropertyOverrides: 'lint/declaration-block-no-shorthand-property-overrides',
  duplicateCustomProperties: 'lint/declaration-block-no-duplicate-custom-properties',
  hexColorLength: 'lint/hex-color-length',
  zeroUnits: 'lint/zero-units',
  customPropertyMissingVarFunction: 'lint/custom-property-no-missing-var-function',
  unknownCustomProperties: 'lint/no-unknown-custom-properties',
  keyframeDuplicateSelectors: 'lint/keyframe-block-no-duplicate-selectors',
  keyframeDeclarationNoImportant: 'lint/keyframe-declaration-no-important',
  declarationNoImportant: 'lint/declaration-no-important',
  invalidNamedGridAreas: 'lint/named-grid-areas-no-invalid',
  fontFamilyDuplicateNames: 'lint/font-family-no-duplicate-names',
  fontFamilyMissingGeneric: 'lint/font-family-no-missing-generic-family-keyword',
  fontFaceMissingRequiredProperties: 'lint/font-face-missing-required-properties',
  propertyIgnoredDueToDisplay: 'lint/property-ignored-due-to-display',
  boxModel: 'lint/box-model',
  float: 'lint/float',
  invalidImportPosition: 'lint/no-invalid-position-at-import-rule',
  duplicateAtImportRules: 'lint/no-duplicate-at-import-rules',
  duplicateModuleLoads: 'lint/no-duplicate-module-load',
  unknownAnimations: 'lint/no-unknown-animations',
  unknownUnits: 'lint/unit-no-unknown',
  unknownFunctions: 'lint/function-no-unknown',
  linearGradientNonstandardDirection: 'lint/function-linear-gradient-no-nonstandard-direction',
  unknownMediaFeatureNames: 'lint/media-feature-name-no-unknown',
  unknownMediaFeatureValues: 'lint/media-feature-name-value-no-unknown',
  unknownPseudoClasses: 'lint/selector-pseudo-class-no-unknown',
  unknownPseudoElements: 'lint/selector-pseudo-element-no-unknown',
  unknownTypeSelectors: 'lint/selector-type-no-unknown',
  unmatchableAnbSelectors: 'lint/selector-anb-no-unmatchable',
  duplicateSelectors: 'lint/no-duplicate-selectors',
  incompatibleMathFunctionUnits: 'lint/incompatible-math-function-units',
  invalidColorFunctionChannels: 'lint/invalid-color-function-channels',
  invalidTypedCustomPropertyValue: 'lint/invalid-typed-custom-property-value',
  unusedVariables: 'lint/no-unused-variable',
  unboundedExtends: 'lint/no-unbounded-extend',
  deadExtends: 'lint/no-dead-extend',
  suspiciousMapKeyAccess: 'lint/no-suspicious-map-key-access',
  unsupportedSassForm: 'unsupported/sass-form'
} as const;

const LENGTH_UNITS = new Set([
  'cap', 'ch', 'em', 'ex', 'ic', 'lh', 'rcap', 'rch', 'rem', 'rex', 'ric', 'rlh',
  'dvb', 'dvh', 'dvi', 'dvmax', 'dvmin', 'dvw',
  'lvb', 'lvh', 'lvi', 'lvmax', 'lvmin', 'lvw',
  'svb', 'svh', 'svi', 'svmax', 'svmin', 'svw',
  'vb', 'vh', 'vi', 'vw', 'vmin', 'vmax', 'vm',
  'px', 'mm', 'cm', 'in', 'pt', 'pc', 'q', 'mozmm',
  'fr',
  'cqw', 'cqh', 'cqi', 'cqb', 'cqmin', 'cqmax'
]);
const KNOWN_CSS_UNITS = new Set([
  ...LENGTH_UNITS,
  's', 'ms',
  'deg', 'grad', 'turn', 'rad',
  'hz', 'khz',
  'dpi', 'dpcm', 'dppx'
]);
const ANGLE_UNITS = new Set(['deg', 'grad', 'turn', 'rad']);
const TIME_UNITS = new Set(['s', 'ms']);
const FREQUENCY_UNITS = new Set(['hz', 'khz']);
const RESOLUTION_UNITS = new Set(['dpi', 'dpcm', 'dppx', 'x']);
const VERTICAL_GRADIENT_SIDES = new Set(['top', 'bottom']);
const HORIZONTAL_GRADIENT_SIDES = new Set(['left', 'right']);
const MATH_FUNCTION_NAMES = new Set(['min', 'max', 'clamp']);
const COLOR_FUNCTION_NAMES = new Set(['rgb', 'rgba', 'hsl', 'hsla']);
const LINEAR_GRADIENT_FUNCTION_NAMES = new Set(['linear-gradient', 'repeating-linear-gradient']);
const FONT_DISPLAY_VALUES = new Set(['auto', 'block', 'swap', 'fallback', 'optional']);
const PROPERTY_SYNTAX_TYPES = new Set([
  'angle',
  'color',
  'custom-ident',
  'image',
  'integer',
  'length',
  'length-percentage',
  'number',
  'percentage',
  'resolution',
  'string',
  'time',
  'transform-function',
  'transform-list',
  'url'
]);
const PAGE_DESCRIPTOR_PROPERTIES = new Set([
  'bleed', 'marks', 'page-orientation', 'size',
  'direction', 'background-color', 'background-image', 'background-repeat',
  'background-attachment', 'background-position', 'background',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-width', 'border-top-color', 'border-right-color', 'border-bottom-color',
  'border-left-color', 'border-color', 'border-top-style', 'border-right-style',
  'border-bottom-style', 'border-left-style', 'border-style', 'border-top',
  'border-right', 'border-bottom', 'border-left', 'border', 'counter-reset',
  'counter-increment', 'color', 'font-family', 'font-size', 'font-style',
  'font-variant', 'font-weight', 'font', 'height', 'min-height', 'max-height',
  'line-height', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'margin', 'outline-width', 'outline-style', 'outline-color', 'outline',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'padding',
  'quotes', 'letter-spacing', 'text-align', 'text-decoration', 'text-indent',
  'text-transform', 'white-space', 'word-spacing', 'visibility', 'width',
  'min-width', 'max-width'
]);
const PAGE_MARGIN_DESCRIPTOR_PROPERTIES = new Set([
  'direction', 'unicode-bidi', 'background-color', 'background-image',
  'background-repeat', 'background-attachment', 'background-position', 'background',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-width', 'border-top-color', 'border-right-color', 'border-bottom-color',
  'border-left-color', 'border-color', 'border-top-style', 'border-right-style',
  'border-bottom-style', 'border-left-style', 'border-style', 'border-top',
  'border-right', 'border-bottom', 'border-left', 'border', 'counter-reset',
  'counter-increment', 'content', 'color', 'font-family', 'font-size', 'font-style',
  'font-variant', 'font-weight', 'font', 'height', 'min-height', 'max-height',
  'line-height', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'margin', 'outline-width', 'outline-style', 'outline-color', 'outline',
  'overflow', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'padding', 'quotes', 'letter-spacing', 'text-align', 'text-decoration',
  'text-indent', 'text-transform', 'white-space', 'word-spacing', 'vertical-align',
  'visibility', 'width', 'min-width', 'max-width', 'z-index'
]);

const SHORTHAND_OVERRIDE_PROPERTIES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['animation', new Set([
    'animation-delay', 'animation-direction', 'animation-duration', 'animation-fill-mode',
    'animation-iteration-count', 'animation-name', 'animation-play-state', 'animation-timing-function'
  ])],
  ['background', new Set([
    'background-attachment', 'background-clip', 'background-color', 'background-image',
    'background-origin', 'background-position', 'background-repeat', 'background-size'
  ])],
  ['border', new Set([
    'border-bottom', 'border-bottom-color', 'border-bottom-style', 'border-bottom-width',
    'border-color', 'border-image', 'border-image-outset', 'border-image-repeat',
    'border-image-slice', 'border-image-source', 'border-image-width', 'border-left',
    'border-left-color', 'border-left-style', 'border-left-width', 'border-right',
    'border-right-color', 'border-right-style', 'border-right-width', 'border-style',
    'border-top', 'border-top-color', 'border-top-style', 'border-top-width', 'border-width'
  ])],
  ['border-block', new Set(['border-block-color', 'border-block-style', 'border-block-width'])],
  ['border-block-end', new Set(['border-block-end-color', 'border-block-end-style', 'border-block-end-width'])],
  ['border-block-start', new Set(['border-block-start-color', 'border-block-start-style', 'border-block-start-width'])],
  ['border-bottom', new Set(['border-bottom-color', 'border-bottom-style', 'border-bottom-width'])],
  ['border-color', new Set(['border-bottom-color', 'border-left-color', 'border-right-color', 'border-top-color'])],
  ['border-inline', new Set(['border-inline-color', 'border-inline-style', 'border-inline-width'])],
  ['border-inline-end', new Set(['border-inline-end-color', 'border-inline-end-style', 'border-inline-end-width'])],
  ['border-inline-start', new Set(['border-inline-start-color', 'border-inline-start-style', 'border-inline-start-width'])],
  ['border-left', new Set(['border-left-color', 'border-left-style', 'border-left-width'])],
  ['border-radius', new Set([
    'border-bottom-left-radius', 'border-bottom-right-radius',
    'border-top-left-radius', 'border-top-right-radius'
  ])],
  ['border-right', new Set(['border-right-color', 'border-right-style', 'border-right-width'])],
  ['border-style', new Set(['border-bottom-style', 'border-left-style', 'border-right-style', 'border-top-style'])],
  ['border-top', new Set(['border-top-color', 'border-top-style', 'border-top-width'])],
  ['border-width', new Set(['border-bottom-width', 'border-left-width', 'border-right-width', 'border-top-width'])],
  ['column-rule', new Set(['column-rule-color', 'column-rule-style', 'column-rule-width'])],
  ['columns', new Set(['column-count', 'column-width'])],
  ['flex', new Set(['flex-basis', 'flex-grow', 'flex-shrink'])],
  ['font', new Set([
    'font-family', 'font-feature-settings', 'font-kerning', 'font-language-override',
    'font-optical-sizing', 'font-size', 'font-size-adjust', 'font-stretch', 'font-style',
    'font-variant', 'font-variant-alternates', 'font-variant-caps',
    'font-variant-east-asian', 'font-variant-emoji', 'font-variant-ligatures',
    'font-variant-numeric', 'font-variant-position', 'font-variation-settings',
    'font-weight', 'line-height'
  ])],
  ['gap', new Set(['column-gap', 'row-gap'])],
  ['grid', new Set([
    'grid-auto-columns', 'grid-auto-flow', 'grid-auto-rows', 'grid-column-gap',
    'grid-row-gap', 'grid-template', 'grid-template-areas',
    'grid-template-columns', 'grid-template-rows'
  ])],
  ['grid-template', new Set(['grid-template-areas', 'grid-template-columns', 'grid-template-rows'])],
  ['inset', new Set(['bottom', 'left', 'right', 'top'])],
  ['inset-block', new Set(['inset-block-end', 'inset-block-start'])],
  ['inset-inline', new Set(['inset-inline-end', 'inset-inline-start'])],
  ['list-style', new Set(['list-style-image', 'list-style-position', 'list-style-type'])],
  ['margin', new Set(['margin-bottom', 'margin-left', 'margin-right', 'margin-top'])],
  ['margin-block', new Set(['margin-block-end', 'margin-block-start'])],
  ['margin-inline', new Set(['margin-inline-end', 'margin-inline-start'])],
  ['outline', new Set(['outline-color', 'outline-style', 'outline-width'])],
  ['overflow', new Set(['overflow-x', 'overflow-y'])],
  ['overscroll-behavior', new Set(['overscroll-behavior-x', 'overscroll-behavior-y'])],
  ['padding', new Set(['padding-bottom', 'padding-left', 'padding-right', 'padding-top'])],
  ['padding-block', new Set(['padding-block-end', 'padding-block-start'])],
  ['padding-inline', new Set(['padding-inline-end', 'padding-inline-start'])],
  ['place-content', new Set(['align-content', 'justify-content'])],
  ['place-items', new Set(['align-items', 'justify-items'])],
  ['place-self', new Set(['align-self', 'justify-self'])],
  ['scroll-margin', new Set(['scroll-margin-bottom', 'scroll-margin-left', 'scroll-margin-right', 'scroll-margin-top'])],
  ['scroll-margin-block', new Set(['scroll-margin-block-end', 'scroll-margin-block-start'])],
  ['scroll-margin-inline', new Set(['scroll-margin-inline-end', 'scroll-margin-inline-start'])],
  ['scroll-padding', new Set(['scroll-padding-bottom', 'scroll-padding-left', 'scroll-padding-right', 'scroll-padding-top'])],
  ['scroll-padding-block', new Set(['scroll-padding-block-end', 'scroll-padding-block-start'])],
  ['scroll-padding-inline', new Set(['scroll-padding-inline-end', 'scroll-padding-inline-start'])],
  ['text-decoration', new Set([
    'text-decoration-color', 'text-decoration-line',
    'text-decoration-style', 'text-decoration-thickness'
  ])],
  ['text-emphasis', new Set(['text-emphasis-color', 'text-emphasis-style'])],
  ['transition', new Set(['transition-delay', 'transition-duration', 'transition-property', 'transition-timing-function'])]
]);

const DIALECT_AT_RULES: Record<JessLanguage, Set<string>> = {
  css: new Set(),
  less: new Set(['plugin']),
  scss: new Set([
    'mixin', 'include', 'function', 'return', 'if', 'else', 'each', 'for',
    'while', 'use', 'forward', 'content', 'extend', 'at-root', 'debug',
    'warn', 'error'
  ]),
  jess: new Set([
    'mixin', 'include', 'function', 'return', 'if', 'else', 'each', 'for',
    'while', 'use', 'forward', 'from', 'compose', 'content', 'extend',
    'at-root', 'debug', 'warn', 'error'
  ])
};

const RULESET_TYPES = new Set([
  'Ruleset',
  'NestedRuleset',
  'RulesetWithExtends',
  'NestedRulesetWithExtends'
]);
const MIXIN_DEFINITION_TYPES = new Set([
  'MixinDefinition',
  'MixinDefinitionRule',
  'MixinOrQualifiedRule'
]);
const ATRULE_TYPES = new Set([
  'AtRuleBlock',
  'AtRuleStatement',
  'UnknownAtRuleBlock',
  'QueryAtRuleBlock',
  'OpaqueAtRuleBlock'
]);
const DECLARATION_TYPES = new Set(['Declaration']);
const CUSTOM_DECLARATION_TYPES = new Set(['CustomDeclaration']);
const DIMENSION_TYPES = new Set(['Dimension']);
const PERCENTAGE_TYPES = new Set(['Percentage']);
const CUSTOM_PROPERTY_VALUE_TYPES = new Set(['CustomPropertyValue']);
const KEYFRAMES_TYPES = new Set(['Keyframes']);
const KEYFRAME_BLOCK_TYPES = new Set(['KeyframeBlock']);
const IMPORTANT_TYPES = new Set(['Important', 'ImportantValue']);
const IMPORT_RULE_TYPES = new Set(['ImportStatement', 'ImportAtRule']);
const MODULE_LOAD_TYPES = new Set(['UseRule', 'ForwardRule', 'ModuleImport', 'StyleImport']);
const STATIC_IMPORT_TARGET_TYPES = new Set(['Quoted', 'ImportTarget', 'Url']);
const EXTEND_TARGET_TYPES = new Set(['ExtendTargetComplex', 'Selector', 'PseudoSelectorComplex']);
const EXTERNAL_SELECTOR_SOURCE_TYPES = new Set(['ImportStatement', 'ImportAtRule', 'UseRule', 'ForwardRule', 'ModuleImport', 'StyleImport', 'Plugin']);
const FUNCTION_TYPES = new Set(['Call', 'VarCall', 'FunctionCall', 'ImportTailFunction']);
const MAP_LIKE_VALUE_TYPES = new Set(['Collection', 'Map', 'ValueBlock']);
const MEDIA_FEATURE_NAME_TYPES = new Set(['QueryBareFeature', 'QueryColonFeature', 'QueryComparisonFeature', 'QueryRangeFeature']);
const PSEUDO_SELECTOR_TYPES = new Set(['PseudoSelector']);
const ANB_PSEUDO_CLASSES = new Set([
  'nth-child',
  'nth-column',
  'nth-last-child',
  'nth-last-column',
  'nth-last-of-type',
  'nth-of-type'
]);
const NTH_ARGUMENT_TYPES = new Set(['PseudoArgument', 'OfTypePseudoArgument']);
const BASIC_SELECTOR_TYPES = new Set(['BasicSelector']);
const SELECTOR_LIST_TYPES = new Set(['SelectorList', 'TopLevelSelectorList']);
const SELECTOR_BRANCH_TYPES = new Set(['ComplexSelector', 'TopLevelComplexSelector', 'RelativeComplexSelector', 'RelativeSelector']);
const RULE_SELECTOR_TYPES = new Set(['SelectorList', 'TopLevelSelectorList', 'SelectorListWithExtends', 'Selector']);
const RULE_SELECTOR_BRANCH_TYPES = new Set([...SELECTOR_BRANCH_TYPES, 'SelectorBranch', 'Complex']);
const LEGACY_SINGLE_COLON_PSEUDO_ELEMENTS = new Set(['before', 'after', 'first-line', 'first-letter']);
const IGNORED_TYPE_SELECTOR_PSEUDO_CLASSES = new Set([
  'active-view-transition-type',
  'dir',
  '-moz-locale-dir',
  'state',
  'lang'
]);
const IGNORED_TYPE_SELECTOR_PSEUDO_ELEMENTS = new Set([
  'highlight',
  'view-transition-group',
  'view-transition-image-pair',
  'view-transition-new',
  'view-transition-old'
]);
const DIALECT_PSEUDO_CLASSES: Record<JessLanguage, Set<string>> = {
  css: new Set(),
  less: new Set(),
  scss: new Set(['global', 'local']),
  jess: new Set(['global', 'local'])
};
const CSS_WIDE_KEYWORDS = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);
const ANIMATION_NAME_KEYWORDS = new Set([...CSS_WIDE_KEYWORDS, 'none']);
const ANIMATION_SHORTHAND_KEYWORDS = new Set([
  ...ANIMATION_NAME_KEYWORDS,
  'linear',
  'ease',
  'ease-in',
  'ease-in-out',
  'ease-out',
  'step-start',
  'step-end',
  'steps',
  'cubic-bezier',
  'infinite',
  'normal',
  'reverse',
  'alternate',
  'alternate-reverse',
  'forwards',
  'backwards',
  'both',
  'running',
  'paused'
]);
const GENERIC_FONT_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'emoji',
  'math',
  'fangsong'
]);
const FONT_SIZE_KEYWORDS = new Set([
  'xx-small',
  'x-small',
  'small',
  'medium',
  'large',
  'x-large',
  'xx-large',
  'xxx-large',
  'larger',
  'smaller'
]);
const SYSTEM_FONT_KEYWORDS = new Set([
  'caption',
  'icon',
  'menu',
  'message-box',
  'small-caption',
  'status-bar'
]);
const FORWARD_AS_PREFIX = /\bas\s+\S+-\*/;
const FORWARD_VISIBILITY = /\b(show|hide)\b/;

type DiagnosticSpan = {
  readonly start: number;
  readonly end: number;
  readonly startLine?: number;
  readonly startColumn?: number;
  readonly endLine?: number;
  readonly endColumn?: number;
};

type ParseDiagnosticSource = {
  readonly errors: readonly { readonly span: DiagnosticSpan }[];
  readonly unconsumedFrom: number | null;
  readonly tree: CssCstNode | null;
};

type VisitContext = {
  readonly inVarCall: boolean;
  readonly inDeclaration: boolean;
  readonly inMediaAtRule: boolean;
  readonly inCustomDeclaration: boolean;
  readonly inFontFaceAtRule: boolean;
  readonly descriptorAtRuleName: string | null;
  readonly pageDescriptorContext: 'page' | 'page-margin' | null;
  readonly inKeyframeBlock: boolean;
  readonly inUrlFunction: boolean;
  readonly inIgnoredTypeSelectorPseudo: boolean;
  readonly allowResolutionXUnit: boolean;
  readonly selectorLists: Map<string, SelectorSeen>;
};

type FontFamilyPart = {
  readonly raw: string;
  readonly normalized: string;
  readonly isGeneric: boolean;
  readonly start: number;
  readonly end: number;
};

type ImportKey = {
  readonly key: string;
  readonly target: string;
};

type ModuleLoadKey = {
  readonly key: string;
  readonly directive: string;
  readonly target: string;
};

type NumericKind = 'number' | 'length' | 'angle' | 'time' | 'frequency' | 'resolution' | 'percentage' | 'flex';

type MathArgumentFact = {
  readonly kind: NumericKind;
  readonly text: string;
  readonly span: DiagnosticSpan;
};

type GridAreaRow = {
  readonly tokens: readonly string[];
  readonly span: DiagnosticSpan;
};

type MathUnitMismatch = {
  readonly functionName: string;
  readonly expected: MathArgumentFact;
  readonly actual: MathArgumentFact;
};

type ColorChannelKind = 'number' | 'percentage' | 'angle' | 'keyword' | 'dimension' | 'unknown';

type ColorChannelFact = {
  readonly kind: ColorChannelKind;
  readonly text: string;
  readonly span: DiagnosticSpan;
};

type ColorFunctionChannelProblem = {
  readonly message: string;
  readonly span: DiagnosticSpan;
};

type AtRuleDescriptorValueProblem = {
  readonly descriptorName: string;
  readonly value: string;
  readonly span: DiagnosticSpan;
};

type TypedCustomPropertySyntaxKind =
  | 'any'
  | 'number'
  | 'integer'
  | 'length'
  | 'percentage'
  | 'length-percentage'
  | 'angle'
  | 'time'
  | 'resolution'
  | 'color';

type TypedCustomPropertySyntax = {
  readonly raw: string;
  readonly kind: TypedCustomPropertySyntaxKind;
};

type TypedCustomPropertyInitialKind =
  | 'number'
  | 'integer'
  | 'length'
  | 'percentage'
  | 'angle'
  | 'time'
  | 'resolution'
  | 'color'
  | 'keyword'
  | 'unknown';

type TypedCustomPropertyInitialValue = {
  readonly text: string;
  readonly kind: TypedCustomPropertyInitialKind;
  readonly numberValue: number | null;
  readonly span: DiagnosticSpan;
};

type TypedCustomPropertyValueProblem = {
  readonly syntax: TypedCustomPropertySyntax;
  readonly value: TypedCustomPropertyInitialValue;
};

type SelectorSeen = {
  readonly line: number;
};

type SelectorBranchFact = {
  readonly key: string;
  readonly display: string;
  readonly span: DiagnosticSpan;
};

type AnimationNameReference = {
  readonly name: string;
  readonly span: DiagnosticSpan;
};

type CustomPropertyReference = {
  readonly name: string;
  readonly span: DiagnosticSpan;
};

type VariableDeclarationFact = {
  readonly name: string;
  readonly display: string;
  readonly span: DiagnosticSpan;
};

type SuspiciousMapKeyAccess = {
  readonly variable: string;
  readonly span: DiagnosticSpan;
};

type ExactExtendTargetFact = {
  readonly key: string;
  readonly display: string;
  readonly span: DiagnosticSpan;
};

const ROOT_VISIT_CONTEXT_BASE = {
  inVarCall: false,
  inDeclaration: false,
  inMediaAtRule: false,
  inCustomDeclaration: false,
  inFontFaceAtRule: false,
  descriptorAtRuleName: null,
  pageDescriptorContext: null,
  inKeyframeBlock: false,
  inUrlFunction: false,
  inIgnoredTypeSelectorPseudo: false,
  allowResolutionXUnit: false
};

function isCstNode(c: CssCstChild): c is CssCstNode {
  return c._tag === 'node';
}

function cstChildrenOf(node: CssCstNode): readonly CssCstChild[] {
  return node.rules;
}

function isQuotedCstNode(node: CssCstNode): boolean {
  return node.grammarType === 'Quoted';
}

function forwardPreludeOf(node: CssCstNode, src: string): string | null {
  let afterPath = false;
  for (const child of cstChildrenOf(node)) {
    if (isCstNode(child)) {
      if (isQuotedCstNode(child)) {
        afterPath = true;
      }
      if (afterPath && child.grammarType === 'ForwardTail') {
        const text = src.slice(Number(child.span.start), Number(child.span.end));
        const normalized = text
          .replace(/\/\*[\s\S]*?\*\//g, ' ')
          .replace(/\/\/[^\n\r]*/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        return normalized === '' ? null : normalized;
      }
      continue;
    }
    if (!afterPath) {
      continue;
    }
    const text = src.slice(Number(child.span.start), Number(child.span.end));
    const normalized = text
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n\r]*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (normalized === ';' || normalized.toLowerCase() === 'with') {
      continue;
    }
    return normalized;
  }
  return null;
}

function propNameOf(slice: string): string {
  const colon = slice.indexOf(':');
  const head = colon >= 0 ? slice.slice(0, colon) : slice;
  return head.trim();
}

function absoluteStart(node: CssCstNode): number {
  return Number(node.span.start);
}

function absoluteEnd(node: CssCstNode): number {
  return Number(node.span.end);
}

function isWhitespaceOnly(source: string, start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    const code = source.charCodeAt(i);
    if (code !== 9 && code !== 10 && code !== 12 && code !== 13 && code !== 32) {
      return false;
    }
  }
  return true;
}

function emptyBracedBody(source: string, start: number, end: number): boolean {
  const open = source.indexOf('{', start);
  const close = source.lastIndexOf('}', end - 1);
  return open >= start && close > open && isWhitespaceOnly(source, open + 1, close);
}

function atRuleNameEnd(source: string, start: number, end: number): number {
  let i = start + 1;
  while (i < end) {
    const code = source.charCodeAt(i);
    const isNameChar = (code >= 65 && code <= 90)
      || (code >= 97 && code <= 122)
      || (code >= 48 && code <= 57)
      || code === 45
      || code === 95;
    if (!isNameChar) {
      break;
    }
    i++;
  }
  return i;
}

function atRuleNameOf(source: string, start: number, end: number): string | null {
  if (start >= end || source.charCodeAt(start) !== 64 /* @ */) {
    return null;
  }
  const nameEnd = atRuleNameEnd(source, start, end);
  if (nameEnd <= start + 1) {
    return null;
  }
  return source.slice(start + 1, nameEnd).toLowerCase();
}

function isIdentStart(code: number): boolean {
  return (code >= 65 && code <= 90)
    || (code >= 97 && code <= 122)
    || code === 45
    || code === 95;
}

function isIdentChar(code: number): boolean {
  return isIdentStart(code) || (code >= 48 && code <= 57);
}

function functionNameOf(source: string, start: number, end: number): string | null {
  let i = start;
  while (i < end && isIdentChar(source.charCodeAt(i))) {
    i++;
  }
  if (i === start) {
    return null;
  }
  let open = i;
  while (open < end) {
    const code = source.charCodeAt(open);
    if (code === 40 /* ( */) {
      return source.slice(start, i).toLowerCase();
    }
    if (code !== 9 && code !== 10 && code !== 12 && code !== 13 && code !== 32) {
      return null;
    }
    open++;
  }
  return null;
}

function unprefixedName(name: string): string {
  if (name.startsWith('-webkit-')) {
    return name.slice(8);
  }
  if (name.startsWith('-moz-')) {
    return name.slice(5);
  }
  if (name.startsWith('-ms-')) {
    return name.slice(4);
  }
  if (name.startsWith('-o-')) {
    return name.slice(3);
  }
  return name;
}

function vendorPrefixOfName(name: string): string {
  if (name.startsWith('-webkit-')) {
    return '-webkit-';
  }
  if (name.startsWith('-moz-')) {
    return '-moz-';
  }
  if (name.startsWith('-ms-')) {
    return '-ms-';
  }
  if (name.startsWith('-o-')) {
    return '-o-';
  }
  return '';
}

function descriptorStatusForContext(
  context: VisitContext,
  metadata: CssDiagnosticMetadata,
  descriptorName: string
): { readonly atRuleName: string; readonly status: boolean | undefined } | null {
  const lower = descriptorName.toLowerCase();
  if (context.pageDescriptorContext === 'page') {
    return { atRuleName: 'page', status: PAGE_DESCRIPTOR_PROPERTIES.has(lower) };
  }
  if (context.pageDescriptorContext === 'page-margin') {
    return { atRuleName: 'page', status: PAGE_MARGIN_DESCRIPTOR_PROPERTIES.has(lower) };
  }
  if (context.descriptorAtRuleName !== null) {
    return {
      atRuleName: context.descriptorAtRuleName,
      status: metadata.isKnownAtRuleDescriptor(context.descriptorAtRuleName, descriptorName)
    };
  }
  return null;
}

function pseudoNameSpan(source: string, start: number, end: number): { name: string; bare: string; colonCount: 1 | 2; start: number; end: number } | null {
  if (start >= end || source.charCodeAt(start) !== 58 /* : */) {
    return null;
  }
  let i = start + 1;
  let colonCount: 1 | 2 = 1;
  if (i < end && source.charCodeAt(i) === 58 /* : */) {
    colonCount = 2;
    i++;
  }
  const nameStart = i;
  if (i >= end || !isIdentStart(source.charCodeAt(i))) {
    return null;
  }
  i++;
  while (i < end && isIdentChar(source.charCodeAt(i))) {
    i++;
  }
  const nameEnd = i;
  const prefix = colonCount === 2 ? '::' : ':';
  const bare = source.slice(nameStart, nameEnd);
  return {
    name: `${prefix}${bare}`,
    bare,
    colonCount,
    start,
    end: nameEnd
  };
}

function isVendorPseudoName(bareName: string): boolean {
  return bareName.startsWith('-webkit-')
    || bareName.startsWith('-moz-')
    || bareName.startsWith('-ms-')
    || bareName.startsWith('-o-');
}

function isVendorPrefixedName(name: string): boolean {
  return name.startsWith('-webkit-')
    || name.startsWith('-moz-')
    || name.startsWith('-ms-')
    || name.startsWith('-o-');
}

function isCustomElementName(name: string): boolean {
  return name.includes('-') && name.toLowerCase() === name && isIdentStart(name.charCodeAt(0));
}

function typeSelectorNameSpan(source: string, node: CssCstNode): { name: string; start: number; end: number } | null {
  const start = absoluteStart(node);
  const end = absoluteEnd(node);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null;
  }
  const name = source.slice(start, end);
  if (
    name === '*'
    || name.startsWith('.')
    || name.startsWith('#')
    || name.startsWith('&')
    || name.includes('@{')
    || name.includes('#{')
    || name.includes('${')
  ) {
    return null;
  }
  if (end < source.length && source.charCodeAt(end) === 124 /* | */) {
    return null;
  }
  return { name, start, end };
}

function ignoresTypeSelectorsInPseudo(source: string, start: number, end: number): boolean {
  const pseudo = pseudoNameSpan(source, start, end);
  if (pseudo === null) {
    return false;
  }
  const bare = pseudo.bare.toLowerCase();
  return pseudo.colonCount === 2
    ? IGNORED_TYPE_SELECTOR_PSEUDO_ELEMENTS.has(bare)
    : IGNORED_TYPE_SELECTOR_PSEUDO_CLASSES.has(bare);
}

function nthArgumentSpan(source: string, node: CssCstNode): DiagnosticSpan | null {
  const argument = firstChildNodeMatching(node, NTH_ARGUMENT_TYPES);
  if (argument === undefined) {
    return null;
  }
  const start = absoluteStart(argument);
  let end = absoluteEnd(argument);
  const selector = firstDescendantNodeOf(argument, 'SelectorList');
  if (selector !== undefined) {
    let cursor = absoluteStart(selector);
    while (cursor > start) {
      const code = source.charCodeAt(cursor - 1);
      if (code !== 9 && code !== 10 && code !== 12 && code !== 13 && code !== 32) {
        break;
      }
      cursor--;
    }
    if (
      cursor >= start + 2
      && source.slice(cursor - 2, cursor).toLowerCase() === 'of'
    ) {
      end = cursor - 2;
    }
  }
  const trimmed = trimOffsets(source.slice(start, end), start);
  return trimmed.start < trimmed.end ? spanFromOffsets(trimmed.start, trimmed.end) : null;
}

function isUnmatchableAnbArgument(text: string): boolean {
  return /^[-+]?0(?:n(?:[-+]0)?)?$/i.test(text.replace(/\s+/g, ''));
}

function mediaFeatureNameSpan(source: string, node: CssCstNode): { name: string; start: number; end: number } | null {
  for (const child of node.rules) {
    if (child._tag === 'node' && child.grammarType === 'Property') {
      const start = absoluteStart(child);
      const end = absoluteEnd(child);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return null;
      }
      return {
        name: source.slice(start, end),
        start,
        end
      };
    }
  }
  return null;
}

function mediaFeatureValue(source: string, node: CssCstNode): { fact: CssMediaFeatureValueFact; span: DiagnosticSpan } | null {
  for (const child of node.rules) {
    if (child._tag !== 'node' || child.grammarType !== 'QueryValue') {
      continue;
    }
    let start = absoluteStart(child);
    let end = absoluteEnd(child);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return null;
    }
    while (start < end && isCssWhitespace(source.charCodeAt(start))) {
      start++;
    }
    while (end > start && isCssWhitespace(source.charCodeAt(end - 1))) {
      end--;
    }
    if (end <= start) {
      return null;
    }
    const raw = source.slice(start, end);
    return {
      fact: mediaFeatureValueFact(source, start, end, raw),
      span: spanAtOrContaining(child, start, end)
    };
  }
  return null;
}

function mediaFeatureValueFact(source: string, start: number, end: number, raw: string): CssMediaFeatureValueFact {
  const normalized = raw.toLowerCase();
  if (hasDynamicSyntax(raw)) {
    return { raw, normalized, kind: 'unknown' };
  }
  const functionName = functionNameOf(source, start, end);
  if (functionName !== null) {
    return { raw, normalized, kind: 'function', functionName };
  }
  if (isCssRatio(raw)) {
    return { raw, normalized, kind: 'ratio' };
  }
  const numberValue = cssNumberValue(raw);
  if (numberValue !== null) {
    return {
      raw,
      normalized,
      kind: isIntegerNumber(raw) ? 'integer' : 'number',
      numericValue: numberValue
    };
  }
  const percentageValue = cssPercentageValue(raw);
  if (percentageValue !== null) {
    return { raw, normalized, kind: 'percentage', numericValue: percentageValue };
  }
  const unit = cssDimensionUnit(raw);
  if (unit !== null) {
    return { raw, normalized, kind: 'dimension', unit };
  }
  if (isCssIdentifier(raw)) {
    return { raw, normalized, kind: 'keyword' };
  }
  return { raw, normalized, kind: 'unknown' };
}

function declarationPropertyValue(source: string, node: CssCstNode): { fact: CssPropertyValueFact; span: DiagnosticSpan } | null {
  const value = declarationValueText(source, node);
  if (value === null) {
    return null;
  }
  const raw = value.text;
  const normalized = raw.toLowerCase();
  if (hasDynamicSyntax(raw)) {
    return {
      fact: { raw, normalized, kind: 'unknown' },
      span: value.span
    };
  }
  if (isStaticCustomPropertyName(raw)) {
    return {
      fact: { raw, normalized, kind: 'unknown' },
      span: value.span
    };
  }
  const valueStart = value.span.start;
  const valueEnd = value.span.end;
  const functionName = functionNameOf(source, valueStart, valueEnd);
  if (functionName !== null) {
    return {
      fact: { raw, normalized, kind: 'function', functionName },
      span: value.span
    };
  }
  if (isValidHexColor(raw) || normalized === 'currentcolor' || namedColor(normalized) !== undefined) {
    return {
      fact: { raw, normalized, kind: 'color' },
      span: value.span
    };
  }
  const numberValue = cssNumberValue(raw);
  if (numberValue !== null) {
    return {
      fact: {
        raw,
        normalized,
        kind: isIntegerNumber(raw) ? 'integer' : 'number',
        numericValue: numberValue
      },
      span: value.span
    };
  }
  const percentageValue = cssPercentageValue(raw);
  if (percentageValue !== null) {
    return {
      fact: { raw, normalized, kind: 'percentage', numericValue: percentageValue },
      span: value.span
    };
  }
  const unit = cssDimensionUnit(raw);
  if (unit !== null) {
    return {
      fact: { raw, normalized, kind: 'dimension', unit },
      span: value.span
    };
  }
  return {
    fact: { raw, normalized, kind: isCssIdentifier(raw) ? 'keyword' : 'unknown' },
    span: value.span
  };
}

function isValidHexColor(value: string): boolean {
  if (value.length !== 4 && value.length !== 5 && value.length !== 7 && value.length !== 9) {
    return false;
  }
  if (value.charCodeAt(0) !== 35 /* # */) {
    return false;
  }
  for (let i = 1; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (!(
      (code >= 48 && code <= 57)
      || (code >= 65 && code <= 70)
      || (code >= 97 && code <= 102)
    )) {
      return false;
    }
  }
  return true;
}

function isCssWhitespace(code: number): boolean {
  return code === 9 || code === 10 || code === 12 || code === 13 || code === 32;
}

function hasDynamicSyntax(value: string): boolean {
  return value.toLowerCase().includes('var(')
    || value.includes('@{')
    || value.includes('#{')
    || value.includes('${')
    || value.includes('$');
}

function isCssIdentifier(value: string): boolean {
  if (value.length === 0 || !isIdentStart(value.charCodeAt(0))) {
    return false;
  }
  for (let i = 1; i < value.length; i++) {
    if (!isIdentChar(value.charCodeAt(i))) {
      return false;
    }
  }
  return true;
}

function isStaticCustomPropertyName(value: string): boolean {
  return value.length > 2
    && value.startsWith('--')
    && !hasDynamicSyntax(value)
    && isCssIdentifier(value);
}

function customPropertyRegistrationName(source: string, node: CssCstNode): string | null {
  const prelude = firstChildNodeOf(node, 'AtRulePrelude');
  if (prelude === undefined) {
    return null;
  }
  const start = absoluteStart(prelude);
  const end = absoluteEnd(prelude);
  const raw = stripComments(source.slice(start, end));
  const trimmed = raw.trim();
  return isStaticCustomPropertyName(trimmed) ? trimmed : null;
}

function customPropertyReferenceOfVarCall(source: string, node: CssCstNode): CustomPropertyReference | null {
  const child = firstChildNodeOf(node, 'CustomPropertyValue');
  if (child === undefined) {
    return null;
  }
  const start = absoluteStart(child);
  const end = absoluteEnd(child);
  const name = source.slice(start, end).trim();
  if (!isStaticCustomPropertyName(name)) {
    return null;
  }
  return {
    name,
    span: spanAtOrContaining(node, start, end)
  };
}

function isKeyframesAtRuleName(name: string): boolean {
  return name === 'keyframes' || (name.startsWith('-') && name.endsWith('-keyframes'));
}

function staticAnimationName(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || hasDynamicSyntax(trimmed)) {
    return null;
  }
  const first = trimmed.charCodeAt(0);
  const last = trimmed.charCodeAt(trimmed.length - 1);
  if ((first === 34 || first === 39) && last === first && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  return isCssIdentifier(trimmed) ? trimmed : null;
}

function keyframesAnimationName(source: string, node: CssCstNode): string | null {
  const start = absoluteStart(node);
  const end = absoluteEnd(node);
  const atRuleName = atRuleNameOf(source, start, end);
  if (atRuleName === null || !isKeyframesAtRuleName(atRuleName)) {
    return null;
  }
  const nameStart = atRuleNameEnd(source, start, end);
  const blockStart = topLevelBlockStart(source, nameStart, end);
  if (blockStart < 0 || blockStart > end) {
    return null;
  }
  return staticAnimationName(stripComments(source.slice(nameStart, blockStart)));
}

function topLevelBlockStart(source: string, start: number, end: number): number {
  let i = start;
  let quote = 0;
  let inBlockComment = false;
  while (i < end) {
    const code = source.charCodeAt(i);
    const next = i + 1 < end ? source.charCodeAt(i + 1) : 0;
    if (inBlockComment) {
      if (code === 42 && next === 47) {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (quote !== 0) {
      if (code === 92) {
        i += 2;
        continue;
      }
      if (code === quote) {
        quote = 0;
      }
      i++;
      continue;
    }
    if (code === 47 && next === 42) {
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (code === 34 || code === 39) {
      quote = code;
      i++;
      continue;
    }
    if (code === 123) {
      return i;
    }
    i++;
  }
  return -1;
}

function isAnimationShorthandNameToken(value: string): boolean {
  const lower = value.toLowerCase();
  return !ANIMATION_SHORTHAND_KEYWORDS.has(lower)
    && cssNumberValue(value) === null
    && cssPercentageValue(value) === null
    && cssDimensionUnit(value) === null
    && isCssIdentifier(value);
}

function animationNameReferences(source: string, node: CssCstNode, name: string, valueStart: number, valueEnd: number): AnimationNameReference[] {
  const refs: AnimationNameReference[] = [];
  const rawValue = source.slice(valueStart, valueEnd);
  if (hasDynamicSyntax(rawValue)) {
    return refs;
  }
  const lowerName = name.toLowerCase();

  const pushAnimationName = (start: number, end: number) => {
    const trimmed = trimOffsets(source.slice(start, end), start);
    const animationName = staticAnimationName(source.slice(trimmed.start, trimmed.end));
    if (animationName !== null && !ANIMATION_NAME_KEYWORDS.has(animationName.toLowerCase())) {
      refs.push({
        name: animationName,
        span: spanAtOrContaining(node, trimmed.start, trimmed.end)
      });
    }
  };

  if (lowerName === 'animation-name') {
    let partStart = valueStart;
    let quote = 0;
    let parenDepth = 0;
    let inBlockComment = false;
    for (let i = valueStart; i < valueEnd; i++) {
      const code = source.charCodeAt(i);
      const next = i + 1 < valueEnd ? source.charCodeAt(i + 1) : 0;
      if (inBlockComment) {
        if (code === 42 && next === 47) {
          inBlockComment = false;
          i++;
        }
        continue;
      }
      if (quote !== 0) {
        if (code === 92) {
          i++;
          continue;
        }
        if (code === quote) {
          quote = 0;
        }
        continue;
      }
      if (code === 47 && next === 42) {
        inBlockComment = true;
        i++;
        continue;
      }
      if (code === 34 || code === 39) {
        quote = code;
        continue;
      }
      if (code === 40) {
        parenDepth++;
        continue;
      }
      if (code === 41 && parenDepth > 0) {
        parenDepth--;
        continue;
      }
      if (code === 44 && parenDepth === 0) {
        pushAnimationName(partStart, i);
        partStart = i + 1;
      }
    }
    pushAnimationName(partStart, valueEnd);
    return refs;
  }

  if (lowerName !== 'animation') {
    return refs;
  }

  let i = valueStart;
  while (i < valueEnd) {
    const code = source.charCodeAt(i);
    const next = i + 1 < valueEnd ? source.charCodeAt(i + 1) : 0;
    if (isCssWhitespace(code) || code === 44) {
      i++;
      continue;
    }
    if (code === 47 && next === 42) {
      i = skipCssComment(source, i, valueEnd);
      continue;
    }
    if (code === 34 || code === 39) {
      i = quotedEnd(source, i, valueEnd);
      continue;
    }
    if (!isIdentStart(code) && code !== 43 && code !== 45 && code !== 46 && (code < 48 || code > 57)) {
      i++;
      continue;
    }
    const tokenStart = i;
    while (i < valueEnd) {
      const tokenCode = source.charCodeAt(i);
      if (!isIdentChar(tokenCode) && tokenCode !== 43 && tokenCode !== 46) {
        break;
      }
      i++;
    }
    const tokenEnd = i;
    const token = source.slice(tokenStart, tokenEnd);
    const afterToken = skipWhitespace(source, tokenEnd, valueEnd);
    if (afterToken < valueEnd && source.charCodeAt(afterToken) === 40) {
      i = balancedEnd(source, afterToken, valueEnd);
      continue;
    }
    if (isAnimationShorthandNameToken(token)) {
      refs.push({
        name: token,
        span: spanAtOrContaining(node, tokenStart, tokenEnd)
      });
    }
  }
  return refs;
}

function cssNumberValue(value: string): number | null {
  if (value.length === 0) {
    return null;
  }
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return null;
  }
  let hasDigit = false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 48 && code <= 57) {
      hasDigit = true;
      continue;
    }
    if (code === 43 || code === 45 || code === 46 || code === 69 || code === 101) {
      continue;
    }
    return null;
  }
  return hasDigit ? numberValue : null;
}

function isIntegerNumber(value: string): boolean {
  let start = 0;
  if (value.charCodeAt(0) === 43 || value.charCodeAt(0) === 45) {
    start = 1;
  }
  if (start >= value.length) {
    return false;
  }
  for (let i = start; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 48 || code > 57) {
      return false;
    }
  }
  return true;
}

function cssPercentageValue(value: string): number | null {
  if (value.length < 2 || value.charCodeAt(value.length - 1) !== 37 /* % */) {
    return null;
  }
  return cssNumberValue(value.slice(0, -1));
}

function cssDimensionUnit(value: string): string | null {
  const numberEnd = cssNumberPrefixEnd(value);
  if (numberEnd === 0 || numberEnd >= value.length || cssNumberValue(value.slice(0, numberEnd)) === null) {
    return null;
  }
  const unit = value.slice(numberEnd).toLowerCase();
  return isCssIdentifier(unit) ? unit : null;
}

function cssNumberPrefixEnd(value: string): number {
  let i = 0;
  if (i < value.length) {
    const first = value.charCodeAt(i);
    if (first === 43 || first === 45) {
      i++;
    }
  }
  let digitsBeforeDot = 0;
  while (i < value.length) {
    const code = value.charCodeAt(i);
    if (code < 48 || code > 57) {
      break;
    }
    digitsBeforeDot++;
    i++;
  }
  let digitsAfterDot = 0;
  if (i < value.length && value.charCodeAt(i) === 46 /* . */) {
    i++;
    while (i < value.length) {
      const code = value.charCodeAt(i);
      if (code < 48 || code > 57) {
        break;
      }
      digitsAfterDot++;
      i++;
    }
  }
  if (digitsBeforeDot === 0 && digitsAfterDot === 0) {
    return 0;
  }
  const exponentStart = i;
  if (i < value.length) {
    const code = value.charCodeAt(i);
    if (code === 69 || code === 101) {
      i++;
      if (i < value.length) {
        const sign = value.charCodeAt(i);
        if (sign === 43 || sign === 45) {
          i++;
        }
      }
      let exponentDigits = 0;
      while (i < value.length) {
        const exponentCode = value.charCodeAt(i);
        if (exponentCode < 48 || exponentCode > 57) {
          break;
        }
        exponentDigits++;
        i++;
      }
      if (exponentDigits === 0) {
        return exponentStart;
      }
    }
  }
  return i;
}

function isCssRatio(value: string): boolean {
  const slash = value.indexOf('/');
  if (slash <= 0 || slash !== value.lastIndexOf('/')) {
    return false;
  }
  return cssNumberValue(value.slice(0, slash).trim()) !== null
    && cssNumberValue(value.slice(slash + 1).trim()) !== null;
}

function blankStrings(value: string): string {
  return value.replace(/"[^"]*"|'[^']*'/g, m => ' '.repeat(m.length));
}

function blankStringsAndComments(value: string): string {
  return value.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n\r]*|"[^"]*"|'[^']*'/g, m => ' '.repeat(m.length));
}

function stripComments(value: string): string {
  return value.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n\r]*/g, ' ');
}

function stripBlockComments(value: string): string {
  return value.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function normalizedCssWords(value: string): string {
  return stripComments(value)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizedKeyframeSelectorKeys(source: string, node: CssCstNode): string[] {
  const raw = source.slice(absoluteStart(node), absoluteEnd(node));
  return blankStringsAndComments(raw)
    .split(',')
    .map(part => part.replace(/\s+/g, '').toLowerCase())
    .filter(Boolean)
    .map(part => part === 'from'
      ? '0%'
      : part === 'to'
        ? '100%'
        : part);
}

function gridAreaRows(source: string, node: CssCstNode): GridAreaRow[] {
  const rows: GridAreaRow[] = [];
  const visit = (child: CssCstChild) => {
    if (!isCstNode(child)) {
      return;
    }
    if (isQuotedCstNode(child)) {
      const start = absoluteStart(child);
      const end = absoluteEnd(child);
      if (Number.isFinite(start) && Number.isFinite(end) && end > start + 1) {
        const text = source.slice(start + 1, end - 1).trim();
        rows.push({
          tokens: text.length === 0 ? [] : text.split(/\s+/),
          span: child.span
        });
      }
      return;
    }
    for (const nested of cstChildrenOf(child)) {
      visit(nested);
    }
  };
  for (const child of cstChildrenOf(node)) {
    visit(child);
  }
  return rows;
}

function invalidGridAreaNames(rows: readonly GridAreaRow[]): string[] {
  const names = new Set(rows.flatMap(row => row.tokens).filter(name => name !== '.'));
  const invalid: string[] = [];
  for (const name of names) {
    let expectedColumns: number[] | undefined;
    let isContiguousAndRectangular = true;
    for (const row of rows) {
      const columns: number[] = [];
      for (let col = 0; col < row.tokens.length; col++) {
        if (row.tokens[col] === name) {
          columns.push(col);
        }
      }
      if (columns.length === 0) {
        continue;
      }
      if (expectedColumns === undefined) {
        expectedColumns = columns;
        continue;
      }
      if (columns.length !== expectedColumns.length || columns.some((col, index) => col !== expectedColumns![index])) {
        isContiguousAndRectangular = false;
        break;
      }
    }
    if (!isContiguousAndRectangular) {
      invalid.push(name);
    }
  }
  return invalid.sort();
}

function dimensionUnitSpan(source: string, start: number, end: number): { unit: string; start: number; end: number } | null {
  let i = start;
  if (i < end) {
    const first = source.charCodeAt(i);
    if (first === 43 || first === 45) {
      i++;
    }
  }
  let sawDigit = false;
  while (i < end) {
    const code = source.charCodeAt(i);
    if (code < 48 || code > 57) {
      break;
    }
    sawDigit = true;
    i++;
  }
  if (i < end && source.charCodeAt(i) === 46) {
    i++;
    while (i < end) {
      const code = source.charCodeAt(i);
      if (code < 48 || code > 57) {
        break;
      }
      sawDigit = true;
      i++;
    }
  }
  if (!sawDigit || i >= end) {
    return null;
  }
  if (source.charCodeAt(i) === 69 || source.charCodeAt(i) === 101) {
    const exponentStart = i;
    i++;
    if (i < end) {
      const sign = source.charCodeAt(i);
      if (sign === 43 || sign === 45) {
        i++;
      }
    }
    let sawExponentDigit = false;
    while (i < end) {
      const code = source.charCodeAt(i);
      if (code < 48 || code > 57) {
        break;
      }
      sawExponentDigit = true;
      i++;
    }
    if (!sawExponentDigit) {
      i = exponentStart;
    }
  }
  if (i >= end) {
    return null;
  }
  const unitStart = i;
  const firstUnit = source.charCodeAt(i);
  if (firstUnit === 37 /* % */) {
    return i + 1 === end ? { unit: '%', start: unitStart, end } : null;
  }
  if (!isIdentStart(firstUnit)) {
    return null;
  }
  i++;
  while (i < end && isIdentChar(source.charCodeAt(i))) {
    i++;
  }
  return i === end ? { unit: source.slice(unitStart, end), start: unitStart, end } : null;
}

function numericKindOfUnit(unit: string): NumericKind | null {
  const lower = unit.toLowerCase();
  if (lower === '%') {
    return 'percentage';
  }
  if (lower === 'fr') {
    return 'flex';
  }
  if (ANGLE_UNITS.has(lower)) {
    return 'angle';
  }
  if (TIME_UNITS.has(lower)) {
    return 'time';
  }
  if (FREQUENCY_UNITS.has(lower)) {
    return 'frequency';
  }
  if (RESOLUTION_UNITS.has(lower)) {
    return 'resolution';
  }
  if (LENGTH_UNITS.has(lower)) {
    return 'length';
  }
  return null;
}

function numberLiteralSpan(source: string, start: number, end: number): { text: string; start: number; end: number } | null {
  const trimmed = trimOffsets(source.slice(start, end), start);
  if (trimmed.start >= trimmed.end) {
    return null;
  }
  const text = source.slice(trimmed.start, trimmed.end);
  if (!/^[+-]?(?:\d*\.\d+(?:[eE][+-]?\d+)?|\d+(?:[eE][+-]?\d+)?)$/.test(text)) {
    return null;
  }
  return { text, start: trimmed.start, end: trimmed.end };
}

function bareDimensionOrPercentageFact(source: string, arg: CssCstNode): MathArgumentFact | null {
  const argStart = absoluteStart(arg);
  const argEnd = absoluteEnd(arg);
  const trimmed = trimOffsets(source.slice(argStart, argEnd), argStart);
  let found: CssCstNode | null = null;
  const visit = (node: CssCstNode) => {
    if (found === null && (DIMENSION_TYPES.has(node.grammarType) || PERCENTAGE_TYPES.has(node.grammarType))) {
      found = node;
      return;
    }
    for (const child of cstChildrenOf(node)) {
      if (isCstNode(child)) {
        visit(child);
      }
    }
  };
  visit(arg);
  if (found === null) {
    return null;
  }
  const valueStart = absoluteStart(found);
  const valueEnd = absoluteEnd(found);
  if (valueStart !== trimmed.start || valueEnd !== trimmed.end) {
    return null;
  }
  if (PERCENTAGE_TYPES.has(found.grammarType)) {
    return {
      kind: 'percentage',
      text: source.slice(valueStart, valueEnd),
      span: found.span
    };
  }
  const unitSpan = dimensionUnitSpan(source, valueStart, valueEnd);
  if (unitSpan === null) {
    return null;
  }
  const kind = numericKindOfUnit(unitSpan.unit);
  if (kind === null) {
    return null;
  }
  return {
    kind,
    text: source.slice(valueStart, valueEnd),
    span: found.span
  };
}

function mathArgumentFact(source: string, arg: CssCstNode): MathArgumentFact | null {
  const start = absoluteStart(arg);
  const end = absoluteEnd(arg);
  const number = numberLiteralSpan(source, start, end);
  if (number !== null) {
    return {
      kind: 'number',
      text: number.text,
      span: spanAtOrContaining(arg, number.start, number.end)
    };
  }
  return bareDimensionOrPercentageFact(source, arg);
}

function areMathKindsDefinitelyIncompatible(a: NumericKind, b: NumericKind): boolean {
  if (a === b) {
    return false;
  }
  return a !== 'percentage' && b !== 'percentage';
}

function incompatibleMathFunctionUnits(source: string, node: CssCstNode, functionName: string): MathUnitMismatch | null {
  const args: MathArgumentFact[] = [];
  for (const child of cstChildrenOf(node)) {
    if (!isCstNode(child) || child.grammarType !== 'ValueSequence') {
      continue;
    }
    const fact = mathArgumentFact(source, child);
    if (fact !== null) {
      args.push(fact);
    }
  }
  if (args.length < 2) {
    return null;
  }
  const expected = args[0]!;
  for (let i = 1; i < args.length; i++) {
    const actual = args[i]!;
    if (areMathKindsDefinitelyIncompatible(expected.kind, actual.kind)) {
      return { functionName, expected, actual };
    }
  }
  return null;
}

function gradientSideAxis(word: string): 'vertical' | 'horizontal' | null {
  if (VERTICAL_GRADIENT_SIDES.has(word)) {
    return 'vertical';
  }
  if (HORIZONTAL_GRADIENT_SIDES.has(word)) {
    return 'horizontal';
  }
  return null;
}

function isGradientSideOrCorner(words: readonly string[]): boolean {
  if (words.length === 1) {
    return gradientSideAxis(words[0]!) !== null;
  }
  if (words.length !== 2) {
    return false;
  }
  const first = gradientSideAxis(words[0]!);
  const second = gradientSideAxis(words[1]!);
  return first !== null && second !== null && first !== second;
}

function gradientDirectionWords(words: readonly string[]): readonly string[] {
  const colorSpaceIndex = words.indexOf('in');
  return colorSpaceIndex < 0 ? words : words.slice(0, colorSpaceIndex);
}

function nonstandardLinearGradientDirection(source: string, node: CssCstNode, functionName: string): DiagnosticSpan | null {
  if (!LINEAR_GRADIENT_FUNCTION_NAMES.has(unprefixedName(functionName))) {
    return null;
  }
  const firstArg = firstChildNodeOf(node, 'ValueSequence');
  if (firstArg === undefined || firstDescendantNodeMatching(firstArg, FUNCTION_TYPES) !== undefined) {
    return null;
  }
  const start = absoluteStart(firstArg);
  const end = absoluteEnd(firstArg);
  const trimmed = trimOffsets(source.slice(start, end), start);
  if (trimmed.start >= trimmed.end) {
    return null;
  }
  const raw = source.slice(trimmed.start, trimmed.end);
  if (hasDynamicSyntax(raw)) {
    return null;
  }
  const words = gradientDirectionWords(normalizedCssWords(raw).split(' ').filter(Boolean));
  if (words.length === 0) {
    return null;
  }
  if (words[0] === 'to') {
    return isGradientSideOrCorner(words.slice(1))
      ? null
      : spanAtOrContaining(firstArg, trimmed.start, trimmed.end);
  }
  if (isGradientSideOrCorner(words) || (words.length === 1 && cssNumberValue(words[0]!) !== null)) {
    return spanAtOrContaining(firstArg, trimmed.start, trimmed.end);
  }
  return null;
}

function colorChannelFact(source: string, node: CssCstNode): ColorChannelFact {
  const start = absoluteStart(node);
  const end = absoluteEnd(node);
  const trimmed = trimOffsets(source.slice(start, end), start);
  const text = source.slice(trimmed.start, trimmed.end);
  const span = spanAtOrContaining(node, trimmed.start, trimmed.end);
  if (trimmed.start >= trimmed.end || hasDynamicSyntax(text) || firstDescendantNodeMatching(node, FUNCTION_TYPES) !== undefined) {
    return { kind: 'unknown', text, span };
  }
  const lower = text.toLowerCase();
  if (lower === 'none' || isCssIdentifier(text)) {
    return { kind: 'keyword', text, span };
  }
  if (cssNumberValue(text) !== null) {
    return { kind: 'number', text, span };
  }
  if (cssPercentageValue(text) !== null) {
    return { kind: 'percentage', text, span };
  }
  const unit = cssDimensionUnit(text);
  if (unit !== null) {
    return {
      kind: numericKindOfUnit(unit) === 'angle' ? 'angle' : 'dimension',
      text,
      span
    };
  }
  return { kind: 'unknown', text, span };
}

function colorFunctionChannels(source: string, node: CssCstNode): { readonly channels: readonly ColorChannelFact[]; readonly alphaIndex: number | null } | null {
  const argumentSequences: CssCstNode[] = [];
  for (const child of cstChildrenOf(node)) {
    if (isCstNode(child) && child.grammarType === 'ValueSequence') {
      argumentSequences.push(child);
    }
  }
  if (argumentSequences.length === 0) {
    return { channels: [], alphaIndex: null };
  }
  if (argumentSequences.length > 1) {
    return {
      channels: argumentSequences.map(sequence => colorChannelFact(source, sequence)),
      alphaIndex: argumentSequences.length === 4 ? 3 : null
    };
  }

  const channels: ColorChannelFact[] = [];
  let alphaIndex: number | null = null;
  for (const child of cstChildrenOf(argumentSequences[0]!)) {
    if (!isCstNode(child) || child.grammarType !== 'Value') {
      continue;
    }
    const start = absoluteStart(child);
    const end = absoluteEnd(child);
    const text = source.slice(start, end).trim();
    if (text === '/') {
      alphaIndex = channels.length;
      continue;
    }
    channels.push(colorChannelFact(source, child));
  }
  return { channels, alphaIndex };
}

function isRgbChannel(channel: ColorChannelFact): boolean {
  return channel.text.toLowerCase() === 'none'
    || channel.kind === 'number'
    || channel.kind === 'percentage';
}

function isHueChannel(channel: ColorChannelFact): boolean {
  return channel.text.toLowerCase() === 'none'
    || channel.kind === 'number'
    || channel.kind === 'angle';
}

function isPercentageColorChannel(channel: ColorChannelFact): boolean {
  return channel.text.toLowerCase() === 'none' || channel.kind === 'percentage';
}

function isAlphaChannel(channel: ColorChannelFact): boolean {
  return channel.text.toLowerCase() === 'none'
    || channel.kind === 'number'
    || channel.kind === 'percentage';
}

function invalidColorFunctionChannels(source: string, node: CssCstNode, functionName: string): ColorFunctionChannelProblem | null {
  const lowerName = functionName.toLowerCase();
  if (!COLOR_FUNCTION_NAMES.has(lowerName)) {
    return null;
  }
  const argsText = source.slice(absoluteStart(node), absoluteEnd(node));
  if (hasDynamicSyntax(argsText)) {
    return null;
  }
  const parsed = colorFunctionChannels(source, node);
  if (parsed === null || parsed.channels.some(channel => channel.kind === 'unknown')) {
    return null;
  }
  const expectedAlphaIndex = parsed.channels.length === 4 ? 3 : null;
  if (parsed.channels.length !== 3 && parsed.channels.length !== 4) {
    return {
      message: `Invalid ${functionName}() color channel count`,
      span: spanAtOrContaining(node, absoluteStart(node), absoluteStart(node) + functionName.length)
    };
  }
  if (parsed.alphaIndex !== null && parsed.alphaIndex !== expectedAlphaIndex) {
    return {
      message: `Invalid ${functionName}() alpha channel placement`,
      span: spanAtOrContaining(node, absoluteStart(node), absoluteStart(node) + functionName.length)
    };
  }
  const isRgb = lowerName === 'rgb' || lowerName === 'rgba';
  for (let i = 0; i < parsed.channels.length; i++) {
    const channel = parsed.channels[i]!;
    const valid = i === 3
      ? isAlphaChannel(channel)
      : isRgb
        ? isRgbChannel(channel)
        : i === 0
          ? isHueChannel(channel)
          : isPercentageColorChannel(channel);
    if (!valid) {
      return {
        message: `Invalid ${functionName}() color channel "${channel.text}"`,
        span: channel.span
      };
    }
  }
  return null;
}

function declarationValueNode(node: CssCstNode): CssCstNode | null {
  return firstChildNodeOf(node, 'ValueList') ?? null;
}

function declarationValueText(source: string, node: CssCstNode): { readonly text: string; readonly span: DiagnosticSpan } | null {
  const value = declarationValueNode(node);
  if (value === null) {
    return null;
  }
  const start = absoluteStart(value);
  const end = absoluteEnd(value);
  const trimmed = trimOffsets(source.slice(start, end), start);
  if (trimmed.start >= trimmed.end) {
    return null;
  }
  return {
    text: source.slice(trimmed.start, trimmed.end),
    span: spanAtOrContaining(node, trimmed.start, trimmed.end)
  };
}

function staticDeclarationKeywordValue(source: string, node: CssCstNode): string | null {
  const value = declarationValueText(source, node);
  if (value === null || hasDynamicSyntax(value.text) || !isCssIdentifier(value.text)) {
    return null;
  }
  return value.text.toLowerCase();
}

type BoxModelSide = 'top' | 'right' | 'bottom' | 'left';

interface BoxModelFacts {
  width: CssCstNode | null;
  height: CssCstNode | null;
  hasBoxSizing: boolean;
  top: CssCstNode[];
  right: CssCstNode[];
  bottom: CssCstNode[];
  left: CssCstNode[];
}

function createBoxModelFacts(): BoxModelFacts {
  return {
    width: null,
    height: null,
    hasBoxSizing: false,
    top: [],
    right: [],
    bottom: [],
    left: []
  };
}

function boxSideFromNameSegment(value: string | undefined): BoxModelSide | null {
  switch (value) {
    case 'top':
      return 'top';
    case 'right':
      return 'right';
    case 'bottom':
      return 'bottom';
    case 'left':
      return 'left';
    default:
      return null;
  }
}

function addUniqueDeclaration(nodes: CssCstNode[], node: CssCstNode): void {
  if (!nodes.includes(node)) {
    nodes.push(node);
  }
}

function boxSideDeclarations(facts: BoxModelFacts, side: BoxModelSide): CssCstNode[] {
  switch (side) {
    case 'top':
      return facts.top;
    case 'right':
      return facts.right;
    case 'bottom':
      return facts.bottom;
    case 'left':
      return facts.left;
  }
}

function updateBoxModelWithValue(
  facts: BoxModelFacts,
  side: BoxModelSide | null,
  value: boolean,
  node: CssCstNode
): void {
  if (!value) {
    return;
  }
  if (side !== null) {
    addUniqueDeclaration(boxSideDeclarations(facts, side), node);
    return;
  }
  addUniqueDeclaration(facts.top, node);
  addUniqueDeclaration(facts.right, node);
  addUniqueDeclaration(facts.bottom, node);
  addUniqueDeclaration(facts.left, node);
}

function updateBoxModelWithList(facts: BoxModelFacts, values: readonly boolean[], node: CssCstNode): void {
  switch (values.length) {
    case 1:
      updateBoxModelWithValue(facts, null, values[0]!, node);
      break;
    case 2:
      updateBoxModelWithValue(facts, 'top', values[0]!, node);
      updateBoxModelWithValue(facts, 'bottom', values[0]!, node);
      updateBoxModelWithValue(facts, 'right', values[1]!, node);
      updateBoxModelWithValue(facts, 'left', values[1]!, node);
      break;
    case 3:
      updateBoxModelWithValue(facts, 'top', values[0]!, node);
      updateBoxModelWithValue(facts, 'right', values[1]!, node);
      updateBoxModelWithValue(facts, 'left', values[1]!, node);
      updateBoxModelWithValue(facts, 'bottom', values[2]!, node);
      break;
    case 4:
      updateBoxModelWithValue(facts, 'top', values[0]!, node);
      updateBoxModelWithValue(facts, 'right', values[1]!, node);
      updateBoxModelWithValue(facts, 'bottom', values[2]!, node);
      updateBoxModelWithValue(facts, 'left', values[3]!, node);
      break;
  }
}

function staticBoxModelTokens(value: string): readonly string[] | null {
  if (hasDynamicSyntax(value)) {
    return null;
  }
  const tokens: string[] = [];
  let tokenStart = -1;
  for (let i = 0; i <= value.length; i++) {
    const code = i < value.length ? value.charCodeAt(i) : 32;
    if (code === 40 || code === 41 || code === 44 || code === 47 || code === 34 || code === 39) {
      return null;
    }
    if (i < value.length && !isCssWhitespace(code)) {
      if (tokenStart < 0) {
        tokenStart = i;
      }
      continue;
    }
    if (tokenStart >= 0) {
      tokens.push(value.slice(tokenStart, i).toLowerCase());
      tokenStart = -1;
    }
  }
  return tokens.length === 0 ? null : tokens;
}

function boxLineWidthIsNonZero(token: string, allowCssWideKeywords: boolean): boolean {
  if (allowCssWideKeywords && CSS_WIDE_KEYWORDS.has(token)) {
    return false;
  }
  return Number.parseFloat(token) !== 0;
}

function boxLineStyleIsNonZero(token: string, allowCssWideKeywords: boolean): boolean {
  if (token === 'none' || token === 'hidden') {
    return false;
  }
  return !allowCssWideKeywords || !CSS_WIDE_KEYWORDS.has(token);
}

function boxLineWidthList(tokens: readonly string[], allowCssWideKeywords: boolean): boolean[] {
  return tokens.map(token => boxLineWidthIsNonZero(token, allowCssWideKeywords));
}

function boxLineStyleList(tokens: readonly string[], allowCssWideKeywords: boolean): boolean[] {
  return tokens.map(token => boxLineStyleIsNonZero(token, allowCssWideKeywords));
}

function borderShorthandIsNonZero(tokens: readonly string[]): boolean {
  if (tokens.length === 1) {
    return boxLineWidthIsNonZero(tokens[0]!, true) && boxLineStyleIsNonZero(tokens[0]!, true);
  }
  for (const token of tokens) {
    if (!boxLineWidthIsNonZero(token, false) || !boxLineStyleIsNonZero(token, false)) {
      return false;
    }
  }
  return true;
}

function applyBoxModelDeclaration(
  facts: BoxModelFacts,
  source: string,
  name: string,
  node: CssCstNode
): void {
  if (name === 'box-sizing') {
    facts.hasBoxSizing = true;
    return;
  }
  if (name === 'width') {
    facts.width = node;
    return;
  }
  if (name === 'height') {
    facts.height = node;
    return;
  }

  const value = declarationValueText(source, node);
  if (value === null) {
    return;
  }
  const tokens = staticBoxModelTokens(value.text);
  if (tokens === null) {
    return;
  }
  const segments = name.split('-');
  if (segments[0] === 'border') {
    const side = boxSideFromNameSegment(segments[1]);
    const qualifierIndex = side === null ? 1 : 2;
    const qualifier = segments[qualifierIndex];
    if (qualifier === undefined) {
      updateBoxModelWithValue(facts, side, borderShorthandIsNonZero(tokens), node);
    } else if (qualifier === 'width') {
      updateBoxModelWithList(facts, boxLineWidthList(tokens, false), node);
    } else if (qualifier === 'style') {
      updateBoxModelWithList(facts, boxLineStyleList(tokens, true), node);
    }
  } else if (segments[0] === 'padding') {
    const side = boxSideFromNameSegment(segments[1]);
    if (side === null && segments.length === 1) {
      updateBoxModelWithList(facts, boxLineWidthList(tokens, true), node);
    } else if (side !== null && segments.length === 2 && tokens.length === 1) {
      updateBoxModelWithValue(facts, side, boxLineWidthIsNonZero(tokens[0]!, true), node);
    }
  }
}

function fontFaceMissingRequiredProperties(source: string, node: CssCstNode): readonly string[] {
  const required = new Set(['font-family', 'src']);
  for (const child of cstChildrenOf(node)) {
    if (!isCstNode(child) || !DECLARATION_TYPES.has(child.grammarType)) {
      continue;
    }
    const start = absoluteStart(child);
    const end = absoluteEnd(child);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      continue;
    }
    const name = propNameOf(source.slice(start, end)).toLowerCase();
    required.delete(name);
  }
  return [...required];
}

function quotedStringInnerText(value: string): string | null {
  if (value.length < 2) {
    return null;
  }
  const quote = value.charCodeAt(0);
  if ((quote !== 34 /* " */ && quote !== 39 /* ' */) || value.charCodeAt(value.length - 1) !== quote) {
    return null;
  }
  return value.slice(1, -1);
}

function simplePropertySyntaxType(value: string): string | null {
  if (value.length < 3 || value.charCodeAt(0) !== 60 /* < */ || value.charCodeAt(value.length - 1) !== 62 /* > */) {
    return null;
  }
  const name = value.slice(1, -1);
  if (name.length === 0) {
    return '';
  }
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    const isLowercase = code >= 97 && code <= 122;
    if (!isLowercase && code !== 45 /* - */) {
      return null;
    }
  }
  return name;
}

function atRuleDescriptorValueProblem(
  source: string,
  node: CssCstNode,
  atRuleName: string,
  descriptorName: string
): AtRuleDescriptorValueProblem | null {
  const value = declarationValueText(source, node);
  if (value === null || hasDynamicSyntax(value.text)) {
    return null;
  }
  const valueNode = declarationValueNode(node);
  if (valueNode !== null && firstDescendantNodeMatching(valueNode, FUNCTION_TYPES) !== undefined) {
    return null;
  }
  const lowerAtRule = atRuleName.toLowerCase();
  const lowerDescriptor = descriptorName.toLowerCase();
  const lowerValue = value.text.toLowerCase();
  if (lowerAtRule === 'property') {
    if (lowerDescriptor === 'inherits' && lowerValue !== 'true' && lowerValue !== 'false') {
      return { descriptorName, value: value.text, span: value.span };
    }
    if (lowerDescriptor === 'syntax') {
      const inner = quotedStringInnerText(value.text);
      if (inner === null) {
        return { descriptorName, value: value.text, span: value.span };
      }
      const rawSyntax = inner.trim().toLowerCase();
      if (rawSyntax.length === 0) {
        return { descriptorName, value: value.text, span: value.span };
      }
      const simpleType = simplePropertySyntaxType(rawSyntax);
      if (simpleType !== null && !PROPERTY_SYNTAX_TYPES.has(simpleType)) {
        return { descriptorName, value: rawSyntax, span: value.span };
      }
    }
  }
  if (
    lowerAtRule === 'font-face'
    && lowerDescriptor === 'font-display'
    && isCssIdentifier(value.text)
    && !FONT_DISPLAY_VALUES.has(lowerValue)
  ) {
    return { descriptorName, value: value.text, span: value.span };
  }
  return null;
}

function typedCustomPropertySyntax(source: string, node: CssCstNode): TypedCustomPropertySyntax | null {
  const value = declarationValueNode(node);
  if (value === null) {
    return null;
  }
  const start = absoluteStart(value);
  const end = absoluteEnd(value);
  const trimmed = trimOffsets(source.slice(start, end), start);
  if (trimmed.end - trimmed.start < 2) {
    return null;
  }
  const quote = source.charCodeAt(trimmed.start);
  if ((quote !== 34 /* " */ && quote !== 39 /* ' */) || source.charCodeAt(trimmed.end - 1) !== quote) {
    return null;
  }
  const raw = source.slice(trimmed.start + 1, trimmed.end - 1).trim();
  if (raw.length === 0 || hasDynamicSyntax(raw) || raw.includes('\\')) {
    return null;
  }
  switch (raw.toLowerCase()) {
    case '*':
      return { raw, kind: 'any' };
    case '<number>':
      return { raw, kind: 'number' };
    case '<integer>':
      return { raw, kind: 'integer' };
    case '<length>':
      return { raw, kind: 'length' };
    case '<percentage>':
      return { raw, kind: 'percentage' };
    case '<length-percentage>':
      return { raw, kind: 'length-percentage' };
    case '<angle>':
      return { raw, kind: 'angle' };
    case '<time>':
      return { raw, kind: 'time' };
    case '<resolution>':
      return { raw, kind: 'resolution' };
    case '<color>':
      return { raw, kind: 'color' };
    default:
      return null;
  }
}

function typedCustomPropertyInitialValue(source: string, node: CssCstNode): TypedCustomPropertyInitialValue | null {
  const value = declarationValueNode(node);
  if (value === null) {
    return null;
  }
  const start = absoluteStart(value);
  const end = absoluteEnd(value);
  const trimmed = trimOffsets(source.slice(start, end), start);
  if (trimmed.start >= trimmed.end) {
    return null;
  }
  const text = source.slice(trimmed.start, trimmed.end);
  const span = spanAtOrContaining(node, trimmed.start, trimmed.end);
  if (hasDynamicSyntax(text)) {
    return { text, kind: 'unknown', numberValue: null, span };
  }
  const nestedFunction = firstDescendantNodeMatching(value, FUNCTION_TYPES);
  if (nestedFunction !== undefined) {
    const functionName = functionNameOf(source, absoluteStart(nestedFunction), absoluteEnd(nestedFunction));
    if (
      functionName !== null
      && COLOR_FUNCTION_NAMES.has(functionName)
      && invalidColorFunctionChannels(source, nestedFunction, functionName) === null
    ) {
      return { text, kind: 'color', numberValue: null, span };
    }
    return { text, kind: 'unknown', numberValue: null, span };
  }
  const lower = text.toLowerCase();
  if (lower === 'currentcolor' || namedColor(lower) !== undefined) {
    return { text, kind: 'color', numberValue: null, span };
  }
  if (text.charCodeAt(0) === 35 /* # */) {
    const digits = text.slice(1);
    if (
      (digits.length === 3 || digits.length === 4 || digits.length === 6 || digits.length === 8)
      && /^[0-9a-f]+$/i.test(digits)
    ) {
      return { text, kind: 'color', numberValue: null, span };
    }
    return { text, kind: 'unknown', numberValue: null, span };
  }
  const percentage = cssPercentageValue(text);
  if (percentage !== null) {
    return { text, kind: 'percentage', numberValue: percentage, span };
  }
  const unit = cssDimensionUnit(text);
  if (unit !== null) {
    const kind = numericKindOfUnit(unit);
    if (kind === 'length' || kind === 'angle' || kind === 'time' || kind === 'resolution') {
      return { text, kind, numberValue: null, span };
    }
    return { text, kind: 'unknown', numberValue: null, span };
  }
  const number = cssNumberValue(text);
  if (number !== null) {
    return {
      text,
      kind: isIntegerNumber(text) ? 'integer' : 'number',
      numberValue: number,
      span
    };
  }
  if (isCssIdentifier(text)) {
    return { text, kind: 'keyword', numberValue: null, span };
  }
  return { text, kind: 'unknown', numberValue: null, span };
}

function isTypedCustomPropertyInitialValueCompatible(
  syntax: TypedCustomPropertySyntax,
  value: TypedCustomPropertyInitialValue
): boolean | null {
  if (syntax.kind === 'any' || value.kind === 'unknown') {
    return null;
  }
  if (syntax.kind === 'number') {
    return value.kind === 'number' || value.kind === 'integer';
  }
  if (syntax.kind === 'integer') {
    return value.kind === 'integer';
  }
  if (syntax.kind === 'length') {
    return value.kind === 'length' || ((value.kind === 'number' || value.kind === 'integer') && value.numberValue === 0);
  }
  if (syntax.kind === 'length-percentage') {
    return value.kind === 'length'
      || value.kind === 'percentage'
      || ((value.kind === 'number' || value.kind === 'integer') && value.numberValue === 0);
  }
  return value.kind === syntax.kind;
}

function typedCustomPropertyValueProblem(source: string, node: CssCstNode): TypedCustomPropertyValueProblem | null {
  let syntax: TypedCustomPropertySyntax | null = null;
  let value: TypedCustomPropertyInitialValue | null = null;
  for (const child of cstChildrenOf(node)) {
    if (!isCstNode(child) || !DECLARATION_TYPES.has(child.grammarType)) {
      continue;
    }
    const start = absoluteStart(child);
    const end = absoluteEnd(child);
    const name = propNameOf(source.slice(start, end)).toLowerCase();
    if (name === 'syntax') {
      syntax = typedCustomPropertySyntax(source, child);
    } else if (name === 'initial-value') {
      value = typedCustomPropertyInitialValue(source, child);
    }
  }
  if (syntax === null || value === null) {
    return null;
  }
  const compatible = isTypedCustomPropertyInitialValueCompatible(syntax, value);
  return compatible === false ? { syntax, value } : null;
}

function isResolutionMediaFeatureDimension(source: string, dimensionStart: number): boolean {
  const open = source.lastIndexOf('(', dimensionStart);
  if (open < 0) {
    return false;
  }
  const lastClose = source.lastIndexOf(')', dimensionStart);
  if (lastClose > open) {
    return false;
  }
  const prelude = source.slice(open + 1, dimensionStart).toLowerCase();
  return /(?:^|[^-_a-z0-9])(?:min-|max-)?resolution\s*:/i.test(prelude);
}

function firstChildNodeOf(node: CssCstNode, grammarType: string): CssCstNode | undefined {
  for (const child of cstChildrenOf(node)) {
    if (isCstNode(child) && child.grammarType === grammarType) {
      return child;
    }
  }
  return undefined;
}

function firstChildNodeMatching(node: CssCstNode, grammarTypes: ReadonlySet<string>): CssCstNode | undefined {
  for (const child of cstChildrenOf(node)) {
    if (isCstNode(child) && grammarTypes.has(child.grammarType)) {
      return child;
    }
  }
  return undefined;
}

function firstDescendantNodeOf(node: CssCstNode, grammarType: string): CssCstNode | undefined {
  for (const child of cstChildrenOf(node)) {
    if (!isCstNode(child)) {
      continue;
    }
    if (child.grammarType === grammarType) {
      return child;
    }
    const nested = firstDescendantNodeOf(child, grammarType);
    if (nested !== undefined) {
      return nested;
    }
  }
  return undefined;
}

function authoredVariableNameOf(source: string, start: number, end: number): { name: string; start: number; end: number } | null {
  let nameStart = start;
  while (nameStart < end) {
    const code = source.charCodeAt(nameStart);
    if (code !== 9 && code !== 10 && code !== 12 && code !== 13 && code !== 32) {
      break;
    }
    nameStart++;
  }
  if (nameStart >= end) {
    return null;
  }
  const sigil = source.charCodeAt(nameStart);
  if (sigil !== 36 && sigil !== 64) {
    return null;
  }
  let nameEnd = nameStart + 1;
  while (nameEnd < end) {
    const code = source.charCodeAt(nameEnd);
    if (
      code === 45
      || code === 95
      || code >= 128
      || (code >= 48 && code <= 57)
      || (code >= 65 && code <= 90)
      || (code >= 97 && code <= 122)
    ) {
      nameEnd++;
      continue;
    }
    break;
  }
  if (nameEnd <= nameStart + 1) {
    return null;
  }
  return { name: source.slice(nameStart, nameEnd), start: nameStart, end: nameEnd };
}

function variableDeclarationOf(source: string, node: CssCstNode, language: JessLanguage): VariableDeclarationFact | null {
  if (language === 'css') {
    return null;
  }
  if (node.grammarType !== 'VarDeclaration' && node.grammarType !== 'VariableDeclaration' && node.grammarType !== 'ValueBlockDeclaration') {
    return null;
  }
  const nameNode = firstChildNodeOf(node, 'VariableName');
  const start = nameNode !== undefined ? absoluteStart(nameNode) : absoluteStart(node);
  const end = nameNode !== undefined ? absoluteEnd(nameNode) : absoluteEnd(node);
  const authored = authoredVariableNameOf(source, start, end);
  if (authored === null) {
    return null;
  }
  return {
    name: normalizedVariableName(authored.name, language),
    display: authored.name,
    span: nameNode !== undefined ? nameNode.span : spanFromNodeStart(node, authored.start, authored.end)
  };
}

function nodeContainsExactDescendant(node: CssCstNode, grammarType: string): boolean {
  const descendant = firstDescendantNodeOf(node, grammarType);
  return descendant !== undefined
    && absoluteStart(descendant) === absoluteStart(node)
    && absoluteEnd(descendant) === absoluteEnd(node);
}

function variableDeclarationIsMapLike(node: CssCstNode, language: JessLanguage): boolean {
  if (language === 'css') {
    return false;
  }
  if (language === 'less') {
    return node.grammarType === 'VarDeclaration' && firstChildNodeOf(node, 'ValueBlock') !== undefined;
  }
  if (language === 'scss') {
    const value = firstChildNodeOf(node, 'Value');
    return node.grammarType === 'VariableDeclaration' && value !== undefined && nodeContainsExactDescendant(value, 'Map');
  }
  const value = firstChildNodeMatching(node, MAP_LIKE_VALUE_TYPES);
  return value !== undefined && nodeContainsExactDescendant(value, 'Collection');
}

function variableReferenceNameOf(source: string, node: CssCstNode, language: JessLanguage): string | null {
  if (language === 'css') {
    return null;
  }
  if (node.grammarType !== 'VariableReference' && node.grammarType !== 'Reference') {
    return null;
  }
  const authored = authoredVariableNameOf(source, absoluteStart(node), absoluteEnd(node));
  if (authored === null) {
    return null;
  }
  if (language === 'less' && authored.name.charCodeAt(0) !== 64) {
    return null;
  }
  if ((language === 'scss' || language === 'jess') && authored.name.charCodeAt(0) !== 36) {
    return null;
  }
  return normalizedVariableName(authored.name, language);
}

function numericBracketAccessSpan(source: string, node: CssCstNode): DiagnosticSpan | null {
  const bracketTail = firstChildNodeOf(node, 'ReferenceBracketTail');
  if (bracketTail === undefined) {
    return null;
  }
  const start = absoluteStart(bracketTail);
  const end = absoluteEnd(bracketTail);
  const text = source.slice(start, end);
  if (!/^\[\s*[+-]?(?:\d+\.?\d*|\.\d+)\s*\]$/.test(text)) {
    return null;
  }
  return bracketTail.span;
}

function scssCallArguments(node: CssCstNode): CssCstNode[] {
  const args: CssCstNode[] = [];
  for (const child of cstChildrenOf(node)) {
    if (!isCstNode(child)) {
      continue;
    }
    if (child.grammarType === 'ValueTerm') {
      args.push(child);
    } else if (child.grammarType === 'ValuePair') {
      const value = firstChildNodeOf(child, 'ValueTerm');
      if (value !== undefined) {
        args.push(value);
      }
    }
  }
  return args;
}

function scssMapGetNumericKeyAccess(source: string, node: CssCstNode, mapLikeVariables: ReadonlySet<string>): SuspiciousMapKeyAccess | null {
  if (node.grammarType !== 'Call' || functionNameOf(source, absoluteStart(node), absoluteEnd(node)) !== 'map-get') {
    return null;
  }
  const args = scssCallArguments(node);
  if (args.length !== 2) {
    return null;
  }
  const baseStart = absoluteStart(args[0]!);
  const baseEnd = absoluteEnd(args[0]!);
  const baseTrimmed = trimOffsets(source.slice(baseStart, baseEnd), baseStart);
  const authoredBase = authoredVariableNameOf(source, baseTrimmed.start, baseTrimmed.end);
  if (authoredBase === null || authoredBase.start !== baseTrimmed.start || authoredBase.end !== baseTrimmed.end) {
    return null;
  }
  const variable = normalizedVariableName(authoredBase.name, 'scss');
  if (!mapLikeVariables.has(variable)) {
    return null;
  }
  const keyStart = absoluteStart(args[1]!);
  const keyEnd = absoluteEnd(args[1]!);
  const keyText = source.slice(keyStart, keyEnd).trim();
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(keyText)) {
    return null;
  }
  return {
    variable,
    span: args[1]!.span
  };
}

function suspiciousMapKeyAccessOf(
  source: string,
  node: CssCstNode,
  language: JessLanguage,
  mapLikeVariables: ReadonlySet<string>
): SuspiciousMapKeyAccess | null {
  if (language === 'css') {
    return null;
  }
  if (language === 'scss') {
    return scssMapGetNumericKeyAccess(source, node, mapLikeVariables);
  }
  const isReferenceNode = language === 'less'
    ? node.grammarType === 'Reference'
    : node.grammarType === 'DollarValue' || node.grammarType === 'Reference';
  if (!isReferenceNode) {
    return null;
  }
  const authored = authoredVariableNameOf(source, absoluteStart(node), absoluteEnd(node));
  if (authored === null) {
    return null;
  }
  const variable = normalizedVariableName(authored.name, language);
  if (!mapLikeVariables.has(variable)) {
    return null;
  }
  const span = numericBracketAccessSpan(source, node);
  if (span !== null && Number(span.start) !== authored.end) {
    return null;
  }
  return span === null ? null : { variable, span };
}

function normalizedVariableName(name: string, language: JessLanguage): string {
  if (language === 'scss') {
    return `${name.charAt(0)}${name.slice(1).replace(/_/g, '-')}`;
  }
  return name;
}

function firstDescendantNodeMatching(node: CssCstNode, grammarTypes: ReadonlySet<string>): CssCstNode | undefined {
  for (const child of cstChildrenOf(node)) {
    if (!isCstNode(child)) {
      continue;
    }
    if (grammarTypes.has(child.grammarType)) {
      return child;
    }
    const nested = firstDescendantNodeMatching(child, grammarTypes);
    if (nested !== undefined) {
      return nested;
    }
  }
  return undefined;
}

function trimOffsets(value: string, absoluteOffset: number): { start: number; end: number } {
  let start = 0;
  let end = value.length;
  while (start < end) {
    const code = value.charCodeAt(start);
    if (code !== 9 && code !== 10 && code !== 12 && code !== 13 && code !== 32) {
      break;
    }
    start++;
  }
  while (end > start) {
    const code = value.charCodeAt(end - 1);
    if (code !== 9 && code !== 10 && code !== 12 && code !== 13 && code !== 32) {
      break;
    }
    end--;
  }
  return { start: absoluteOffset + start, end: absoluteOffset + end };
}

function selectorDisplay(source: string, start: number, end: number): string {
  const trimmed = trimOffsets(source.slice(start, end), start);
  return source.slice(trimmed.start, trimmed.end);
}

function normalizedSelectorText(source: string, start: number, end: number): string {
  let out = '';
  let quote = 0;
  let pendingSpace = false;
  for (let i = start; i < end; i++) {
    const code = source.charCodeAt(i);
    if (quote !== 0) {
      out += source[i];
      if (code === 92 /* \ */ && i + 1 < end) {
        i++;
        out += source[i];
        continue;
      }
      if (code === quote) {
        quote = 0;
      }
      continue;
    }
    if (code === 34 /* " */ || code === 39 /* ' */) {
      if (pendingSpace && out.length > 0 && !isSelectorTightAfter(out.charCodeAt(out.length - 1))) {
        out += ' ';
      }
      pendingSpace = false;
      quote = code;
      out += source[i];
      continue;
    }
    if (code === 47 /* / */ && i + 1 < end && source.charCodeAt(i + 1) === 42 /* * */) {
      pendingSpace = true;
      i += 2;
      while (i < end && !(source.charCodeAt(i) === 42 /* * */ && i + 1 < end && source.charCodeAt(i + 1) === 47 /* / */)) {
        i++;
      }
      if (i < end) {
        i++;
      }
      continue;
    }
    if (code === 9 || code === 10 || code === 12 || code === 13 || code === 32) {
      pendingSpace = true;
      continue;
    }
    if (isSelectorTightBefore(code)) {
      out = out.trimEnd();
      pendingSpace = false;
      out += source[i];
      continue;
    }
    if (pendingSpace && out.length > 0 && !isSelectorTightAfter(out.charCodeAt(out.length - 1))) {
      out += ' ';
    }
    pendingSpace = false;
    out += source[i];
  }
  return out.trim();
}

function isSelectorTightBefore(code: number): boolean {
  return code === 41 /* ) */
    || code === 44 /* , */
    || code === 61 /* = */
    || code === 62 /* > */
    || code === 93 /* ] */
    || code === 124 /* | */
    || code === 126 /* ~ */
    || code === 43;
}

function isSelectorTightAfter(code: number): boolean {
  return code === 40 /* ( */
    || code === 44 /* , */
    || code === 61 /* = */
    || code === 62 /* > */
    || code === 91 /* [ */
    || code === 124 /* | */
    || code === 126 /* ~ */
    || code === 43;
}

function selectorBranches(source: string, selectorList: CssCstNode): readonly SelectorBranchFact[] {
  const branches: SelectorBranchFact[] = [];
  for (const child of cstChildrenOf(selectorList)) {
    if (!isCstNode(child) || !SELECTOR_BRANCH_TYPES.has(child.grammarType)) {
      continue;
    }
    const start = absoluteStart(child);
    const end = absoluteEnd(child);
    const key = normalizedSelectorText(source, start, end);
    if (key.length === 0) {
      continue;
    }
    branches.push({
      key,
      display: selectorDisplay(source, start, end),
      span: child.span
    });
  }
  return branches;
}

function selectorListKey(branches: readonly SelectorBranchFact[]): string {
  return branches.map(branch => branch.key).sort().join('\n');
}

function collectRuleSelectorBranches(source: string, selector: CssCstNode): SelectorBranchFact[] {
  const branches: SelectorBranchFact[] = [];
  const visit = (node: CssCstNode) => {
    if (RULE_SELECTOR_BRANCH_TYPES.has(node.grammarType)) {
      const start = absoluteStart(node);
      const end = absoluteEnd(node);
      const key = normalizedSelectorText(source, start, end);
      if (key.length > 0) {
        branches.push({
          key,
          display: selectorDisplay(source, start, end),
          span: node.span
        });
      }
      return;
    }
    for (const child of cstChildrenOf(node)) {
      if (isCstNode(child)) {
        visit(child);
      }
    }
  };
  visit(selector);
  return branches;
}

function exactExtendTargetFact(source: string, target: CssCstNode): ExactExtendTargetFact | null {
  if (isUnboundedExtendTarget(source, target)) {
    return null;
  }
  const branches = collectRuleSelectorBranches(source, target);
  if (branches.length > 1) {
    return null;
  }
  if (branches.length === 1) {
    const branch = branches[0]!;
    return { key: branch.key, display: branch.display, span: branch.span };
  }
  const start = absoluteStart(target);
  const end = absoluteEnd(target);
  const text = source.slice(start, end);
  if (hasDynamicSyntax(text)) {
    return null;
  }
  const key = normalizedSelectorText(source, start, end);
  return key.length > 0 ? { key, display: selectorDisplay(source, start, end), span: target.span } : null;
}

function unquoteFontFamily(raw: string): { value: string; quoted: boolean } {
  const trimmed = raw.trim();
  if (trimmed.length >= 2) {
    const first = trimmed.charCodeAt(0);
    if ((first === 34 || first === 39) && trimmed.charCodeAt(trimmed.length - 1) === first) {
      return {
        value: trimmed.slice(1, -1).replace(/\\(["'])/g, '$1'),
        quoted: true
      };
    }
  }
  return { value: trimmed, quoted: false };
}

function unquoteImportTarget(raw: string): string {
  const trimmed = stripBlockComments(raw).trim();
  if (trimmed.length >= 2) {
    const first = trimmed.charCodeAt(0);
    if ((first === 34 || first === 39) && trimmed.charCodeAt(trimmed.length - 1) === first) {
      return trimmed.slice(1, -1).replace(/\\(["'])/g, '$1');
    }
  }
  return trimmed;
}

function skipWhitespace(source: string, start: number, end: number): number {
  let i = start;
  while (i < end) {
    const code = source.charCodeAt(i);
    if (code !== 9 && code !== 10 && code !== 12 && code !== 13 && code !== 32) {
      break;
    }
    i++;
  }
  return i;
}

function balancedEnd(source: string, start: number, end: number): number {
  let quote = 0;
  let depth = 0;
  let inBlockComment = false;
  for (let i = start; i < end; i++) {
    const code = source.charCodeAt(i);
    const next = i + 1 < end ? source.charCodeAt(i + 1) : 0;
    if (inBlockComment) {
      if (code === 42 && next === 47) {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (quote !== 0) {
      if (code === 92) {
        i++;
        continue;
      }
      if (code === quote) {
        quote = 0;
      }
      continue;
    }
    if (code === 47 && next === 42) {
      inBlockComment = true;
      i++;
      continue;
    }
    if (code === 34 || code === 39) {
      quote = code;
      continue;
    }
    if (code === 40) {
      depth++;
      continue;
    }
    if (code === 41) {
      depth--;
      if (depth === 0) {
        return i + 1;
      }
    }
  }
  return end;
}

function quotedEnd(source: string, start: number, end: number): number {
  const quote = source.charCodeAt(start);
  for (let i = start + 1; i < end; i++) {
    const code = source.charCodeAt(i);
    if (code === 92) {
      i++;
      continue;
    }
    if (code === quote) {
      return i + 1;
    }
  }
  return end;
}

function importTargetStart(source: string, start: number, end: number): number {
  let i = skipWhitespace(source, start, end);
  while (i < end && source.charCodeAt(i) === 40) {
    const optionsEnd = balancedEnd(source, i, end);
    if (optionsEnd <= i || optionsEnd >= end) {
      return i;
    }
    i = skipWhitespace(source, optionsEnd, end);
  }
  return i;
}

function normalizedImportKey(source: string, node: CssCstNode): ImportKey | null {
  const start = absoluteStart(node);
  let end = absoluteEnd(node);
  if (source.charCodeAt(end - 1) === 59 /* ; */) {
    end--;
  }
  const nameEnd = atRuleNameEnd(source, start, end);
  const targetStart = importTargetStart(source, nameEnd, end);
  if (targetStart >= end) {
    return null;
  }

  let targetEnd: number;
  const targetFirst = source.charCodeAt(targetStart);
  const lowerTargetHead = source.slice(targetStart, Math.min(targetStart + 4, end)).toLowerCase();
  if (targetFirst === 34 || targetFirst === 39) {
    targetEnd = quotedEnd(source, targetStart, end);
  } else if (lowerTargetHead === 'url(') {
    targetEnd = balancedEnd(source, targetStart + 3, end);
  } else {
    return null;
  }

  const rawPrefix = source.slice(nameEnd, targetStart);
  const rawTarget = source.slice(targetStart, targetEnd);
  const rawTail = source.slice(targetEnd, end);
  if (
    rawPrefix.includes('@{') || rawPrefix.includes('#{') || rawPrefix.includes('${')
    || rawTarget.includes('@{') || rawTarget.includes('#{') || rawTarget.includes('${')
    || rawTail.includes('@{') || rawTail.includes('#{') || rawTail.includes('${')
  ) {
    return null;
  }

  let target = rawTarget;
  if (lowerTargetHead === 'url(') {
    target = rawTarget.slice(4, -1);
  }
  const normalizedTarget = unquoteImportTarget(target);
  if (normalizedTarget === '') {
    return null;
  }

  return {
    key: `${normalizedCssWords(rawPrefix)}|${normalizedTarget}|${normalizedCssWords(rawTail)}`,
    target: normalizedTarget
  };
}

function normalizedModuleLoadKey(source: string, node: CssCstNode, language: JessLanguage): ModuleLoadKey | null {
  if ((language !== 'scss' && language !== 'jess') || !MODULE_LOAD_TYPES.has(node.grammarType)) {
    return null;
  }
  if (language === 'scss' && node.grammarType !== 'UseRule' && node.grammarType !== 'ForwardRule') {
    return null;
  }
  if (language === 'jess' && node.grammarType !== 'ModuleImport' && node.grammarType !== 'StyleImport') {
    return null;
  }

  const start = absoluteStart(node);
  let end = absoluteEnd(node);
  if (source.charCodeAt(end - 1) === 59 /* ; */) {
    end--;
  }
  const nameEnd = atRuleNameEnd(source, start, end);
  if (nameEnd <= start + 1) {
    return null;
  }
  const targetNode = firstDescendantNodeMatching(node, STATIC_IMPORT_TARGET_TYPES);
  if (targetNode === undefined) {
    return null;
  }
  const targetStart = absoluteStart(targetNode);
  const targetEnd = absoluteEnd(targetNode);
  if (targetStart < nameEnd || targetEnd > end) {
    return null;
  }
  const rawTarget = source.slice(targetStart, targetEnd);
  const rawTail = source.slice(targetEnd, end);
  if (
    rawTarget.includes('@{') || rawTarget.includes('#{') || rawTarget.includes('${')
    || rawTail.includes('@{') || rawTail.includes('#{') || rawTail.includes('${')
  ) {
    return null;
  }
  const target = unquoteImportTarget(rawTarget);
  if (target === '') {
    return null;
  }
  const directive = source.slice(start, nameEnd).toLowerCase();
  return {
    key: `${language}|${directive}|${target}|${normalizedCssWords(rawTail)}`,
    directive,
    target
  };
}

function forEachExtendTarget(
  source: string,
  node: CssCstNode,
  language: JessLanguage,
  fn: (target: CssCstNode, exact: boolean) => void
): void {
  if (node.grammarType === 'ExtendTarget') {
    const target = firstChildNodeMatching(node, EXTEND_TARGET_TYPES);
    if (target !== undefined) {
      fn(target, !isLessPartialExtendTarget(source.slice(absoluteStart(node), absoluteEnd(node))));
    }
    return;
  }
  if (node.grammarType !== 'Extend') {
    return;
  }
  if (language === 'scss') {
    const target = firstChildNodeOf(node, 'Selector');
    if (target !== undefined) {
      fn(target, true);
    }
    return;
  }
  if (language === 'jess') {
    const exact = isJessExactExtend(source.slice(absoluteStart(node), absoluteEnd(node)));
    for (const child of cstChildrenOf(node)) {
      if (isCstNode(child) && child.grammarType === 'PseudoSelectorComplex') {
        fn(child, exact);
      }
    }
  }
}

function isLessPartialExtendTarget(text: string): boolean {
  return /\s!?all\s*$/i.test(normalizedCssWords(text));
}

function isJessExactExtend(text: string): boolean {
  return /(?:^|\s)!exact(?:\s|;|$)/.test(text);
}

function hasTopLevelBoundedSelectorAtom(source: string, start: number, end: number): boolean {
  let quote = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  for (let i = start; i < end; i++) {
    const code = source.charCodeAt(i);
    const next = i + 1 < end ? source.charCodeAt(i + 1) : 0;
    if (quote !== 0) {
      if (code === 92) {
        i++;
        continue;
      }
      if (code === quote) {
        quote = 0;
      }
      continue;
    }
    if (code === 47 && next === 42) {
      i = skipCssComment(source, i, end) - 1;
      continue;
    }
    if (code === 34 || code === 39) {
      quote = code;
      continue;
    }
    if (code === 91) {
      bracketDepth++;
      continue;
    }
    if (code === 93 && bracketDepth > 0) {
      bracketDepth--;
      continue;
    }
    if (bracketDepth > 0) {
      continue;
    }
    if (code === 40) {
      parenDepth++;
      continue;
    }
    if (code === 41 && parenDepth > 0) {
      parenDepth--;
      continue;
    }
    if (parenDepth > 0) {
      continue;
    }
    if (code === 38) {
      return true;
    }
    if (code === 35 || code === 37 || code === 46) {
      if (next === 92 || isIdentChar(next)) {
        return true;
      }
    }
  }
  return false;
}

function isUnboundedExtendTarget(source: string, target: CssCstNode): boolean {
  const start = absoluteStart(target);
  const end = absoluteEnd(target);
  const text = source.slice(start, end);
  return !hasDynamicSyntax(text) && !hasTopLevelBoundedSelectorAtom(source, start, end);
}

function splitFontFamilyValue(source: string, valueStart: number, valueEnd: number): FontFamilyPart[] {
  const parts: FontFamilyPart[] = [];
  let partStart = valueStart;
  let quote = 0;
  let parenDepth = 0;
  let inBlockComment = false;

  const pushPart = (absoluteEnd: number) => {
    const raw = source.slice(partStart, absoluteEnd);
    const trimmed = trimOffsets(raw, partStart);
    const trimmedRaw = source.slice(trimmed.start, trimmed.end);
    if (trimmedRaw !== '') {
      const unquoted = unquoteFontFamily(trimmedRaw);
      const normalized = unquoted.value.replace(/\s+/g, ' ').toLowerCase();
      parts.push({
        raw: unquoted.value,
        normalized,
        isGeneric: !unquoted.quoted && GENERIC_FONT_FAMILIES.has(normalized),
        start: trimmed.start,
        end: trimmed.end
      });
    }
    partStart = absoluteEnd + 1;
  };

  for (let i = valueStart; i < valueEnd; i++) {
    const code = source.charCodeAt(i);
    const next = i + 1 < valueEnd ? source.charCodeAt(i + 1) : 0;
    if (inBlockComment) {
      if (code === 42 && next === 47) {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (quote !== 0) {
      if (code === 92) {
        i++;
        continue;
      }
      if (code === quote) {
        quote = 0;
      }
      continue;
    }
    if (code === 47 && next === 42) {
      inBlockComment = true;
      i++;
      continue;
    }
    if (code === 34 || code === 39) {
      quote = code;
      continue;
    }
    if (code === 40) {
      parenDepth++;
      continue;
    }
    if (code === 41 && parenDepth > 0) {
      parenDepth--;
      continue;
    }
    if (code === 44 && parenDepth === 0) {
      pushPart(i);
    }
  }
  pushPart(valueEnd);
  return parts;
}

function isFontSizeToken(value: string): boolean {
  const beforeLineHeight = value.split('/')[0]!.toLowerCase();
  return FONT_SIZE_KEYWORDS.has(beforeLineHeight)
    || /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[a-z%]+)$/i.test(beforeLineHeight);
}

function nextNonWhitespace(source: string, start: number, end: number): number {
  let i = start;
  while (i < end) {
    const code = source.charCodeAt(i);
    if (code !== 9 && code !== 10 && code !== 12 && code !== 13 && code !== 32) {
      break;
    }
    i++;
  }
  return i;
}

function fontShorthandFamilyStart(source: string, valueStart: number, valueEnd: number): number | null {
  const raw = source.slice(valueStart, valueEnd).trim();
  const lower = raw.toLowerCase();
  if (CSS_WIDE_KEYWORDS.has(lower) || SYSTEM_FONT_KEYWORDS.has(lower) || containsDynamicFontValue(raw)) {
    return null;
  }

  let tokenStart = -1;
  let quote = 0;
  let parenDepth = 0;
  let inBlockComment = false;
  const finishToken = (tokenEnd: number): number | null => {
    if (tokenStart < 0) {
      return null;
    }
    const token = source.slice(tokenStart, tokenEnd);
    if (!isFontSizeToken(token)) {
      tokenStart = -1;
      return null;
    }
    let familyStart = nextNonWhitespace(source, tokenEnd, valueEnd);
    if (familyStart < valueEnd && source.charCodeAt(familyStart) === 47) {
      familyStart = nextNonWhitespace(source, familyStart + 1, valueEnd);
      while (familyStart < valueEnd) {
        const code = source.charCodeAt(familyStart);
        if (code === 9 || code === 10 || code === 12 || code === 13 || code === 32) {
          break;
        }
        familyStart++;
      }
      familyStart = nextNonWhitespace(source, familyStart, valueEnd);
    }
    return familyStart < valueEnd ? familyStart : null;
  };

  for (let i = valueStart; i < valueEnd; i++) {
    const code = source.charCodeAt(i);
    const next = i + 1 < valueEnd ? source.charCodeAt(i + 1) : 0;
    if (inBlockComment) {
      if (code === 42 && next === 47) {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (quote !== 0) {
      if (code === 92) {
        i++;
        continue;
      }
      if (code === quote) {
        quote = 0;
      }
      continue;
    }
    if (code === 47 && next === 42) {
      inBlockComment = true;
      i++;
      continue;
    }
    if (code === 34 || code === 39) {
      quote = code;
      continue;
    }
    if (code === 40) {
      parenDepth++;
      continue;
    }
    if (code === 41 && parenDepth > 0) {
      parenDepth--;
      continue;
    }
    if ((code === 9 || code === 10 || code === 12 || code === 13 || code === 32) && parenDepth === 0) {
      const familyStart = finishToken(i);
      if (familyStart !== null) {
        return familyStart;
      }
      continue;
    }
    if (tokenStart < 0) {
      tokenStart = i;
    }
  }
  return finishToken(valueEnd);
}

function containsDynamicFontValue(value: string): boolean {
  const lower = value.toLowerCase();
  return lower.includes('var(')
    || value.includes('@{')
    || value.includes('#{')
    || value.includes('${')
    || value.includes('$');
}

function isDeclarationValueContext(source: string, offset: number): boolean {
  const lastBlockOpen = source.lastIndexOf('{', offset);
  const lastBlockClose = source.lastIndexOf('}', offset);
  if (lastBlockOpen < 0 || lastBlockClose > lastBlockOpen) {
    return false;
  }

  const lastStatement = Math.max(lastBlockOpen, source.lastIndexOf(';', offset));
  const lastColon = source.lastIndexOf(':', offset);
  return lastColon > lastStatement;
}

function sourceSpan(source: string, start: number, end: number): DiagnosticSpan {
  let line = 1;
  let column = 1;
  for (let i = 0; i < start; i++) {
    const code = source.charCodeAt(i);
    if (code === 10) {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  let endLine = line;
  let endColumn = column;
  for (let i = start; i < end; i++) {
    const code = source.charCodeAt(i);
    if (code === 10) {
      endLine++;
      endColumn = 1;
    } else {
      endColumn++;
    }
  }
  return { start, end: Math.max(start, end), startLine: line, startColumn: column, endLine, endColumn };
}

function skipCssString(source: string, start: number, end: number): number {
  const quote = source.charCodeAt(start);
  let i = start + 1;
  while (i < end) {
    const code = source.charCodeAt(i);
    if (code === 92) {
      i += 2;
      continue;
    }
    i++;
    if (code === quote) {
      break;
    }
  }
  return i;
}

function skipCssComment(source: string, start: number, end: number): number {
  let i = start + 2;
  while (i + 1 < end) {
    if (source.charCodeAt(i) === 42 && source.charCodeAt(i + 1) === 47) {
      return i + 2;
    }
    i++;
  }
  return end;
}

function skipCssTrivia(source: string, start: number, end: number): number {
  let i = start;
  while (i < end) {
    const code = source.charCodeAt(i);
    const next = i + 1 < end ? source.charCodeAt(i + 1) : 0;
    if (code === 9 || code === 10 || code === 12 || code === 13 || code === 32) {
      i++;
      continue;
    }
    if (code === 47 && next === 42) {
      i = skipCssComment(source, i, end);
      continue;
    }
    break;
  }
  return i;
}

function cssConstructEnd(source: string, start: number, end: number): { end: number; hasBlock: boolean } {
  let parenDepth = 0;
  for (let i = start; i < end;) {
    const code = source.charCodeAt(i);
    const next = i + 1 < end ? source.charCodeAt(i + 1) : 0;
    if (code === 47 && next === 42) {
      i = skipCssComment(source, i, end);
      continue;
    }
    if (code === 34 || code === 39) {
      i = skipCssString(source, i, end);
      continue;
    }
    if (code === 40) {
      parenDepth++;
      i++;
      continue;
    }
    if (code === 41 && parenDepth > 0) {
      parenDepth--;
      i++;
      continue;
    }
    if (parenDepth === 0 && code === 59) {
      return { end: i + 1, hasBlock: false };
    }
    if (parenDepth === 0 && code === 123) {
      return { end: cssBlockEnd(source, i, end), hasBlock: true };
    }
    i++;
  }
  return { end, hasBlock: false };
}

function cssBlockEnd(source: string, start: number, end: number): number {
  let depth = 0;
  for (let i = start; i < end;) {
    const code = source.charCodeAt(i);
    const next = i + 1 < end ? source.charCodeAt(i + 1) : 0;
    if (code === 47 && next === 42) {
      i = skipCssComment(source, i, end);
      continue;
    }
    if (code === 34 || code === 39) {
      i = skipCssString(source, i, end);
      continue;
    }
    if (code === 123) {
      depth++;
      i++;
      continue;
    }
    if (code === 125) {
      depth--;
      i++;
      if (depth <= 0) {
        return i;
      }
      continue;
    }
    i++;
  }
  return end;
}

function invalidImportPositionSpans(source: string): DiagnosticSpan[] {
  const spans: DiagnosticSpan[] = [];
  const end = source.length;
  let invalidPosition = false;
  let i = 0;
  while (i < end) {
    i = skipCssTrivia(source, i, end);
    if (i >= end) {
      break;
    }
    const code = source.charCodeAt(i);
    if (code === 64 /* @ */) {
      const nameEnd = atRuleNameEnd(source, i, end);
      if (nameEnd <= i + 1) {
        invalidPosition = true;
        i++;
        continue;
      }
      const name = source.slice(i + 1, nameEnd).toLowerCase();
      const construct = cssConstructEnd(source, nameEnd, end);
      if (name === 'import') {
        if (invalidPosition) {
          spans.push(sourceSpan(source, i, construct.end));
        }
      } else if (name !== 'charset' && !(name === 'layer' && !construct.hasBlock)) {
        invalidPosition = true;
      }
      i = construct.end;
      continue;
    }
    invalidPosition = true;
    i = cssConstructEnd(source, i, end).end;
  }
  return spans;
}

function diagnostic(
  code: string,
  defaultSeverity: DiagnosticSeverityName,
  message: string,
  span: DiagnosticSpan,
  filePath?: string,
  qualifiers?: readonly string[]
): SourceDiagnostic {
  const start = Number(span.start);
  const end = Number(span.end);
  return {
    code,
    phase: code.startsWith('parse/') ? 'parse' : 'lint',
    source: 'jess',
    message,
    reason: '',
    fix: '',
    defaultSeverity,
    filePath,
    start,
    end: Math.max(start, end),
    line: span.startLine,
    column: span.startColumn,
    endLine: span.endLine,
    endColumn: span.endColumn,
    qualifiers
  };
}

function spanFromOffsets(start: number, end: number): DiagnosticSpan {
  return { start, end: Math.max(start, end) };
}

function spanFromNodeStart(node: CssCstNode, start: number, end: number): DiagnosticSpan {
  const nodeStart = absoluteStart(node);
  const startDelta = Math.max(0, start - nodeStart);
  const endDelta = Math.max(startDelta, end - nodeStart);
  if (node.span.startLine === undefined || node.span.startColumn === undefined) {
    return spanFromOffsets(start, end);
  }
  return {
    start,
    end: Math.max(start, end),
    startLine: node.span.startLine,
    startColumn: node.span.startColumn + startDelta,
    endLine: node.span.startLine,
    endColumn: node.span.startColumn + endDelta
  };
}

function spanAtOrContaining(node: CssCstNode, start: number, end: number): DiagnosticSpan {
  let enclosing: DiagnosticSpan | undefined;
  const visit = (child: CssCstChild) => {
    const childStart = Number(child.span.start);
    const childEnd = Number(child.span.end);
    if (childStart > start || childEnd < end) {
      return;
    }
    if (childStart === start && childEnd === end) {
      enclosing = child.span;
      return;
    }
    if (enclosing === undefined || childEnd - childStart < enclosing.end - enclosing.start) {
      enclosing = child.span;
    }
    if (child._tag === 'node') {
      for (const nested of child.rules) {
        visit(nested);
      }
    }
  };
  visit(node);
  return enclosing ?? spanFromOffsets(start, end);
}

function metadataWithDefaults(metadata?: Partial<CssDiagnosticMetadata>): CssDiagnosticMetadata {
  return {
    isKnownProperty(name) {
      return metadata?.isKnownProperty?.(name) ?? defaultCssDiagnosticMetadata.isKnownProperty(name);
    },
    isKnownPropertyValue(name, value) {
      return metadata?.isKnownPropertyValue?.(name, value) ?? defaultCssDiagnosticMetadata.isKnownPropertyValue(name, value);
    },
    isKnownAtRule(name) {
      return metadata?.isKnownAtRule?.(name) ?? defaultCssDiagnosticMetadata.isKnownAtRule(name);
    },
    isKnownAtRuleDescriptor(atRuleName, descriptorName) {
      return metadata?.isKnownAtRuleDescriptor?.(atRuleName, descriptorName)
        ?? defaultCssDiagnosticMetadata.isKnownAtRuleDescriptor(atRuleName, descriptorName);
    },
    isKnownFunction(name) {
      return metadata?.isKnownFunction?.(name) ?? defaultCssDiagnosticMetadata.isKnownFunction(name);
    },
    isKnownMediaFeatureName(name) {
      return metadata?.isKnownMediaFeatureName?.(name) ?? defaultCssDiagnosticMetadata.isKnownMediaFeatureName(name);
    },
    isKnownMediaFeatureValue(name, value) {
      return metadata?.isKnownMediaFeatureValue?.(name, value) ?? defaultCssDiagnosticMetadata.isKnownMediaFeatureValue(name, value);
    },
    isKnownPseudoClass(name) {
      return metadata?.isKnownPseudoClass?.(name) ?? defaultCssDiagnosticMetadata.isKnownPseudoClass(name);
    },
    isKnownPseudoElement(name) {
      return metadata?.isKnownPseudoElement?.(name) ?? defaultCssDiagnosticMetadata.isKnownPseudoElement(name);
    },
    isKnownTypeSelector(name) {
      return metadata?.isKnownTypeSelector?.(name) ?? defaultCssDiagnosticMetadata.isKnownTypeSelector(name);
    }
  };
}

export function parseDocForLanguage(source: string, language: JessLanguage): ParseDoc<CssCstNode> {
  if (language === 'less') {
    return parseLessDiagnosticDoc(source);
  }
  if (language === 'scss') {
    return parseScssDiagnosticDoc(source);
  }
  if (language === 'jess') {
    return parseJessDiagnosticDoc(source);
  }
  return parseCssDiagnosticDoc(source);
}

function parseResultForLanguage(source: string, language: JessLanguage): CssCstParseResult {
  if (language === 'less') {
    return parseLessDiagnosticCst(source);
  }
  if (language === 'scss') {
    return parseScssDiagnosticCst(source);
  }
  if (language === 'jess') {
    return parseJessDiagnosticCst(source);
  }
  return parseCssDiagnosticCst(source);
}

export function parseDiagnosticsForDoc(doc: ParseDiagnosticSource, filePath?: string): SourceDiagnostic[] {
  const diagnostics: SourceDiagnostic[] = [];
  const emitted = new Set<string>();
  const push = (span: DiagnosticSpan, message: string) => {
    const key = `parse/syntax-error:${span.start}`;
    if (emitted.has(key)) {
      return;
    }
    emitted.add(key);
    diagnostics.push(diagnostic(
      'parse/syntax-error',
      'error',
      message,
      span,
      filePath
    ));
  };
  for (const error of doc.errors) {
    push(error.span, 'Unexpected syntax');
  }
  if (doc.unconsumedFrom !== null) {
    const rootSpan = doc.tree?.span;
    const unconsumedSpan = rootSpan !== undefined && Number(rootSpan.end) === doc.unconsumedFrom
      ? {
          ...rootSpan,
          start: doc.unconsumedFrom,
          end: doc.unconsumedFrom + 1,
          startLine: rootSpan.endLine,
          startColumn: rootSpan.endColumn
        }
      : spanFromOffsets(doc.unconsumedFrom, doc.unconsumedFrom + 1);
    push(unconsumedSpan, 'Unexpected input');
  }
  return diagnostics;
}

export function cstLintDiagnostics(
  root: CssCstNode,
  source: string,
  language: JessLanguage,
  metadata?: Partial<CssDiagnosticMetadata>,
  filePath?: string,
  tolerantSourceScan = true
): SourceDiagnostic[] {
  const out: SourceDiagnostic[] = [];
  const emitted = new Set<string>();
  const seenImports = new Map<string, ImportKey>();
  const seenModuleLoads = new Map<string, ModuleLoadKey>();
  const declaredAnimations = new Set<string>();
  const animationReferences: AnimationNameReference[] = [];
  const declaredCustomProperties = new Set<string>();
  const customPropertyReferences: CustomPropertyReference[] = [];
  const variableDeclarations: VariableDeclarationFact[] = [];
  const variableReferences = new Set<string>();
  const mapLikeVariables = new Set<string>();
  const ruleSelectorKeys = new Set<string>();
  const exactExtendTargets: ExactExtendTargetFact[] = [];
  let hasExternalSelectorSources = false;
  const cssData = metadataWithDefaults(metadata);
  const dialectAtRules = DIALECT_AT_RULES[language];
  const push = (
    code: string,
    severity: DiagnosticSeverityName,
    message: string,
    span: DiagnosticSpan,
    qualifiers?: readonly string[]
  ) => {
    const start = Number(span.start);
    const end = Number(span.end);
    const key = `${code}:${start}:${Math.max(start, end)}:${message}`;
    if (emitted.has(key)) {
      return;
    }
    emitted.add(key);
    out.push(diagnostic(code, severity, message, span, filePath, qualifiers));
  };

  const visit = (node: CssCstNode, context: VisitContext) => {
    const start = absoluteStart(node);
    const end = absoluteEnd(node);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      return;
    }
    const gt = node.grammarType;
    hasExternalSelectorSources ||= EXTERNAL_SELECTOR_SOURCE_TYPES.has(gt);
    const declarationName = DECLARATION_TYPES.has(gt)
      ? propNameOf(source.slice(start, end)).toLowerCase()
      : null;
    const functionName = FUNCTION_TYPES.has(gt) ? functionNameOf(source, start, end) : null;
    const isUrlFunction = gt === 'Url' || functionName === 'url';
    const isImageSetFunction = functionName !== null && unprefixedName(functionName) === 'image-set';
    const descriptorAtRuleName = gt === 'DescriptorBlock' ? atRuleNameOf(source, start, end) : null;
    const pageDescriptorContext = gt === 'MarginAtRule' && context.pageDescriptorContext === 'page'
      ? 'page-margin'
      : gt === 'PageBlock'
        ? 'page'
        : context.pageDescriptorContext;
    const isMediaAtRule = gt === 'QueryAtRuleBlock'
      && source.charCodeAt(start) === 64
      && source.slice(start + 1, atRuleNameEnd(source, start, end)).toLowerCase() === 'media';
    const isFontFaceAtRule = (gt === 'DescriptorBlock' || ATRULE_TYPES.has(gt))
      && source.charCodeAt(start) === 64
      && source.slice(start + 1, atRuleNameEnd(source, start, end)).toLowerCase() === 'font-face';
    const nodeContext: VisitContext = {
      inVarCall: context.inVarCall || gt === 'VarCall',
      inDeclaration: context.inDeclaration || DECLARATION_TYPES.has(gt),
      inMediaAtRule: context.inMediaAtRule || isMediaAtRule,
      inCustomDeclaration: context.inCustomDeclaration || CUSTOM_DECLARATION_TYPES.has(gt),
      inFontFaceAtRule: context.inFontFaceAtRule || isFontFaceAtRule,
      descriptorAtRuleName: descriptorAtRuleName ?? context.descriptorAtRuleName,
      pageDescriptorContext,
      inKeyframeBlock: context.inKeyframeBlock || KEYFRAME_BLOCK_TYPES.has(gt),
      inUrlFunction: context.inUrlFunction || isUrlFunction,
      inIgnoredTypeSelectorPseudo: context.inIgnoredTypeSelectorPseudo || (gt === 'PseudoSelector' && ignoresTypeSelectorsInPseudo(source, start, end)),
      allowResolutionXUnit: context.allowResolutionXUnit || isImageSetFunction || declarationName === 'image-resolution',
      selectorLists: context.selectorLists
    };

    if (language === 'css' && RULESET_TYPES.has(gt) && !nodeContext.inKeyframeBlock) {
      const selectorList = firstChildNodeMatching(node, SELECTOR_LIST_TYPES);
      if (selectorList !== undefined) {
        const branches = selectorBranches(source, selectorList);
        const seenBranches = new Map<string, SelectorSeen>();
        for (const branch of branches) {
          const previous = seenBranches.get(branch.key);
          if (previous !== undefined) {
            push(
              LINT_CODES.duplicateSelectors,
              'warning',
              `Duplicate selector "${branch.display}", first used at line ${previous.line}`,
              branch.span
            );
          } else {
            seenBranches.set(branch.key, { line: branch.span.startLine ?? 1 });
          }
        }
        if (branches.length > 0) {
          const key = selectorListKey(branches);
          const previous = nodeContext.selectorLists.get(key);
          if (previous !== undefined) {
            const selectorStart = absoluteStart(selectorList);
            const selectorEnd = absoluteEnd(selectorList);
            push(
              LINT_CODES.duplicateSelectors,
              'warning',
              `Duplicate selector "${selectorDisplay(source, selectorStart, selectorEnd)}", first used at line ${previous.line}`,
              selectorList.span
            );
          } else {
            nodeContext.selectorLists.set(key, { line: selectorList.span.startLine ?? 1 });
          }
        }
      }
    }

    if (RULESET_TYPES.has(gt)) {
      if (emptyBracedBody(source, start, end)) {
        push(LINT_CODES.emptyRules, 'warning', 'Do not use empty rulesets', node.span);
      }
      const selector = firstChildNodeMatching(node, RULE_SELECTOR_TYPES);
      if (selector !== undefined) {
        for (const branch of collectRuleSelectorBranches(source, selector)) {
          ruleSelectorKeys.add(branch.key);
        }
      }
    }

    if (language !== 'css' && gt === 'SelectorBranch') {
      const key = normalizedSelectorText(source, start, end);
      if (key.length > 0) {
        ruleSelectorKeys.add(key);
      }
    }

    if (MIXIN_DEFINITION_TYPES.has(gt) && emptyBracedBody(source, start, end)) {
      push(LINT_CODES.emptyRules, 'warning', 'Do not use empty mixin bodies', node.span, ['mixin-body']);
    }

    const variableDeclaration = variableDeclarationOf(source, node, language);
    if (variableDeclaration !== null) {
      variableDeclarations.push(variableDeclaration);
      if (variableDeclarationIsMapLike(node, language)) {
        mapLikeVariables.add(variableDeclaration.name);
      } else {
        mapLikeVariables.delete(variableDeclaration.name);
      }
    }

    const variableReference = variableReferenceNameOf(source, node, language);
    if (variableReference !== null) {
      variableReferences.add(variableReference);
    }

    const suspiciousMapKeyAccess = suspiciousMapKeyAccessOf(source, node, language, mapLikeVariables);
    if (suspiciousMapKeyAccess !== null) {
      push(
        LINT_CODES.suspiciousMapKeyAccess,
        'warning',
        `Numeric key access on map-like variable "${suspiciousMapKeyAccess.variable}" is probably an accidental positional lookup`,
        suspiciousMapKeyAccess.span
      );
    }

    if (language === 'css' && gt === 'DescriptorBlock' && descriptorAtRuleName === 'property') {
      const registeredName = customPropertyRegistrationName(source, node);
      if (registeredName !== null) {
        declaredCustomProperties.add(registeredName);
      }
      const problem = typedCustomPropertyValueProblem(source, node);
      if (problem !== null) {
        push(
          LINT_CODES.invalidTypedCustomPropertyValue,
          'warning',
          `Initial value "${problem.value.text}" does not match @property syntax "${problem.syntax.raw}"`,
          problem.value.span
        );
      }
    }

    if (language === 'css' && gt === 'DescriptorBlock' && descriptorAtRuleName === 'font-face') {
      const missing = fontFaceMissingRequiredProperties(source, node);
      if (missing.length > 0) {
        const requirement = missing.map(name => `"${name}"`).join(' and ');
        push(
          LINT_CODES.fontFaceMissingRequiredProperties,
          'warning',
          `@font-face rule must define ${requirement}`,
          spanAtOrContaining(node, start, atRuleNameEnd(source, start, end))
        );
      }
    }

    if (gt === 'AtRootFilter') {
      push(
        LINT_CODES.unsupportedSassForm, 'warning',
        '@at-root prelude/filter forms are not yet supported in Jess. Write the hoisted rules directly instead.',
        node.span
      );
    }
    if (gt === 'ForwardRule') {
      const prelude = forwardPreludeOf(node, source);
      if (prelude !== null) {
        if (FORWARD_AS_PREFIX.test(prelude)) {
          push(
            LINT_CODES.unsupportedSassForm, 'warning',
            '@forward with "as <prefix>-*" prefixing is not supported in Jess and will never be. Use explicit namespacing instead.',
            node.span
          );
        }
        if (FORWARD_VISIBILITY.test(prelude)) {
          push(
            LINT_CODES.unsupportedSassForm, 'warning',
            '@forward with "show"/"hide" lists is not supported in Jess and will never be. Visibility control belongs to the module itself.',
            node.span
          );
        }
      }
    }

    if (ATRULE_TYPES.has(gt)) {
      if (source.charCodeAt(start) === 64 /* @ */) {
        const nameEnd = atRuleNameEnd(source, start, end);
        if (nameEnd > start + 1) {
          const rawName = source.slice(start + 1, nameEnd);
          const name = rawName.toLowerCase();
          if (!cssData.isKnownAtRule(name) && !dialectAtRules.has(name)) {
            push(LINT_CODES.unknownAtRules, 'warning', `Unknown at-rule @${rawName}`, spanAtOrContaining(node, start, nameEnd));
          }
        }
      }
    }

    if (IMPORT_RULE_TYPES.has(gt)) {
      const importKey = normalizedImportKey(source, node);
      if (importKey !== null) {
        const previous = seenImports.get(importKey.key);
        if (previous !== undefined) {
          push(
            LINT_CODES.duplicateAtImportRules,
            'warning',
            `Duplicate @import rule ${importKey.target}`,
            node.span
          );
        } else {
          seenImports.set(importKey.key, importKey);
        }
      }
    }

    const moduleLoadKey = normalizedModuleLoadKey(source, node, language);
    if (moduleLoadKey !== null) {
      if (seenModuleLoads.has(moduleLoadKey.key)) {
        push(
          LINT_CODES.duplicateModuleLoads,
          'warning',
          `Duplicate ${moduleLoadKey.directive} module load ${moduleLoadKey.target}`,
          node.span
        );
      } else {
        seenModuleLoads.set(moduleLoadKey.key, moduleLoadKey);
      }
    }

    forEachExtendTarget(source, node, language, (target, exact) => {
      if (isUnboundedExtendTarget(source, target)) {
        const targetStart = absoluteStart(target);
        const targetEnd = absoluteEnd(target);
        push(
          LINT_CODES.unboundedExtends,
          'warning',
          `Extend target "${selectorDisplay(source, targetStart, targetEnd)}" has no class, id, placeholder, or parent selector anchor`,
          target.span
        );
      } else if (exact) {
        const targetFact = exactExtendTargetFact(source, target);
        if (targetFact !== null) {
          exactExtendTargets.push(targetFact);
        }
      }
    });

    if (PSEUDO_SELECTOR_TYPES.has(gt)) {
      const pseudo = pseudoNameSpan(source, start, end);
      if (pseudo !== null) {
        const bareLower = pseudo.bare.toLowerCase();
        if (language === 'css' && ANB_PSEUDO_CLASSES.has(bareLower)) {
          const argument = nthArgumentSpan(source, node);
          if (argument !== null && isUnmatchableAnbArgument(source.slice(argument.start, argument.end))) {
            push(
              LINT_CODES.unmatchableAnbSelectors,
              'warning',
              `Unmatchable An+B selector "${source.slice(start, end)}"`,
              node.span
            );
          }
        }
        if (
          !bareLower.startsWith('--')
          && !isVendorPseudoName(bareLower)
          && !DIALECT_PSEUDO_CLASSES[language].has(bareLower)
        ) {
          if (pseudo.colonCount === 2) {
            if (!cssData.isKnownPseudoElement(pseudo.name)) {
              push(
                LINT_CODES.unknownPseudoElements,
                'warning',
                `Unknown pseudo-element selector "${pseudo.name}"`,
                spanAtOrContaining(node, pseudo.start, pseudo.end)
              );
            }
          } else if (
            !LEGACY_SINGLE_COLON_PSEUDO_ELEMENTS.has(bareLower)
            && !cssData.isKnownPseudoClass(pseudo.name)
          ) {
            push(
              LINT_CODES.unknownPseudoClasses,
              'warning',
              `Unknown pseudo-class selector "${pseudo.name}"`,
              spanAtOrContaining(node, pseudo.start, pseudo.end)
            );
          }
        }
      }
    }

    if (language === 'css' && !nodeContext.inIgnoredTypeSelectorPseudo && BASIC_SELECTOR_TYPES.has(gt)) {
      const selector = typeSelectorNameSpan(source, node);
      if (
        selector !== null
        && !isCustomElementName(selector.name)
        && !cssData.isKnownTypeSelector(selector.name)
      ) {
        push(
          LINT_CODES.unknownTypeSelectors,
          'warning',
          `Unknown type selector "${selector.name}"`,
          spanAtOrContaining(node, selector.start, selector.end)
        );
      }
    }

    if (language === 'css' && nodeContext.inMediaAtRule && MEDIA_FEATURE_NAME_TYPES.has(gt)) {
      const feature = mediaFeatureNameSpan(source, node);
      if (feature !== null) {
        const lower = feature.name.toLowerCase();
        const shouldCheckFeature = !lower.startsWith('--') && !isVendorPrefixedName(lower);
        if (shouldCheckFeature && !cssData.isKnownMediaFeatureName(lower)) {
          push(
            LINT_CODES.unknownMediaFeatureNames,
            'warning',
            `Unknown media feature name "${feature.name}"`,
            spanAtOrContaining(node, feature.start, feature.end)
          );
        }
        if (shouldCheckFeature && cssData.isKnownMediaFeatureName(lower)) {
          const value = mediaFeatureValue(source, node);
          if (value !== null && cssData.isKnownMediaFeatureValue(lower, value.fact) === false) {
            push(
              LINT_CODES.unknownMediaFeatureValues,
              'warning',
              `Unknown media feature value "${value.fact.raw}" for name "${feature.name}"`,
              value.span
            );
          }
        }
      }
    }

    if (language === 'css' && nodeContext.inDeclaration && FUNCTION_TYPES.has(gt) && functionName !== null) {
      if (gt === 'VarCall') {
        const customPropertyReference = customPropertyReferenceOfVarCall(source, node);
        if (customPropertyReference !== null) {
          customPropertyReferences.push(customPropertyReference);
        }
      }
      if (!functionName.startsWith('--') && !cssData.isKnownFunction(functionName)) {
        push(
          LINT_CODES.unknownFunctions,
          'warning',
          `Unknown function "${functionName}"`,
          spanAtOrContaining(node, start, start + functionName.length)
        );
      }
      if (MATH_FUNCTION_NAMES.has(functionName)) {
        const mismatch = incompatibleMathFunctionUnits(source, node, functionName);
        if (mismatch !== null) {
          push(
            LINT_CODES.incompatibleMathFunctionUnits,
            'warning',
            `Incompatible units in ${mismatch.functionName}(): ${mismatch.expected.text} is ${mismatch.expected.kind} but ${mismatch.actual.text} is ${mismatch.actual.kind}`,
            mismatch.actual.span
          );
        }
      }
      const gradientDirection = nonstandardLinearGradientDirection(source, node, functionName);
      if (gradientDirection !== null) {
        push(
          LINT_CODES.linearGradientNonstandardDirection,
          'warning',
          `Expected standard direction syntax in ${functionName}()`,
          gradientDirection
        );
      }
      const colorProblem = invalidColorFunctionChannels(source, node, functionName);
      if (colorProblem !== null) {
        push(
          LINT_CODES.invalidColorFunctionChannels,
          'error',
          colorProblem.message,
          colorProblem.span
        );
      }
    }

    if (CUSTOM_PROPERTY_VALUE_TYPES.has(gt) && !nodeContext.inVarCall && !nodeContext.inCustomDeclaration) {
      const name = source.slice(start, end).trim();
      push(
        LINT_CODES.customPropertyMissingVarFunction,
        'warning',
        `Use var(${name}) when reading a custom property`,
        node.span
      );
    }

    if (nodeContext.inKeyframeBlock && IMPORTANT_TYPES.has(gt)) {
      push(
        LINT_CODES.keyframeDeclarationNoImportant,
        'warning',
        'Do not use !important inside keyframes',
        node.span
      );
    }

    if (language === 'css' && nodeContext.inDeclaration && !nodeContext.inKeyframeBlock && IMPORTANT_TYPES.has(gt)) {
      push(
        LINT_CODES.declarationNoImportant,
        'warning',
        'Disallowed !important',
        node.span
      );
    }

    if (DIMENSION_TYPES.has(gt)) {
      const slice = source.slice(start, end).trim();
      const m = /^([+-]?(?:\d+\.?\d*|\.\d+))([a-z%]+)$/i.exec(slice);
      if (m && Number(m[1]) === 0 && LENGTH_UNITS.has(m[2]!.toLowerCase())) {
        push(LINT_CODES.zeroUnits, 'hint', `The unit "${m[2]}" is unnecessary for a zero value`, node.span);
      }
      const unitSpan = dimensionUnitSpan(source, start, end);
      if (unitSpan !== null && unitSpan.unit !== '%') {
        const lowerUnit = unitSpan.unit.toLowerCase();
        const allowXUnit = lowerUnit === 'x'
          && (nodeContext.allowResolutionXUnit || isResolutionMediaFeatureDimension(source, start));
        if (!nodeContext.inUrlFunction && !allowXUnit && !KNOWN_CSS_UNITS.has(lowerUnit)) {
          push(
            LINT_CODES.unknownUnits,
            'warning',
            `Unknown unit "${unitSpan.unit}"`,
            spanAtOrContaining(node, unitSpan.start, unitSpan.end)
          );
        }
      }
    }

    if (DECLARATION_TYPES.has(gt)) {
      const slice = source.slice(start, end);
      const colon = slice.indexOf(':');
      const name = propNameOf(slice);
      const descriptor = name.length > 0 ? descriptorStatusForContext(nodeContext, cssData, name) : null;

      if (name.length > 0) {
        const lower = name.toLowerCase();
        const skip = lower.startsWith('--')
          || lower.startsWith('-')
          || lower.startsWith('$')
          || lower.startsWith('@')
          || lower.includes('#{')
          || lower.includes('@{')
          || lower.includes('${');
        const nameStart = start + slice.indexOf(name);
        if (descriptor !== null && descriptor.status === false) {
          push(
            LINT_CODES.unknownAtRuleDescriptors,
            'warning',
            `Unknown descriptor "${name}" for at-rule "@${descriptor.atRuleName}"`,
            spanAtOrContaining(node, nameStart, nameStart + name.length)
          );
        } else if (descriptor?.status === undefined && !skip && !cssData.isKnownProperty(lower)) {
          push(LINT_CODES.unknownProperties, 'warning', `Unknown property: '${name}'`, spanAtOrContaining(node, nameStart, nameStart + name.length));
        }
      }

      if (colon >= 0) {
        const valueStart = colon + 1;
        const value = blankStrings(slice.slice(valueStart));
        const hexRe = /#([0-9a-fA-F]+)/g;
        let hm: RegExpExecArray | null;
        while ((hm = hexRe.exec(value)) !== null) {
          const digits = hm[1]!.length;
          if (digits !== 3 && digits !== 4 && digits !== 6 && digits !== 8) {
            const hexStart = start + valueStart + hm.index;
            push(LINT_CODES.hexColorLength, 'error', `Hex color '${hm[0]}' does not have 3, 4, 6 or 8 digits`, spanAtOrContaining(node, hexStart, hexStart + hm[0].length));
          }
        }

        const lowerName = name.toLowerCase();
        const important = firstChildNodeOf(node, 'Important');
        const absoluteValueStart = start + valueStart;
        const absoluteValueEnd = important ? absoluteStart(important) : end;
        if (language === 'css' && descriptor?.status === true) {
          const descriptorValueProblem = atRuleDescriptorValueProblem(source, node, descriptor.atRuleName, lowerName);
          if (descriptorValueProblem !== null) {
            push(
              LINT_CODES.unknownAtRuleDescriptorValues,
              'warning',
              `Unknown value "${descriptorValueProblem.value}" for descriptor "${descriptorValueProblem.descriptorName}" in @${descriptor.atRuleName}`,
              descriptorValueProblem.span
            );
          }
        }
        if (language === 'css' && descriptor?.status === undefined && name.length > 0 && !lowerName.startsWith('--')) {
          const propertyValue = declarationPropertyValue(source, node);
          if (propertyValue !== null && cssData.isKnownPropertyValue(lowerName, propertyValue.fact) === false) {
            push(
              LINT_CODES.unknownPropertyValues,
              'warning',
              `Unknown value "${propertyValue.fact.raw}" for property "${name}"`,
              propertyValue.span
            );
          }
        }
        if (language === 'css' && (lowerName === 'animation' || lowerName === 'animation-name')) {
          animationReferences.push(...animationNameReferences(source, node, name, absoluteValueStart, absoluteValueEnd));
        }
        const fontFamilyStart = lowerName === 'font-family'
          ? absoluteValueStart
          : lowerName === 'font'
            ? fontShorthandFamilyStart(source, absoluteValueStart, absoluteValueEnd)
            : null;

        if (language === 'css' && (lowerName === 'grid' || lowerName === 'grid-template' || lowerName === 'grid-template-areas')) {
          const rows = gridAreaRows(source, node);
          const emptyRow = rows.find(row => row.tokens.length === 0);
          if (emptyRow !== undefined) {
            push(
              LINT_CODES.invalidNamedGridAreas,
              'warning',
              'Expected cell token within string',
              emptyRow.span
            );
          } else if (rows.length > 0) {
            const expectedTokenCount = rows[0]!.tokens.length;
            const mismatchedRow = rows.find(row => row.tokens.length !== expectedTokenCount);
            if (mismatchedRow !== undefined) {
              push(
                LINT_CODES.invalidNamedGridAreas,
                'warning',
                'Expected same number of cell tokens in each string',
                mismatchedRow.span
              );
            } else {
              for (const name of invalidGridAreaNames(rows)) {
                const row = rows.find(areaRow => areaRow.tokens.includes(name));
                if (row !== undefined) {
                  push(
                    LINT_CODES.invalidNamedGridAreas,
                    'warning',
                    `Expected single filled-in rectangle for "${name}"`,
                    row.span
                  );
                }
              }
            }
          }
        }

        if (fontFamilyStart !== null && !nodeContext.inFontFaceAtRule) {
          const rawValue = source.slice(fontFamilyStart, absoluteValueEnd);
          const fontFamilies = splitFontFamilyValue(source, fontFamilyStart, absoluteValueEnd);
          const seenFontFamilies = new Map<string, FontFamilyPart>();
          for (const family of fontFamilies) {
            const previous = seenFontFamilies.get(family.normalized);
            if (previous !== undefined) {
              push(
                LINT_CODES.fontFamilyDuplicateNames,
                'warning',
                `Duplicate font family '${family.raw}'`,
                spanAtOrContaining(node, family.start, family.end)
              );
              continue;
            }
            seenFontFamilies.set(family.normalized, family);
          }
          const isCssWideOnly = fontFamilies.length === 1 && CSS_WIDE_KEYWORDS.has(fontFamilies[0]!.normalized);
          if (
            fontFamilies.length > 0
            && !isCssWideOnly
            && !containsDynamicFontValue(rawValue)
            && !fontFamilies.some(family => family.isGeneric)
          ) {
            push(
              LINT_CODES.fontFamilyMissingGeneric,
              'warning',
              'Add a generic font family keyword',
              node.span
            );
          }
        }
      }
    }

    if (KEYFRAMES_TYPES.has(gt)) {
      if (language === 'css') {
        const animationName = keyframesAnimationName(source, node);
        if (animationName !== null) {
          declaredAnimations.add(animationName);
        }
      }
      const seenSelectors = new Set<string>();
      for (const child of cstChildrenOf(node)) {
        if (!isCstNode(child) || !KEYFRAME_BLOCK_TYPES.has(child.grammarType)) {
          continue;
        }
        const selector = firstChildNodeOf(child, 'keyframeSelector');
        if (!selector) {
          continue;
        }
        for (const key of normalizedKeyframeSelectorKeys(source, selector)) {
          if (seenSelectors.has(key)) {
            push(
              LINT_CODES.keyframeDuplicateSelectors,
              'warning',
              `Duplicate keyframe selector '${source.slice(absoluteStart(selector), absoluteEnd(selector)).trim()}'`,
              selector.span
            );
            break;
          }
          seenSelectors.add(key);
        }
      }
    }

    const childContext: VisitContext = RULESET_TYPES.has(gt) || ATRULE_TYPES.has(gt)
      ? {
          ...nodeContext,
          selectorLists: new Map()
        }
      : nodeContext;
    const checkCssRulesetDeclarations = language === 'css' && RULESET_TYPES.has(gt) && !nodeContext.inKeyframeBlock;
    let seenProps: Map<string, string> | undefined;
    let seenCustomProps: Set<string> | undefined;
    let hasDisplayInlineBlock = false;
    let hasDisplayBlock = false;
    let nonNoneFloatDeclarations: CssCstNode[] | undefined;
    let verticalAlignDeclarations: CssCstNode[] | undefined;
    let boxModelFacts: BoxModelFacts | undefined;
    let previousDeclarationKey: string | undefined;
    for (const child of cstChildrenOf(node)) {
      if (!isCstNode(child)) {
        continue;
      }
      const childGrammarType = child.grammarType;
      if (DECLARATION_TYPES.has(childGrammarType)) {
        const childStart = absoluteStart(child);
        const childEnd = absoluteEnd(child);
        const childSource = source.slice(childStart, childEnd);
        const name = propNameOf(childSource);
        if (name.length > 0 && !name.includes('#{') && !name.includes('@{') && !name.includes('${')) {
          const key = name.toLowerCase();
          if (checkCssRulesetDeclarations) {
            boxModelFacts ??= createBoxModelFacts();
            applyBoxModelDeclaration(boxModelFacts, source, key, child);
            const keywordValue = staticDeclarationKeywordValue(source, child);
            if (key === 'display') {
              hasDisplayInlineBlock ||= keywordValue === 'inline-block';
              hasDisplayBlock ||= keywordValue === 'block';
            } else if (key === 'float') {
              if (keywordValue !== null && keywordValue !== 'none') {
                (nonNoneFloatDeclarations ??= []).push(child);
              }
            } else if (key === 'vertical-align') {
              (verticalAlignDeclarations ??= []).push(child);
            }
          }
          seenProps ??= new Map();
          if (seenProps.has(key)) {
            const qualifiers = previousDeclarationKey === key ? ['consecutive-duplicate'] : undefined;
            push(LINT_CODES.duplicateProperties, 'warning', `Duplicate property '${name}'`, child.span, qualifiers);
          }
          const prefix = vendorPrefixOfName(key);
          const overriddenProperties = SHORTHAND_OVERRIDE_PROPERTIES.get(unprefixedName(key));
          if (overriddenProperties !== undefined) {
            const nameStart = childStart + childSource.indexOf(name);
            const nameSpan = spanAtOrContaining(child, nameStart, nameStart + name.length);
            for (const longhand of overriddenProperties) {
              const overriddenName = seenProps.get(`${prefix}${longhand}`);
              if (overriddenName !== undefined) {
                push(
                  LINT_CODES.shorthandPropertyOverrides,
                  'warning',
                  `Overridden property "${overriddenName}" by shorthand "${name}"`,
                  nameSpan
                );
              }
            }
          }
          seenProps.set(key, name);
          previousDeclarationKey = key;
        } else {
          previousDeclarationKey = undefined;
        }
      } else if (CUSTOM_DECLARATION_TYPES.has(childGrammarType)) {
        previousDeclarationKey = undefined;
      } else if (RULESET_TYPES.has(childGrammarType) || ATRULE_TYPES.has(childGrammarType)) {
        previousDeclarationKey = undefined;
      }
      if (CUSTOM_DECLARATION_TYPES.has(childGrammarType)) {
        const childStart = absoluteStart(child);
        const childEnd = absoluteEnd(child);
        const name = propNameOf(source.slice(childStart, childEnd));
        if (isStaticCustomPropertyName(name)) {
          if (language === 'css') {
            declaredCustomProperties.add(name);
          }
          seenCustomProps ??= new Set();
          if (seenCustomProps.has(name)) {
            push(LINT_CODES.duplicateCustomProperties, 'warning', `Duplicate custom property "${name}"`, child.span);
          } else {
            seenCustomProps.add(name);
          }
        }
      }
      visit(child, childContext);
    }
    if (checkCssRulesetDeclarations) {
      if (boxModelFacts !== undefined && !boxModelFacts.hasBoxSizing) {
        const widthProblems = [...boxModelFacts.left, ...boxModelFacts.right];
        if (boxModelFacts.width !== null && widthProblems.length > 0) {
          const warned = new Set<CssCstNode>();
          for (const declaration of [boxModelFacts.width, ...widthProblems]) {
            if (warned.has(declaration)) {
              continue;
            }
            warned.add(declaration);
            push(
              LINT_CODES.boxModel,
              'warning',
              'Width with horizontal padding or border can make the box wider than expected',
              declaration.span
            );
          }
        }
        const heightProblems = [...boxModelFacts.top, ...boxModelFacts.bottom];
        if (boxModelFacts.height !== null && heightProblems.length > 0) {
          const warned = new Set<CssCstNode>();
          for (const declaration of [boxModelFacts.height, ...heightProblems]) {
            if (warned.has(declaration)) {
              continue;
            }
            warned.add(declaration);
            push(
              LINT_CODES.boxModel,
              'warning',
              'Height with vertical padding or border can make the box taller than expected',
              declaration.span
            );
          }
        }
      }
      if (hasDisplayInlineBlock) {
        for (const declaration of nonNoneFloatDeclarations ?? []) {
          push(
            LINT_CODES.propertyIgnoredDueToDisplay,
            'warning',
            'With display: inline-block, float changes display to block',
            declaration.span
          );
        }
      }
      for (const declaration of nonNoneFloatDeclarations ?? []) {
        push(
          LINT_CODES.float,
          'warning',
          'Avoid using float for layout',
          declaration.span
        );
      }
      if (hasDisplayBlock) {
        for (const declaration of verticalAlignDeclarations ?? []) {
          push(
            LINT_CODES.propertyIgnoredDueToDisplay,
            'warning',
            'With display: block, vertical-align has no effect',
            declaration.span
          );
        }
      }
    }
  };

  visit(root, {
    ...ROOT_VISIT_CONTEXT_BASE,
    selectorLists: new Map()
  });

  for (const animation of animationReferences) {
    if (!declaredAnimations.has(animation.name)) {
      push(
        LINT_CODES.unknownAnimations,
        'warning',
        `Unknown animation "${animation.name}"`,
        animation.span
      );
    }
  }

  if (language === 'css') {
    for (const reference of customPropertyReferences) {
      if (!declaredCustomProperties.has(reference.name)) {
        push(
          LINT_CODES.unknownCustomProperties,
          'warning',
          `Unknown custom property "${reference.name}"`,
          reference.span
        );
      }
    }
  }

  if (language !== 'css') {
    for (const declaration of variableDeclarations) {
      if (!variableReferences.has(declaration.name)) {
        push(
          LINT_CODES.unusedVariables,
          'warning',
          `Unused variable "${declaration.display}"`,
          declaration.span
        );
      }
    }

    if (!hasExternalSelectorSources) {
      for (const target of exactExtendTargets) {
        if (!ruleSelectorKeys.has(target.key)) {
          push(
            LINT_CODES.deadExtends,
            'warning',
            `Extend target "${target.display}" does not match any same-file selector`,
            target.span
          );
        }
      }
    }
  }

  if (tolerantSourceScan) {
    if (language === 'css') {
      for (const span of invalidImportPositionSpans(source)) {
        push(
          LINT_CODES.invalidImportPosition,
          'warning',
          'Invalid position for @import rule',
          span
        );
      }
    }

    const sourceForHexScan = blankStringsAndComments(source);
    const sourceHexRe = /#([0-9a-fA-F]+)/g;
    let match: RegExpExecArray | null;
    while ((match = sourceHexRe.exec(sourceForHexScan)) !== null) {
      const digits = match[1]!.length;
      if (digits !== 3 && digits !== 4 && digits !== 6 && digits !== 8 && isDeclarationValueContext(sourceForHexScan, match.index)) {
        push(
          LINT_CODES.hexColorLength,
          'error',
          `Hex color '${match[0]}' does not have 3, 4, 6 or 8 digits`,
          spanFromOffsets(match.index, match.index + match[0].length)
        );
      }
    }
  }

  return out;
}

export function collectTolerantDiagnostics(input: CollectDiagnosticsInput): CollectDiagnosticsResult {
  const result = parseResultForLanguage(input.source, input.language);
  const needsTolerantSourceScan = result.errors.length > 0 || result.unconsumedFrom !== null || !result.ok;
  const lintDiagnostics = result.tree
    ? cstLintDiagnostics(
        result.tree,
        input.source,
        input.language,
        input.metadata,
        input.filePath,
        needsTolerantSourceScan
      )
    : [];
  return {
    diagnostics: [
      ...parseDiagnosticsForDoc(result, input.filePath),
      ...lintDiagnostics
    ]
  };
}
