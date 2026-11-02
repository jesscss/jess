/*
 * Constructors for Jess's AST nodes, one per node shape. GENERATED from the node
 * literals in nodes.ts and at-rule.ts; node-ctors.d.ts types each one.
 *
 * Why constructors: V8 keeps an allocation site per object literal and decides per site
 * whether to allocate straight into old space (pretenuring), from where scavenges happen
 * to fall during warm-up, so identical processes split into a fast and a slow parse and
 * any change in bundle layout re-rolls it. A `new` call has no allocation site. Each
 * constructor's `prototype` is `Object.prototype`, so a node is still a plain object
 * (DESIGN-DECISIONS C3): same prototype, same `constructor`, same keys in the same order.
 * Plain JavaScript because TypeScript cannot declare a function constructor without a cast.
 * Keep ONE copy of this module per process: each constructor defines its own hidden class.
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

export function AnonymousMixinNode(rules, extendInstructions, _bs, _be) {
  this.type = 'AnonymousMixin';
  this.rules = rules;
  this.extendInstructions = extendInstructions;
  this._bs = _bs;
  this._be = _be;
}

export function AnonymousMixinNode2(rules, extendInstructions, params, _bs, _be) {
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

export function DeclarationNode(name, value, merge, important, valueOnNewLine, _s, _e) {
  this.type = 'Declaration';
  this.name = name;
  this.value = value;
  this.merge = merge;
  this.important = important;
  this.valueOnNewLine = valueOnNewLine;
  this._s = _s;
  this._e = _e;
}

export function DeclarationNode2(name, value, merge, important, _s, _e) {
  this.type = 'Declaration';
  this.name = name;
  this.value = value;
  this.merge = merge;
  this.important = important;
  this._s = _s;
  this._e = _e;
}

export function CollectionEntryNode(key, value, merge, important, valueOnNewLine) {
  this.type = 'CollectionEntry';
  this.key = key;
  this.value = value;
  this.merge = merge;
  this.important = important;
  this.valueOnNewLine = valueOnNewLine;
}

export function CollectionEntryNode2(key, value, merge, important) {
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

export function LookupStepNode2(kind, name, indexBase) {
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

export function BlockNode(value, delimiter, escaped, _s, _e) {
  this.type = 'Block';
  this.value = value;
  this.delimiter = delimiter;
  this.escaped = escaped;
  this._s = _s;
  this._e = _e;
}

export function BlockNode2(value, delimiter, _s, _e) {
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
  AnonymousMixinNode,
  AnonymousMixinNode2,
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
  DeclarationNode,
  DeclarationNode2,
  CollectionEntryNode,
  CollectionEntryNode2,
  CollectionSpreadNode,
  CollectionNode,
  NestedPropertyBlockNode,
  CommentNode,
  LookupStepNode,
  LookupStepNode2,
  ImportantNode,
  OperationNode,
  FunctionCallNode,
  BlockNode,
  BlockNode2,
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

/*
 * Written by hand: shapes the generator does not derive (a spread-built Ruleset, the
 * CallArg value object, and the reference-call step reducers build).
 */
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
