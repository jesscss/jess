import { describe, expect, it } from 'vitest';
import { knownSettings, SettingNotPlainDataError } from '../src/known-settings.js';
import type { StylesConfig } from '../src/types.js';

/*
 * What crosses into the script sandbox from a `styles.config`: each typed
 * section's keys, a fixed-shape setting's own keys, and user-keyed records
 * whole, with plain-data values only.
 */
describe('knownSettings', () => {
  it('keeps a source map object to its own settings', () => {
    const output: StylesConfig = { output: { sourceMap: Object.assign({ sourceMapRootpath: 'r' }, { custom: 'SM-SECRET' }) } };
    expect(knownSettings(output)).toEqual({ output: { sourceMap: { sourceMapRootpath: 'r' } } });
    const less: StylesConfig = { language: { less: { sourceMap: Object.assign({ sourceMapURL: 'u' }, { custom: 'SM-SECRET' }) } } };
    expect(knownSettings(less)).toEqual({ language: { less: { sourceMap: { sourceMapURL: 'u' } } } });
  });

  it('keeps a user-keyed record whole', () => {
    const config: StylesConfig = {
      lint: { rules: { noUnknown: ['warn', { ignore: ['a'] }] }, diagnostics: { evalX: 'off' } },
      language: { less: { modifyVars: { brand: 'red' }, globalVars: { gutter: '8px' } } }
    };
    expect(knownSettings(config)).toEqual(config);
  });

  it('refuses a record value that is not plain data', () => {
    const modifyVars: Record<string, string> = {};
    Reflect.set(modifyVars, 'brand', () => 'red');
    expect(() => knownSettings({ language: { less: { modifyVars } } })).toThrow(SettingNotPlainDataError);
    expect(() => knownSettings({ lint: { rules: { noX: ['warn', { pattern: /x/ }] } } })).toThrow(/lint\.rules/);
  });
});
