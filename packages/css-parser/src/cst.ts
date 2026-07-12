import { run, type BuildHost, type FieldMap, type ParseError, type Runnable, type Span } from 'parseman';

export type CssCstType = string;

export type CssCstLeaf = {
  readonly _tag: 'leaf';
  readonly value: string;
  readonly span: Span;
};

export type CssCstError = {
  readonly _tag: 'error';
  readonly type: string;
  readonly span: Span;
  readonly expected: string[];
  readonly children: CssCstChild[];
  readonly state: unknown;
};

export type CssCstNode = {
  readonly _tag: 'node';
  readonly type: CssCstType;
  readonly grammarType: string;
  readonly span: Span;
  readonly state: unknown;
  readonly children: CssCstChild[];
};

export type CssCstChild = CssCstNode | CssCstLeaf | CssCstError;

export type CssCstParseResult = {
  readonly ok: boolean;
  readonly tree: CssCstNode;
  readonly span: Span;
  readonly expected: string[];
  readonly errors: ParseError[];
  readonly triviaLog: number[];
  readonly unconsumedFrom: number | null;
};

export type CssCstParseOptions = {
  readonly collapse?: boolean;
};

const TYPE_NAMES: Record<string, CssCstType> = {
  Stylesheet: 'StyleSheet',
  Ruleset: 'QualifiedRule',
  AtRuleBlock: 'AtRule',
  AtRuleStatement: 'AtRule',
  UnknownAtRuleBlock: 'AtRule',
  QueryAtRuleBlock: 'QueryAtRule',
  Declaration: 'Declaration',
  CustomDeclaration: 'Declaration',
  BasicSelector: 'BasicSelector',
  SelectorList: 'SelectorList',
  ComplexSelector: 'ComplexSelector',
  CompoundSelector: 'CompoundSelector',
  AttributeSelector: 'AttributeSelector',
  PseudoSelector: 'PseudoSelector',
  Dimension: 'Dimension',
  Num: 'Number',
  Color: 'Color',
  Url: 'Url',
  Call: 'Function',
  Operation: 'Operation',
  Paren: 'SimpleBlock',
  Quoted: 'String',
  QueryCondition: 'QueryCondition',
  QueryInParens: 'QueryInParens',
  QueryFeature: 'QueryFeature'
};

const COLLAPSIBLE_GRAMMAR_TYPES = new Set([
  'Reference',
  'NamedColor',
  'InterpolatedSelector'
]);

function pascalCaseRuleName(type: string): string {
  return type
    .replace(/(^|[^a-zA-Z0-9]+)([a-zA-Z0-9])/g, (_, _sep: string, char: string) => char.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, '');
}

function publicTypeName(grammarType: string): CssCstType {
  return TYPE_NAMES[grammarType] ?? pascalCaseRuleName(grammarType);
}

function isRunnable(value: unknown): value is Runnable {
  return typeof value === 'function'
    || (typeof value === 'object' && value !== null && typeof (value as { parse?: unknown }).parse === 'function');
}

function rule(grammar: Record<string, unknown>, name: string): Runnable {
  const value = grammar[name];
  if (!isRunnable(value)) {
    throw new TypeError(`Grammar rule "${name}" is not runnable`);
  }
  return value;
}

function isCssCstChild(value: unknown): value is CssCstChild {
  return typeof value === 'object'
    && value !== null
    && ((value as { _tag?: string })._tag === 'node'
      || (value as { _tag?: string })._tag === 'leaf'
      || (value as { _tag?: string })._tag === 'error');
}

export const cssCstBuildHost: BuildHost = (
  grammarType: string,
  _children: ReadonlyArray<unknown>,
  _fields: FieldMap | undefined,
  span: Span,
  rawChildren: ReadonlyArray<unknown>,
  _triviaLog: readonly number[],
  state: unknown
): CssCstNode => ({
  _tag: 'node',
  type: publicTypeName(grammarType),
  grammarType,
  span: { start: span.start, end: span.end },
  state: state ?? null,
  children: rawChildren.filter(isCssCstChild)
});

function emptyStyleSheet(): CssCstNode {
  return {
    _tag: 'node',
    type: 'StyleSheet',
    grammarType: 'Stylesheet',
    span: { start: 0, end: 0 },
    state: null,
    children: []
  };
}

function cssCstBuildHostFor(options: CssCstParseOptions): BuildHost {
  if (!options.collapse) {
    return cssCstBuildHost;
  }
  return Object.assign(
    (
      grammarType: string,
      children: ReadonlyArray<unknown>,
      fields: FieldMap | undefined,
      span: Span,
      rawChildren: ReadonlyArray<unknown>,
      triviaLog: readonly number[],
      state: unknown
    ) => cssCstBuildHost(grammarType, children, fields, span, rawChildren, triviaLog, state),
    {
      _parsemanCstCollapse: (grammarType: string) => COLLAPSIBLE_GRAMMAR_TYPES.has(grammarType)
    }
  );
}

export function parseCst(
  grammar: Record<string, unknown>,
  input: string,
  startRule = 'Stylesheet',
  options: CssCstParseOptions = {}
): CssCstParseResult {
  const result = run(rule(grammar, startRule), input, {
    build: cssCstBuildHostFor(options),
    trivia: rule(grammar, 'rw')
  });
  const tree = isCssCstChild(result.value) && result.value._tag === 'node'
    ? result.value
    : emptyStyleSheet();
  return {
    ok: result.ok,
    tree,
    span: result.span,
    expected: result.expected,
    errors: result.errors,
    triviaLog: result.triviaLog,
    unconsumedFrom: result.unconsumedFrom
  };
}
