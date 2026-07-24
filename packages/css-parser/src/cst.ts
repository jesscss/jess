import { run, parseDoc, type BuildHost, type FieldMap, type ParseDoc, type ParseError, type Registry, type Runnable, type Span } from 'parseman';

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

function publicTypeName(grammarType: string): CssCstType {
  // Grammar node names are already public PascalCase identifiers. Exceptional
  // names live in the explicit contract table above; do not run a second
  // handwritten recognizer over a grammar name at CST construction time.
  return TYPE_NAMES[grammarType] ?? grammarType;
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
  _children: ReadonlyArray<unknown> | undefined,
  _fields: FieldMap | undefined,
  span: Span,
  rawChildren: ReadonlyArray<unknown>,
  _triviaLog: readonly number[],
  state: unknown
): CssCstNode => {
  // The unified `numeric` rule (noTrivia numPart + optional unit) surfaces in the
  // CST-public shape as the split rules did: a Dimension when the unit leaf is
  // present (2 leaves), otherwise a bare Num. Keeps CST type/grammarType stable.
  const type = grammarType === 'Numeric'
    ? (rawChildren.length > 1 ? 'Dimension' : 'Num')
    : grammarType;
  return {
    _tag: 'node',
    type: publicTypeName(type),
    grammarType: type,
    span: { start: span.start, end: span.end },
    state: state ?? null,
    children: rawChildren.filter(isCssCstChild)
  };
};

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
      children: ReadonlyArray<unknown> | undefined,
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

/**
 * Incremental-document counterpart of {@link parseCst}: parse `input` from
 * `startRule` into a parseman `ParseDoc` that can be re-parsed in place with
 * `.edit(from, to, replacement)`. The tree is built with the same
 * {@link cssCstBuildHost} the one-shot `parseCst` uses, so `absolutizeCST(doc.tree)`
 * is structurally identical to `parseCst(...).tree` for the same input (the doc's
 * own spans are PARENT-RELATIVE — absolutize before comparing).
 *
 * `structuralReuse` is enabled: the CST list rules are genuine repetitions
 * (`many`/`sepBy`), so a whole-element insert/delete near the top of a large
 * stylesheet reparses only the disturbed span and shares the untouched tail by
 * identity. Every splice is still grammar-verified and falls back to a full,
 * correct reparse when reuse can't be proven — so the result always matches a
 * from-scratch parse.
 */
export function parseDocCst(
  grammar: Record<string, unknown>,
  input: string,
  startRule = 'Stylesheet'
): ParseDoc<CssCstNode> {
  /* eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion */
  return parseDoc<CssCstNode>(grammar as unknown as Registry<CssCstNode>, startRule, input, {
    build: cssCstBuildHost,
    structuralReuse: true
  });
}

export type { ParseDoc } from 'parseman';
