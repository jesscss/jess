import { describe, it, expect } from 'vitest';
import { getOptions } from '../src/options.js';
import type { StylesConfig } from '../src/types.js';

describe('getOptions', () => {
  describe('language inference from input extension', () => {
    it('should infer language from .less extension', () => {
      const config: StylesConfig = {
        language: {
          less: { leakyRules: true }
        }
      };
      const options = getOptions(config, { input: 'src/styles.less' });
      expect(options.leakyRules).toBe(true);
    });

    it('should infer language from .scss extension', () => {
      const config: StylesConfig = {
        language: {
          scss: { precision: 10 }
        }
      };
      const options = getOptions(config, { input: 'src/styles.scss' });
      expect(options.precision).toBe(10);
    });

    it('should infer language from .sass extension', () => {
      const config: StylesConfig = {
        language: {
          scss: { indentedSyntax: true }
        }
      };
      const options = getOptions(config, { input: 'src/styles.sass' });
      expect(options.indentedSyntax).toBe(true);
    });

    it('should infer language from .jess extension', () => {
      const config: StylesConfig = {
        language: {
          jess: { customOption: 'value' }
        }
      };
      const options = getOptions(config, { input: 'src/styles.jess' });
      expect(options.customOption).toBe('value');
    });

    it('should allow explicit language to override inferred', () => {
      const config: StylesConfig = {
        language: {
          less: { leakyRules: true },
          scss: { precision: 10 }
        }
      };
      // File is .less but we explicitly request scss options
      const options = getOptions(config, { language: 'scss', input: 'src/styles.less' });
      expect(options.precision).toBe(10);
      expect(options.leakyRules).toBeUndefined();
    });
  });

  describe('merge priority', () => {
    it('should merge compile options as base', () => {
      const config: StylesConfig = {
        compile: {
          mathMode: 'parens-division',
          unitMode: 'loose'
        }
      };
      const options = getOptions(config);
      expect(options.mathMode).toBe('parens-division');
      expect(options.unitMode).toBe('loose');
    });

    it('should override compile options with language options', () => {
      const config: StylesConfig = {
        compile: {
          mathMode: 'parens-division'
        },
        language: {
          less: { mathMode: 'strict' }
        }
      };
      const options = getOptions(config, { language: 'less' });
      expect(options.mathMode).toBe('strict');
    });

    it('should override language options with matched input options', () => {
      const config: StylesConfig = {
        language: {
          less: { mathMode: 'parens-division', leakyRules: true }
        },
        input: [
          { mathMode: 'strict' }
        ]
      };
      const options = getOptions(config, { input: 'src/styles.less' });
      expect(options.mathMode).toBe('strict');
      expect(options.leakyRules).toBe(true); // from language.less
    });

    it('should override input options with matched output options', () => {
      const config: StylesConfig = {
        input: [
          { compress: false }
        ],
        output: [
          { compress: true }
        ]
      };
      const options = getOptions(config, { input: 'src/styles.less', output: 'dist/styles.css' });
      expect(options.compress).toBe(true);
    });

    it('should apply full merge priority chain', () => {
      const config: StylesConfig = {
        compile: {
          mathMode: 'always',
          unitMode: 'loose'
        },
        language: {
          less: {
            mathMode: 'parens-division',
            leakyRules: true
          }
        },
        input: [
          { mathMode: 'strict', collapseNesting: false }
        ],
        output: [
          { compress: true, sourceMap: true }
        ]
      };
      const options = getOptions(config, { input: 'src/styles.less', output: 'dist/styles.css' });
      expect(options.unitMode).toBe('loose'); // from compile
      expect(options.leakyRules).toBe(true); // from language.less
      expect(options.mathMode).toBe('strict'); // from input (overrides language)
      expect(options.collapseNesting).toBe(false); // from input
      expect(options.compress).toBe(true); // from output
      expect(options.sourceMap).toBe(true); // from output
    });
  });

  describe('file matching', () => {
    it('should match entries without file property as defaults', () => {
      const config: StylesConfig = {
        input: [
          { leakyRules: true }
        ]
      };
      const options = getOptions(config, { input: 'any/file.less' });
      expect(options.leakyRules).toBe(true);
    });

    it('should match exact file paths', () => {
      const config: StylesConfig = {
        input: [
          { leakyRules: false },
          { file: 'src/legacy.less', leakyRules: true }
        ]
      };
      const options = getOptions(config, { input: 'src/legacy.less' });
      expect(options.leakyRules).toBe(true);
    });

    it('should match basename patterns', () => {
      const config: StylesConfig = {
        input: [
          { leakyRules: false },
          { file: 'legacy.less', leakyRules: true }
        ]
      };
      const options = getOptions(config, { input: '/path/to/legacy.less' });
      expect(options.leakyRules).toBe(true);
    });

    it('should match glob patterns', () => {
      const config: StylesConfig = {
        input: [
          { leakyRules: false },
          { file: 'legacy/**/*.less', leakyRules: true }
        ]
      };
      const options = getOptions(config, { input: 'legacy/old/styles.less' });
      expect(options.leakyRules).toBe(true);
    });

    it('should not match when glob does not match', () => {
      const config: StylesConfig = {
        input: [
          { leakyRules: false },
          { file: 'legacy/**/*.less', leakyRules: true }
        ]
      };
      const options = getOptions(config, { input: 'modern/styles.less' });
      expect(options.leakyRules).toBe(false);
    });

    it('should merge multiple matching entries in order', () => {
      const config: StylesConfig = {
        input: [
          { mathMode: 'always', leakyRules: false },
          { file: '**/*.less', mathMode: 'parens-division' },
          { file: 'legacy/**/*.less', leakyRules: true }
        ]
      };
      const options = getOptions(config, { input: 'legacy/old.less' });
      expect(options.mathMode).toBe('parens-division'); // from **/*.less
      expect(options.leakyRules).toBe(true); // from legacy/**/*.less
    });

    it('should match output files with glob patterns', () => {
      const config: StylesConfig = {
        output: [
          { compress: false },
          { file: '**/*.min.css', compress: true }
        ]
      };
      const options = getOptions(config, { output: 'dist/styles.min.css' });
      expect(options.compress).toBe(true);
    });
  });

  describe('single object vs array', () => {
    it('should handle single input object', () => {
      const config: StylesConfig = {
        input: { leakyRules: true }
      };
      const options = getOptions(config, { input: 'src/styles.less' });
      expect(options.leakyRules).toBe(true);
    });

    it('should handle single output object', () => {
      const config: StylesConfig = {
        output: { compress: true }
      };
      const options = getOptions(config, { output: 'dist/styles.css' });
      expect(options.compress).toBe(true);
    });
  });

  describe('no config', () => {
    it('should return empty-ish object with no config', () => {
      const options = getOptions();
      expect(options).toBeDefined();
    });

    it('should return empty-ish object with empty config', () => {
      const options = getOptions({});
      expect(options).toBeDefined();
    });
  });
});

