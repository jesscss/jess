import { describe, expect, it } from 'vitest';
import type { AbstractPlugin } from '@jesscss/core';
import { CssPlugin } from '@jesscss/compiler-preset';
import lessPlugin from '@jesscss/plugin-less';
import scssPlugin from '@jesscss/plugin-scss';
import jessPlugin from '@jesscss/plugin-jess';

/**
 * Each case PARSES, proven at each dialect's parse boundary (the plugin's
 * `safeParse`, which the compiler calls): a document, no error and no warning,
 * and the construct built from its own component values — never one `Any`
 * standing in for the whole of it. A delim between components is the `Any`
 * delim the css grammar builds (ledger N18). Owner 2026-10-16: valid, balanced
 * syntax parses; any later diagnostic for legacy IE syntax comes after parsing.
 */
type Dialect = 'css' | 'less' | 'scss' | 'jess';

const PLUGINS: Record<Dialect, AbstractPlugin> = {
  css: new CssPlugin(),
  less: lessPlugin(),
  scss: scssPlugin(),
  jess: jessPlugin()
};

function parseClean(dialect: Dialect, source: string): unknown {
  const parsePlugin = PLUGINS[dialect];
  const result = parsePlugin.safeParse!(`/proj/delim-run.${dialect}`, source);
  expect(result.errors).toEqual([]);
  expect(result.warnings ?? []).toEqual([]);
  expect(result.document).toBeDefined();
  return result.document;
}

/** The value of the first declaration of the first rule. */
function declarationValue(dialect: Dialect, source: string): unknown {
  const document = parseClean(dialect, source) as { rules: Array<{ rules: Array<{ value: unknown }> }> };
  return document.rules[0]!.rules[0]!.value;
}

const keyword = (src: string) => ({ type: 'Keyword', src });
const delim = (src: string) => ({ type: 'Any', src });
const arg = (value: unknown) => ({ value });

const PROGID = 'progid:DXImageTransform.Microsoft.gradient(startColorstr=\'#000\', endColorstr=\'#fff\')';
const PROGID_HEAD = [keyword('progid'), delim(':'), keyword('DXImageTransform'), delim('.'), keyword('Microsoft'), delim('.')];
const NAME_VALUE_ARGS = [
  arg([keyword('startColorstr'), delim('='), { type: 'Quoted' }]),
  arg([keyword('endColorstr'), delim('='), { type: 'Quoted' }])
];

describe('a progid filter declaration parses into its components', () => {
  it.each(['css', 'jess'] as const)('%s', (dialect) => {
    expect(declarationValue(dialect, `a { filter: ${PROGID}; }`)).toMatchObject([
      ...PROGID_HEAD,
      { type: 'FunctionCall', name: 'gradient', args: NAME_VALUE_ARGS }
    ]);
  });

  it('scss: `Microsoft.gradient(` is SCSS\'s namespaced call, written as authored', () => {
    expect(declarationValue('scss', `a { filter: ${PROGID}; }`)).toMatchObject([
      ...PROGID_HEAD.slice(0, 4),
      { type: 'FunctionCall', name: 'Microsoft.gradient', args: NAME_VALUE_ARGS }
    ]);
  });

  it('less: the call\'s `=` arguments are comparisons (V11)', () => {
    expect(declarationValue('less', `a { filter: ${PROGID}; }`)).toMatchObject([
      ...PROGID_HEAD,
      { type: 'FunctionCall', name: 'gradient', args: [arg({ type: 'Condition' }), arg({ type: 'Condition' })] }
    ]);
  });

  it('css: alpha(opacity=50)', () => {
    expect(declarationValue('css', 'a { filter: alpha(opacity=50); }')).toMatchObject({
      type: 'FunctionCall',
      name: 'alpha',
      args: [arg([keyword('opacity'), delim('='), { type: 'Dimension', src: '50' }])]
    });
  });
});

describe('a delim between declaration components parses into its components', () => {
  for (const dialect of ['css', 'less', 'scss', 'jess'] as const) {
    it.each([
      ['a=b', '='],
      ['a = b', '='],
      ['a~b', '~'],
      ['a ~ b', '~']
    ])(`${dialect}: %s`, (authored, spelled) => {
      expect(declarationValue(dialect, `a { x: ${authored}; }`)).toMatchObject([keyword('a'), delim(spelled), keyword('b')]);
    });
  }
});

describe('a delim run in a call argument parses into its components', () => {
  const call = (...args: unknown[]) => ({ type: 'FunctionCall', name: 'foo', args });

  it.each(['css', 'less', 'scss', 'jess'] as const)('%s: foo(a=b=c)', (dialect) => {
    expect(declarationValue(dialect, 'a { x: foo(a=b=c); }')).toMatchObject(
      call(arg([keyword('a'), delim('='), keyword('b'), delim('='), keyword('c')]))
    );
  });

  it.each(['css', 'less', 'scss', 'jess'] as const)('%s: foo(a = b < c)', (dialect) => {
    expect(declarationValue(dialect, 'a { x: foo(a = b < c); }')).toMatchObject(
      call(arg([keyword('a'), delim('='), keyword('b'), delim('<'), keyword('c')]))
    );
  });

  it.each(['css', 'less', 'jess'] as const)('%s: foo(a==b)', (dialect) => {
    expect(declarationValue(dialect, 'a { x: foo(a==b); }')).toMatchObject(
      call(arg([keyword('a'), delim('=='), keyword('b')]))
    );
  });

  it('scss: @include m(a=b)', () => {
    const document = parseClean('scss', '@mixin m($a) { x: $a; }\na { @include m(a=b); }') as {
      rules: Array<{ rules?: unknown[] }>;
    };
    expect(document.rules[1]!.rules![0]).toMatchObject({
      type: 'MixinCall',
      args: [arg([keyword('a'), delim('='), keyword('b')])]
    });
  });
});
