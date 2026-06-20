import type { Context } from '../../context.js';
import { Node } from '../node.js';

function getCallReferenceKey(name: unknown): string {
  if (!name || typeof name !== 'object' || !('type' in name) || name.type !== 'Reference') {
    return '';
  }
  const value = 'value' in name ? name.value : undefined;
  if (!value || typeof value !== 'object') {
    return '';
  }
  const key = 'key' in value ? value.key : undefined;
  return String(
    key && typeof key === 'object' && 'valueOf' in key
      ? key.valueOf()
      : key ?? ''
  );
}

export function getDefaultGuardValue(node: Node | undefined, context: Context): boolean | undefined {
  if (!node) {
    return;
  }
  if (node.type === 'DefaultGuard') {
    return Boolean(context.isDefault);
  }
  if (node.type === 'Paren') {
    const { value } = node;
    return getDefaultGuardValue(value instanceof Node ? value : undefined, context);
  }
  if (node.type === 'Any' && String(node.valueOf?.() ?? '') === 'default()') {
    return Boolean(context.isDefault);
  }
  if (node.type !== 'Call') {
    return;
  }
  const callValue = node.value;
  if (!callValue || typeof callValue !== 'object' || !('name' in callValue)) {
    return;
  }
  const name = callValue.name;
  const callName = String(name?.valueOf?.() ?? name ?? '');
  const refKey = getCallReferenceKey(name);
  if (callName === 'default' || refKey === 'default') {
    return Boolean(context.isDefault);
  }
}
