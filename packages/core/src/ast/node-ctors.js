/*
 * Constructors for Jess's AST and value nodes, one per node shape; node-ctors.d.ts types
 * each one. A type with more than one shape (a ruleset with or without `extendInstructions`
 * or a guard, a block that is or is not escaped) has one constructor per shape, named for it.
 *
 * Why constructors: V8 keeps an allocation site per object literal and decides per site
 * whether to allocate straight into old space (pretenuring), from where scavenges happen
 * to fall during warm-up, so identical processes split into a fast and a slow parse and
 * any change in bundle layout re-rolls it. A `new` call has no allocation site. Each
 * constructor's `prototype` is `Object.prototype`, so a node is still a plain object
 * (DESIGN-DECISIONS C3): same prototype, same `constructor`, same keys in the same order.
 * A constructor's map is never the map of a literal or a spread with the same keys, so a
 * node of a type built here is never copied with `{ ...node }`: rebuild it through its
 * constructor. Plain JavaScript because TypeScript cannot declare a function constructor
 * without a cast. Keep ONE copy of this module per process: each constructor defines its
 * own hidden class.
 */

export function KeywordNode(src) {
  this.type = 'Keyword';
  this.src = src;
}

export function AnyNode(src, _s, _e) {
  this.type = 'Any';
  this.src = src;
  this._s = _s;
  this._e = _e;
}

export function UrlNode(value, _s, _e) {
  this.type = 'Url';
  this.value = value;
  this._s = _s;
  this._e = _e;
}

export function SelectorCaptureNode(branches, components, src) {
  this.type = 'SelectorCapture';
  this.branches = branches;
  this.components = components;
  this.src = src;
}

export function ColorNode(src) {
  this.type = 'Color';
  this.src = src;
}

export function QuotedNode(src, value, quote, escaped, interp) {
  this.type = 'Quoted';
  this.src = src;
  this.value = value;
  this.quote = quote;
  this.escaped = escaped;
  this.interp = interp;
}

export function DimensionNode(number, unit, src) {
  this.type = 'Dimension';
  this.number = number;
  this.unit = unit;
  this.src = src;
}

export function SequenceNode(parts) {
  this.type = 'Sequence';
  this.parts = parts;
}

export function ListNode(value, sep) {
  this.type = 'List';
  this.value = value;
  this.sep = sep;
}

export function SimpleSelectorNode(text, interp, _s, _e) {
  this.type = 'SimpleSelector';
  this.text = text;
  this.interp = interp;
  this._s = _s;
  this._e = _e;
}

export function PseudoSelectorNode(text, interp, name, args, arg, crossable, _s, _e) {
  this.type = 'PseudoSelector';
  this.text = text;
  this.interp = interp;
  this.name = name;
  this.args = args;
  this.arg = arg;
  this.crossable = crossable;
  this._s = _s;
  this._e = _e;
}

export function AnPlusBNode(src) {
  this.type = 'AnPlusB';
  this.src = src;
}

export function InterpolationNode(parts, _s, _e) {
  this.type = 'Interpolation';
  this.parts = parts;
  this._s = _s;
  this._e = _e;
}

export function LeadQuotingInterpolationNode(parts, _s, _e) {
  this.type = 'Interpolation';
  this.parts = parts;
  this._s = _s;
  this._e = _e;
  this.leadQuoting = true;
}

export function AnonymousMixinNode(rules, extendInstructions, _bs, _be) {
  this.type = 'AnonymousMixin';
  this.rules = rules;
  this.extendInstructions = extendInstructions;
  this._bs = _bs;
  this._be = _be;
}

export function AnonymousMixinWithParamsNode(rules, extendInstructions, params, _bs, _be) {
  this.type = 'AnonymousMixin';
  this.rules = rules;
  this.extendInstructions = extendInstructions;
  this.params = params;
  this._bs = _bs;
  this._be = _be;
}

export function ForNode(iterable, rules, binding, extendInstructions, _asCall, _bs, _be) {
  this.type = 'For';
  this.iterable = iterable;
  this.rules = rules;
  this.binding = binding;
  this.extendInstructions = extendInstructions;
  this._asCall = _asCall;
  this._bs = _bs;
  this._be = _be;
}

