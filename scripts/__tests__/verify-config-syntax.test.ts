import { describe, expect, it } from 'vitest';
import { configSyntaxKind, validateConfigText } from '../verify-config-syntax.mjs';

describe('configuration syntax guard', () => {
  it('uses TypeScript JSONC parsing only for tsconfig files', () => {
    const jsonc = '{\n  // TypeScript permits comments in this file.\n  "compilerOptions": {}\n}\n';
    expect(configSyntaxKind('packages/core/tsconfig.json')).toBe('jsonc');
    expect(validateConfigText('packages/core/tsconfig.json', jsonc)).toBeUndefined();
  });

  it('keeps every other .json file strict JSON', () => {
    const jsonc = '{\n  // A package manifest cannot contain comments.\n  "name": "example"\n}\n';
    expect(configSyntaxKind('packages/core/package.json')).toBe('json');
    expect(validateConfigText('packages/core/package.json', jsonc)).toMatch(/JSON|Expected/i);
  });
});
