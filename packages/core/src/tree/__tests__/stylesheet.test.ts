import {
  any,
  decl,
  Rules,
  stylesheet
} from '../index.js';
import { isNode } from '../util/is-node.js';
import { N } from '../node-type.js';

describe('Stylesheet', () => {
  it('is a slim Rules root with a distinct type', () => {
    const declaration = decl({ name: 'color', value: any('red') });
    const root = stylesheet([declaration]);

    expect(root).toBeInstanceOf(Rules);
    expect(root.type).toBe('Stylesheet');
    expect(root.rules).toBe(root.value);
    expect(isNode(root, N.Rules)).toBe(true);
    expect(root.sourceRoot).toBe(root);
    expect(declaration.rulesParent).toBe(root);
    expect(declaration.sourceRoot).toBe(root);
    expect(declaration.depth).toBe(1);
    expect(root.toTrimmedString()).toBe('color: red;');
  });
});