export function IfNode(branches, _asCall) {
  this.type = 'If';
  this.branches = branches;
  this._asCall = _asCall;
}

export function WhileNode(guard, rules) {
  this.type = 'While';
  this.guard = guard;
  this.rules = rules;
}

export function RangeNode(start, end, step, includeStart, includeEnd) {
  this.type = 'Range';
  this.start = start;
  this.end = end;
  this.step = step;
  this.includeStart = includeStart;
  this.includeEnd = includeEnd;
}

export function ReferenceNode(base, steps, raw, _s, _e) {
  this.type = 'Reference';
  this.base = base;
  this.steps = steps;
  this.raw = raw;
  this._s = _s;
  this._e = _e;
}

export function LookupNode(scope, kind, name, raw, _s, _e) {
  this.type = 'Lookup';
  this.scope = scope;
  this.kind = kind;
  this.name = name;
  this.raw = raw;
  this._s = _s;
  this._e = _e;
}

export function CompoundSelectorNode(value, _s, _e) {
  this.type = 'CompoundSelector';
  this.value = value;
  this._s = _s;
  this._e = _e;
}

export function ComplexSelectorNode(value, _s, _e) {
  this.type = 'ComplexSelector';
  this.value = value;
  this._s = _s;
  this._e = _e;
}

export function RelativeSelectorNode(value, _s, _e) {
  this.type = 'RelativeSelector';
  this.value = value;
  this._s = _s;
  this._e = _e;
}

export function SelectorListNode(selectors, _s, _e, _level) {
  this.type = 'SelectorList';
  this.selectors = selectors;
  this._s = _s;
  this._e = _e;
  this._level = _level;
}

export function ValueOnNewLineDeclarationNode(name, value, merge, important, valueOnNewLine, _s, _e) {
  this.type = 'Declaration';
  this.name = name;
  this.value = value;
  this.merge = merge;
  this.important = important;
  this.valueOnNewLine = valueOnNewLine;
  this._s = _s;
  this._e = _e;
}

export function DeclarationNode(name, value, merge, important, _s, _e) {
  this.type = 'Declaration';
  this.name = name;
  this.value = value;
  this.merge = merge;
  this.important = important;
  this._s = _s;
  this._e = _e;
}

export function ValueOnNewLineCollectionEntryNode(key, value, merge, important, valueOnNewLine) {
  this.type = 'CollectionEntry';
  this.key = key;
  this.value = value;
  this.merge = merge;
  this.important = important;
  this.valueOnNewLine = valueOnNewLine;
}

export function CollectionEntryNode(key, value, merge, important) {
  this.type = 'CollectionEntry';
  this.key = key;
  this.value = value;
  this.merge = merge;
  this.important = important;
}

export function CollectionSpreadNode(value) {
  this.type = 'CollectionSpread';
  this.value = value;
}

export function CollectionNode(entries) {
  this.type = 'Collection';
  this.entries = entries;
}

export function NestedPropertyBlockNode(entries, base) {
  this.type = 'NestedPropertyBlock';
  this.entries = entries;
  this.base = base;
}

export function CommentNode(text, _s, _e) {
  this.type = 'Comment';
  this.text = text;
  this._s = _s;
  this._e = _e;
}

export function LookupStepNode(kind, name) {
  this.type = 'LookupStep';
  this.kind = kind;
  this.name = name;
}

export function IndexedLookupStepNode(kind, name, indexBase) {
  this.type = 'LookupStep';
  this.kind = kind;
  this.name = name;
  this.indexBase = indexBase;
}

export function ImportantNode(value) {
  this.type = 'Important';
  this.value = value;
}

export function OperationNode(operator, left, right, inMathFunction, mathOutsideParens, _s, _e) {
  this.type = 'Operation';
  this.operator = operator;
  this.left = left;
  this.right = right;
  this.inMathFunction = inMathFunction;
  this.mathOutsideParens = mathOutsideParens;
  this._s = _s;
  this._e = _e;
}

export function FunctionCallNode(name, args, modern, _s, _e, _fnScope) {
  this.type = 'FunctionCall';
  this.name = name;
  this.args = args;
  this.modern = modern;
  this._s = _s;
  this._e = _e;
  this._fnScope = _fnScope;
}

