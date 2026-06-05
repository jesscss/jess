import type { Node } from '../node.js';

export function getCallableNodeSignature(value: Node): string {
  return String(value.valueOf());
}

export function getCallableRestSignature(args: Node[], restName: string, hasFileContext: boolean): string {
  if (args.length === 0 && !hasFileContext) {
    return restName;
  }
  let signature = '';
  for (let i = 0; i < args.length; i++) {
    if (i !== 0) {
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
