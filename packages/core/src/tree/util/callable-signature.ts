import type { Node } from '../node.js';

export function getCallableNodeSignature(value: Node): string {
  return String(value.valueOf());
}

export function getCallableRestSignature(
  args: readonly Node[],
  restName: string,
  hasFileContext: boolean,
  start = 0
): string {
  if (args.length === start && !hasFileContext) {
    return restName;
  }
  let signature = '';
  for (let i = start; i < args.length; i++) {
    if (i !== start) {
      signature += ' ';
    }
    signature += getCallableNodeSignature(args[i]!);
  }
  return signature;
}

export function getCallableSignatureKey(parts: Array<string | undefined>): string | undefined {
  let signature: string | undefined;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === undefined) {
      continue;
    }
    signature = signature === undefined ? part : `${signature};${part}`;
  }
  return signature;
}
