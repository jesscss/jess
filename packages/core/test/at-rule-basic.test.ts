import { rules, sel, el, decl, any, ruleset, atrule } from '../src/index.js';
import { Context } from '../src/context.js';
import { renderNodeToString } from '../src/tree/util/render-buffer.js';

describe('Basic At-Rule Serialization', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context({});
  });

  it('should serialize @media rule correctly', async () => {
    const tree = rules([
      ruleset({
        selector: sel([el('.parent')]),
        rules: [
          decl({ name: 'color', value: any('red') }),
          atrule({
            name: '@media',
            prelude: '(max-width: 768px)',
            rules: [
              ruleset({
                selector: sel([el('.child')]),
                rules: [
                  decl({ name: 'background', value: any('blue') })
                ]
              })
            ]
          })
        ]
      })
    ]);

    const css = await renderNodeToString(tree, context);

    expect(css).toBeString(`
      .parent {
        color: red;
        @media (max-width: 768px) {
          .child {
            background: blue;
          }
        }
      }
  `);
  });

  it('should serialize @supports rule correctly', async () => {
    const tree = rules([
      ruleset({
        selector: sel([el('.parent')]),
        rules: [
          decl({ name: 'color', value: any('red') }),
          atrule({
            name: '@supports',
            prelude: any('(display: grid)'),
            rules: [
              ruleset({
                selector: sel([el('.child')]),
                rules: [
                  decl({ name: 'display', value: any('grid') })
                ]
              })
            ]
          })
        ]
      })
    ]);

    const css = await renderNodeToString(tree, context);

    expect(css).toBeString(`
      .parent {
        color: red;
        @supports (display: grid) {
          .child {
            display: grid;
          }
        }
      }
  `);
  });

  it('should serialize standalone @media rule correctly', async () => {
    // Test just the AtRule node directly
    const atRule = atrule({
      name: '@media',
      prelude: any('(max-width: 768px)'),
      rules: [
        ruleset({
          selector: sel([el('.child')]),
          rules: [
            decl({ name: 'background', value: any('blue') })
          ]
        })
      ]
    });

    const css = atRule.toTrimmedString();
    console.log('Standalone AtRule output:', JSON.stringify(css));

    expect(css).toBeString(`
      @media (max-width: 768px) {
        .child {
          background: blue;
        }
      }
    `);
  });
});
