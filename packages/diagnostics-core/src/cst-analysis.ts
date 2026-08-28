import type { CssCstChild, CssCstNode } from '@jesscss/css-parser';

export type CstIndexEntry = { node: CssCstNode; start: number; end: number };

export type CstIndex = {
  nodes: CstIndexEntry[];
  spanOf(node: CssCstNode): { start: number; end: number } | undefined;
  findNodeAtOffset(offset: number): CssCstNode | null;
};

function isCstNode(c: CssCstChild): c is CssCstNode {
  return c._tag === 'node';
}

function cstChildrenOf(node: CssCstNode): readonly CssCstChild[] {
  return node.rules;
}

const INDEX_CACHE = new WeakMap<CssCstNode, CstIndex>();

export function buildCstIndex(root: CssCstNode): CstIndex {
  const cached = INDEX_CACHE.get(root);
  if (cached) {
    return cached;
  }
  const out: CstIndexEntry[] = [];
  const abs = new Map<CssCstNode, [number, number]>();
  const walk = (node: CssCstNode) => {
    const s = Number(node.span.start);
    const e = Number(node.span.end);
    abs.set(node, [s, e]);
    if (Number.isFinite(s) && Number.isFinite(e) && e >= s) {
      out.push({ node, start: s, end: e });
    }
    for (const child of cstChildrenOf(node)) {
      if (isCstNode(child)) {
        walk(child);
      }
    }
  };
  walk(root);
  out.sort((a, b) => (a.start - b.start) || (a.end - b.end));
  const index: CstIndex = {
    nodes: out,
    spanOf(node) {
      const a = abs.get(node);
      return a ? { start: a[0], end: a[1] } : undefined;
    },
    findNodeAtOffset(offset) {
      let best: CstIndexEntry | null = null;
      for (const entry of out) {
        if (entry.start <= offset && offset <= entry.end) {
          if (!best || (entry.end - entry.start) <= (best.end - best.start)) {
            best = entry;
          }
        }
      }
      return best?.node ?? null;
    }
  };
  INDEX_CACHE.set(root, index);
  return index;
}
