import type {
  Apply,
  ComplexSelector,
  CompoundSelector,
  CollectionEntry,
  Declaration,
  FunctionCall,
  If,
  Interpolation,
  MixinCall,
  MixinDefinition,
  ModuleImport,
  Param,
  PseudoSelector,
  Reference,
  Ruleset,
  SelectorList,
  SimpleSelector,
  SimpleToken,
  Statement,
  StyleImport,
  Stylesheet,
  ValueNode,
  ValueSlot,
  VariableDeclaration
} from './nodes.js';
import type { AtRuleBlock, AtRuleStatement, ImportAtRule, OpaqueAtRuleBlock, Plugin } from './at-rule.js';
import type { GuardNode } from './guard.js';
import type { CallArg, CallValue } from './mixin-dispatch.js';

export type AstVisitNode =
  | Stylesheet
  | Statement
  | ValueNode
  | CollectionEntry
  | SelectorList
  | ComplexSelector
  | CompoundSelector
  | SimpleToken;

export type AstVisitParent =
  | AstVisitNode
  | readonly ValueSlot[]
  | GuardNode
  | null;

export type AstEdge =
  | 'root'
  | 'stylesheet.rules'
  | 'ruleset.selector'
  | 'ruleset.guard'
  | 'ruleset.extend.target'
  | 'ruleset.extend.subject'
  | 'ruleset.rules'
  | 'declaration.name'
  | 'declaration.value'
  | 'variable.value'
  | 'mixin.param-default'
  | 'mixin.param-pattern'
  | 'mixin.guard'
  | 'mixin.rules'
  | 'mixin-call.arg'
  | 'apply.selector'
  | 'for.iterable'
  | 'for.rules'
  | 'if.branch.guard'
  | 'if.branch.rules'
  | 'style-import.path'
  | 'module-import.path'
  | 'atrule.prelude'
  | 'atrule.rules'
  | 'atrule-statement.prelude'
  | 'import.options'
  | 'import.target'
  | 'import.alias'
  | 'import.tail'
  | 'plugin.target'
  | 'plugin.options'
  | 'selector.branch'
  | 'selector.value'
  | 'selector.simple'
  | 'selector.simple.interp'
  | 'selector.pseudo.interp'
  | 'selector.pseudo.args'
  | 'value-slot.item'
  | 'value.url.value'
  | 'value.parts'
  | 'value.list.item'
  | 'value.value'
  | 'value.operation.left'
  | 'value.operation.right'
  | 'value.function.arg'
  | 'value.interpolation.ref'
  | 'value.general.content'
  | 'value.var-indirect.name'
  | 'value.condition.guard'
  | 'value.reference.base'
  | 'value.reference.bracket-key'
  | 'value.reference.call-arg'
  | 'value.range.start'
  | 'value.range.end'
  | 'value.range.step'
  | 'value.collection.base'
  | 'value.collection.entry'
  | 'value.collection.key'
  | 'value.collection.value'
  | 'value.anonymous-mixin.param-default'
  | 'value.anonymous-mixin.param-pattern'
  | 'value.anonymous-mixin.rules'
  | 'call-arg.value'
  | 'guard.cmp.left'
  | 'guard.cmp.right'
  | 'guard.logical.left'
  | 'guard.logical.right'
  | 'guard.not.inner'
  | 'guard.truth.value'
  | 'guard.call.arg';

export interface AstCursor {
  readonly phase: 'authored';
  readonly edge: AstEdge;
  readonly parentKind: 'node' | 'slot' | 'guard' | null;
  readonly parent: AstVisitParent;
  readonly index: number;
  readonly depth: number;
}

export type AstVisitDecision = void | 'skip-children';

export interface AstVisitHooks {
  enterNode?(node: AstVisitNode, cursor: AstCursor): AstVisitDecision;
  leaveNode?(node: AstVisitNode, cursor: AstCursor): void;
  enterSlot?(slot: readonly ValueSlot[], cursor: AstCursor): AstVisitDecision;
  leaveSlot?(slot: readonly ValueSlot[], cursor: AstCursor): void;
  enterGuard?(guard: GuardNode, cursor: AstCursor): AstVisitDecision;
  leaveGuard?(guard: GuardNode, cursor: AstCursor): void;
}

type ParentKind = AstCursor['parentKind'];

function cursor(
  edge: AstEdge,
  parent: AstVisitParent,
  parentKind: ParentKind,
  index: number,
  depth: number
): AstCursor {
  return { phase: 'authored', edge, parentKind, parent, index, depth };
}

