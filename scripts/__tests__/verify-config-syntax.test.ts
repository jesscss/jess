import { describe, expect, it } from 'vitest';
import { configSyntaxKind, validateConfigText } from '../verify-config-syntax.mjs';

describe('configuration syntax guard', () => {
  it('uses JSONC parsing for consumers that explicitly accept it', () => {
    const jsonc = '{\n  // TypeScript permits comments in this file.\n  "compilerOptions": {}\n}\n';
    expect(configSyntaxKind('packages/core/tsconfig.json')).toBe('jsonc');
    expect(validateConfigText('packages/core/tsconfig.json', jsonc)).toBeUndefined();

    const vscodeJsonc = '{\n  // VS Code workspace files permit comments.\n  "version": "0.2.0",\n}\n';
    expect(configSyntaxKind('.vscode/launch.json')).toBe('jsonc');
    expect(validateConfigText('.vscode/launch.json', vscodeJsonc)).toBeUndefined();
  });

  it('keeps package manifests and data files strict JSON', () => {
    const jsonc = '{\n  // A package manifest cannot contain comments.\n  "name": "example"\n}\n';
    expect(configSyntaxKind('packages/core/package.json')).toBe('json');
    expect(validateConfigText('packages/core/package.json', jsonc)).toMatch(/JSON|Expected/i);

    expect(configSyntaxKind('packages/editor/vscode/syntaxes/jess.tmLanguage.json')).toBe('json');
  });
});
