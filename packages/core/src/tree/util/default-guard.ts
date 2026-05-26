import type { Context } from '../../context.js';
import { Node } from '../node.js';

function getCallReferenceKey(name: unknown): string {
  if (!name || typeof name !== 'object' || Reflect.get(name, 'type') !== 'Reference') {
    return '';
  }
  const value = Reflect.get(name, 'value');
  if (!value || typeof value !== 'object') {
    return '';
  }
  const key = Reflect.get(value, 'key');
  return String(
    key && typeof key === 'object' && 'valueOf' in key
      ? Reflect.apply(Reflect.get(key, 'valueOf'), key, [])
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
    const value = Reflect.get(node, 'value');
    return getDefaultGuardValue(value instanceof Node ? value : undefined, context);
  }
  if (node.type !== 'Call') {
    return;
  }
  const rawValue = node.value;
  if (!rawValue || typeof rawValue !== 'object' || !('name' in rawValue)) {
    return;
  }
  const rawName = rawValue.name;
  const callName = String(rawName?.valueOf?.() ?? rawName ?? '');
  const refKey = getCallReferenceKey(rawName);
  if (callName === 'default' || callName === '??' || refKey === 'default' || refKey === '??') {
    return Boolean(context.isDefault);
  }
}
