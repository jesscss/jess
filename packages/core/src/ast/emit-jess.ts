/**
 * `.jess` SOURCE printer: a PARSED `Stylesheet` in, `.jess` source text out.
 *
 * It evaluates nothing and shares no traversal with `serialize()`. `serialize()`
 * fuses eval with CSS emit; a source printer needs neither — it walks the parsed
 * tree once and writes the spelling the `.jess` grammar reads back as the same
 * node. That is the whole contract, and the round trip is its test:
 * `parse(emitJess(parse(src)))` equals `parse(src)` for `.jess` input.
 *
 * WHERE EACH SPELLING COMES FROM. Every arm below is the inverse of a production
 * in `packages/syntax/jess/jess-parser/src/grammar.ts` (the rule named in the arm's
 * comment). Leaf bytes (`src` of keywords, dimensions, colors, quoted strings,
 * opaque `Any`) are the parser's own verbatim spelling; selector text reuses the
 * pure canonical helpers in `nodes.ts`. The only byte tests here check that a
 * leaf the printer is about to write is a spelling its grammar slot accepts
 * (an identifier where the rule wants one, no `$` sigil inside opaque bytes);
 * no tree fact is derived from bytes.
 *
 * NO APPROXIMATION. A node — or a field value of a node — that no `.jess`
 * spelling parses back to throws {@link NoJessSpelling}. That list of throws is
 * the map of what `.jess` cannot express yet; `.jess` syntax deliberately lags
 * the AST, so the gaps are expected. Printing a near-miss instead (a live read
 * for a scoped one, `$( … )` inferred around bare math, a bracketed list for a
 * bare comma argument) would turn a recorded gap into a silent semantic change.
 *
 * The only normalizations are ones the `.jess` grammar itself applies, so they
 * are not approximations:
 *   - a `Sequence` prints as its space run and re-parses as a raw `ValueSlot[]`
 *     (the jess reducers' own `jessValueSlot` unwrap);
 *   - a standalone `Expression` value re-parses as a one-part `Interpolation`
 *     around the `Expression` (the `Expression` rule's own reduction);
 *   - a mixin-call namespace path prints with `>` (the only `.jess` path
 *     combinator; core reads only each segment's selector);
 *   - `Lookup.raw` / `Reference.raw` / `Condition.src` are verbatim fallback
 *     spellings, recomputed by the `.jess` reducer from what is printed.
 */
import type {
  AnonymousMixin, Block, CallArg, CallValue, Collection, CollectionItem, ComplexSelector, CompoundSelector,
  Declaration, Expression, ExtendInstruction, FunctionCall, Interpolation, Lookup, LookupStep, MixinCall,
  MixinDefinition, Param, PseudoSelector, Reference, RelativeSelector, Ruleset, SelectorBranch, SelectorList,
  SelectorTerm, SimpleSelector, Statement, StyleImport, Stylesheet, ValueNode, ValueSlot, VariableDeclaration
} from './nodes.js';
import { selectorBranchCanonical } from './nodes.js';
import type { AtRuleBlock, AtRuleStatement } from './at-rule.js';
import type { GuardNode } from './guard.js';
import { renderCombinator } from './node.js';
import { NO_SPAN, bodyEndOf, bodyStartOf, sourceEndOf, sourceStartOf, triviaMapOf, valueLayoutOf } from './provenance.js';
import type { Trivia } from '../types/index.js';

export interface EmitJessOptions {

  /**
   * Rewrites a converted `@import` path. `.jess` imports name the file they
   * load — no extension inference — so which `.jess` file a Less import becomes
   * is the CONVERTER's fact (it knows what it wrote), not the printer's. Called
   * with the authored path after the `./` rewrite; absent, the path is kept.
   */
  readonly importPath?: (path: string) => string;
}

/** One construct `.jess` cannot spell yet: the node type and why. */
export interface JessSpellingGap {
  readonly nodeType: string;
  readonly reason: string;
}

/**
 * Thrown when the tree holds a node with no `.jess` spelling. `gaps` lists every
 * gap found in the document (one per statement at most), so a single run maps
 * the whole file rather than stopping at the first construct.
 */
export class NoJessSpelling extends Error {
  readonly nodeType: string;
  readonly reason: string;
  gaps: readonly JessSpellingGap[];

  constructor(nodeType: string, reason: string) {
    super(`NoJessSpelling: ${nodeType} (${reason})`);
    this.name = 'NoJessSpelling';
    this.nodeType = nodeType;
    this.reason = reason;
    this.gaps = [{ nodeType, reason }];
  }
}

const gap = (nodeType: string, reason: string): never => {
  throw new NoJessSpelling(nodeType, reason);
};

/**
 * Where a value is being printed — each `.jess` position admits a different atom
 * set: a declaration/variable `Value`, the inside of `$( … )` or a guard operand
 * (`ExpressionLogical` atoms), a function argument (`CallComponent`, `CalcSum`
 * inside a math function), or an at-rule prelude (CSS leaves only).
 */
const At = { Value: 'value', Expr: 'expr', Math: 'math', Prelude: 'prelude' } as const;
type At = typeof At[keyof typeof At];

/** `jess-parser` `expressionProductSymbol` / `expressionSumSymbol`. */
const EXPRESSION_OPS = new Set(['*', '/', '%', '+', '-']);
const precedence = (operator: string): number => (operator === '+' || operator === '-' ? 1 : 2);

/** The value nodes `ExpressionAtom` (plus the operator/comparison ladder above it) can spell. */
const EXPRESSION_NODES = new Set([
  'Lookup', 'Reference', 'Dimension', 'Color', 'Quoted', 'Keyword', 'Null', 'Block', 'Operation', 'Condition', 'Interpolation'
]);

