import type { Node } from '../node.js';

export function getCallableNodeSignature(value: Node): string {
  return String(value.valueOf());
}

export function getCallableRestSignature(args: Node[], restName: string, hasFileContext: boolean): string {
  if (args.length === 0 && !hasFileContext) {
    return restName;
  }
  return args.map(getCallableNodeSignature).join(' ');
}

export function getCallableSignatureKey(parts: Array<string | undefined>): string | undefined {
  const signatureValues = parts.filter((part): part is string => part !== undefined);
  return signatureValues.length > 0 ? signatureValues.join(';') : undefined;
}
