/**
 * Parses `src/less/css-forms.jess` once and writes the parse tree as
 * `src/less/css-forms.generated.ts`, constructor-built, so the package ships the
 * tree and no parser. `pnpm build:forms` writes it; a test keeps it fresh.
 *
 * The forms are the CSS forms of Less's colour and math built-ins
 * (docs/design/CSS-NATIVE-BUILTINS.md §3.3). `$amount` is a number on the
 * channel's scale (css-color-5 §4.4); a `-deferred` form takes what only the
 * browser knows, a colour's amount as a percentage (Q2), Less's decimal places
 * as `pow(10, -1 * $places)`. `$step` and `$one` are 1 in the unit of a known
 * `$value`, and a number otherwise (Q3).
 */
import { readFileSync, writeFileSync } from 'node:fs';

const FACTORIES = ['anonymousMixin', 'block', 'callArg', 'decl', 'dimension', 'funcCall', 'keyword', 'list', 'operation', 'variableReference'];

const text = value => JSON.stringify(value).replaceAll('"', '\'');

function slot(value) {
  return Array.isArray(value) ? `[${value.map(slot).join(', ')}]` : node(value);
}

function node(value) {
  switch (value.type) {
    case 'Keyword':
      return `keyword(${text(value.src)})`;
    case 'Dimension':
      return `dimension(${value.number}, ${text(value.unit)}, ${text(value.src)})`;
    case 'Lookup':
      return `variableReference(${text(value.name)}, ${text(value.scope)})`;
    case 'List':
      return `list([${value.value.map(slot).join(', ')}], ${text(value.sep)})`;
    case 'Block':
      return `block(${slot(value.value)})`;
    case 'Operation':
      return `operation(${text(value.operator)}, ${node(value.left)}, ${node(value.right)}, ${value.inMathFunction}, ${value.mathOutsideParens})`;
    case 'FunctionCall':
      return `funcCall(${text(value.name)}, [${value.args.map(arg => `callArg(${slot(arg.value)})`).join(', ')}], ${value.modern})`;
    case 'Declaration':
      return `decl(${text(value.name)}, ${slot(value.value)})`;
    default:
      throw new Error(`A CSS form cannot hold a ${value.type}`);
  }
}

const camel = name => name.replace(/-(\w)/g, (_, letter) => letter.toUpperCase());

/** The module for `source`, parsed by `parse`. */
export function generate(parse, source) {
  const forms = parse(source).rules.filter(rule => rule.type === 'VariableDeclaration');
  const lines = forms.map(({ name, value }) => {
    if (value.rules.length !== 1) {
      throw new Error(`The CSS form ${name} must be one \`result:\`; evalForm walks no body`);
    }
    const params = value.params.map(param => `{ name: ${text(param.name)} }`).join(', ');
    return `export const ${camel(name)} = /* @__PURE__ */ anonymousMixin([${value.rules.map(node).join(', ')}], [${params}]);`;
  });
  const factories = FACTORIES.filter(name => lines.some(line => line.includes(`${name}(`)));
  return `// Generated from css-forms.jess by scripts/build-css-forms.mjs. Do not edit.\nimport { ${factories.join(', ')} } from '@jesscss/core/ast';\n\n${lines.join('\n')}\n`;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const { parse } = await import('../../syntax/jess/jess-parser/lib/index.js');
  const source = new URL('../src/less/css-forms.jess', import.meta.url);
  writeFileSync(new URL('../src/less/css-forms.generated.ts', import.meta.url), generate(parse, readFileSync(source, 'utf8')));
}
