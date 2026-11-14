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
KeywordNode.prototype = Object.prototype;

export function AnyNode(src, _s, _e) {
  this.type = 'Any';
  this.src = src;
  this._s = _s;
  this._e = _e;
}
AnyNode.prototype = Object.prototype;

export function UrlNode(value, _s, _e) {
  this.type = 'Url';
  this.value = value;
  this._s = _s;
  this._e = _e;
}
UrlNode.prototype = Object.prototype;

export function SelectorCaptureNode(branches, components, src) {
  this.type = 'SelectorCapture';
  this.branches = branches;
  this.components = components;
  this.src = src;
}
SelectorCaptureNode.prototype = Object.prototype;

export function ColorNode(src) {
  this.type = 'Color';
  this.src = src;
}
ColorNode.prototype = Object.prototype;

export function QuotedNode(src, value, quote, escaped, interp) {
  this.type = 'Quoted';
  this.src = src;
  this.value = value;
  this.quote = quote;
  this.escaped = escaped;
  this.interp = interp;
}
QuotedNode.prototype = Object.prototype;

export function DimensionNode(number, unit, src) {
  this.type = 'Dimension';
  this.number = number;
  this.unit = unit;
  this.src = src;
}
DimensionNode.prototype = Object.prototype;

export function SequenceNode(parts) {
  this.type = 'Sequence';
  this.parts = parts;
}
SequenceNode.prototype = Object.prototype;

export function ListNode(value, sep) {
  this.type = 'List';
  this.value = value;
  this.sep = sep;
}
ListNode.prototype = Object.prototype;

export function SimpleSelectorNode(text, interp, _s, _e) {
  this.type = 'SimpleSelector';
  this.text = text;
  this.interp = interp;
  this._s = _s;
  this._e = _e;
}
SimpleSelectorNode.prototype = Object.prototype;

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
PseudoSelectorNode.prototype = Object.prototype;

export function AnPlusBNode(src) {
  this.type = 'AnPlusB';
  this.src = src;
}
AnPlusBNode.prototype = Object.prototype;

export function InterpolationNode(parts, _s, _e) {
  this.type = 'Interpolation';
  this.parts = parts;
  this._s = _s;
  this._e = _e;
}
InterpolationNode.prototype = Object.prototype;

export function LeadQuotingInterpolationNode(parts, _s, _e) {
  this.type = 'Interpolation';
  this.parts = parts;
  this._s = _s;
  this._e = _e;
  this.leadQuoting = true;
}
LeadQuotingInterpolationNode.prototype = Object.prototype;

export function AnonymousMixinNode(rules, extendInstructions, _bs, _be) {
  this.type = 'AnonymousMixin';
  this.rules = rules;
  this.extendInstructions = extendInstructions;
  this._bs = _bs;
  this._be = _be;
}
AnonymousMixinNode.prototype = Object.prototype;

export function AnonymousMixinWithParamsNode(rules, extendInstructions, params, _bs, _be) {
  this.type = 'AnonymousMixin';
  this.rules = rules;
  this.extendInstructions = extendInstructions;
  this.params = params;
  this._bs = _bs;
  this._be = _be;
}
AnonymousMixinWithParamsNode.prototype = Object.prototype;

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
ForNode.prototype = Object.prototype;

export function IfNode(branches, _asCall) {
  this.type = 'If';
  this.branches = branches;
  this._asCall = _asCall;
}
IfNode.prototype = Object.prototype;

export function WhileNode(guard, rules) {
  this.type = 'While';
  this.guard = guard;
  this.rules = rules;
}
WhileNode.prototype = Object.prototype;

export function RangeNode(start, end, step, includeStart, includeEnd) {
  this.type = 'Range';
  this.start = start;
  this.end = end;
  this.step = step;
  this.includeStart = includeStart;
  this.includeEnd = includeEnd;
}
RangeNode.prototype = Object.prototype;

export function ReferenceNode(base, steps, raw, _s, _e) {
  this.type = 'Reference';
  this.base = base;
  this.steps = steps;
  this.raw = raw;
  this._s = _s;
  this._e = _e;
}
ReferenceNode.prototype = Object.prototype;

