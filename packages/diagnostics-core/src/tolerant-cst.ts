import { parseCssDiagnosticCst, parseCssDiagnosticDoc, type CssCstChild, type CssCstNode, type CssCstParseResult, type ParseDoc } from '@jesscss/css-parser';
import { parseJessDiagnosticCst, parseJessDiagnosticDoc } from '@jesscss/jess-parser/cst';
import { parseLessDiagnosticCst, parseLessDiagnosticDoc } from '@jesscss/less-parser/cst';
import { parseScssDiagnosticCst, parseScssDiagnosticDoc } from '@jesscss/scss-parser/cst';
import { defaultCssDiagnosticMetadata } from './metadata.js';
import type {
  CollectDiagnosticsInput,
  CollectDiagnosticsResult,
  CssDiagnosticMetadata,
  CssMediaFeatureValueFact,
  DiagnosticSeverityName,
  JessLanguage,
  SourceDiagnostic
} from './types.js';

export const LINT_CODES = {
  emptyRules: 'lint/empty-rules',
  unknownProperties: 'lint/unknown-property',
  unknownAtRules: 'lint/unknown-at-rule',
  unknownAtRuleDescriptors: 'lint/at-rule-descriptor-no-unknown',
  duplicateProperties: 'lint/duplicate-property',
  shorthandPropertyOverrides: 'lint/declaration-block-no-shorthand-property-overrides',
  duplicateCustomProperties: 'lint/declaration-block-no-duplicate-custom-properties',
  hexColorLength: 'lint/hex-color-length',
  zeroUnits: 'lint/zero-units',
  customPropertyMissingVarFunction: 'lint/custom-property-no-missing-var-function',
  keyframeDuplicateSelectors: 'lint/keyframe-block-no-duplicate-selectors',
  keyframeDeclarationNoImportant: 'lint/keyframe-declaration-no-important',
  declarationNoImportant: 'lint/declaration-no-important',
  invalidNamedGridAreas: 'lint/named-grid-areas-no-invalid',
  fontFamilyDuplicateNames: 'lint/font-family-no-duplicate-names',
  fontFamilyMissingGeneric: 'lint/font-family-no-missing-generic-family-keyword',
  invalidImportPosition: 'lint/no-invalid-position-at-import-rule',
  duplicateAtImportRules: 'lint/no-duplicate-at-import-rules',
  unknownUnits: 'lint/unit-no-unknown',
  unknownFunctions: 'lint/function-no-unknown',
  unknownMediaFeatureNames: 'lint/media-feature-name-no-unknown',
  unknownMediaFeatureValues: 'lint/media-feature-name-value-no-unknown',
  unknownPseudoClasses: 'lint/selector-pseudo-class-no-unknown',
  unknownPseudoElements: 'lint/selector-pseudo-element-no-unknown',
  unknownTypeSelectors: 'lint/selector-type-no-unknown',
  unmatchableAnbSelectors: 'lint/selector-anb-no-unmatchable',
  duplicateSelectors: 'lint/no-duplicate-selectors',
  incompatibleMathFunctionUnits: 'lint/incompatible-math-function-units',
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
const MATH_FUNCTION_NAMES = new Set(['min', 'max', 'clamp']);
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
  ['border-bottom', new Set(['border-bottom-color', 'border-bottom-style', 'border-bottom-width'])],
  ['border-color', new Set(['border-bottom-color', 'border-left-color', 'border-right-color', 'border-top-color'])],
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
  ['grid', new Set([
    'grid-auto-columns', 'grid-auto-flow', 'grid-auto-rows',
    'grid-template', 'grid-template-areas', 'grid-template-columns', 'grid-template-rows'
  ])],
  ['grid-template', new Set(['grid-template-areas', 'grid-template-columns', 'grid-template-rows'])],
  ['inset', new Set(['bottom', 'left', 'right', 'top'])],
  ['inset-block', new Set(['inset-block-end', 'inset-block-start'])],
  ['inset-inline', new Set(['inset-inline-end', 'inset-inline-start'])],
  ['list-style', new Set(['list-style-image', 'list-style-position', 'list-style-type'])],
  ['margin', new Set(['margin-bottom', 'margin-left', 'margin-right', 'margin-top'])],
  ['outline', new Set(['outline-color', 'outline-style', 'outline-width'])],
  ['padding', new Set(['padding-bottom', 'padding-left', 'padding-right', 'padding-top'])],
  ['place-content', new Set(['align-content', 'justify-content'])],
  ['place-items', new Set(['align-items', 'justify-items'])],
  ['place-self', new Set(['align-self', 'justify-self'])],
  ['scroll-margin', new Set(['scroll-margin-bottom', 'scroll-margin-left', 'scroll-margin-right', 'scroll-margin-top'])],
  ['scroll-padding', new Set(['scroll-padding-bottom', 'scroll-padding-left', 'scroll-padding-right', 'scroll-padding-top'])],
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
  'NestedRulesetWithExtends',
  'DirectScssRule',
  'DirectJessRule'
]);
const ATRULE_TYPES = new Set([
  'AtRuleBlock',
  'AtRuleStatement',
  'UnknownAtRuleBlock',
  'QueryAtRuleBlock',
  'OpaqueAtRuleBlock'
]);
const DECLARATION_TYPES = new Set(['Declaration', 'DirectScssDeclaration', 'DirectJessDeclaration']);
const CUSTOM_DECLARATION_TYPES = new Set(['CustomDeclaration']);
const DIMENSION_TYPES = new Set(['Dimension', 'DirectScssDimension', 'DirectJessDimension']);
const PERCENTAGE_TYPES = new Set(['Percentage']);
const CUSTOM_PROPERTY_VALUE_TYPES = new Set(['CustomPropertyValue']);
const KEYFRAMES_TYPES = new Set(['Keyframes']);
const KEYFRAME_BLOCK_TYPES = new Set(['KeyframeBlock']);
const IMPORTANT_TYPES = new Set(['Important', 'ImportantValue']);
const IMPORT_RULE_TYPES = new Set(['ImportStatement', 'ImportAtRule', 'StaticImportRule']);
const FUNCTION_TYPES = new Set(['Call', 'StaticCall', 'VarCall', 'FunctionCall', 'ImportTailFunction']);
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

