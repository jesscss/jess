import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { logger } from '@jesscss/core';

/*
 * V18 — `unitMode: 'preserve'` (the Less default) is `strict` WITHOUT the error.
 * Everything strict rejects — a non-convertible `+`/`-`, or a final unit
 * multiset CSS cannot express — renders as the authored `calc(…)` AND warns
 * `eval/unexpressible-unit` at the boundary (§4.7: no rung of the ladder is
 * silent); everything strict computes, preserve computes identically.
 *
 * The additive case is the one that used to be BOTH wrong and silent: it
 * folded to the Less 4.x guess (`1px + 3em` → `4px`) as a plain Dimension the
 * boundary had no reason to warn about.
 */
type UnitMode = 'loose' | 'preserve' | 'strict';

const render = (source: string, unitMode?: UnitMode) =>
  new Compiler({
    compile: { plugins: [lessPlugin()], ...(unitMode ? { unitMode } : {}) }
  }).renderToResult({ source, language: 'less', extension: '.less' }, {});

const value = (css: string) => /width:\s*([^;]+);/.exec(css)?.[1];
const codes = (r: Awaited<ReturnType<typeof render>>) => r.warnings.map(w => w.code);

describe('unitMode preserve = strict without the error (V18)', () => {
  it('a non-convertible + / - preserves as calc() AND warns, under the default', async () => {
    for (const [expr, spelled] of [
      ['1px + 3em', 'calc(1px + 3em)'],
      ['100% - 10px', 'calc(100% - 10px)']
    ]) {
      const r = await render(`.a { width: ${expr}; }`);
      expect(r.errors, expr).toHaveLength(0);
      expect(value(r.css), expr).toBe(spelled);
      expect(codes(r), `${expr} must warn`).toContain('eval/unexpressible-unit');
    }
  });

  it('a surviving ratio preserves as calc() AND warns, as a product already did', async () => {
    for (const [expr, spelled] of [
      ['(4em / 2cm)', 'calc(4em / 2cm)'],
      ['2px * 3s', 'calc(2px * 3s)']
    ]) {
      const r = await render(`.a { width: ${expr}; }`);
      expect(value(r.css), expr).toBe(spelled);
      expect(codes(r), `${expr} must warn`).toContain('eval/unexpressible-unit');
    }
  });

  it('what strict computes, preserve computes identically and silently', async () => {
    for (const [expr, spelled] of [
      ['(8cats * 9dogs / 4cats)', '18dogs'],
      ['(10px / 5em) * 3em', '6px'],
      ['1cm + 0mm', '1cm']
    ]) {
      const p = await render(`.a { width: ${expr}; }`);
      const s = await render(`.a { width: ${expr}; }`, 'strict');
      expect(value(p.css), expr).toBe(spelled);
      expect(value(s.css), expr).toBe(spelled);
      expect(codes(p), `${expr} is expressible; nothing to warn about`).toHaveLength(0);
    }
  });

  it('loose keeps the Less 4.x fold, selected only by an explicit unitMode', async () => {
    const r = await render('.a { width: 1px + 3em; }', 'loose');
    expect(value(r.css)).toBe('4px');
  });

  it('deprecated strictUnits: false means preserve, and warns', async () => {
    const warned: string[] = [];
    const prev = logger.warn;
    logger.warn = (...args: unknown[]) => {
      warned.push(args.map(String).join(' '));
    };
    try {
      const r = await new Compiler({
        compile: { plugins: [lessPlugin({ strictUnits: false })] }
      }).renderToResult({ source: '.a { width: 1px + 3em; }', language: 'less', extension: '.less' }, {});
      expect(value(r.css)).toBe('calc(1px + 3em)');
    } finally {
      logger.warn = prev;
    }
    expect(warned.join('\n')).toMatch(/strictUnits is deprecated.*unitMode: 'preserve'/);
  });
});
