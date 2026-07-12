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

describe('At Rules', () => {
  const compiler = new Compiler();

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
    const css = await compiler.renderString(lessCode, {
      language: 'less',
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
});