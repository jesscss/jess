import { describe, expect, it } from 'vitest';
import { any, decl, el, N, num, rules, ruleset } from '../../index.js';
import { isNode } from '../is-node.js';
import { serializeTypes } from '../serialize-types.js';

describe('serializeTypes', () => {
  it('prints node type and role metadata without depending on untyped fields', () => {
    const node = any('screen', { role: 'keyword' });

    expect(serializeTypes(node, { showOptions: true })).toContain('(Any [role=keyword]');
  });

  it('prints compact numeric nodes', () => {
    expect(serializeTypes(num(10))).toBe('(Num 10)');
  });

  it('protects against node cycles', () => {
    const root = rules([]);
    root.rules.push(root);

    expect(serializeTypes(root)).toContain('(Rules');
    expect(serializeTypes(root)).toContain('(Rules …)');
  });

  it('matches rule containers by the Rules abstract mask', () => {
    const body = [decl({ name: 'color', value: any('red') })];
    const node = ruleset({ selector: el('.a'), rules: body });

    expect(isNode(node, N.Ruleset)).toBe(true);
    // N.Rules is an abstract container mask — it matches Ruleset and AtRule too,
    // not only concrete Rules instances.
    expect(isNode(node, N.Rules)).toBe(true);
  });
});