export function EscapedBlockNode(value, delimiter, escaped, _s, _e) {
  this.type = 'Block';
  this.value = value;
  this.delimiter = delimiter;
  this.escaped = escaped;
  this._s = _s;
  this._e = _e;
}

export function BlockNode(value, delimiter, _s, _e) {
  this.type = 'Block';
  this.value = value;
  this.delimiter = delimiter;
  this._s = _s;
  this._e = _e;
}

export function BranchNode(condition, value) {
  this.type = 'Branch';
  this.condition = condition;
  this.value = value;
}

export function ExpressionNode(value, _s, _e, _asCall, _callArgument) {
  this.type = 'Expression';
  this.value = value;
  this._s = _s;
  this._e = _e;
  this._asCall = _asCall;
  this._callArgument = _callArgument;
}

export function ConditionNode(guard, src, _s, _e) {
  this.type = 'Condition';
  this.guard = guard;
  this.src = src;
  this._s = _s;
  this._e = _e;
}

export function IfValueNode(branches, _asCall, trailingSemicolon, name) {
  this.type = 'IfValue';
  this.branches = branches;
  this._asCall = _asCall;
  this.trailingSemicolon = trailingSemicolon;
  this.name = name;
}

export function VariableDeclarationNode(name, value, write, _s, _e) {
  this.type = 'VariableDeclaration';
  this.name = name;
  this.value = value;
  this.write = write;
  this._s = _s;
  this._e = _e;
}

export function VariableExposeNode(names, _s, _e) {
  this.type = 'VariableExpose';
  this.names = names;
  this._s = _s;
  this._e = _e;
}

export function MixinDefinitionNode(name, params, rules, extendInstructions, guard, ruleMixin, _s, _e, _bs, _be) {
  this.type = 'MixinDefinition';
  this.name = name;
  this.params = params;
  this.rules = rules;
  this.extendInstructions = extendInstructions;
  this.guard = guard;
  this.ruleMixin = ruleMixin;
  this._s = _s;
  this._e = _e;
  this._bs = _bs;
  this._be = _be;
}

export function MixinCallNode(name, args, path, important, content, _s, _e) {
  this.type = 'MixinCall';
  this.name = name;
  this.args = args;
  this.path = path;
  this.important = important;
  this.content = content;
  this._s = _s;
  this._e = _e;
}

export function ApplyNode(selectors) {
  this.type = 'Apply';
  this.selectors = selectors;
}

export function StyleImportNode(name, target, options, alias, mode, namespace, forward, config, _s, _e) {
  this.type = 'StyleImport';
  this.name = name;
  this.target = target;
  this.options = options;
  this.alias = alias;
  this.mode = mode;
  this.namespace = namespace;
  this.forward = forward;
  this.config = config;
  this._s = _s;
  this._e = _e;
}

export function ModuleImportNode(path, mode, defaultImport, namespace, imports, _s, _e) {
  this.type = 'ModuleImport';
  this.path = path;
  this.mode = mode;
  this.defaultImport = defaultImport;
  this.namespace = namespace;
  this.imports = imports;
  this._s = _s;
  this._e = _e;
}

export function StylesheetNode(rules, _s, _e, _trivia, _extend) {
  this.type = 'Stylesheet';
  this.rules = rules;
  this._s = _s;
  this._e = _e;
  this._trivia = _trivia;
  this._extend = _extend;
}

const scssAtRootKey = Symbol.for('jess.ast.scss-at-root');

export function AtRuleBlockNode(name, prelude, rules, extendInstructions, _s, _e, _bs, _be) {
  this.type = 'AtRuleBlock';
  this.name = name;
  this.prelude = prelude;
  this.rules = rules;
  this.extendInstructions = extendInstructions;
  this._s = _s;
  this._e = _e;
  this._bs = _bs;
  this._be = _be;
  this[scssAtRootKey] = false;
}

export function UnknownAtRuleBlockNode(name, prelude, rawBody, _s, _e) {
  this.type = 'UnknownAtRuleBlock';
  this.name = name;
  this.prelude = prelude;
  this.rawBody = rawBody;
  this._s = _s;
  this._e = _e;
}

export function PluginNode(target, options, _s, _e) {
  this.type = 'Plugin';
  this.target = target;
  this.options = options;
  this._s = _s;
  this._e = _e;
}