type SelectorSeen = {
  readonly line: number;
};

type SelectorBranchFact = {
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

function forwardPreludeOf(node: CssCstNode, src: string): string | null {
  let afterPath = false;
  for (const child of cstChildrenOf(node)) {
    if (isCstNode(child)) {
      if (child.grammarType === 'Quoted' || child.grammarType === 'StaticQuoted') {
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
    if (child.grammarType === 'Quoted' || child.grammarType === 'StaticQuoted') {
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
  filePath?: string
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
    endColumn: span.endColumn
  };
}

function spanFromOffsets(start: number, end: number): DiagnosticSpan {
  return { start, end: Math.max(start, end) };
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
  const cssData = metadataWithDefaults(metadata);
  const dialectAtRules = DIALECT_AT_RULES[language];
  const push = (
    code: string,
    severity: DiagnosticSeverityName,
    message: string,
    span: DiagnosticSpan
  ) => {
    const start = Number(span.start);
    const end = Number(span.end);
    const key = `${code}:${start}:${Math.max(start, end)}:${message}`;
    if (emitted.has(key)) {
      return;
    }
    emitted.add(key);
    out.push(diagnostic(code, severity, message, span, filePath));
  };

  const visit = (node: CssCstNode, context: VisitContext) => {
    const start = absoluteStart(node);
    const end = absoluteEnd(node);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      return;
    }
    const gt = node.grammarType;
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
      const open = source.indexOf('{', start);
      const close = source.lastIndexOf('}', end - 1);
      if (open >= start && close > open && isWhitespaceOnly(source, open + 1, close)) {
        push(LINT_CODES.emptyRules, 'warning', 'Do not use empty rulesets', node.span);
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
    let seenProps: Map<string, string> | undefined;
    let seenCustomProps: Set<string> | undefined;
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
          seenProps ??= new Map();
          if (seenProps.has(key)) {
            push(LINT_CODES.duplicateProperties, 'warning', `Duplicate property '${name}'`, child.span);
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
        }
      }
      if (CUSTOM_DECLARATION_TYPES.has(childGrammarType)) {
        const childStart = absoluteStart(child);
        const childEnd = absoluteEnd(child);
        const name = propNameOf(source.slice(childStart, childEnd));
        if (name.startsWith('--') && !name.includes('#{') && !name.includes('@{') && !name.includes('${')) {
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
  };

  visit(root, {
    ...ROOT_VISIT_CONTEXT_BASE,
    selectorLists: new Map()
  });

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