function nodeParentKind(parent: AstVisitParent): ParentKind {
  if (parent === null) {
    return null;
  }
  return isValueSlotArray(parent) ? 'slot' : 'type' in parent ? 'node' : 'guard';
}

function isValueSlotArray(value: AstVisitParent | CallValue | ValueSlot): value is readonly ValueSlot[] {
  return Array.isArray(value);
}

function walkValueSlot(
  slot: ValueSlot,
  hooks: AstVisitHooks,
  edge: AstEdge,
  parent: AstVisitParent,
  index: number,
  depth: number
): void {
  if (isValueSlotArray(slot)) {
    const c = cursor(edge, parent, nodeParentKind(parent), index, depth);
    if (hooks.enterSlot?.(slot, c) === 'skip-children') {
      hooks.leaveSlot?.(slot, c);
      return;
    }
    for (let i = 0; i < slot.length; i++) {
      walkValueSlot(slot[i]!, hooks, 'value-slot.item', slot, i, depth + 1);
    }
    hooks.leaveSlot?.(slot, c);
    return;
  }
  walkNode(slot, hooks, edge, parent, index, depth);
}

function walkCallValue(
  value: CallValue,
  hooks: AstVisitHooks,
  edge: AstEdge,
  parent: AstVisitParent,
  index: number,
  depth: number
): void {
  if (isValueSlotArray(value)) {
    walkValueSlot(value, hooks, edge, parent, index, depth);
    return;
  }
  walkNode(value, hooks, edge, parent, index, depth);
}

function walkCallArg(
  arg: CallArg,
  hooks: AstVisitHooks,
  edge: AstEdge,
  parent: AstVisitParent,
  index: number,
  depth: number
): void {
  walkCallValue(arg.value, hooks, edge, parent, index, depth);
}

function walkParams(
  params: readonly Param[],
  parent: AstVisitNode,
  hooks: AstVisitHooks,
  depth: number,
  edgePrefix: 'mixin' | 'value.anonymous-mixin'
): void {
  for (let i = 0; i < params.length; i++) {
    const param = params[i]!;
    if (param.default !== undefined) {
      walkValueSlot(param.default, hooks, `${edgePrefix}.param-default`, parent, i, depth + 1);
    }
    if (param.pattern !== undefined) {
      walkValueSlot(param.pattern, hooks, `${edgePrefix}.param-pattern`, parent, i, depth + 1);
    }
  }
}

function walkGuard(
  guard: GuardNode,
  hooks: AstVisitHooks,
  edge: AstEdge,
  parent: AstVisitParent,
  index: number,
  depth: number
): void {
  const c = cursor(edge, parent, nodeParentKind(parent), index, depth);
  if (hooks.enterGuard?.(guard, c) === 'skip-children') {
    hooks.leaveGuard?.(guard, c);
    return;
  }
  switch (guard.g) {
    case 'cmp':
      walkValueSlot(guard.left, hooks, 'guard.cmp.left', guard, 0, depth + 1);
      walkValueSlot(guard.right, hooks, 'guard.cmp.right', guard, 1, depth + 1);
      break;
    case 'and':
    case 'or':
      walkGuard(guard.left, hooks, 'guard.logical.left', guard, 0, depth + 1);
      walkGuard(guard.right, hooks, 'guard.logical.right', guard, 1, depth + 1);
      break;
    case 'not':
      walkGuard(guard.inner, hooks, 'guard.not.inner', guard, 0, depth + 1);
      break;
    case 'truth':
      walkValueSlot(guard.value, hooks, 'guard.truth.value', guard, 0, depth + 1);
      break;
    case 'call':
      for (let i = 0; i < guard.args.length; i++) {
        walkValueSlot(guard.args[i]!, hooks, 'guard.call.arg', guard, i, depth + 1);
      }
      break;
    case 'default':
      break;
  }
  hooks.leaveGuard?.(guard, c);
}

function walkInterpolation(
  node: Interpolation,
  hooks: AstVisitHooks,
  depth: number
): void {
  let refIndex = 0;
  for (const part of node.parts) {
    if ('ref' in part) {
      walkNode(part.ref, hooks, 'value.interpolation.ref', node, refIndex, depth + 1);
      refIndex++;
    }
  }
}

function walkSelectorList(node: SelectorList, hooks: AstVisitHooks, depth: number): void {
  for (let i = 0; i < node.selectors.length; i++) {
    walkNode(node.selectors[i]!, hooks, 'selector.branch', node, i, depth + 1);
  }
}

