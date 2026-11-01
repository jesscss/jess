/**
 * The reducers of the Less declaration nodes: `Declaration` (a declaration
 * from its head, colon and value) and the declaration-list items that hold one.
 * A reducer shared by several `node(...)` calls has to be importable, so they
 * live in a module of their own (see `grammar-helpers.ts`).
 */
import type { FieldMap, Span } from 'parseman';
import { any, decl, isToken, valueLayoutOf, withSourceSpan } from '@jesscss/core/ast';
import type { Declaration, ValueSlot } from '@jesscss/core/ast';
import {
  isInterp,
  isLessDeclaration,
  isLessTerminalText,
  isLessValueSlotValue,
  isSequence,
  isValueNode,
  lessValueSlot,
  requireField,
  requireTerminalText,
  requireToken,
  requireValueSlot
} from './grammar-helpers.js';

/* A declaration from its head, colon and value: the reducer of every Less `Declaration` node. */
export function declarationFromChildren(children: readonly unknown[], fields: FieldMap | undefined, span: Span): Declaration {
  // Property, delimiter, and value are independently recognized grammar
  // children; AST construction does not split or reclassify authored text.
  const rawName = children[0];
  // Parseman's optional branch is transparent when absent. Find the value
  // only after the property delimiter, because an interpolated property
  // name is itself an `Interpolation` value node.
  const mergeToken = children.find(child => isToken(child) && (child.value === '+' || child.value === '+_'));
  const colonIndex = children.findIndex(child => isLessTerminalText(child, ':'));
  if (colonIndex < 0) {
    throw new TypeError('Less grammar produced no declaration delimiter.');
  }
  const valueChild = children.slice(colonIndex + 1).find(isLessValueSlotValue);
  const value: ValueSlot = valueChild === undefined ? any('') : requireValueSlot(valueChild);
  const merge = mergeToken === undefined ? null : requireToken(mergeToken).value === '+_' ? ' ' : ',';
  const valueGap = fields?.valueGap === undefined ? '' : requireTerminalText(requireField(fields, 'valueGap').value);
  // A lone line break after `:` is ordinary parser layout and canonicalizes
  // back to `: value`. Preserve the declaration break only when the value
  // itself carries multiline separator facts (grid-area style output).
  const layout = Array.isArray(value) || isSequence(value) ? valueLayoutOf(value) : undefined;
  const valueOnNewLine = (valueGap.includes('\n') || valueGap.includes('\r'))
    && layout?.some(separator => separator.includes('\n') || separator.includes('\r')) === true;
  if (merge !== null && merge !== ',' && merge !== ' ') {
    throw new TypeError('Less grammar produced an invalid declaration merge modifier.');
  }
  const node = !Array.isArray(value) && isValueNode(value) && value.type === 'Important'
    ? decl(isInterp(rawName) ? rawName : requireToken(rawName).value, lessValueSlot(value.value), merge, true, valueOnNewLine)
    : decl(isInterp(rawName) ? rawName : requireToken(rawName).value, Array.isArray(value) ? value : lessValueSlot(value), merge, false, valueOnNewLine);
  return withSourceSpan(node, span);
}

/* The declaration a declaration-list item holds, without its terminator. */
export function declarationOfItem(children: readonly unknown[]): Declaration {
  const declaration = children.find(isLessDeclaration);
  if (declaration === undefined) {
    throw new TypeError('Less declaration item lost its declaration fact.');
  }
  return declaration;
}
