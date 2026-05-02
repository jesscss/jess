import { describe, it, expect } from 'vitest';
import { rules, ruleset, decl, vardecl, any, ref, el } from '../index.js';
import { Context } from '../../context.js';

describe('Hidden evaluated definition trivia', () => {
  it('does not emit hidden variable trivia ahead of later visible declarations', async () => {
    const context = new Context();
    const hiddenVar = vardecl({
      name: any('answer'),
      value: any('yes')
    });
    hiddenVar.post = [' /* comment */'];

    const root = rules([
      ruleset({
        selector: el('.demo'),
        rules: rules([
          hiddenVar,
          decl({
            name: any('color'),
            value: ref({ key: 'answer' }, { type: 'variable' })
          })
        ])
      })
    ]);

    const evald = await root.eval(context);
    expect(`${evald}`).toContain('.demo {\n  color: yes;\n}');
    expect(`${evald}`).not.toContain('/* comment */  color: yes;');
  });
});