export function LookupNode(scope, kind, name, raw, _s, _e) {
  this.type = 'Lookup';
  this.scope = scope;
  this.kind = kind;
  this.name = name;
  this.raw = raw;
  this._s = _s;
  this._e = _e;
}
LookupNode.prototype = Object.prototype;

export function CompoundSelectorNode(value, _s, _e) {
  this.type = 'CompoundSelector';
  this.value = value;
  this._s = _s;
  this._e = _e;
}
CompoundSelectorNode.prototype = Object.prototype;

export function ComplexSelectorNode(value, _s, _e) {
  this.type = 'ComplexSelector';
  this.value = value;
  this._s = _s;
  this._e = _e;
}
ComplexSelectorNode.prototype = Object.prototype;

export function RelativeSelectorNode(value, _s, _e) {
  this.type = 'RelativeSelector';
  this.value = value;
  this._s = _s;
  this._e = _e;
}
RelativeSelectorNode.prototype = Object.prototype;

export function SelectorListNode(selectors, _s, _e, _level) {
  this.type = 'SelectorList';
  this.selectors = selectors;
  this._s = _s;
  this._e = _e;
  this._level = _level;
}
SelectorListNode.prototype = Object.prototype;

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
ValueOnNewLineDeclarationNode.prototype = Object.prototype;

export function DeclarationNode(name, value, merge, important, _s, _e) {
  this.type = 'Declaration';
  this.name = name;
  this.value = value;
  this.merge = merge;
  this.important = important;
  this._s = _s;
  this._e = _e;
}
DeclarationNode.prototype = Object.prototype;

export function ValueOnNewLineCollectionEntryNode(key, value, merge, important, valueOnNewLine) {
  this.type = 'CollectionEntry';
  this.key = key;
  this.value = value;
  this.merge = merge;
  this.important = important;
  this.valueOnNewLine = valueOnNewLine;
}
ValueOnNewLineCollectionEntryNode.prototype = Object.prototype;

export function CollectionEntryNode(key, value, merge, important) {
  this.type = 'CollectionEntry';
  this.key = key;
  this.value = value;
  this.merge = merge;
  this.important = important;
}
CollectionEntryNode.prototype = Object.prototype;

export function CollectionSpreadNode(value) {
  this.type = 'CollectionSpread';
  this.value = value;
}
CollectionSpreadNode.prototype = Object.prototype;

export function CollectionNode(entries) {
  this.type = 'Collection';
  this.entries = entries;
}
CollectionNode.prototype = Object.prototype;

export function NestedPropertyBlockNode(entries, base) {
  this.type = 'NestedPropertyBlock';
  this.entries = entries;
  this.base = base;
}
NestedPropertyBlockNode.prototype = Object.prototype;

export function CommentNode(text, _s, _e) {
  this.type = 'Comment';
  this.text = text;
  this._s = _s;
  this._e = _e;
}
CommentNode.prototype = Object.prototype;

export function LookupStepNode(kind, name) {
  this.type = 'LookupStep';
  this.kind = kind;
  this.name = name;
}
LookupStepNode.prototype = Object.prototype;

export function IndexedLookupStepNode(kind, name, indexBase) {
  this.type = 'LookupStep';
  this.kind = kind;
  this.name = name;
  this.indexBase = indexBase;
}
IndexedLookupStepNode.prototype = Object.prototype;

export function ImportantNode(value) {
  this.type = 'Important';
  this.value = value;
}
ImportantNode.prototype = Object.prototype;

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
OperationNode.prototype = Object.prototype;

export function FunctionCallNode(name, args, modern, _s, _e, _fnScope) {
  this.type = 'FunctionCall';
  this.name = name;
  this.args = args;
  this.modern = modern;
  this._s = _s;
  this._e = _e;
  this._fnScope = _fnScope;
}
FunctionCallNode.prototype = Object.prototype;

export function EscapedBlockNode(value, delimiter, escaped, _s, _e) {
  this.type = 'Block';
  this.value = value;
  this.delimiter = delimiter;
  this.escaped = escaped;
  this._s = _s;
  this._e = _e;
}
EscapedBlockNode.prototype = Object.prototype;