for (const f of [
  KeywordNode,
  AnyNode,
  UrlNode,
  SelectorCaptureNode,
  ColorNode,
  QuotedNode,
  DimensionNode,
  SequenceNode,
  ListNode,
  SimpleSelectorNode,
  PseudoSelectorNode,
  AnPlusBNode,
  InterpolationNode,
  LeadQuotingInterpolationNode,
  AnonymousMixinNode,
  AnonymousMixinWithParamsNode,
  ForNode,
  IfNode,
  WhileNode,
  RangeNode,
  ReferenceNode,
  LookupNode,
  CompoundSelectorNode,
  ComplexSelectorNode,
  RelativeSelectorNode,
  SelectorListNode,
  ValueOnNewLineDeclarationNode,
  DeclarationNode,
  ValueOnNewLineCollectionEntryNode,
  CollectionEntryNode,
  CollectionSpreadNode,
  CollectionNode,
  NestedPropertyBlockNode,
  CommentNode,
  LookupStepNode,
  IndexedLookupStepNode,
  ImportantNode,
  OperationNode,
  FunctionCallNode,
  EscapedBlockNode,
  BlockNode,
  BranchNode,
  ExpressionNode,
  ConditionNode,
  IfValueNode,
  VariableDeclarationNode,
  VariableExposeNode,
  MixinDefinitionNode,
  MixinCallNode,
  ApplyNode,
  StyleImportNode,
  ModuleImportNode,
  StylesheetNode,
  AtRuleBlockNode,
  UnknownAtRuleBlockNode,
  PluginNode
]) {
  f.prototype = Object.prototype;
}

/* The four Ruleset shapes, the CallArg value object, and the reference-call step. */
export function RulesetNode(selector, rules, _s, _e, _bs, _be) {
  this.type = 'Ruleset';
  this.selector = selector;
  this.rules = rules;
  this._s = _s;
  this._e = _e;
  this._bs = _bs;
  this._be = _be;
}

export function RulesetExtendNode(selector, rules, extendInstructions, _s, _e, _bs, _be) {
  this.type = 'Ruleset';
  this.selector = selector;
  this.rules = rules;
  this.extendInstructions = extendInstructions;
  this._s = _s;
  this._e = _e;
  this._bs = _bs;
  this._be = _be;
}

export function RulesetGuardNode(selector, rules, guard, _s, _e, _bs, _be) {
  this.type = 'Ruleset';
  this.selector = selector;
  this.rules = rules;
  this.guard = guard;
  this._s = _s;
  this._e = _e;
  this._bs = _bs;
  this._be = _be;
}

export function RulesetExtendGuardNode(selector, rules, extendInstructions, guard, _s, _e, _bs, _be) {
  this.type = 'Ruleset';
  this.selector = selector;
  this.rules = rules;
  this.extendInstructions = extendInstructions;
  this.guard = guard;
  this._s = _s;
  this._e = _e;
  this._bs = _bs;
  this._be = _be;
}

export function CallArgValue(value, name, spread, sigil) {
  this.value = value;
  this.name = name;
  this.spread = spread;
  this.sigil = sigil;
}

export function ReferenceCallNode(args) {
  this.type = 'Call';
  this.args = args;
}

for (const f of [RulesetNode, RulesetExtendNode, RulesetGuardNode, RulesetExtendGuardNode, CallArgValue, ReferenceCallNode]) {
  f.prototype = Object.prototype;
}

/* The `null` literal, an `@expose` name, a namespaced-call path segment, and a block-less at-rule. */
export function NullNode(src) {
  this.type = 'Null';
  this.src = src;
}

export function ExposedNameNode(name, _s, _e) {
  this.name = name;
  this._s = _s;
  this._e = _e;
}

export function MixinPathSegmentNode(combinator, selector) {
  this.combinator = combinator;
  this.selector = selector;
}

const importStartKey = Symbol.for('jess.ast.import-source-start');
const importEndKey = Symbol.for('jess.ast.import-source-end');
const importTailStartKey = Symbol.for('jess.ast.import-tail-start');
const diagnosticKey = Symbol.for('jess.ast.scss-diagnostic');