function walkComplexSelector(node: ComplexSelector, hooks: AstVisitHooks, depth: number): void {
  let visitIndex = 0;
  for (let i = 0; i < node.value.length; i++) {
    const part = node.value[i]!;
    if (typeof part !== 'string') {
      walkNode(part, hooks, 'selector.value', node, visitIndex, depth + 1);
      visitIndex++;
    }
  }
}

function walkCompoundSelector(node: CompoundSelector, hooks: AstVisitHooks, depth: number): void {
  for (let i = 0; i < node.value.length; i++) {
    walkNode(node.value[i]!, hooks, 'selector.simple', node, i, depth + 1);
  }
}

function walkSimpleSelector(node: SimpleSelector, hooks: AstVisitHooks, depth: number): void {
  if (node.interp !== null) {
    walkNode(node.interp, hooks, 'selector.simple.interp', node, 0, depth + 1);
  }
}

function walkPseudoSelector(node: PseudoSelector, hooks: AstVisitHooks, depth: number): void {
  if (node.interp !== null) {
    walkNode(node.interp, hooks, 'selector.pseudo.interp', node, 0, depth + 1);
  }
  if (node.args !== null) {
    walkNode(node.args, hooks, 'selector.pseudo.args', node, 0, depth + 1);
  }
}

function walkDeclaration(node: Declaration, hooks: AstVisitHooks, depth: number): void {
  if (typeof node.name !== 'string') {
    walkNode(node.name, hooks, 'declaration.name', node, 0, depth + 1);
  }
  walkValueSlot(node.value, hooks, 'declaration.value', node, 0, depth + 1);
}

function walkVariableDeclaration(node: VariableDeclaration, hooks: AstVisitHooks, depth: number): void {
  walkCallValue(node.value, hooks, 'variable.value', node, 0, depth + 1);
}

function walkMixinCall(node: MixinCall, hooks: AstVisitHooks, depth: number): void {
  for (let i = 0; i < node.args.length; i++) {
    walkCallArg(node.args[i]!, hooks, 'mixin-call.arg', node, i, depth + 1);
  }
}

function walkFunctionCall(node: FunctionCall, hooks: AstVisitHooks, depth: number): void {
  for (let i = 0; i < node.args.length; i++) {
    walkValueSlot(node.args[i]!, hooks, 'value.function.arg', node, i, depth + 1);
  }
}

function walkRuleset(node: Ruleset, hooks: AstVisitHooks, depth: number): void {
  walkNode(node.selector, hooks, 'ruleset.selector', node, 0, depth + 1);
  if (node.guard !== undefined) {
    walkGuard(node.guard, hooks, 'ruleset.guard', node, 0, depth + 1);
  }
  if (node.extendInstructions !== undefined) {
    for (let i = 0; i < node.extendInstructions.length; i++) {
      const instruction = node.extendInstructions[i]!;
      walkNode(instruction.target, hooks, 'ruleset.extend.target', node, i, depth + 1);
      if (instruction.subject !== undefined) {
        walkNode(instruction.subject, hooks, 'ruleset.extend.subject', node, i, depth + 1);
      }
    }
  }
  for (let i = 0; i < node.rules.length; i++) {
    walkNode(node.rules[i]!, hooks, 'ruleset.rules', node, i, depth + 1);
  }
}

function walkMixinDef(node: MixinDefinition, hooks: AstVisitHooks, depth: number): void {
  walkParams(node.params, node, hooks, depth, 'mixin');
  if (node.guard !== undefined) {
    walkGuard(node.guard, hooks, 'mixin.guard', node, 0, depth + 1);
  }
  for (let i = 0; i < node.rules.length; i++) {
    walkNode(node.rules[i]!, hooks, 'mixin.rules', node, i, depth + 1);
  }
}

function walkApply(node: Apply, hooks: AstVisitHooks, depth: number): void {
  for (let i = 0; i < node.selectors.length; i++) {
    walkNode(node.selectors[i]!, hooks, 'apply.selector', node, i, depth + 1);
  }
}

function walkFor(node: Extract<Statement, { type: 'For' }>, hooks: AstVisitHooks, depth: number): void {
  walkCallValue(node.iterable, hooks, 'for.iterable', node, 0, depth + 1);
  for (let i = 0; i < node.rules.length; i++) {
    walkNode(node.rules[i]!, hooks, 'for.rules', node, i, depth + 1);
  }
}