export function BlockNode(value, delimiter, _s, _e) {
  this.type = 'Block';
  this.value = value;
  this.delimiter = delimiter;
  this._s = _s;
  this._e = _e;
}
BlockNode.prototype = Object.prototype;

export function BranchNode(condition, value) {
  this.type = 'Branch';
  this.condition = condition;
  this.value = value;
}
BranchNode.prototype = Object.prototype;

export function ExpressionNode(value, _s, _e, _asCall, _callArgument) {
  this.type = 'Expression';
  this.value = value;
  this._s = _s;
  this._e = _e;
  this._asCall = _asCall;
  this._callArgument = _callArgument;
}
ExpressionNode.prototype = Object.prototype;

export function ConditionNode(guard, src, _s, _e) {
  this.type = 'Condition';
  this.guard = guard;
  this.src = src;
  this._s = _s;
  this._e = _e;
}
ConditionNode.prototype = Object.prototype;

export function IfValueNode(branches, _asCall, trailingSemicolon, name) {
  this.type = 'IfValue';
  this.branches = branches;
  this._asCall = _asCall;
  this.trailingSemicolon = trailingSemicolon;
  this.name = name;
}
IfValueNode.prototype = Object.prototype;

export function VariableDeclarationNode(name, value, write, _s, _e) {
  this.type = 'VariableDeclaration';
  this.name = name;
  this.value = value;
  this.write = write;
  this._s = _s;
  this._e = _e;
}
VariableDeclarationNode.prototype = Object.prototype;

export function VariableExposeNode(names, _s, _e) {
  this.type = 'VariableExpose';
  this.names = names;
  this._s = _s;
  this._e = _e;
}
VariableExposeNode.prototype = Object.prototype;

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
MixinDefinitionNode.prototype = Object.prototype;

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
MixinCallNode.prototype = Object.prototype;

export function ApplyNode(selectors) {
  this.type = 'Apply';
  this.selectors = selectors;
}
ApplyNode.prototype = Object.prototype;

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
StyleImportNode.prototype = Object.prototype;

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
ModuleImportNode.prototype = Object.prototype;

export function StylesheetNode(rules, _s, _e, _trivia, _extend) {
  this.type = 'Stylesheet';
  this.rules = rules;
  this._s = _s;
  this._e = _e;
  this._trivia = _trivia;
  this._extend = _extend;
}
StylesheetNode.prototype = Object.prototype;

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
AtRuleBlockNode.prototype = Object.prototype;

export function UnknownAtRuleBlockNode(name, prelude, rawBody, _s, _e) {
  this.type = 'UnknownAtRuleBlock';
  this.name = name;
  this.prelude = prelude;
  this.rawBody = rawBody;
  this._s = _s;
  this._e = _e;
}
UnknownAtRuleBlockNode.prototype = Object.prototype;

export function PluginNode(target, options, _s, _e) {
  this.type = 'Plugin';
  this.target = target;
  this.options = options;
  this._s = _s;
  this._e = _e;
}
PluginNode.prototype = Object.prototype;

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
RulesetNode.prototype = Object.prototype;

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
RulesetExtendNode.prototype = Object.prototype;

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
RulesetGuardNode.prototype = Object.prototype;

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
RulesetExtendGuardNode.prototype = Object.prototype;

export function CallArgValue(value, name, spread, sigil) {
  this.value = value;
  this.name = name;
  this.spread = spread;
  this.sigil = sigil;
}
CallArgValue.prototype = Object.prototype;

export function ReferenceCallNode(args) {
  this.type = 'Call';
  this.args = args;
}
ReferenceCallNode.prototype = Object.prototype;

/* The `null` literal, an `@expose` name, a namespaced-call path segment, and a block-less at-rule. */
export function NullNode(src) {
  this.type = 'Null';
  this.src = src;
}
NullNode.prototype = Object.prototype;

export function ExposedNameNode(name, _s, _e) {
  this.name = name;
  this._s = _s;
  this._e = _e;
}
ExposedNameNode.prototype = Object.prototype;

