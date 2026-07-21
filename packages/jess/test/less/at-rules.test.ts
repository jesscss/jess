// @var: 42;

// @media print {
//     .class {
//         color: blue;
//         .sub {
//             width: @var;
//         }
//     }
//     .top, header > h1 {
//         color: (#222 * 2);
//     }
// }

import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';

describe('Less at-rules through the public AST route', () => {

  it('renders CSS-valid @property through the public Less compiler route', async () => {
    const css = await new Compiler({ output: { collapseNesting: true } }).renderString(
      '@property --accent { syntax: "<color>"; inherits: false; initial-value: red; }',
      { language: 'less', filePath: '/virtual/property.less' }
    );

    expect(css).toBe('@property --accent {\n  syntax: "<color>";\n  inherits: false;\n  initial-value: red;\n}\n');
  });

  it('should handle simple at rule', async () => {
    const lessCode = `
      @var: 42;

      @media print {
          .class {
              color: blue;
              .sub {
                  width: @var;
              }
          }
          .top, header > h1 {
              color: (#222 * 2);
          }
      }
    `;
    const compiler = new Compiler();
    const context = compiler.createContext('entry.less');
    const parsed = await context.parseString(lessCode, {
      filePath: 'entry.less',
      extension: '.less'
    });
    expect(parsed.node.type).toBe('Stylesheet');
    expect(context.document).toBe(parsed.node);

    const css = await compiler.renderString(lessCode, {
      filePath: 'entry.less',
      extension: '.less',
      config: {
        output: {
          collapseNesting: true
        }
      }
    });
    expect(css).toBeString(`
      @media print {
        .class {
          color: blue;
        }
        .class .sub {
          width: 42;
        }
        .top,
        header > h1 {
          color: #444444;
        }
      }
    `);
  });

  it('keeps each parsed mixin expansion independent through nested media blocks', async () => {
    const source = `
      .mediaMixin(@fallback: 200px) {
        background: black;
        @media handheld {
          background: white;
          @media (max-width: @fallback) { background: red; }
        }
      }
      .a { .mediaMixin(100px); }
      .b { .mediaMixin(); }
    `;
    const compiler = new Compiler();
    const context = compiler.createContext('entry.less');
    const parsed = await context.parseString(source, {
      filePath: 'entry.less',
      extension: '.less'
    });
    expect(parsed.node.type).toBe('Stylesheet');
    expect(context.document).toBe(parsed.node);

    await expect(compiler.renderString(source, {
      filePath: 'entry.less',
      extension: '.less',
      config: { output: { collapseNesting: true } }
    })).resolves.toBe(
      '.a {\n  background: black;\n}\n@media handheld {\n  .a {\n    background: white;\n  }\n  @media (max-width: 100px) {\n    .a {\n      background: red;\n    }\n  }\n}\n.b {\n  background: black;\n}\n@media handheld {\n  .b {\n    background: white;\n  }\n  @media (max-width: 200px) {\n    .b {\n      background: red;\n    }\n  }\n}\n'
    );
  });
});
