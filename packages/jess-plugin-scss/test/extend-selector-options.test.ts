import { describe, expect, it } from 'vitest';
import scssPlugin from '../src/index.js';

describe('scss-plugin extend selector options', () => {
  it('defaults to simple-only extend targets', () => {
    const plugin = scssPlugin();
    const result = plugin.safeParse!('test.scss', '.a { @extend .b.c; }');

    expect(result.errors).toHaveLength(1);
  });

  it('uses compiler-level allowExtendSelectors when plugin opts do not set it', () => {
    const plugin = scssPlugin();
    const result = plugin.safeParse!(
      'test.scss',
      '.a { @extend .b.c; }',
      { compilerOptions: { allowExtendSelectors: ['compound'] } }
    );

    expect(result.errors).toHaveLength(0);
    expect(result.tree).toBeDefined();
  });

  it('prefers explicit plugin allowExtendSelectors over compiler defaults', () => {
    const plugin = scssPlugin({ allowExtendSelectors: ['compound'] });
    const result = plugin.safeParse!(
      'test.scss',
      '.a { @extend .b.c; }',
      { compilerOptions: { allowExtendSelectors: ['simple'] } }
    );

    expect(result.errors).toHaveLength(0);
    expect(result.tree).toBeDefined();
  });
});