export function MixinPathSegmentNode(combinator, selector) {
  this.combinator = combinator;
  this.selector = selector;
}
MixinPathSegmentNode.prototype = Object.prototype;

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
AtRuleStatementNode.prototype = Object.prototype;

/* Guard conditions (guard-node.ts): one constructor per shape, so `cmp`/`match`, `and`/`or` and `truth`/`css` share a class. */
export function GuardCompareNode(g, op, left, right, implied, parens) {
  this.g = g;
  this.op = op;
  this.left = left;
  this.right = right;
  this.implied = implied;
  this.parens = parens;
}
GuardCompareNode.prototype = Object.prototype;

export function GuardLogicalNode(g, left, right, word, gluedAt, parens) {
  this.g = g;
  this.left = left;
  this.right = right;
  this.word = word;
  this.gluedAt = gluedAt;
  this.parens = parens;
}
GuardLogicalNode.prototype = Object.prototype;

export function GuardNotNode(inner, word, gluedAt, parens) {
  this.g = 'not';
  this.inner = inner;
  this.word = word;
  this.gluedAt = gluedAt;
  this.parens = parens;
}
GuardNotNode.prototype = Object.prototype;

export function GuardValueNode(g, value, parens) {
  this.g = g;
  this.value = value;
  this.parens = parens;
}
GuardValueNode.prototype = Object.prototype;

export function GuardCallNode(name, args, parens) {
  this.g = 'call';
  this.name = name;
  this.args = args;
  this.parens = parens;
}
GuardCallNode.prototype = Object.prototype;

export function GuardDefaultNode(parens) {
  this.g = 'default';
  this.parens = parens;
}
GuardDefaultNode.prototype = Object.prototype;

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
DimensionValueNode.prototype = Object.prototype;

export function CompoundDimensionValueNode(number, unit, numerator, denominator, bytes) {
  this.type = 'Dimension';
  this.number = number;
  this.unit = unit;
  this.numerator = numerator;
  this.denominator = denominator;
  this.bytes = bytes;
}
CompoundDimensionValueNode.prototype = Object.prototype;

export function ColorValueNode(rgb, alpha, format, bytes) {
  this.type = 'Color';
  this.rgb = rgb;
  this.alpha = alpha;
  this.format = format;
  this.bytes = bytes;
}
ColorValueNode.prototype = Object.prototype;

export function HslColorValueNode(rgb, alpha, hsl, format, bytes) {
  this.type = 'Color';
  this.rgb = rgb;
  this.alpha = alpha;
  this.hsl = hsl;
  this.format = format;
  this.bytes = bytes;
}
HslColorValueNode.prototype = Object.prototype;

export function QuotedValueNode(value, quote, escaped, bytes) {
  this.type = 'Quoted';
  this.value = value;
  this.quote = quote;
  this.escaped = escaped;
  this.bytes = bytes;
}
QuotedValueNode.prototype = Object.prototype;

export function KeywordValueNode(text, bytes, groups) {
  this.type = 'Keyword';
  this.text = text;
  this.bytes = bytes;
  this.groups = groups;
}
KeywordValueNode.prototype = Object.prototype;

export function FunctionCallValueNode(name, args, result, computed, bytes) {
  this.type = 'FunctionCall';
  this.name = name;
  this.args = args;
  this.result = result;
  this.computed = computed;
  this.bytes = bytes;
}
FunctionCallValueNode.prototype = Object.prototype;

export function ArithmeticValueNode(op, left, right, kept, bytes, written) {
  this.type = 'Arithmetic';
  this.op = op;
  this.left = left;
  this.right = right;
  this.kept = kept;
  this.bytes = bytes;
  this.written = written;
}
ArithmeticValueNode.prototype = Object.prototype;

export function AnyValueNode(bytes, escapedQuote, groups) {
  this.type = 'Any';
  this.bytes = bytes;
  this.escapedQuote = escapedQuote;
  this.groups = groups;
}
AnyValueNode.prototype = Object.prototype;

export function UrlValueNode(bytes) {
  this.type = 'Url';
  this.bytes = bytes;
}
UrlValueNode.prototype = Object.prototype;