function walkIf(node: If, hooks: AstVisitHooks, depth: number): void {
  for (let i = 0; i < node.branches.length; i++) {
    const branch = node.branches[i]!;
    if (branch.guard !== null) {
      walkGuard(branch.guard, hooks, 'if.branch.guard', node, i, depth + 1);
    }
    for (let j = 0; j < branch.rules.length; j++) {
      walkNode(branch.rules[j]!, hooks, 'if.branch.rules', node, j, depth + 1);
    }
  }
}

function walkAtRuleBlock(node: AtRuleBlock, hooks: AstVisitHooks, depth: number): void {
  if (node.prelude !== null) {
    walkNode(node.prelude, hooks, 'atrule.prelude', node, 0, depth + 1);
  }
  for (let i = 0; i < node.rules.length; i++) {
    walkNode(node.rules[i]!, hooks, 'atrule.rules', node, i, depth + 1);
  }
}

function walkAtRuleStatement(node: AtRuleStatement, hooks: AstVisitHooks, depth: number): void {
  if (node.prelude !== null) {
    walkNode(node.prelude, hooks, 'atrule-statement.prelude', node, 0, depth + 1);
  }
}

function walkImportAtRule(node: ImportAtRule, hooks: AstVisitHooks, depth: number): void {
  if (node.options !== null) {
    walkNode(node.options, hooks, 'import.options', node, 0, depth + 1);
  }
  walkNode(node.target, hooks, 'import.target', node, 0, depth + 1);
  if (node.alias !== null) {
    walkNode(node.alias, hooks, 'import.alias', node, 0, depth + 1);
  }
  if (node.tail !== null) {
    walkNode(node.tail, hooks, 'import.tail', node, 0, depth + 1);
  }
}

function walkPlugin(node: Plugin, hooks: AstVisitHooks, depth: number): void {
  walkNode(node.target, hooks, 'plugin.target', node, 0, depth + 1);
  if (node.options !== null) {
    walkNode(node.options, hooks, 'plugin.options', node, 0, depth + 1);
  }
}

function walkReference(node: Reference, hooks: AstVisitHooks, depth: number): void {
  walkNode(node.base, hooks, 'value.reference.base', node, 0, depth + 1);
  for (let i = 0; i < node.steps.length; i++) {
    const step = node.steps[i]!;
    if (step.type === 'BracketLookup' && typeof step.key !== 'number') {
      walkNode(step.key, hooks, 'value.reference.bracket-key', node, i, depth + 1);
    } else if (step.type === 'Call') {
      for (let j = 0; j < step.args.length; j++) {
        walkCallArg(step.args[j]!, hooks, 'value.reference.call-arg', node, j, depth + 1);
      }
    }
  }
}

function walkStyleImport(node: StyleImport, hooks: AstVisitHooks, depth: number): void {
  walkNode(node.path, hooks, 'style-import.path', node, 0, depth + 1);
}

function walkModuleImport(node: ModuleImport, hooks: AstVisitHooks, depth: number): void {
  walkNode(node.path, hooks, 'module-import.path', node, 0, depth + 1);
}

function walkOpaqueAtRuleBlock(node: OpaqueAtRuleBlock): void {
  void node;
}