const IDENT = /^-?(?:[_a-zA-Z\u0080-\uffff]|\\.)(?:[-_a-zA-Z0-9\u0080-\uffff]|\\.)*$/u;
const DOLLAR_NAME = /^-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*$/u;
const MIXIN_NAME = /^[.#]?-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*$/u;
const WHITESPACE = /^[ \t\n\r\f]+$/u;

/** `jess-parser` `guardUnaryTypePredicate` / `guardIsUnitPredicate`. */
const TYPE_PREDICATES = new Set(['iscolor', 'isnumber', 'isstring', 'iskeyword', 'ispixel', 'ispercentage', 'isem']);

/** `jess-parser` `expressionCompareSymbol` / `ifGuardCompareOperator`. */
const COMPARE_OPS = new Set(['>=', '<=', '==', '>', '<', '=']);

/**
 * Which statement set a body is parsed with: the `Stylesheet` rule, a ruleset
 * body (`rulesetBodyItem`), an at-rule body (`atBlockStatement`), or a
 * mixin/lambda/control body (`nestedBodyStatement`). They admit different
 * statements, so a statement valid in one is a gap in another.
 */
type Body = 'root' | 'rule' | 'at' | 'nested';

/** Statements the `Stylesheet` prologue admits before a CSS `@import`. */
const isPrologue = (node: Statement): boolean =>
  node.type === 'StyleImport' || node.type === 'ModuleImport' || node.type === 'VariableDeclaration'
  || (node.type === 'AtRuleStatement' && ['@import', '@layer', '@charset'].includes(node.name.toLowerCase()));

const KEYFRAMES = /^@(?:-[a-z]+-)?keyframes$/iu;

/** A statement's source extent; a block that records only its body span falls back to it. */
const startOf = (node: object): number => {
  const s = sourceStartOf(node);
  return s === NO_SPAN ? bodyStartOf(node) : s;
};
const endOf = (node: object): number => {
  const e = sourceEndOf(node);
  return e === NO_SPAN ? bodyEndOf(node) : e;
};

/**
 * `Parent`: the fused `&suffix` only takes an identifier tail; `&(suffix)` is
 * the explicit append for any other `ampersandAppendPayload`.
 */
const FUSED_AMPERSAND_TAIL = /^(?:--(?:[-_a-zA-Z0-9\u0080-\uffff]|\\.)*|-?(?:[_a-zA-Z\u0080-\uffff]|\\.)(?:[-_a-zA-Z0-9\u0080-\uffff]|\\.)*)?$/u;
const APPEND_PAYLOAD = /^[-_a-zA-Z0-9\u0080-\uffff]+$/u;

const isSlotArray = (slot: ValueSlot | CallValue): slot is readonly ValueSlot[] => Array.isArray(slot);

/** A space-adjacency run: a raw multi-part `ValueSlot[]` or a `Sequence`. */
const isSpaceRun = (slot: ValueSlot | CallValue): boolean =>
  isSlotArray(slot) ? slot.length > 1 : slot.type === 'Sequence';

class JessPrinter {
  readonly gaps: JessSpellingGap[] = [];
  readonly #comments: readonly Trivia[];
  readonly #importPath: (path: string) => string;

  constructor(root: Stylesheet, options: EmitJessOptions) {
    this.#comments = triviaMapOf(root)?.commentRuns() ?? [];
    this.#importPath = options.importPath ?? (path => path);
  }

  /* ------------------------------------------------------------ statements */

  /**
   * One body. Each statement prints on its own so a gap in one does not hide the
   * gaps after it; a failed statement records its gap and prints nothing.
   * Statement-level comments are replayed from the document trivia between
   * sibling spans — a comment inside a statement is not (it has no `.jess`
   * position this printer can place it in).
   */
  body(rules: readonly Statement[], where: Body, indent: string, start: number, end: number): string {
    let out = '';
    let cursor = start;
    let prologue = where === 'root';
    for (const [index, rule] of rules.entries()) {
      const s = startOf(rule);
      if (s !== NO_SPAN) {
        out += this.commentsBetween(cursor, s, indent);
      }
      try {
        this.placement(rule, where, index, prologue);
        prologue &&= isPrologue(rule);
        out += this.statement(rule, indent);
      } catch (error) {
        if (!(error instanceof NoJessSpelling)) {
          throw error;
        }
        this.gaps.push({ nodeType: error.nodeType, reason: error.reason });
      }
      const e = endOf(rule);
      if (e !== NO_SPAN) {
        cursor = e;
      }
    }
    return out + this.commentsBetween(cursor, end, indent);
  }

  commentsBetween(from: number, to: number, indent: string): string {
    if (from === NO_SPAN || to === NO_SPAN || from >= to) {
      return '';
    }
    let out = '';
    for (const run of this.#comments) {
      if (run.start >= to) {
        break;
      }
      if (run.start >= from && run.end <= to) {
        out += `${indent}${run.src.slice(run.start, run.end).trim()}\n`;
      }
    }
    return out;
  }

  block(rules: readonly Statement[], where: Body, owner: object, indent: string): string {
    const inner = this.body(rules, where, `${indent}  `, bodyStartOf(owner), bodyEndOf(owner));
    return inner === '' ? '{}' : `{\n${inner}${indent}}`;
  }

  /** Is this statement admitted by the statement set of the body it sits in? */
  placement(node: Statement, where: Body, index: number, prologue: boolean): void {
    switch (node.type) {
      case 'StyleImport':
      case 'ModuleImport':
        if (where !== 'root') {
          gap(node.type, 'an import inside a block: `.jess` imports are `Stylesheet`-level statements');
        }
        return;
      case 'Declaration':
        if (where === 'root') {
          gap('Declaration', 'a top-level declaration: the `Stylesheet` rule admits none');
        }
        return;
      case 'AtRuleStatement': {
        const name = node.name.toLowerCase();
        if (name === '@charset' && (where !== 'root' || index !== 0)) {
          gap('AtRuleStatement', '`@charset` after another statement: `Charset` is only the first statement');
        }
        if (name === '@import' && (where !== 'root' || !prologue)) {
          gap('AtRuleStatement', 'a CSS `@import` after a rule: `ImportStatement` is only in the `Stylesheet` prologue');
        }
        return;
      }
      case 'AtRuleBlock':
        if (KEYFRAMES.test(node.name) && where === 'rule') {
          gap('AtRuleBlock', '`@keyframes` inside a ruleset body: `rulesetBodyItem` has no `Keyframes` arm');
        }
        if (node.name.toLowerCase() === '@property' && where !== 'root') {
          gap('AtRuleBlock', '`@property` inside a block: `PropertyAtRule` is `Stylesheet`-level');
        }
        return;
      default:
    }
  }

  statement(node: Statement, indent: string): string {
    switch (node.type) {
      case 'Ruleset': return `${indent}${this.ruleset(node, indent)}\n`;
      case 'Declaration': return `${indent}${this.declaration(node)};\n`;
      case 'VariableDeclaration': return `${indent}${this.variableDeclaration(node, indent)};\n`;
      case 'MixinDefinition': return `${indent}${this.mixinDefinition(node, indent)}\n`;
      case 'MixinCall': return `${indent}${this.mixinCall(node, indent)};\n`;
      case 'AtRuleBlock': return `${indent}${this.atRuleBlock(node, indent)}\n`;
      case 'AtRuleStatement': return `${indent}${this.atRuleStatement(node)};\n`;
      case 'UnknownAtRuleBlock':
        return `${indent}${node.name}${node.prelude === null ? '' : ` ${node.prelude}`} {${node.rawBody}}\n`;
      case 'StyleImport': return `${indent}${this.styleImport(node)};\n`;
      case 'Comment': return `${indent}${node.text}\n`;
      case 'Reference': return `${indent}${this.referenceCall(node)};\n`;
      case 'For': {
        const b = node.binding;

        // `ForBinding`: `[$a, $b]`, or one to three comma names.
        const binding = b.kind === 'single'
          ? `$${b.name}`
          : b.kind === 'bracket'
            ? `[$${b.names[0]}, $${b.names[1]}]`
            : b.kind === 'comma'
              ? b.names.filter((name): name is string => name !== undefined).map(name => `$${name}`).join(', ')
              : gap('For', 'tuple binding: `ForBinding` spells at most three comma names');
        return `${indent}$for (${binding} of ${this.forSource(node.iterable)}) ${this.block(node.rules, 'nested', node, indent)}\n`;
      }
      case 'If': {
        let out = '';
        for (const [i, branch] of node.branches.entries()) {
          const body = this.block(branch.rules, 'nested', branch, indent);
          out += branch.guard === null
            ? ` $else ${body}`
            : `${i === 0 ? '$if' : ' $else if'} (${this.guard(branch.guard, true, false)}) ${body}`;
        }
        return `${indent}${out}\n`;
      }
      case 'While':
        return `${indent}$while (${this.guard(node.guard, true, false)}) ${this.block(node.rules, 'nested', node, indent)}\n`;
      case 'Apply':
        return `${indent}$apply ${node.selectors.map(term => this.selectorTerm(term)).join(', ')};\n`;
      case 'ModuleImport': {
        // `ModuleImport`: `@-use "p" [as ns]` / `@-from "p" import …`.
        const path = node.path.src;
        if (node.mode === 'use') {
          return `${indent}@-use ${path}${node.namespace === null ? '' : ` as ${node.namespace}`};\n`;
        }
        const names = node.imports.map(s => (s.alias === null ? s.name : `${s.name} as ${s.alias}`)).join(', ');
        const what = node.namespace !== null
          ? `* as ${node.namespace}`
          : node.defaultImport !== null
            ? `${node.defaultImport}${names === '' ? '' : `, (${names})`}`
            : `(${names})`;
        return `${indent}@-from ${path} import ${what};\n`;
      }
      case 'Plugin':
        return gap('Plugin', '`@-plugin` parses only as an inert at-rule statement; `.jess` script integration is `@-use`/`@-from`');
      case 'FunctionCall':
        return gap('FunctionCall', 'a bare call in statement position has no `.jess` statement production');
    }
  }

  ruleset(node: Ruleset, indent: string): string {
    if (node.guard !== undefined) {
      gap('Ruleset', '`when` guard on a ruleset: the `.jess` `Ruleset` rule takes no guard');
    }
    const extend = node.extendInstructions;
    return extend !== undefined && extend.length > 0
      ? `${this.selectorList(node.selector)} ${this.blockWithExtend(node, extend, indent)}`
      : `${this.selectorList(node.selector)} ${this.block(node.rules, 'rule', node, indent)}`;
  }

  /**
   * `Extend`: `$extend <targets> [!exact];` in the body — the only `.jess` extend.
   * It carries no subject, so it reproduces an instruction whose subject is the
   * WHOLE rule: a body-form extend, or an inline one on a single-branch rule.
   */
  blockWithExtend(node: Ruleset, extend: readonly ExtendInstruction[], indent: string): string {
    const whole = node.selector.selectors;
    let lines = '';
    for (const inst of extend) {
      if (inst.optional === true) {
        gap('ExtendInstruction', '`!optional`: `Extend` spells only `!exact`');
      }
      if (inst.subject !== undefined) {
        const subject = inst.subject.selectors;
        if (whole.length !== 1 || subject.length !== 1
          || selectorBranchCanonical(subject[0]!) !== selectorBranchCanonical(whole[0]!)) {
          gap('ExtendInstruction', 'per-branch extend subject: `$extend` always extends the whole rule');
        }
      }
      lines += `${indent}  $extend ${this.selectorList(inst.target)}${inst.partial ? '' : ' !exact'};\n`;
    }
    const inner = this.body(node.rules, 'rule', `${indent}  `, bodyStartOf(node), bodyEndOf(node));
    return `{\n${inner}${lines}${indent}}`;
  }

  declaration(node: Declaration): string {
    if (node.merge !== null) {
      gap('Declaration', `merge \`${node.merge === ',' ? '+' : '+_'}:\`: the \`.jess\` \`Declaration\` rule has no merge marker`);
    }
    if (node.valueOnNewLine === true) {
      gap('Declaration', 'value-on-new-line layout: the `.jess` `Declaration` reducer never records it');
    }
    const name = typeof node.name === 'string'
      ? this.propertyName(node.name)
      : this.template(node.name, 'name');
    const custom = typeof node.name === 'string' && node.name.startsWith('--');
    const value = custom ? this.customValue(node.value) : this.value(node.value, At.Value);
    return `${name}: ${value}${node.important ? ' !important' : ''}`;
  }

  propertyName(name: string): string {
    return IDENT.test(name) || name.startsWith('--')
      ? name
      : gap('Declaration', 'a property name that is not an identifier (a Less map key such as `100` or `<`): the `.jess` `Declaration` name is an `Identifier`');
  }

  /** `CustomDeclaration`: custom-property values are raw CSS. */
  customValue(value: ValueSlot): string {
    if (!isSlotArray(value) && (value.type === 'Any' || value.type === 'Keyword')) {
      return value.src;
    }
    return this.value(value, At.Value);
  }

  variableDeclaration(node: VariableDeclaration, indent: string): string {
    if (!DOLLAR_NAME.test(node.name)) {
      gap('VariableDeclaration', 'a variable name that is not a `.jess` `$` name (`dollarName`)');
    }

    // `assignHead`: `$n:` / `$n?:` / `$n:=` / `$n::=`, `$^` for the scoped store.
    const w = node.write;
    const head = w.mode === 'declare'
      ? `$${node.name}:`
      : `$${w.scope === 'scoped' ? '^' : ''}${node.name}${w.mode === 'if-absent' ? '?:' : w.mode === 'reassign' ? ' :=' : ' ::='}`;
    const value = node.value;
    if (!isSlotArray(value) && value.type === 'MixinCall') {
      return gap('VariableDeclaration', 'bound to a mixin call: no `.jess` value spelling for a call\'s output');
    }
    if (!isSlotArray(value) && value.type === 'Important') {
      return gap('Important', '`!important` on a variable value is undecided for `.jess` (inventory row)');
    }

    // `ValueBlockDeclaration`: a block is admitted only as the WHOLE value.
    if (!isSlotArray(value) && value.type === 'AnonymousMixin') {
      return `${head} ${this.anonymousMixin(value, indent)}`;
    }
    if (!isSlotArray(value) && value.type === 'Collection') {
      return `${head} ${this.collection(value, indent)}`;
    }
    return `${head} ${this.value(value, At.Value, indent)}`;
  }

  params(params: readonly Param[]): string {
    return `(${params.map((p) => {
      if (p.rest === true) {
        return gap('Param', 'rest/variadic parameter: `MixinParam` has no `...` form');
      }
      if (p.pattern !== undefined || p.name === undefined) {
        return gap('Param', 'literal-value pattern parameter: `MixinParam` is always `$name`');
      }
      if (p.default === undefined) {
        return `$${p.name}`;
      }
      if (!isSlotArray(p.default) && p.default.type === 'List' && p.default.sep === ',') {
        return gap('Param', 'comma-list default: a `MixinParam` default is one `ValueTerm`');
      }
      if (isSpaceRun(p.default)) {
        return gap('Param', 'space-run default: the `MixinParam` reducer keeps only a single node and silently drops it (parser defect)');
      }
      return `$${p.name}: ${this.value(p.default, At.Value)}`;
    }).join(', ')})`;
  }

  mixinDefinition(node: MixinDefinition, indent: string): string {
    if (!MIXIN_NAME.test(node.name)) {
      gap('MixinDefinition', 'a mixin name outside `mixinNameToken` (e.g. an escaped or `!`-bearing name)');
    }
    const guard = node.guard === undefined ? '' : ` when (${this.guard(node.guard, true, true)})`;
    return `${node.name}${this.params(node.params)}${guard} ${this.block(node.rules, 'nested', node, indent)}`;
  }

  /**
   * `MixinCallArgument` (`mixin`) or `ReferenceCallTail` arguments. The mixin
   * reducer mis-reads two shapes it parses, so those two print nothing it could
   * read back: a space run throws inside the reducer, and a positional string's
   * content token is taken for a keyword name.
   */
  callArgs(args: readonly CallArg[], owner: string, mixin = false): string {
    return args.map((arg) => {
      if (arg.spread) {
        return gap(owner, 'spread argument: no `.jess` call spelling splats a list');
      }
      const value = arg.value;
      if (!isSlotArray(value) && value.type === 'MixinCall') {
        return gap(owner, 'a mixin call passed as an argument has no `.jess` spelling');
      }
      if (!isSlotArray(value) && value.type === 'List' && value.sep === ',') {
        return gap(owner, 'comma-list argument: a `.jess` call argument is one `ValueTerm`');
      }
      if (mixin && isSpaceRun(value)) {
        return gap(owner, 'space-run argument: the `MixinCallArgument` reducer throws on it (parser defect)');
      }
      if (mixin && arg.name === undefined && !isSlotArray(value) && value.type === 'Quoted') {
        return gap(owner, 'positional string argument: the `MixinCallArgument` reducer reads its content as a keyword name (parser defect)');
      }
      const printed = this.value(value, At.Value);
      return arg.name === undefined ? printed : `$${arg.name}: ${printed}`;
    }).join(', ');
  }

  /** `MixinCall`: `$ > [path >]* name(args)` with an optional `: { … }` content block. */
  mixinCall(node: MixinCall, indent: string): string {
    if (node.important) {
      gap('MixinCall', '`!important` on a mixin call: the `.jess` `MixinCall` rule has no importance marker');
    }
    const names = [...node.path.map(s => s.selector), node.name];
    for (const name of names) {
      if (!MIXIN_NAME.test(name)) {
        gap('MixinCall', 'a mixin name outside `mixinNameToken` (e.g. an escaped or `!`-bearing name)');
      }
    }
    const content = node.content === null
      ? ''
      : `: ${node.content.params === undefined ? '' : `${this.params(node.content.params)} `}${this.block(node.content.rules, 'nested', node.content, indent)}`;
    return `$ > ${names.join(' > ')}(${this.callArgs(node.args, 'MixinCall', true)})${content}`;
  }

  /** `ReferenceCall`: `$name();` — a zero-argument call on a live variable. */
  referenceCall(node: Reference): string {
    const base = node.base;
    const [step, ...rest] = node.steps;
    if (base.type !== 'Lookup' || base.kind !== 'var' || typeof base.name !== 'string'
      || step?.type !== 'Call' || rest.length > 0) {
      return gap('Reference', 'statement-position reference chain: `ReferenceCall` is only `$name()`');
    }
    if (base.scope !== 'live') {
      return gap('Reference', 'call on a scoped (Less `@name`) binding: `.jess` `$name()` reads the live store only');
    }
    if (step.args.length > 0) {
      return gap('Reference', 'arguments on a variable call: `ReferenceCall` takes none');
    }
    return `$${base.name}()`;
  }

  atRuleBlock(node: AtRuleBlock, indent: string): string {
    const prelude = node.prelude === null ? '' : ` ${this.value(node.prelude, At.Prelude)}`;
    return `${node.name}${prelude} ${this.block(node.rules, 'at', node, indent)}`;
  }

  atRuleStatement(node: AtRuleStatement): string {
    return `${node.name}${node.prelude === null ? '' : ` ${this.value(node.prelude, At.Prelude)}`}`;
  }

  /**
   * `StyleImport` `@-import "<path>"`. Less resolves a bare `"foo"` against the
   * importing file first; `.jess` requires file-relative paths to be written
   * explicitly, so a bare relative target gains `./` (the migration guide's
   * documented rewrite). The option clause has no `.jess` spelling at all.
   */
  styleImport(node: StyleImport): string {
    if (node.mode !== 'import' || node.alias !== null || node.config !== null || node.forward) {
      if (node.name === '@-compose' || node.name === '@-export') {
        const config = node.config === null
          ? ''
          : ` ${node.config.kind} {${node.config.bindings.map(b => ` ${this.variableDeclaration(b, '')};`).join('')} }`;
        const as = node.namespace === null ? '' : ` as ${node.namespace}`;
        return `${node.name} ${this.importTarget(node, false)}${as}${config}`;
      }
      return gap('StyleImport', 'module import semantics (`as`/`with`/forward) outside `@-compose`/`@-export`');
    }
    if (node.options !== null) {
      const words = node.options.value.map(o => (!isSlotArray(o) && 'src' in o ? String(o.src).trim() : '?')).join(', ');
      return gap('StyleImport', `import option \`(${words})\`: \`@-import\` takes no option clause (\`@-reference\` parses only as an inert at-rule)`);
    }
    return `@-import ${this.importTarget(node, node.name !== '@-import')}`;
  }

  importTarget(node: StyleImport, fromLess: boolean): string {
    /*
     * A compile-time import's `url(…)` wrapper is syntax around the same path,
     * so it prints as the plain quoted path the `.jess` rule takes.
     */
    const target = node.target.type === 'Url' ? node.target.value : node.target;
    if ((target.type !== 'Quoted' && target.type !== 'Any') || (target.type === 'Quoted' && target.escaped)) {
      return gap('StyleImport', 'an interpolated or escaped import target: `.jess` imports take a plain quoted path');
    }
    const quote = target.type === 'Quoted' ? target.quote : '"';
    const path = target.type === 'Quoted' ? target.value : target.src;
    if (!fromLess) {
      return `${quote}${path}${quote}`;
    }
    const relative = path.startsWith('./') || path.startsWith('../') || path.startsWith('/')
      || /^[a-z][a-z0-9+.-]*:/iu.test(path);
    const rewritten = this.#importPath(relative ? path : `./${path}`);
    return rewritten.includes(quote)
      ? gap('StyleImport', 'an import path containing its own quote character')
      : `${quote}${rewritten}${quote}`;
  }

  /* -------------------------------------------------------------- selectors */

  selectorList(list: SelectorList): string {
    return list.selectors.map(branch => this.selectorBranch(branch)).join(', ');
  }

  selectorBranch(branch: SelectorBranch): string {
    if (branch.type === 'ComplexSelector' || branch.type === 'RelativeSelector') {
      return this.sequenceSelector(branch);
    }
    return this.selectorTerm(branch);
  }

  sequenceSelector(branch: ComplexSelector | RelativeSelector): string {
    let out = '';
    for (const part of branch.value) {
      out += typeof part === 'string' ? renderCombinator(part) : this.selectorTerm(part);
    }
    return branch.type === 'RelativeSelector' ? out.trimStart() : out;
  }

  selectorTerm(term: SelectorTerm): string {
    if (term.type === 'CompoundSelector') {
      return this.compound(term);
    }
    return term.type === 'PseudoSelector' ? this.pseudo(term) : this.simple(term);
  }

  compound(node: CompoundSelector): string {
    return node.value.map(t => (t.type === 'PseudoSelector' ? this.pseudo(t) : this.simple(t))).join('');
  }

  simple(node: SimpleSelector): string {
    if (node.interp !== null) {
      return this.template(node.interp, 'selector');
    }
    const text = node.text ?? '';
    if (!text.startsWith('&')) {
      return text;
    }
    const tail = text.slice(1);
    if (FUSED_AMPERSAND_TAIL.test(tail)) {
      return text;
    }
    return APPEND_PAYLOAD.test(tail) && tail !== 'nil'
      ? `&(${tail})`
      : gap('SimpleSelector', `\`&\` fused with \`${tail}\`: \`Parent\` spells an identifier tail or \`&(…)\``);
  }

  pseudo(node: PseudoSelector): string {
    if (node.interp !== null) {
      return this.template(node.interp, 'selector');
    }
    return node.args === null ? (node.text ?? '') : `${node.name}(${this.selectorList(node.args)})`;
  }

  /* ----------------------------------------------------------------- values */

  value(slot: ValueSlot, at: At, indent = ''): string {
    if (at === At.Expr && (isSlotArray(slot) || !EXPRESSION_NODES.has(slot.type)
      || (slot.type === 'Block' && slot.delimiter !== 'paren'))) {
      return gap(isSlotArray(slot) ? 'ValueSlot[]' : slot.type, 'not an `ExpressionAtom`: `$( … )` and guard operands take references, numbers, colors, strings, keywords and `( … )` groups');
    }
    if (isSlotArray(slot)) {
      return this.spaceRun(slot, valueLayoutOf(slot), at, indent);
    }
    return this.node(slot, at, indent);
  }

  /** `ValueSpaceGroup`: the authored whitespace boundary runs, or one space. */
  spaceRun(parts: readonly ValueSlot[], layout: readonly string[] | undefined, at: At, indent: string): string {
    let out = '';
    for (const [i, part] of parts.entries()) {
      if (i > 0) {
        const sep = layout?.[i - 1] ?? ' ';
        out += WHITESPACE.test(sep)
          ? sep
          : gap('Comment', 'a comment between value parts: `ValueSpaceGroup` separators are whitespace only');
      }
      out += this.value(part, at, indent);
    }
    return out;
  }

  node(node: ValueNode, at: At, indent: string): string {
    switch (node.type) {
      case 'Keyword':
        if (node.src === '/') {
          return gap('Keyword', 'a `/` value atom: in `.jess` a slash is a list separator — the division rule owns it (P34/P35 not landed)');
        }
        if (node.src === 'null') {
          return gap('Keyword', '`null` is a `.jess` literal, not an identifier');
        }
        return node.src;
      case 'Dimension':
      case 'Color':
        return node.src;
      case 'Null':
        return 'null';
      case 'Quoted':
        if (/\$[[({]/u.test(node.value)) {
          return gap('Quoted', 'a string holding `${`/`$(`/`$[`, which `.jess` reads as interpolation');
        }
        return node.src;
      case 'Any':
        if (node.src.includes('$')) {
          return gap('Any', 'opaque bytes containing `$`, which `.jess` reads as a sigil');
        }
        return node.src;
      case 'Url':
        if (node.value.type === 'Any' && /[ \t\n\r\f]/u.test(node.value.src)) {
          return gap('Url', 'an unquoted `url()` body containing whitespace: `UnquotedUrlText` admits none');
        }
        return `url(${node.value.type === 'Interpolation' ? this.template(node.value, 'string') : this.value(node.value, at)})`;
      case 'SelectorCapture':
        return `*[${node.branches.join(', ')}]`;
      case 'List': {
        if (valueLayoutOf(node)?.some(sep => !/^[ \t]*[,/][ \t]*$/u.test(sep)) === true) {
          return gap('List', 'a list laid out across lines or around comments: the `.jess` `Value` rule keeps no separator layout');
        }
        const glue = node.sep === ',' ? ', ' : ' / ';
        return node.value.map(item => this.value(item, at, indent)).join(glue);
      }
      case 'Sequence':
        return this.spaceRun(node.parts, valueLayoutOf(node), at, indent);
      case 'Lookup':
        return this.lookup(node, at);
      case 'Reference':
        return this.reference(node, at);
      case 'Important':
        return gap('Important', '`!important` inside a value is undecided for `.jess` (inventory row)');
      case 'Operation':
        if (at !== At.Expr && !(at === At.Math && node.inMathFunction)) {
          return gap('Operation', 'math outside an `Expression`: `.jess` computes only inside `$( … )` (P35 not landed)');
        }
        if (!EXPRESSION_OPS.has(node.operator)) {
          return gap('Operation', `operator \`${node.operator}\` is not a \`.jess\` arithmetic operator`);
        }

        /*
         * `ExpressionProduct` / `ExpressionSum` fold left, so an operand tree the
         * ladder would regroup has no spelling: parenthesizing it would add a
         * `Block` the tree does not have.
         */
        if ((node.left.type === 'Operation' && precedence(node.left.operator) < precedence(node.operator))
          || (node.right.type === 'Operation' && precedence(node.right.operator) <= precedence(node.operator))) {
          return gap('Operation', 'an operand grouping the left-folding precedence ladder cannot reproduce without a `( … )` block');
        }
        return `${this.value(node.left, at, indent)} ${node.operator} ${this.value(node.right, at, indent)}`;
      case 'FunctionCall':
        return this.call(node, at);
      case 'Block':
        return this.paren(node, at);
      case 'Expression':
        return this.expression(node, at);
      case 'Condition':
        if (at !== At.Expr) {
          return gap('Condition', 'a comparison outside `$( … )`: `.jess` has no `boolean()` (ledger P17)');
        }
        return this.guard(node.guard, true, false);
      case 'IfValue':
        return gap('IfValue', 'value-position `$if … $else`: documented on the node, but no `.jess` production builds it');
      case 'Interpolation':
        return this.valueInterpolation(node, at);
      case 'AnonymousMixin':
        return gap('AnonymousMixin', 'a block inside a larger value: `BlockLambda` is admitted only as a whole variable value');
      case 'Collection':
        return gap('Collection', 'a collection inside a larger value: `Collection` is admitted only as a whole variable or entry value');
      case 'NestedPropertyBlock':
        return gap('NestedPropertyBlock', 'SCSS nested-property block: no `.jess` production');
      case 'Range': {
        // `ForRange`: `[>]a to [<]b [step c]`.
        const step = node.step === null ? '' : ` step ${this.node(node.step, at, indent)}`;
        return `${node.includeStart ? '' : '>'}${this.node(node.start, at, indent)} to ${node.includeEnd ? '' : '<'}${this.node(node.end, at, indent)}${step}`;
      }
      case 'Comment':
        return gap('Comment', 'a comment carried as a value node');
    }
  }

  /** `VariableReference`: `$name` (live) / `$^name` (scoped). */
  lookup(node: Lookup, at: At): string {
    if (at === At.Prelude) {
      return gap('Lookup', 'a variable inside an at-rule prelude: `.jess` preludes take CSS leaves or a whole `${…}`');
    }
    if (node.kind === 'prop') {
      return gap('Lookup', 'Less `$prop` property accessor: `.jess` `$.prop` reads the entry surface, a different lookup');
    }
    if (node.kind !== 'var' || typeof node.name !== 'string') {
      return gap('Lookup', typeof node.name === 'string'
        ? `\`${node.kind}\` lookup outside a reference chain`
        : 'indirect `@@name`: `.jess` `$[$n]` reads the live store only');
    }
    return `$${node.scope === 'scoped' ? '^' : ''}${node.name}`;
  }

  /** `DollarValue` / `ExpressionAtom` reference chains. */
  reference(node: Reference, at: At): string {
    const base = node.base;
    let out: string;
    if (base.type === 'Lookup' && base.kind === 'entry') {
      /*
       * `$a.b` and `$.a.b` are the same tree (the reducer folds a dotted chain on
       * a variable head into an entry-surface member chain); print the variable
       * head so the reducer's `raw` matches. A single member needs the `$.`.
       */
      const [head, next] = node.steps;
      if (at !== At.Expr && head?.type === 'LookupStep' && head.kind === 'member'
        && typeof head.name === 'string' && head.name !== 'type'
        && next?.type === 'LookupStep' && next.kind === 'member' && typeof next.name === 'string') {
        out = `$${head.name}`;
        for (const step of node.steps.slice(1)) {
          out += step.type === 'Call' ? `(${this.callArgs(step.args, 'Reference')})` : this.lookupStep(step);
        }
        return out;
      }
      out = at === At.Expr ? '' : '$';
    } else if (base.type === 'Lookup') {
      out = this.lookup(base, at);
    } else {
      return gap('Reference', 'a chain rooted at a mixin call: `.jess` accessors root at a `$` binding');
    }
    for (const step of node.steps) {
      out += step.type === 'Call'
        ? `(${this.callArgs(step.args, 'Reference')})`
        : this.lookupStep(step);
    }
    return out;
  }

  lookupStep(step: LookupStep): string {
    const { name } = step;
    if (step.kind === 'member') {
      if (typeof name === 'string') {
        return `.${name}`;
      }
      if (typeof name === 'number') {
        return gap('LookupStep', 'numeric member step');
      }
      if (name.type === 'Keyword' || name.type === 'Quoted') {
        return `[${name.src}]`;
      }
    }
    if (step.kind === 'index' && typeof name === 'number' && step.indexBase === 0) {
      return `[${name}]`;
    }
    if (step.kind === 'var' && typeof name === 'object' && name.type === 'Lookup' && step.indexBase === 0) {
      return `[${this.lookup(name, At.Value)}]`;
    }
    return gap('LookupStep', `\`${step.kind}\` step${step.indexBase === undefined ? ' with Less 1-based indexing' : ''}: no \`.jess\` accessor spells it`);
  }

  call(node: FunctionCall, at: At): string {
    if (at === At.Expr) {
      return gap('FunctionCall', 'a bare-name call inside `$( … )`: only `$fn(…)` calls are expression atoms');
    }
    if (!IDENT.test(node.name)) {
      return gap('FunctionCall', 'a function name that is not an identifier (Less `%()`)');
    }
    const inner = at === At.Prelude ? At.Prelude : At.Math;
    const args = node.args.map((arg) => {
      if (arg.spread || arg.name !== undefined) {
        return gap('FunctionCall', 'keyword or spread argument: `CallArgument` is positional');
      }
      const value = arg.value;
      if (!isSlotArray(value) && value.type === 'List' && value.sep === ',') {
        return gap('FunctionCall', 'comma-list argument: `.jess` would read it as separate arguments');
      }
      return this.value(value, inner);
    });
    return `${node.name}(${args.join(', ')})`;
  }

  paren(node: Block, at: At): string {
    if (node.escaped === true) {
      return gap('Block', 'escaped `~( … )` block: no `.jess` production');
    }
    if (node.delimiter === 'square') {
      return `[${this.value(node.value, at)}]`;
    }
    if (at === At.Prelude && !isSlotArray(node.value) && node.value.type === 'Operation' && node.value.operator === ':') {
      // `QueryFeature`: `(name: value)`.
      return `(${this.node(node.value.left, at, '')}: ${this.node(node.value.right, at, '')})`;
    }
    return `(${this.value(node.value, at)})`;
  }

  /** `Expression`: `$( … )`, the only `.jess` math boundary. */
  expression(node: Expression, at: At): string {
    if (at === At.Expr) {
      return gap('Expression', 'a nested `$( … )`: `ExpressionAtom` has no `$(` arm');
    }
    if (at === At.Prelude) {
      return gap('Expression', '`$( … )` inside an at-rule prelude');
    }
    return `$(${this.value(node.value, At.Expr)})`;
  }

  /**
   * An `Interpolation` in value position: a quoted template (`"a${b}"`), an
   * escaped one (`~"a${b}"`), or `$( … )`-headed parts with literal tails
   * (`InterpolatedValue`).
   */
  valueInterpolation(node: Interpolation, at: At): string {
    const first = node.parts[0];
    if (first !== undefined && 'ref' in first && first.ref.type === 'Expression') {
      let out = '';
      for (const part of node.parts) {
        if ('lit' in part) {
          out += part.lit;
        } else if (part.ref.type === 'Expression' && part.unquote) {
          out += this.expression(part.ref, at);
        } else {
          return gap('Interpolation', 'a value template mixing `$( … )` with a non-expression reference');
        }
      }
      return out;
    }
    if (first !== undefined && 'lit' in first && (first.lit.startsWith('"') || first.lit.startsWith('\''))) {
      return this.template(node, 'string');
    }
    const body = this.template(node, 'string');
    if (body.includes('"')) {
      return gap('Interpolation', 'escaped template holding `"`: the delimiter it was written with is not retained');
    }
    return `~"${body}"`;
  }

  /** `DollarBrace` (`${name}`) / `ExpressionInterpolation` (`$( … )`) template parts. */
  template(node: Interpolation, where: 'string' | 'selector' | 'name'): string {
    let out = '';
    for (const part of node.parts) {
      if ('lit' in part) {
        out += part.lit;
        continue;
      }
      const ref = part.ref;
      if (ref.type === 'Expression' && where === 'string') {
        out += this.expression(ref, At.Value);
        continue;
      }
      if (ref.type !== 'Lookup' || ref.kind !== 'var' || typeof ref.name !== 'string') {
        return gap('Interpolation', `a \`${ref.type}\` spliced into a ${where}: \`\${…}\` takes a variable name`);
      }
      if (ref.scope !== 'live') {
        return gap('Interpolation', `a scoped (Less \`@{name}\`) read spliced into a ${where}: \`.jess\` \`\${name}\` reads the live store only`);
      }
      if (!part.unquote) {
        return gap('Interpolation', 'a quote-preserving splice: `.jess` `${…}` always unquotes');
      }
      out += `\${${ref.name}}`;
    }
    return out;
  }

  /** `BlockLambda`: `@{ … }` / `@(params) { … }`. */
  anonymousMixin(node: AnonymousMixin, indent: string): string {
    const params = node.params === undefined ? '' : this.params(node.params);
    return `@${params}${params === '' ? '' : ' '}${this.block(node.rules, 'nested', node, indent)}`;
  }

  /** `Collection`: `{ key: value; …; ...spread; }`. */
  collection(node: Collection, indent: string): string {
    if (node.entries.length === 0) {
      return '{}';
    }
    const inner = `${indent}  `;
    const item = (entry: CollectionItem): string => {
      if (entry.type === 'CollectionSpread') {
        return `...${this.value(entry.value, At.Value, inner)}`;
      }
      if (entry.merge !== null || entry.valueOnNewLine === true) {
        return gap('CollectionEntry', 'merge marker or value-on-new-line layout on a collection entry');
      }
      const key = !isSlotArray(entry.key) && (entry.key.type === 'Keyword' || entry.key.type === 'Quoted')
        ? entry.key.src
        : `[${this.value(entry.key, At.Value, inner)}]`;
      const value = !isSlotArray(entry.value) && entry.value.type === 'Collection'
        ? this.collection(entry.value, inner)
        : this.value(entry.value, At.Value, inner);
      return `${key}: ${value}${entry.important ? ' !important' : ''}`;
    };
    return `{\n${node.entries.map(e => `${inner}${item(e)};\n`).join('')}${indent}}`;
  }

  /** `ForSource`: one atom or a comma list of atoms (a range prints as itself). */
  forSource(iterable: ValueSlot | MixinCall): string {
    if (!isSlotArray(iterable) && iterable.type === 'MixinCall') {
      return gap('For', 'iterating a mixin call\'s output: `ForSource` takes a value');
    }
    if (!isSlotArray(iterable) && iterable.type === 'List' && iterable.sep === ',') {
      return iterable.value.map((item) => {
        if (isSlotArray(item)) {
          return gap('For', 'a space-run item in an iterated list: `ForSource` items are single atoms');
        }
        return this.node(item, At.Value, '');
      }).join(', ');
    }
    if (isSlotArray(iterable)) {
      return gap('For', 'iterating a space run: `ForSource` takes one atom or a comma list');
    }
    return this.node(iterable, At.Value, '');
  }

  /* ----------------------------------------------------------------- guards */

  /**
   * `MixinGuard` (`mixin` true) / `IfGuard` (`mixin` false). A comparison is
   * `match` under a mixin guard and `cmp` under `$if`; an `and`/`or` operand is
   * always parenthesized, which re-parses to the same node (the group arm
   * returns its inner node).
   */
  guard(node: GuardNode, top: boolean, mixin: boolean): string {
    const wrap = (s: string): string => (top ? s : `(${s})`);
    switch (node.g) {
      case 'cmp':
      case 'match': {
        if ((node.g === 'match') !== mixin) {
          return gap('GuardNode', `a \`${node.g}\` comparison where \`.jess\` builds \`${mixin ? 'match' : 'cmp'}\``);
        }
        if (!COMPARE_OPS.has(node.op)) {
          return gap('GuardNode', `comparison operator \`${node.op}\``);
        }
        return wrap(`${this.value(node.left, At.Expr)} ${node.op} ${this.value(node.right, At.Expr)}`);
      }
      case 'and':
      case 'or':
        return wrap(`${this.guard(node.left, false, mixin)} ${node.g} ${this.guard(node.right, false, mixin)}`);
      case 'not':
        return `not (${this.guard(node.inner, true, mixin)})`;
      case 'truth':
        return this.value(node.value, At.Expr);
      case 'default':
        return mixin ? 'default()' : gap('GuardNode', '`default()` outside a mixin guard');
      case 'call': {
        const name = node.name.toLowerCase();
        const unit = name === 'isunit' && (node.args.length === 1 || node.args.length === 2);
        if (!mixin || (!TYPE_PREDICATES.has(name) && !unit) || (!unit && node.args.length !== 1)) {
          return gap('GuardNode', `guard call \`${node.name}()\`: \`GuardCall\` spells only the \`$type.*\` predicates`);
        }
        return `$type.${name}(${node.args.map(arg => this.value(arg, At.Value)).join(', ')})`;
      }
    }
  }
}

/**
 * Print a parsed stylesheet as `.jess` source. Throws {@link NoJessSpelling}
 * (carrying every gap in `gaps`) when any node has no `.jess` spelling.
 */
export function emitJess(root: Stylesheet, options: EmitJessOptions = {}): string {
  const printer = new JessPrinter(root, options);
  const out = printer.body(root.rules, 'root', '', 0, sourceEndOf(root));
  const [first] = printer.gaps;
  if (first !== undefined) {
    const error = new NoJessSpelling(first.nodeType, first.reason);
    error.gaps = printer.gaps;
    throw error;
  }
  return out;
}
