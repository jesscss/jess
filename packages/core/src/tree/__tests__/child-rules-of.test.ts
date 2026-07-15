import { ok } from 'node:assert/strict';
import { describe, expect, it } from 'vitest';
import {
  any,
  atrule,
  decl,
  mixin,
  N,
  rules,
  ruleset,
  stylesheet,
  type Node
} from '../index.js';
import { isNode } from '../util/is-node.js';

describe('childRulesOf compatibility', () => {
  it('recognizes every local Rules subclass and preserves the foreign Rules fallback', () => {
    const localChildren: Node[] = [
      rules([decl({ name: 'color', value: any('red') })]),
      stylesheet([decl({ name: 'color', value: any('red') })]),
      ruleset({ selector: '.local', rules: [decl({ name: 'color', value: any('red') })] }),
      atrule({ name: '@media', prelude: 'screen', rules: [decl({ name: 'color', value: any('red') })] }),
      mixin({ name: '.local', rules: [decl({ name: 'color', value: any('red') })] })
    ];
    const foreignCandidate: unknown = {
      type: 'Rules',
      nodeType: N.Rules,
      rules: [decl({ name: 'color', value: any('red') })],
      options: { rulesVisibility: {} },
      children: () => []
    };
    expect(isNode(foreignCandidate)).toBe(true);
    ok(isNode(foreignCandidate));
    const foreignChild = foreignCandidate;

    for (const child of [...localChildren, foreignChild]) {
      const parent = rules([]);
      parent.rules.push(child);

      const entries = parent.collectDirectDeclarationChildEntries();
      expect(entries).toHaveLength(1);
      expect(entries?.[0]?.node).toBe(child);
      expect(entries?.[0]?.hasDeclarationSurface).toBe(true);
    }
  });
});
