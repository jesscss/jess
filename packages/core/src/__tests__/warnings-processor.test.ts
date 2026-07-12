import { describe, it, expect } from 'vitest';
import { Context, type ContextOptions } from '../context.js';
import { WARN, type WarningDiagnostic } from '../jess-error.js';
import { warnCodeMatches, resolveWarningsConfig, resolveErrorsConfig } from '../warnings.js';
import { Deprecation } from '../deprecation.js';

/** Build a bare warning diagnostic at a chosen code/site. */
function diag(
  code: string,
  opts: { filePath?: string; line?: number; column?: number } = {}
): WarningDiagnostic {
  return {
    code,
    phase: 'eval',
    message: `${code} at ${opts.filePath ?? ''}:${opts.line ?? 1}`,
    reason: '',
    fix: '',
    filePath: opts.filePath ?? '/a.less',
    line: opts.line ?? 1,
    column: opts.column ?? 1
  };
}

function makeContext(opts: ContextOptions = {}): Context {
  return new Context(opts, []);
}

describe('warnCodeMatches', () => {
  it('matches exact codes', () => {
    expect(warnCodeMatches('extend/not-found', 'extend/not-found')).toBe(true);
    expect(warnCodeMatches('extend/not-found', 'extend/not-accessible')).toBe(false);
  });

  it('matches the catch-all', () => {
    expect(warnCodeMatches('anything/at-all', '*')).toBe(true);
  });

  it('matches trailing category wildcards without bleeding across the slash', () => {
    expect(warnCodeMatches('deprecation/mixin-call', 'deprecation/*')).toBe(true);
    expect(warnCodeMatches('deprecationX/y', 'deprecation/*')).toBe(false);
    expect(warnCodeMatches('mixin/call', 'deprecation/*')).toBe(false);
  });
});

describe('resolveWarningsConfig back-compat', () => {
  it('maps suppressWarnings to silence-all', () => {
    const cfg = resolveWarningsConfig({ suppressWarnings: true });
    expect(cfg.silence).toContain('*');
  });

  it('maps legacy deprecation options onto deprecation/<id> codes', () => {
    const cfg = resolveWarningsConfig({
      fatalDeprecations: ['dot-slash-operator'],
      futureDeprecations: ['less-plugin']
    });
    expect(cfg.fatal).toContain('deprecation/dot-slash-operator');
    expect(cfg.future).toContain('deprecation/less-plugin');
  });

  it('defaults limitRepetition true and maxSitesPerCode 5', () => {
    const cfg = resolveWarningsConfig({});
    expect(cfg.limitRepetition).toBe(true);
    expect(cfg.maxSitesPerCode).toBe(5);
  });
});

describe('display-tier config normalization', () => {
  it('defaults warnings.display to line and errors.display to frame', () => {
    expect(resolveWarningsConfig({}).display).toBe('line');
    expect(resolveErrorsConfig().display).toBe('frame');
  });

  it('normalizes the scalar warnings form to { display }', () => {
    expect(resolveWarningsConfig({ warnings: 'summary' }).display).toBe('summary');
    expect(resolveWarningsConfig({ warnings: 'frame' }).display).toBe('frame');
  });

  it('reads warnings.display from the object form and keeps other levers', () => {
    const cfg = resolveWarningsConfig({
      warnings: { display: 'frame', silence: ['extend/*'], maxSitesPerCode: 2 }
    });
    expect(cfg.display).toBe('frame');
    expect(cfg.silence).toContain('extend/*');
    expect(cfg.maxSitesPerCode).toBe(2);
  });

  it('normalizes the scalar and object errors forms', () => {
    expect(resolveErrorsConfig('line').display).toBe('line');
    expect(resolveErrorsConfig({ display: 'summary' }).display).toBe('summary');
  });
});

