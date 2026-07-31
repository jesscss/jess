import { run, parseDoc, cstBuildHost as parsemanCstBuildHost, type BuildHost, type ParseDoc, type ParseError, type Registry, type RootTriviaCapture, type Runnable, type Span } from 'parseman';
import { commentTriviaLabels } from './trivia-labels.js';

export { commentTriviaLabels } from './trivia-labels.js';

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
  readonly tags?: readonly string[];
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

  /* Selected root trivia, absent when the parse retained none. */
  readonly rootTrivia?: RootTriviaCapture;
  readonly unconsumedFrom: number | null;
};

export type CssCstParseOptions = {
  readonly collapse?: boolean;
  readonly trackLines?: boolean;
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

function startsWithDigit(value: string): boolean {
  const first = value[0];
  return first !== undefined && first >= '0' && first <= '9';
}

function selectorGrammarType(rawChildren: readonly unknown[]): 'BasicSelector' | 'ClassSelector' | 'IdSelector' | 'TypeSelector' | 'UniversalSelector' {
  const first = rawChildren.find(isCssCstLeaf)?.value;
  if (first?.startsWith('.') === true) {
    return 'ClassSelector';
  }
  if (first?.startsWith('#') === true) {
    return 'IdSelector';
  }
  if (first === '*') {
    return 'UniversalSelector';
  }
  return first !== undefined && startsWithDigit(first) ? 'BasicSelector' : 'TypeSelector';
}

function mergeTags(tags: readonly string[] | undefined, tag: string): readonly string[] {
  if (tags === undefined || tags.length === 0) {
    return [tag];
  }
  return tags.includes(tag) ? tags : [...tags, tag];
}

function hasNodeChild(rawChildren: readonly unknown[], grammarType: string): boolean {
  return rawChildren.some(child => isCssCstChild(child) && child._tag === 'node' && child.grammarType === grammarType);
}

function publicGrammarType(grammarType: string, rawChildren: readonly unknown[]): string {
  if (grammarType === 'Numeric' || grammarType === 'Dimension') {
    return numericGrammarType(rawChildren);
  }
  if (grammarType === 'BasicSelector') {
    return selectorGrammarType(rawChildren);
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
  return grammarType;
}

/*
 * A `Span` is either fully lined (start/end plus all four line/column fields) or
 * bare (start/end). No parseman producer writes a subset, so branching on
 * `startColumn` cannot drop a field that a partial span was carrying.
 *
 * Note what is NOT true: line-ness is not uniform within a parse. A line-tracked
 * benchmark.css realizes ~67.6k lined spans AND ~3.7k bare ones, because raw and
 * scan leaf captures (Property, the Quoted string body, UrlUnquoted, Important,
 * …) emit bare spans even in diagnostic mode. So "the whole parse is lined"
 * would be the wrong justification.
 *
 * What makes `joinedSpan` safe is its CALLER, not the mode: its only call site
 * is the `Url` branch of `publicChildren`, which joins the two leaves of
 * `urlOpen = noTrivia(sequence(identWord('url'), literal('(')))`. Both are
 * literal/word captures, so they always share a family — the mixed join, where
 * `first` is bare and `second` lined, is not reachable. If `publicChildren` ever
 * joins two spans from different capture kinds, revisit this. `shiftedSpan`
 * takes ONE span and so cannot mix by construction.
 *
 * Both builders below take the same treatment as `buildCssCstNode`: explicit
 * arms rather than `...span` plus a conditional spread. Same three reasons —
 * a spread drops the literal off V8's object-literal fast path onto a generic
 * copy-properties runtime call, allocates a throwaway `{}` per conditional arm,
 * and (uniquely here) could mint span shapes matching NEITHER input family. The
 * old `joinedSpan` spread `...first` and then conditionally added `endLine` and
 * `endColumn` from `second` INDEPENDENTLY, so a lineless `first` joined with a
 * lined `second` produced `{start,end,endLine,endColumn}` — a shape no other
 * site in the parser ever builds — for up to 4 shapes from one construction
 * site. Field order in every arm is the canonical `Span` declaration order.
 */
function shiftedSpan(span: Span, start: number, columnDelta: number): Span {
  if (span.startColumn === undefined) {
    return { start, end: span.end };
  }
  return {
    start,
    end: span.end,
    startLine: span.startLine,
    startColumn: span.startColumn + columnDelta,
    endLine: span.endLine,
    endColumn: span.endColumn
  };
}

function joinedSpan(first: Span, second: Span): Span {
  if (first.startColumn === undefined) {
    return { start: first.start, end: second.end };
  }
  return {
    start: first.start,
    end: second.end,
    startLine: first.startLine,
    startColumn: first.startColumn,
    endLine: second.endLine,
    endColumn: second.endColumn
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
  const [grammarType, , , span, rawChildren, , state, tags] = args;

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
  const publicTags = type === 'ClassSelector'
    || type === 'IdSelector'
    || type === 'TypeSelector'
    || type === 'UniversalSelector'
    || type === 'BasicSelector'
    ? mergeTags(tags, 'Selector')
    : tags;
  const typeName = publicTypeName(type);
  const nodeSpan = publicSpan(
    grammarType,
    span,
    rawChildren
  );
  const nodeState = state ?? null;

  /*
   * Two explicit branches, not one literal with a conditional `tags` spread.
   * Both spellings realize the SAME two hidden classes (measured with
   * `%HaveSameMap`, not assumed), so this is NOT a node-shape fix — it is a
   * construction-path one: a conditional spread drops the literal off V8's
   * object-literal fast path onto a generic copy-properties runtime call, and
   * allocates a throwaway `{}`/`{ tags }` per node to do it. Every dialect pays
   * it, because less/scss/jess all route their CST through here.
   *
   * Measured on benchmark.css (CPU time, 3 interleaved pairs, 30 samples):
   * ~2x at the floor and ~1.3-1.6x at loaded quantiles — the upper quantiles
   * compress because contention adds a roughly constant cost to both lanes.
   * Quote the range, not a single number. Harness:
   * `packages/core/perf/node-representation-bench.mjs` (spread vs branch at
   * equal hidden-class count) and `cst-spread-ab-*` (real-parse A/B).
   *
   * Field order is deliberately identical to the spread it replaces, and both
   * arms must stay identical: adding a field to only one arm, or in a different
   * position, silently mints a third hidden class. `cst-shape-digest.mjs`
   * catches exactly that.
   */
  if (publicTags === undefined || publicTags.length === 0) {
    return {
      _tag: 'node',
      type: typeName,
      grammarType: type,
      span: nodeSpan,
      state: nodeState,
      rules,
      children: rules
    };
  }
  return {
    _tag: 'node',
    type: typeName,
    grammarType: type,
    tags: publicTags,
    span: nodeSpan,
    state: nodeState,
    rules,
    children: rules
  };
}

export const cssCstBuildHost: BuildHost = Object.assign(
  (...args: BuildHostArgs) => buildCssCstNode(args),
  parsemanCstBuildHost({ tags: true })
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
      collapse: (grammarType: string) => COLLAPSIBLE_GRAMMAR_TYPES.has(grammarType),
      tags: true
    })
  );
}

/*
 * `select` names the grammar's own comment trivia arms. Parseman validates it
 * against the entry grammar's label table and throws on a name that grammar
 * never declares, so it belongs to the composing dialect, not to a caller's
 * options.
 */
export function parseCst(
  grammar: Record<string, unknown>,
  input: string,
  startRule = 'Stylesheet',
  options: CssCstParseOptions = {},
  select: readonly string[] = commentTriviaLabels
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
      ),
      rootTrivia: { select }
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
    rootTrivia: result.rootTrivia,
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
