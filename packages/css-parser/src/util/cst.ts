import type { IToken } from 'chevrotain';
// AdvancedCstParser is unused; keep type local here to avoid dependency
type AdvancedCstNode = {
  name: string;
  childrenStream: Array<AdvancedCstNode | IToken>;
};

export const stringify = (cst: AdvancedCstNode): string => {
  let output = '';

  const recurseCst = (node: AdvancedCstNode | IToken): void => {
    if (!node) {
      return;
    }
    if ('name' in node) {
      node.childrenStream.forEach((child) => {
        recurseCst(child);
      });
      return;
    }
    output += node.image;
  };
  recurseCst(cst);

  return output;
};