describe('context.warn de-duplication', () => {
  it('collapses 200 warnings at one site to 1 + a summary counting 199', () => {
    const context = makeContext();
    for (let i = 0; i < 200; i++) {
      context.warn(diag('selector/duplicate', { line: 7 }));
    }
    // Before finalize: exactly one real warning surfaces.
    expect(context.warnings.filter(w => w.code === 'selector/duplicate')).toHaveLength(1);

    context.finalizeWarnings();
    const summary = context.warnings.find(w => w.message.includes('suppressed'));
    expect(summary).toBeDefined();
    expect(summary!.message).toContain('199 warnings suppressed across 1 sites');
  });

  it('caps distinct sites per code and reports the over-cap sites', () => {
    const context = makeContext();
    for (let line = 1; line <= 8; line++) {
      context.warn(diag('selector/duplicate', { line }));
    }
    // Default cap is 5 distinct sites.
    expect(context.warnings.filter(w => w.code === 'selector/duplicate')).toHaveLength(5);

    context.finalizeWarnings();
    const summary = context.warnings.find(w => w.message.includes('suppressed'));
    expect(summary!.message).toContain('3 warnings suppressed across 3 sites');
  });

  it('respects a custom maxSitesPerCode', () => {
    const context = makeContext({ warnings: { maxSitesPerCode: 2 } });
    for (let line = 1; line <= 5; line++) {
      context.warn(diag('selector/duplicate', { line }));
    }
    expect(context.warnings.filter(w => w.code === 'selector/duplicate')).toHaveLength(2);
  });

  it('finalizeWarnings is idempotent', () => {
    const context = makeContext();
    for (let i = 0; i < 10; i++) {
      context.warn(diag('selector/duplicate', { line: 1 }));
    }
    context.finalizeWarnings();
    context.finalizeWarnings();
    expect(context.warnings.filter(w => w.message.includes('suppressed'))).toHaveLength(1);
  });
});

describe('context.warn silencing', () => {
  it('drops warnings matching an exact silenced code', () => {
    const context = makeContext({ warnings: { silence: ['selector/duplicate'] } });
    context.warn(diag('selector/duplicate'));
    context.warn(diag('extend/not-found'));
    expect(context.warnings.map(w => w.code)).toEqual(['extend/not-found']);
  });

  it('drops warnings matching a category wildcard', () => {
    const context = makeContext({ warnings: { silence: ['extend/*'] } });
    context.warn(diag('extend/not-found'));
    context.warn(diag('extend/not-accessible'));
    context.warn(diag('selector/duplicate'));
    expect(context.warnings.map(w => w.code)).toEqual(['selector/duplicate']);
  });

  it('suppressWarnings silences everything (back-compat)', () => {
    const context = makeContext({ suppressWarnings: true });
    context.warn(diag('extend/not-found'));
    context.warn(diag('selector/duplicate'));
    context.finalizeWarnings();
    expect(context.warnings).toHaveLength(0);
  });
});

describe('context.warn fatal promotion', () => {
  it('throws with the fatal-explanation message on an exact code', () => {
    const context = makeContext({ warnings: { fatal: ['extend/not-found'] } });
    expect(() => context.warn(diag('extend/not-found'))).toThrow(
      /only an error because you've set extend\/not-found to be fatal/
    );
  });

  it('throws on a category wildcard', () => {
    const context = makeContext({ warnings: { fatal: ['deprecation/*'] } });
    const dep = Deprecation.fromId('dot-slash-operator')!;
    expect(() =>
      context.warnDeprecation(dep, diag('eval/deprecated'))
    ).toThrow(/deprecation\/dot-slash-operator to be fatal/);
  });
});

describe('context.warn verbose / limitRepetition:false', () => {
  it('verbose emits every repeat and adds no summary', () => {
    const context = makeContext({ verbose: true });
    for (let i = 0; i < 20; i++) {
      context.warn(diag('selector/duplicate', { line: 1 }));
    }
    expect(context.warnings).toHaveLength(20);
    context.finalizeWarnings();
    expect(context.warnings.some(w => w.message.includes('suppressed'))).toBe(false);
  });

  it('limitRepetition:false disables capping', () => {
    const context = makeContext({ warnings: { limitRepetition: false } });
    for (let line = 1; line <= 20; line++) {
      context.warn(diag('selector/duplicate', { line }));
    }
    expect(context.warnings).toHaveLength(20);
    context.finalizeWarnings();
    expect(context.warnings.some(w => w.message.includes('suppressed'))).toBe(false);
  });
});

describe('context.warn accepts a JessError from WARN.*', () => {
  it('normalizes a JessError and dedups by site', () => {
    const context = makeContext();
    for (let i = 0; i < 3; i++) {
      context.warn(WARN.parentlessAmpersand({
        filePath: '/x.less',
        line: 2,
        column: 4,
        meta: { selector: '&' }
      }));
    }
    const kept = context.warnings.filter(w => w.code === 'selector/parentless-ampersand');
    expect(kept).toHaveLength(1);
    expect(kept[0]!.line).toBe(2);
    context.finalizeWarnings();
    expect(
      context.warnings.find(w => w.message.includes('suppressed'))!.message
    ).toContain('2 warnings suppressed across 1 sites');
  });

  it('deprecation routing stamps deprecation/<id> and surfaces the single site', () => {
    const context = makeContext();
    const dep = Deprecation.fromId('less-plugin')!;
    context.warnDeprecation(dep, diag('eval/deprecated'));
    expect(context.warnings.map(w => w.code)).toEqual(['deprecation/less-plugin']);
  });
});