export function BoolValueNode(value, bytes) {
  this.type = 'Bool';
  this.value = value;
  this.bytes = bytes;
}
BoolValueNode.prototype = Object.prototype;

export function NullValueNode(explicit) {
  this.type = 'Null';
  this.explicit = explicit;
  this.bytes = '';
}
NullValueNode.prototype = Object.prototype;

export function ListValueNode(value, sep, selector, bytes) {
  this.type = 'List';
  this.value = value;
  this.sep = sep;
  this.selector = selector;
  this.bytes = bytes;
}
ListValueNode.prototype = Object.prototype;

export function CollectionValueNode(entries, bytes) {
  this.type = 'Collection';
  this.entries = entries;
  this.bytes = bytes;
}
CollectionValueNode.prototype = Object.prototype;

export function BlockValueNode(value, delimiter, bytes) {
  this.type = 'Block';
  this.value = value;
  this.delimiter = delimiter;
  this.bytes = bytes;
}
BlockValueNode.prototype = Object.prototype;

/*
 * copyNode: a node rebuilt through the constructor of its shape, then any field stored on it
 * after construction, in order — what `{ ...node }` copies, without a literal's class. Each
 * constructor body runs once, as a plain call with sentinel arguments on a null-prototype
 * object, to learn which argument fills which field, so no field list is written twice. That
 * object is a dictionary from the start: the probe touches no constructor's class and no
 * field's representation. Built on the first copy, so a bundle that never copies a node drops
 * the table and every constructor only the table names.
 */
let shapes;
const allShapes = () => shapes ??= shapesOf([
  KeywordNode, AnyNode, UrlNode, SelectorCaptureNode, ColorNode, QuotedNode, DimensionNode, SequenceNode, ListNode,
  SimpleSelectorNode, PseudoSelectorNode, AnPlusBNode, InterpolationNode, LeadQuotingInterpolationNode, AnonymousMixinNode, AnonymousMixinWithParamsNode,
  ForNode, IfNode, WhileNode, RangeNode, ReferenceNode, LookupNode, CompoundSelectorNode, ComplexSelectorNode,
  RelativeSelectorNode, SelectorListNode, ValueOnNewLineDeclarationNode, DeclarationNode, ValueOnNewLineCollectionEntryNode,
  CollectionEntryNode, CollectionSpreadNode, CollectionNode, NestedPropertyBlockNode, CommentNode, LookupStepNode,
  IndexedLookupStepNode, ImportantNode, OperationNode, FunctionCallNode, EscapedBlockNode, BlockNode, BranchNode,
  ExpressionNode, ConditionNode, IfValueNode, VariableDeclarationNode, VariableExposeNode, MixinDefinitionNode,
  MixinCallNode, ApplyNode, StyleImportNode, ModuleImportNode, StylesheetNode, AtRuleBlockNode, UnknownAtRuleBlockNode,
  PluginNode, RulesetNode, RulesetExtendNode, RulesetGuardNode, RulesetExtendGuardNode, ReferenceCallNode, NullNode, AtRuleStatementNode,
  DimensionValueNode, CompoundDimensionValueNode, ColorValueNode, HslColorValueNode, QuotedValueNode, KeywordValueNode, FunctionCallValueNode, ArithmeticValueNode,
  AnyValueNode, UrlValueNode, BoolValueNode, NullValueNode, ListValueNode, CollectionValueNode, BlockValueNode
]);

function shapesOf(ctors) {
  const shapes = new Map();
  for (const f of ctors) {
    const sentinels = Array.from({ length: f.length }, () => ({}));
    const probe = Object.create(null);
    Reflect.apply(f, probe, sentinels);
    const keys = Object.keys(probe);
    const args = sentinels.map(s => keys.find(k => probe[k] === s));
    const list = shapes.get(probe.type) ?? [];
    list.push({ f, keys, args });
    shapes.set(probe.type, list);
  }
  return shapes;
}

export function copyNode(node) {
  const keys = Object.keys(node);
  let shape;
  for (const s of allShapes().get(node.type) ?? []) {
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
