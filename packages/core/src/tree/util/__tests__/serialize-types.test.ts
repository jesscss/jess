import { describe, expect, it } from 'vitest';
import { any, num, rules } from '../../index.js';
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
    root.value.push(root);

    expect(serializeTypes(root)).toContain('(Rules');
    expect(serializeTypes(root)).toContain('(Rules …)');
  });
});