export function AtRuleStatementNode(name, prelude, _s, _e) {
  this.type = 'AtRuleStatement';
  this.name = name;
  this.prelude = prelude;
  this._s = _s;
  this._e = _e;
  this[importStartKey] = -1;
  this[importEndKey] = -1;
  this[importTailStartKey] = -1;
  this[diagnosticKey] = false;
}

/* Guard conditions (guard-node.ts): one constructor per shape, so `cmp`/`match`, `and`/`or` and `truth`/`css` share a class. */
export function GuardCompareNode(g, op, left, right, implied, parens) {
  this.g = g;
  this.op = op;
  this.left = left;
  this.right = right;
  this.implied = implied;
  this.parens = parens;
}

export function GuardLogicalNode(g, left, right, word, gluedAt, parens) {
  this.g = g;
  this.left = left;
  this.right = right;
  this.word = word;
  this.gluedAt = gluedAt;
  this.parens = parens;
}

export function GuardNotNode(inner, word, gluedAt, parens) {
  this.g = 'not';
  this.inner = inner;
  this.word = word;
  this.gluedAt = gluedAt;
  this.parens = parens;
}

export function GuardValueNode(g, value, parens) {
  this.g = g;
  this.value = value;
  this.parens = parens;
}

export function GuardCallNode(name, args, parens) {
  this.g = 'call';
  this.name = name;
  this.args = args;
  this.parens = parens;
}

export function GuardDefaultNode(parens) {
  this.g = 'default';
  this.parens = parens;
}

/*
 * Value-domain nodes (value-eval.ts), built by value-factory.ts. A field a value carries
 * only sometimes (`preserved`, `hsl`, `escaped`, ...) is stored after construction, in one
 * order per factory, so it extends the constructor's class instead of starting another.
 */
export function DimensionValueNode(number, unit, bytes) {
  this.type = 'Dimension';
  this.number = number;
  this.unit = unit;
  this.bytes = bytes;
}

export function CompoundDimensionValueNode(number, unit, numerator, denominator, bytes) {
  this.type = 'Dimension';
  this.number = number;
  this.unit = unit;
  this.numerator = numerator;
  this.denominator = denominator;
  this.bytes = bytes;
}

export function ColorValueNode(rgb, alpha, format, bytes) {
  this.type = 'Color';
  this.rgb = rgb;
  this.alpha = alpha;
  this.format = format;
  this.bytes = bytes;
}

export function HslColorValueNode(rgb, alpha, hsl, format, bytes) {
  this.type = 'Color';
  this.rgb = rgb;
  this.alpha = alpha;
  this.hsl = hsl;
  this.format = format;
  this.bytes = bytes;
}

export function QuotedValueNode(value, quote, escaped, bytes) {
  this.type = 'Quoted';
  this.value = value;
  this.quote = quote;
  this.escaped = escaped;
  this.bytes = bytes;
}

export function KeywordValueNode(text, bytes, groups) {
  this.type = 'Keyword';
  this.text = text;
  this.bytes = bytes;
  this.groups = groups;
}

export function FunctionCallValueNode(name, args, result, computed, bytes) {
  this.type = 'FunctionCall';
  this.name = name;
  this.args = args;
  this.result = result;
  this.computed = computed;
  this.bytes = bytes;
}

export function AnyValueNode(bytes, escapedQuote, groups) {
  this.type = 'Any';
  this.bytes = bytes;
  this.escapedQuote = escapedQuote;
  this.groups = groups;
}

export function UrlValueNode(bytes) {
  this.type = 'Url';
  this.bytes = bytes;
}

export function BoolValueNode(value, bytes) {
  this.type = 'Bool';
  this.value = value;
  this.bytes = bytes;
}

export function NullValueNode(explicit) {
  this.type = 'Null';
  this.explicit = explicit;
  this.bytes = '';
}

export function ListValueNode(value, sep, selector, bytes) {
  this.type = 'List';
  this.value = value;
  this.sep = sep;
  this.selector = selector;
  this.bytes = bytes;
}

export function CollectionValueNode(entries, bytes) {
  this.type = 'Collection';
  this.entries = entries;
  this.bytes = bytes;
}

export function BlockValueNode(value, delimiter, bytes) {
  this.type = 'Block';
  this.value = value;
  this.delimiter = delimiter;
  this.bytes = bytes;
}

