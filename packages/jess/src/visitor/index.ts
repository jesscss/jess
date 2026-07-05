import type { Node } from '@jesscss/core';

export class Visitor {
  visit(n: Node): Node {
    return n;
  }
}