function walkNode(
  node: AstVisitNode,
  hooks: AstVisitHooks,
  edge: AstEdge,
  parent: AstVisitParent,
  index: number,
  depth: number
): void {
  const c = cursor(edge, parent, nodeParentKind(parent), index, depth);
  if (hooks.enterNode?.(node, c) === 'skip-children') {
    hooks.leaveNode?.(node, c);
    return;
  }
  switch (node.type) {
    case 'Stylesheet':
      for (let i = 0; i < node.rules.length; i++) {
        walkNode(node.rules[i]!, hooks, 'stylesheet.rules', node, i, depth + 1);
      }
      break;
    case 'Ruleset':
      walkRuleset(node, hooks, depth);
      break;
    case 'Declaration':
      walkDeclaration(node, hooks, depth);
      break;
    case 'VariableDeclaration':
      walkVariableDeclaration(node, hooks, depth);
      break;
    case 'MixinDefinition':
      walkMixinDef(node, hooks, depth);
      break;
    case 'MixinCall':
      walkMixinCall(node, hooks, depth);
      break;
    case 'Apply':
      walkApply(node, hooks, depth);
      break;
    case 'For':
      walkFor(node, hooks, depth);
      break;
    case 'If':
      walkIf(node, hooks, depth);
      break;
    case 'StyleImport':
      walkStyleImport(node, hooks, depth);
      break;
    case 'ModuleImport':
      walkModuleImport(node, hooks, depth);
      break;
    case 'AtRuleBlock':
      walkAtRuleBlock(node, hooks, depth);
      break;
    case 'AtRuleStatement':
      walkAtRuleStatement(node, hooks, depth);
      break;
    case 'ImportAtRule':
      walkImportAtRule(node, hooks, depth);
      break;
    case 'Plugin':
      walkPlugin(node, hooks, depth);
      break;
    case 'OpaqueAtRuleBlock':
      walkOpaqueAtRuleBlock(node);
      break;
    case 'SelectorList':
      walkSelectorList(node, hooks, depth);
      break;
    case 'ComplexSelector':
      walkComplexSelector(node, hooks, depth);
      break;
    case 'CompoundSelector':
      walkCompoundSelector(node, hooks, depth);
      break;
    case 'SimpleSelector':
      walkSimpleSelector(node, hooks, depth);
      break;
    case 'PseudoSelector':
      walkPseudoSelector(node, hooks, depth);
      break;
    case 'Url':
      walkNode(node.value, hooks, 'value.url.value', node, 0, depth + 1);
      break;
    case 'SpacedValue':
    case 'Sequence':
      for (let i = 0; i < node.parts.length; i++) {
        walkNode(node.parts[i]!, hooks, 'value.parts', node, i, depth + 1);
      }
      break;
    case 'List':
      for (let i = 0; i < node.value.length; i++) {
        walkValueSlot(node.value[i]!, hooks, 'value.list.item', node, i, depth + 1);
      }
      break;
    case 'Important':
    case 'Block':
      walkValueSlot(node.value, hooks, 'value.value', node, 0, depth + 1);
      break;
    case 'Operation':
      walkNode(node.left, hooks, 'value.operation.left', node, 0, depth + 1);
      walkNode(node.right, hooks, 'value.operation.right', node, 1, depth + 1);
      break;
    case 'FunctionCall':
      walkFunctionCall(node, hooks, depth);
      break;
    case 'Interpolation':
      walkInterpolation(node, hooks, depth);
      break;
    case 'GeneralEnclosed':
      walkNode(node.content, hooks, 'value.general.content', node, 0, depth + 1);
      break;
    case 'VarIndirect':
      walkNode(node.nameRef, hooks, 'value.var-indirect.name', node, 0, depth + 1);
      break;
    case 'Condition':
      walkGuard(node.guard, hooks, 'value.condition.guard', node, 0, depth + 1);
      break;
    case 'Reference':
      walkReference(node, hooks, depth);
      break;
    case 'Range':
      walkNode(node.start, hooks, 'value.range.start', node, 0, depth + 1);
      walkNode(node.end, hooks, 'value.range.end', node, 1, depth + 1);
      if (node.step !== null) {
        walkNode(node.step, hooks, 'value.range.step', node, 2, depth + 1);
      }
      break;
    case 'Collection':
      if (node.base !== undefined) {
        walkValueSlot(node.base, hooks, 'value.collection.base', node, 0, depth + 1);
      }
      for (let i = 0; i < node.entries.length; i++) {
        walkNode(node.entries[i]!, hooks, 'value.collection.entry', node, i, depth + 1);
      }
      break;
    case 'CollectionEntry':
      walkValueSlot(node.key, hooks, 'value.collection.key', node, 0, depth + 1);
      walkValueSlot(node.value, hooks, 'value.collection.value', node, 1, depth + 1);
      break;
    case 'AnonymousMixin':
      if (node.params !== undefined) {
        walkParams(node.params, node, hooks, depth, 'value.anonymous-mixin');
      }
      for (let i = 0; i < node.rules.length; i++) {
        walkNode(node.rules[i]!, hooks, 'value.anonymous-mixin.rules', node, i, depth + 1);
      }
      break;
    case 'Keyword':
    case 'Color':
    case 'Quoted':
    case 'Any':
    case 'Comment':
    case 'SelectorCapture':
    case 'Dimension':
    case 'VariableReference':
    case 'DeclarationReference':
    case 'PropertyReference':
    case 'RawInline':
      break;
  }
  hooks.leaveNode?.(node, c);
}

export function walkAuthoredAst(root: Stylesheet, hooks: AstVisitHooks): void {
  walkNode(root, hooks, 'root', null, 0, 0);
}

export function walkAuthoredValue(value: ValueSlot, hooks: AstVisitHooks): void {
  walkValueSlot(value, hooks, 'root', null, 0, 0);
}
