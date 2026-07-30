import { run, parseDoc, cstBuildHost as parsemanCstBuildHost, type BuildHost, type ParseDoc, type ParseError, type Registry, type Runnable, type Span } from 'parseman';

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
  readonly rules: CssCstChild[];
  readonly state: unknown;
};

export type CssCstNode = {
  readonly _tag: 'node';
  readonly type: CssCstType;
  readonly grammarType: string;
  readonly span: Span;
  readonly state: unknown;
  readonly rules: CssCstChild[];
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

type BuildHostArgs = Parameters<BuildHost>;

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
  Percentage: 'Percentage',
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
  /*
   * Grammar node names are already public PascalCase identifiers. Exceptional
   * names live in the explicit contract table above; do not run a second
   * handwritten recognizer over a grammar name at CST construction time.
   */
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

function isCssCstLeaf(value: unknown): value is CssCstLeaf {
  return typeof value === 'object'
    && value !== null
    && (value as { _tag?: string })._tag === 'leaf'
    && typeof (value as { value?: unknown }).value === 'string';
}

function numericGrammarType(rawChildren: readonly unknown[]): 'Percentage' | 'Dimension' | 'Num' {
  const leaves = rawChildren.filter(isCssCstLeaf);
  const suffix = leaves[1]?.value;
  if (suffix === '%') {
    return 'Percentage';
  }
  return suffix === undefined ? 'Num' : 'Dimension';
}

function hasNodeChild(rawChildren: readonly unknown[], grammarType: string): boolean {
  return rawChildren.some(child => isCssCstChild(child) && child._tag === 'node' && child.grammarType === grammarType);
}

function publicGrammarType(grammarType: string, rawChildren: readonly unknown[]): string {
  if (grammarType === 'Numeric' || grammarType === 'Dimension') {
    return numericGrammarType(rawChildren);
  }
  if (grammarType === 'Declaration' && hasNodeChild(rawChildren, 'CustomProperty')) {
    return 'CustomDeclaration';
  }
  if (grammarType === 'ConditionalBlock' || grammarType === 'NestedConditionalBlock') {
    return 'QueryAtRuleBlock';
  }
  if (grammarType === 'LayerStatement') {
    return 'AtRuleStatement';
  }
  if (grammarType === 'TopLevelRuleset') {
    return 'Ruleset';
  }
  if (grammarType === 'TopLevelSelectorList') {
    return 'SelectorList';
  }
  if (grammarType === 'PunctuationValue' || grammarType === 'NonIdentifierPunctuationValue') {
    return 'DeclarationAny';
  }
  if (grammarType === 'ParenValue') {
    return 'DeclarationParen';
  }
  if (grammarType === 'RawParenValue') {
    return 'DeclarationRawParen';
  }
  if (grammarType === 'TopLevelComplexSelector') {
    return 'ComplexSelector';
  }
  if (grammarType === 'TopLevelCompoundSelector') {
    return 'CompoundSelector';
  }
  if (grammarType === 'ContainerPrelude') {
    return 'QueryPrelude';
  }
  if (grammarType === 'ContainerQueryPrelude') {
    return 'QueryPrelude';
  }
  if (grammarType === 'ContainerQueryClause') {
    return 'QueryClause';
  }
  return grammarType;
}

function shiftedSpan(span: Span, start: number, columnDelta: number): Span {
  return {
    ...span,
    start,
    ...(span.startColumn === undefined ? {} : { startColumn: span.startColumn + columnDelta })
  };
}

function joinedSpan(first: Span, second: Span): Span {
  return {
    ...first,
    end: second.end,
    ...(second.endLine === undefined ? {} : { endLine: second.endLine }),
    ...(second.endColumn === undefined ? {} : { endColumn: second.endColumn })
  };
}

function shiftedLeaf(leaf: CssCstLeaf, value: string, start: number): CssCstLeaf {
  return {
    _tag: 'leaf',
    value,
    span: shiftedSpan(leaf.span, start, 1)
  };
}

function publicChildren(grammarType: string, rawChildren: readonly unknown[]): CssCstChild[] {
  const children = rawChildren.filter(isCssCstChild);
  if (grammarType === 'Quoted') {
    const first = children[0];
    if (first?._tag === 'leaf' && first.value.startsWith('~')) {
      return [
        shiftedLeaf(
          first,
          first.value.slice(1),
          first.span.start + 1
        ),
        ...children.slice(1)
      ];
    }
  }
  if (grammarType === 'Url') {
    const first = children[0];
    const second = children[1];
    if (first?._tag === 'leaf' && second?._tag === 'leaf' && second.value === '(') {
      return [
        {
          _tag: 'leaf',
          value: `${first.value}(`,
          span: joinedSpan(first.span, second.span)
        },
        ...children.slice(2)
      ];
    }
  }
  return children;
}

function publicSpan(grammarType: string, span: Span, rawChildren: readonly unknown[]): Span {
  if (grammarType === 'Quoted') {
    const first = rawChildren.find(isCssCstLeaf);
    if (first?.value.startsWith('~')) {
      return shiftedSpan(span, span.start + 1, 1);
    }
  }
  return span;
}

function buildCssCstNode(args: BuildHostArgs): CssCstNode {
  const [grammarType, , , span, rawChildren, , state] = args;

  /*
   * The unified `Numeric` value-position recognizer surfaces in the CST-public
   * shape as the split rules do: Percentage for a `%` suffix, Dimension for an
   * identifier unit, otherwise Num. Keeps CST type/grammarType stable while the
   * grammar owns one shared numeric language.
   */
  const type = publicGrammarType(
    grammarType,
    rawChildren
  );
  const rules = publicChildren(
    grammarType,
    rawChildren
  );
  return {
    _tag: 'node',
    type: publicTypeName(type),
    grammarType: type,
    span: publicSpan(
      grammarType,
      span,
      rawChildren
    ),
    state: state ?? null,
    rules,
    children: rules
  };
}

export const cssCstBuildHost: BuildHost = Object.assign(
  (...args: BuildHostArgs) => buildCssCstNode(args),
  parsemanCstBuildHost()
);

function emptyStyleSheet(): CssCstNode {
  return {
    _tag: 'node',
    type: 'StyleSheet',
    grammarType: 'Stylesheet',
    span: { start: 0, end: 0 },
    state: null,
    rules: [],
    children: []
  };
}

function cssCstBuildHostFor(options: CssCstParseOptions): BuildHost {
  if (!options.collapse) {
    return cssCstBuildHost;
  }
  return Object.assign(
    (...args: BuildHostArgs) => cssCstBuildHost(...args),
    parsemanCstBuildHost({
      collapse: (grammarType: string) => COLLAPSIBLE_GRAMMAR_TYPES.has(grammarType)
    })
  );
}

export function parseCst(
  grammar: Record<string, unknown>,
  input: string,
  startRule = 'Stylesheet',
  options: CssCstParseOptions = {}
): CssCstParseResult {
  const result = run(
    rule(
      grammar,
      startRule
    ),
    input,
    {
      build: cssCstBuildHostFor(options),
      trivia: rule(
        grammar,
        'rw'
      )
    }
  );
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
 * {@link cssCstBuildHost} the one-shot `parseCst` uses, so `doc.tree` is
 * structurally identical to `parseCst(...).tree` for the same input.
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
  return parseDoc<CssCstNode>(
    /* eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion */
    grammar as unknown as Registry<CssCstNode>,
    startRule,
    input,
    {
      build: cssCstBuildHost,
      structuralReuse: true
    }
  );
}

export type { ParseDoc } from 'parseman';