for (const f of [
  NullNode, ExposedNameNode, MixinPathSegmentNode, AtRuleStatementNode,
  GuardCompareNode, GuardLogicalNode, GuardNotNode, GuardValueNode, GuardCallNode, GuardDefaultNode,
  DimensionValueNode, CompoundDimensionValueNode, ColorValueNode, HslColorValueNode, QuotedValueNode, KeywordValueNode, FunctionCallValueNode,
  AnyValueNode, UrlValueNode, BoolValueNode, NullValueNode, ListValueNode, CollectionValueNode, BlockValueNode
]) {
  f.prototype = Object.prototype;
}

/*
 * copyNode: a node rebuilt through the constructor of its shape, then any field stored on it
 * after construction, in order — what `{ ...node }` copies, without a literal's class. Each
 * constructor body runs once, as a plain call with sentinel arguments on a null-prototype
 * object, to learn which argument fills which field, so no field list is written twice. That
 * object is a dictionary from the start: the probe touches no constructor's class and no
 * field's representation.
 */
const SHAPES = new Map();
for (const f of [
  KeywordNode, AnyNode, UrlNode, SelectorCaptureNode, ColorNode, QuotedNode, DimensionNode, SequenceNode, ListNode,
  SimpleSelectorNode, PseudoSelectorNode, AnPlusBNode, InterpolationNode, LeadQuotingInterpolationNode, AnonymousMixinNode, AnonymousMixinWithParamsNode,
  ForNode, IfNode, WhileNode, RangeNode, ReferenceNode, LookupNode, CompoundSelectorNode, ComplexSelectorNode,
  RelativeSelectorNode, SelectorListNode, ValueOnNewLineDeclarationNode, DeclarationNode, ValueOnNewLineCollectionEntryNode,
  CollectionEntryNode, CollectionSpreadNode, CollectionNode, NestedPropertyBlockNode, CommentNode, LookupStepNode,
  IndexedLookupStepNode, ImportantNode, OperationNode, FunctionCallNode, EscapedBlockNode, BlockNode, BranchNode,
  ExpressionNode, ConditionNode, IfValueNode, VariableDeclarationNode, VariableExposeNode, MixinDefinitionNode,
  MixinCallNode, ApplyNode, StyleImportNode, ModuleImportNode, StylesheetNode, AtRuleBlockNode, UnknownAtRuleBlockNode,
  PluginNode, RulesetNode, RulesetExtendNode, RulesetGuardNode, RulesetExtendGuardNode, ReferenceCallNode, NullNode, AtRuleStatementNode,
  DimensionValueNode, CompoundDimensionValueNode, ColorValueNode, HslColorValueNode, QuotedValueNode, KeywordValueNode, FunctionCallValueNode,
  AnyValueNode, UrlValueNode, BoolValueNode, NullValueNode, ListValueNode, CollectionValueNode, BlockValueNode
]) {
  const sentinels = Array.from({ length: f.length }, () => ({}));
  const probe = Object.create(null);
  Reflect.apply(f, probe, sentinels);
  const keys = Object.keys(probe);
  const args = sentinels.map(s => keys.find(k => probe[k] === s));
  const list = SHAPES.get(probe.type) ?? [];
  list.push({ f, keys, args });
  SHAPES.set(probe.type, list);
}

export function copyNode(node) {
  const keys = Object.keys(node);
  let shape;
  for (const s of SHAPES.get(node.type) ?? []) {
    if ((shape === undefined || s.keys.length > shape.keys.length) && s.keys.length <= keys.length && s.keys.every((k, i) => keys[i] === k)) {
      shape = s;
    }
  }
  if (shape === undefined) {
    throw new TypeError(`copyNode: no constructor builds a ${String(node.type)} with fields ${keys.join(', ')}`);
  }
  const copy = new shape.f(...shape.args.map(k => node[k]));
  for (let i = shape.keys.length; i < keys.length; i++) {
    copy[keys[i]] = node[keys[i]];
  }
  for (const sym of Object.getOwnPropertySymbols(node)) {
    copy[sym] = node[sym];
  }
  return copy;
}

/* `{ ...node, ...patch }` without a literal's class: the copy keeps the node's field order and appends a new field after them. */
export function withFields(node, patch) {
  return Object.assign(copyNode(node), patch);
}
