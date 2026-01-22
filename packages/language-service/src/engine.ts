import { CssParser } from '@jesscss/css-parser';
import { Parser as LessParser } from '@jesscss/less-parser';
import { Parser as ScssParser } from '@jesscss/scss-parser';
import type { IParseResult, Rules, Node } from '@jesscss/core';
import { getErrorFromParser, toDiagnostic, getValues, isNode } from '@jesscss/core';
import { createRequire } from 'node:module';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  CompletionItem,
  CompletionItemKind,
  CompletionList,
  Diagnostic,
  DiagnosticSeverity,
  DocumentSymbol,
  Hover,
  Location,
  MarkupContent,
  MarkupKind,
  Position,
  Range,
  SemanticTokens,
  SymbolKind,
  TextEdit
} from 'vscode-languageserver-types';

export type JessLang = 'css' | 'less' | 'scss' | 'jess';

type TrackedDoc = {
  document: TextDocument;
  lang: JessLang;
  parse: IParseResult<Rules> | null;
  index: JessIndex | null;
};

type JessIndexNode = {
  node: Node;
  start: number;
  end: number;
};

type JessIndex = {
  nodes: JessIndexNode[];
  findNodeAtOffset(offset: number): Node | null;
};

function getSpan(node: Node): { start: number; end: number } | null {
  const loc = (node as any).location as unknown;
  if (Array.isArray(loc) && loc.length === 6) {
    const start = Number(loc[0]);
    const end = Number(loc[3]);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      return { start, end };
    }
  }
  return null;
}

function buildJessIndex(root: Node): JessIndex {
  const out: JessIndexNode[] = [];
  const seen = new Set<Node>();
  const stack: Node[] = [root];

  while (stack.length) {
    const node = stack.pop()!;
    if (seen.has(node)) {
      continue;
    }
    seen.add(node);

    const span = getSpan(node);
    if (span) {
      out.push({ node, start: span.start, end: span.end });
    }

    const value = (node as any).value;
    for (const child of getValues(value)) {
      if (isNode(child)) {
        stack.push(child as Node);
      }
    }
  }

  out.sort((a, b) => (a.start - b.start) || (a.end - b.end));

  return {
    nodes: out,
    findNodeAtOffset(offset: number) {
      let best: JessIndexNode | null = null;
      for (const entry of out) {
        if (entry.start <= offset && offset <= entry.end) {
          if (!best) {
            best = entry;
          } else {
            const bestSpan = best.end - best.start;
            const entrySpan = entry.end - entry.start;
            if (entrySpan <= bestSpan) {
              best = entry;
            }
          }
        }
      }
      return best?.node ?? null;
    }
  };
}

// Parsers are expensive to construct: reuse instances.
const cssParser = new CssParser({ recoveryEnabled: true });
const lessParser = new LessParser({ recoveryEnabled: true });
const scssParser = new ScssParser({ recoveryEnabled: true });

function getJessLangFromLanguageId(languageId: string): JessLang {
  switch (languageId) {
    case 'less':
      return 'less';
    case 'scss':
      return 'scss';
    case 'jess':
      return 'jess';
    default:
      return 'css';
  }
}

function parseWithJess(text: string, lang: JessLang): IParseResult<Rules> {
  if (lang === 'less') {
    return lessParser.parse(text) as IParseResult<Rules>;
  }
  if (lang === 'scss') {
    return scssParser.parse(text) as IParseResult<Rules>;
  }
  // TODO: add dedicated .jess parser; for now treat as css-ish.
  return cssParser.parse(text) as IParseResult<Rules>;
}

function suggestWithJess(text: string, lang: JessLang, offset: number): Array<{ nextTokenType: string }> {
  try {
    if (lang === 'less') {
      return lessParser.suggest(text, { offset });
    }
    if (lang === 'scss') {
      return scssParser.suggest(text, { offset });
    }
    return cssParser.suggest(text, { offset });
  } catch {
    return [];
  }
}

function getCurrentWord(text: string, offset: number): string {
  const WORD_BREAKS = ' \t\n\r":{[()]},*>+;}';

  // Find word start (backwards from offset).
  let start = offset - 1;
  while (start >= 0 && WORD_BREAKS.indexOf(text.charAt(start)) === -1) {
    start--;
  }
  start++;

  // Find word end (forwards from offset).
  let end = offset;
  while (end < text.length && WORD_BREAKS.indexOf(text.charAt(end)) === -1) {
    end++;
  }

  return text.substring(start, end);
}

function findPropertyNameBeforeColon(text: string, offset: number): string | null {
  // Look backwards from offset to find the most recent `:` that's inside a block.
  // Then extract the property name before that colon.
  let depth = 0;
  let colonPos = -1;
  for (let i = Math.min(offset - 1, text.length - 1); i >= 0; i--) {
    const ch = text.charCodeAt(i);
    if (ch === 125) {
      depth++;
    } else if (ch === 123) {
      depth--;
      if (depth < 0) {
        break; // exited block
      }
    } else if (ch === 58 && depth === 0) {
      // Found `:` at block depth 0 (inside a ruleset block).
      colonPos = i;
      break;
    }
  }
  if (colonPos === -1) {
    return null;
  }

  // Extract property name: word characters before the colon.
  let start = colonPos - 1;
  while (start >= 0 && /[a-zA-Z0-9_-]/.test(text.charAt(start))) {
    start--;
  }
  const propName = text.substring(start + 1, colonPos).trim();
  return propName || null;
}

function toRange(document: TextDocument, startOffset: number, endOffset: number): Range {
  return {
    start: document.positionAt(Math.max(0, startOffset)),
    end: document.positionAt(Math.max(Math.max(0, startOffset), endOffset))
  };
}

function pos(line1: number | undefined, col1: number | undefined): Position {
  return Position.create(Math.max(0, (line1 ?? 1) - 1), Math.max(0, (col1 ?? 1) - 1));
}

function rangeFrom(
  document: TextDocument,
  line: number,
  column: number,
  endLine?: number,
  endColumn?: number
): Range {
  const start = pos(line, column);
  const end = endLine ? pos(endLine, endColumn ?? column) : Position.create(start.line, start.character + 1);

  // Clamp via offset conversions to stay within bounds.
  const startOffset = document.offsetAt(start);
  const endOffset = Math.max(startOffset, document.offsetAt(end));
  return { start: document.positionAt(startOffset), end: document.positionAt(endOffset) } as Range;
}

// Data sources:
// - At-rules: from VS Code's published web custom data (npm package).
// - Properties: use the same package Less parser uses (`known-css-properties`).
// - Property values: from web custom data (properties have `values` arrays).
const require = createRequire(import.meta.url);
const webCssData = require('@vscode/web-custom-data/data/browsers.css-data.json') as {
  atDirectives?: Array<{ name: string; description?: string | { value: string; kind?: string } }>;
  properties?: Array<{ name: string; description?: string | { value: string; kind?: string }; values?: Array<{ name: string; description?: string | { value: string; kind?: string } }> }>;
};

type AtDirectiveEntry = { name: string; description?: string | { value: string; kind?: string } };
type PropertyEntry = { name: string; description?: string | { value: string; kind?: string }; values?: Array<{ name: string; description?: string | { value: string; kind?: string } }> };

const AT_RULES: string[] = (webCssData.atDirectives ?? []).map(d => d.name).filter(Boolean);
const AT_RULES_MAP = new Map<string, AtDirectiveEntry>();
for (const d of webCssData.atDirectives ?? []) {
  if (d.name) {
    AT_RULES_MAP.set(d.name.toLowerCase(), d);
  }
}

const knownCssProperties = require('known-css-properties') as { all?: unknown };
const CSS_PROPERTIES: string[] = Array.isArray(knownCssProperties.all) ? (knownCssProperties.all as string[]) : [];

// Build property name -> property data map for hover/completions.
const PROPERTIES_MAP = new Map<string, PropertyEntry>();
const PROPERTY_VALUES = new Map<string, string[]>();
for (const prop of webCssData.properties ?? []) {
  if (prop.name) {
    PROPERTIES_MAP.set(prop.name.toLowerCase(), prop);
    if (prop.values) {
      PROPERTY_VALUES.set(prop.name.toLowerCase(), prop.values.map(v => v.name).filter(Boolean) as string[]);
    }
  }
}

export type JessLanguageServiceEngine = {
  open(uri: string, languageId: string, version: number, text: string): void;
  change(uri: string, version: number, text: string): void;
  close(uri: string): void;

  getCompletions(uri: string, position: Position): CompletionList;
  getHover(uri: string, position: Position): Hover | null;
  findDefinition(uri: string, position: Position): Location | null;
  findReferences(uri: string, position: Position): Location[];
  getDocumentSymbols(uri: string): DocumentSymbol[];
  getDiagnostics(uri: string): Diagnostic[];
  getSemanticTokens(uri: string): SemanticTokens;
};

// Keep in sync with server semantic token legend.
const SEMANTIC_TOKEN_TYPES = [
  'comment',
  'string',
  'keyword',
  'enumMember',
  'number',
  'operator',
  'function',
  'variable',
  'property',
  'type',
  'class',
  'namespace'
] as const;

type SemanticTokenType = (typeof SEMANTIC_TOKEN_TYPES)[number];

type ChevTok = {
  image: string;
  startLine?: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
  tokenType?: { name?: string; CATEGORIES?: Array<{ name?: string }> };
};

function tokenTypeFromChevrotain(tok: ChevTok, lang: JessLang): SemanticTokenType | null {
  const name = String(tok?.tokenType?.name ?? '');
  const cats: string[] = Array.isArray(tok?.tokenType?.CATEGORIES)
    ? tok.tokenType.CATEGORIES.map((c: any) => String(c?.name ?? '')).filter(Boolean)
    : [];

  const hasCat = (c: string) => cats.includes(c);

  if (name === 'WS' || name === 'Newline') return null;

  if (name.includes('Comment') || hasCat('Comment')) return 'comment';
  if (name.includes('String') || name.includes('Quoted')) return 'string';
  if (name === 'NonQuotedUrl' || name === 'UrlStart' || name === 'UrlEnd') return 'string';

  // Less: treat `@ident` as variable references by default (including inside at-rule preludes),
  // but keep *known* CSS at-rules (like `@media`) as at-rule names.
  if (lang === 'less' && /^@[_a-zA-Z]/.test(tok.image)) {
    if (AT_RULES_MAP.has(tok.image.toLowerCase())) {
      return 'namespace';
    }
    return 'variable';
  }

  // Less: `@var` is a variable, not an at-rule.
  // Less variables are commonly tokenized as AtKeyword (AtName category).
  if (lang === 'less' && (name === 'AtKeyword' || name === 'AtKeywordLessExtension')) {
    // Treat `@ident` as variable; keep `@-` / `@<digit>...` as at-rule-ish.
    if (/^@[_a-zA-Z]/.test(tok.image)) {
      return 'variable';
    }
  }

  // At-rules and keywords.
  if (hasCat('AtName') || /^At[A-Z]/.test(name)) return 'namespace';
  if (name === 'When' || name === 'DefaultGuardIdent' || name === 'DefaultGuardFunc') return 'keyword';

  // Variables.
  if (hasCat('VarOrProp') || name.includes('Variable') || name.includes('Var')) return 'variable';
  if (lang === 'scss' && name === 'Dollar') return 'variable';

  // Numbers (dimension tokens are split later into number+unit where possible).
  if (name.includes('Num') || name.includes('Int') || name.includes('Dimension') || name === 'Percent') return 'number';

  // Operators / punctuation that often gets styled.
  if (hasCat('CompareOperator') || name.includes('Operator') || name === 'Colon' || name === 'Semi') return 'operator';

  // Function calls.
  if (hasCat('FunctionStart') || name.includes('FunctionStart')) return 'function';

  // Selectors.
  if (name.includes('Pseudo')) return 'class';
  if (hasCat('Selector') || name.includes('HashName') || name.includes('DotName') || name.includes('Ampersand')) return 'class';

  // Plain identifiers: split later into property vs value where possible.
  if (hasCat('Ident') || name === 'PlainIdent') return 'property';

  return null;
}

function asStringName(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof (value as any).valueOf === 'function') {
    return String((value as any).valueOf());
  }
  if (value && typeof (value as any).value === 'string') {
    return String((value as any).value);
  }
  return String(value ?? '');
}

function formatVarName(lang: JessLang, rawName: string): string {
  const trimmed = rawName.trim();
  if (!trimmed) {
    return trimmed;
  }
  // Already has a sigil / prefix.
  if (trimmed.startsWith('@') || trimmed.startsWith('$') || trimmed.startsWith('--')) {
    return trimmed;
  }
  if (lang === 'less') {
    return `@${trimmed}`;
  }
  if (lang === 'scss') {
    return `$${trimmed}`;
  }
  return `--${trimmed}`;
}

export function createEngine(): JessLanguageServiceEngine {
  const docs = new Map<string, TrackedDoc>();

  function ensure(uri: string): TrackedDoc {
    const doc = docs.get(uri);
    if (!doc) {
      throw new Error(`Unknown document: ${uri}`);
    }
    return doc;
  }

  function reparse(t: TrackedDoc) {
    const text = t.document.getText();
    try {
      t.parse = parseWithJess(text, t.lang);
      // Build index even if there are parse errors (recovery mode may still produce partial tree)
      if (t.parse?.tree) {
        t.index = buildJessIndex(t.parse.tree as Node);
      } else {
        t.index = null;
      }
    } catch (e) {
      // On exception, still try to use partial parse result if available
      t.parse = null;
      t.index = null;
    }
  }

  return {
    open(uri, languageId, version, text) {
      const lang = getJessLangFromLanguageId(languageId);
      const document = TextDocument.create(uri, languageId, version, text);
      const tracked: TrackedDoc = { document, lang, parse: null, index: null };
      docs.set(uri, tracked);
      reparse(tracked);
    },
    change(uri, version, text) {
      const tracked = ensure(uri);
      tracked.document = TextDocument.update(tracked.document, [{ text }], version);
      reparse(tracked);
    },
    close(uri) {
      docs.delete(uri);
    },

    getCompletions(uri, position) {
      const tracked = ensure(uri);
      const document = tracked.document;
      const text = document.getText();
      const offset = document.offsetAt(position);
      const currentWord = getCurrentWord(text, offset);
      const replaceRange = toRange(document, offset - currentWord.length, offset);

      const suggestions = suggestWithJess(text, tracked.lang, offset).map(s => String(s.nextTokenType).toLowerCase());
      const wantsAt = currentWord.startsWith('@') || suggestions.some(t => t.includes('at'));
      const wantsIdent = suggestions.some(t => t.includes('ident')) || suggestions.length === 0;

      const items: CompletionItem[] = [];

      // Variable completions: Less @var, SCSS $var, CSS custom properties --x
      const wantVar =
        tracked.lang === 'less'
          ? currentWord.startsWith('@')
          : tracked.lang === 'scss'
            ? currentWord.startsWith('$')
            : currentWord.startsWith('--');

      if (wantVar && tracked.index) {
        const prefix = currentWord.toLowerCase();
        for (const { node } of tracked.index.nodes) {
          if ((node as any).type !== 'VarDeclaration') {
            continue;
          }
          const nameNode = (node as any).value?.name;
          if (!nameNode) {
            continue;
          }
          // Extract string value from node (might be Any node with valueOf(), or already a string)
          let nameStr: string;
          if (typeof nameNode === 'string') {
            nameStr = nameNode;
          } else if (nameNode && typeof nameNode.valueOf === 'function') {
            nameStr = String(nameNode.valueOf());
          } else if (nameNode && typeof nameNode.value === 'string') {
            nameStr = nameNode.value;
          } else {
            nameStr = String(nameNode);
          }
          // Remove prefix if present for normalization (SCSS already strips $, Less might keep @)
          const nameWithoutPrefix = nameStr.replace(/^[$@]/, '');
          const label =
            tracked.lang === 'less'
              ? `@${nameWithoutPrefix}`
              : tracked.lang === 'scss'
                ? `$${nameWithoutPrefix}`
                : `--${nameWithoutPrefix}`;

          if (prefix && !label.toLowerCase().startsWith(prefix.toLowerCase())) {
            continue;
          }

          items.push({
            label,
            kind: CompletionItemKind.Variable,
            textEdit: TextEdit.replace(replaceRange, label)
          });
        }
        if (items.length > 0) {
          return { isIncomplete: false, items };
        }
      }

      if (wantsAt) {
        const prefix = currentWord.toLowerCase();
        for (const name of AT_RULES) {
          if (prefix && !name.toLowerCase().startsWith(prefix)) {
            continue;
          }
          items.push({
            label: name,
            kind: CompletionItemKind.Keyword,
            textEdit: TextEdit.replace(replaceRange, name)
          });
        }
        return { isIncomplete: false, items };
      }

      if (wantsIdent) {
        // Check if we're in a property value context (after `:`).
        const propName = findPropertyNameBeforeColon(text, offset);
        if (propName) {
          const values = PROPERTY_VALUES.get(propName.toLowerCase());
          if (values && values.length > 0) {
            const prefix = currentWord.toLowerCase();
            for (const value of values) {
              if (prefix && !value.toLowerCase().startsWith(prefix)) {
                continue;
              }
              items.push({
                label: value,
                kind: CompletionItemKind.Value,
                textEdit: TextEdit.replace(replaceRange, value)
              });
            }
            if (items.length > 0) {
              return { isIncomplete: false, items };
            }
          }
        }

        // Otherwise, suggest property names (inside a block).
        let depth = 0;
        for (let i = 0; i < Math.min(offset, text.length); i++) {
          const ch = text.charCodeAt(i);
          if (ch === 123) {
            depth++;
          } else if (ch === 125) {
            depth = Math.max(0, depth - 1);
          }
        }
        if (depth > 0) {
          const prefix = currentWord.toLowerCase();
          for (const name of CSS_PROPERTIES) {
            if (prefix && !name.toLowerCase().startsWith(prefix)) {
              continue;
            }
            items.push({
              label: name,
              kind: CompletionItemKind.Property,
              textEdit: TextEdit.replace(replaceRange, name)
            });
          }
          return { isIncomplete: false, items };
        }
      }

      return { isIncomplete: false, items: [] };
    },

    getHover(uri, position) {
      const tracked = ensure(uri);
      const document = tracked.document;
      const text = document.getText();
      const offset = document.offsetAt(position);
      const word = getCurrentWord(text, offset);

      if (!word) {
        return null;
      }

      // Check for at-rule hover.
      if (word.startsWith('@')) {
        const entry = AT_RULES_MAP.get(word.toLowerCase());
        if (entry?.description) {
          const desc = typeof entry.description === 'string' ? entry.description : entry.description.value;
          return {
            contents: {
              kind: MarkupKind.Markdown,
              value: `**${entry.name}**\n\n${desc}`
            }
          };
        }
      }

      // Check for property name hover.
      const propEntry = PROPERTIES_MAP.get(word.toLowerCase());
      if (propEntry?.description) {
        const desc = typeof propEntry.description === 'string' ? propEntry.description : propEntry.description.value;
        return {
          contents: {
            kind: MarkupKind.Markdown,
            value: `**${propEntry.name}**\n\n${desc}`
          }
        };
      }

      // Check for property value hover (need to find the property name first).
      const propName = findPropertyNameBeforeColon(text, offset);
      if (propName) {
        const prop = PROPERTIES_MAP.get(propName.toLowerCase());
        if (prop?.values) {
          for (const val of prop.values) {
            if (val.name.toLowerCase() === word.toLowerCase()) {
              const desc = val.description
                ? (typeof val.description === 'string' ? val.description : val.description.value)
                : `Value for \`${propName}\``;
              return {
                contents: {
                  kind: MarkupKind.Markdown,
                  value: `**${val.name}**\n\n${desc}`
                }
              };
            }
          }
        }
      }

      return null;
    },

    findDefinition(uri, position) {
      const tracked = ensure(uri);
      const document = tracked.document;
      const index = tracked.index;
      if (!index) {
        return null;
      }

      const offset = document.offsetAt(position);
      const node = index.findNodeAtOffset(offset);
      if (!node) {
        return null;
      }

      // Variable definition lookup: find VarDeclaration for a Reference(type=variable).
      if ((node as any).type === 'Reference' && (node as any).options?.type === 'variable') {
        const key = (node as any).value?.key;
        const name = typeof key === 'string' ? key : Array.isArray(key) ? key.join('') : null;
        if (!name) {
          return null;
        }

        // Normalize name (strip prefix for comparison).
        const normalizedName = name.replace(/^[$@]/, '');

        for (const entry of index.nodes) {
          const n: any = entry.node;
          if (n.type === 'VarDeclaration') {
            const nameNode = n.value?.name;
            let declNameStr: string;
            if (typeof nameNode === 'string') {
              declNameStr = nameNode;
            } else if (nameNode && typeof nameNode.valueOf === 'function') {
              declNameStr = String(nameNode.valueOf());
            } else if (nameNode && typeof nameNode.value === 'string') {
              declNameStr = nameNode.value;
            } else {
              declNameStr = String(nameNode ?? '');
            }
            const declName = declNameStr.replace(/^[$@]/, '');
            if (declName === normalizedName) {
              const span = getSpan(n);
              if (span) {
                return {
                  uri,
                  range: toRange(document, span.start, span.end)
                };
              }
            }
          }
        }
      }

      return null;
    },

    findReferences(uri, position) {
      const tracked = ensure(uri);
      const document = tracked.document;
      const index = tracked.index;
      if (!index) {
        return [];
      }

      const offset = document.offsetAt(position);
      const node = index.findNodeAtOffset(offset);
      if (!node) {
        return [];
      }

      // Find variable name from either a Reference or VarDeclaration.
      let targetName: string | null = null;

      if ((node as any).type === 'Reference' && (node as any).options?.type === 'variable') {
        const key = (node as any).value?.key;
        targetName = typeof key === 'string' ? key : Array.isArray(key) ? key.join('') : null;
      } else if ((node as any).type === 'VarDeclaration') {
        const nameNode = (node as any).value?.name;
        if (typeof nameNode === 'string') {
          targetName = nameNode;
        } else if (nameNode && typeof nameNode.valueOf === 'function') {
          targetName = String(nameNode.valueOf());
        } else if (nameNode && typeof nameNode.value === 'string') {
          targetName = nameNode.value;
        } else {
          targetName = String(nameNode ?? '');
        }
      }

      if (!targetName) {
        return [];
      }

      const normalizedTarget = targetName.replace(/^[$@]/, '');
      const out: Location[] = [];

      for (const entry of index.nodes) {
        const n: any = entry.node;
        const span = getSpan(n);
        if (!span) {
          continue;
        }

        // Collect references.
        if (n.type === 'Reference' && n.options?.type === 'variable') {
          const k = n.value?.key;
          const refName = typeof k === 'string' ? k : Array.isArray(k) ? k.join('') : null;
          if (refName && refName.replace(/^[$@]/, '') === normalizedTarget) {
            out.push({
              uri,
              range: toRange(document, span.start, span.end)
            });
          }
        }

        // Collect the declaration itself.
        if (n.type === 'VarDeclaration') {
          const nameNode = n.value?.name;
          let declNameStr: string;
          if (typeof nameNode === 'string') {
            declNameStr = nameNode;
          } else if (nameNode && typeof nameNode.valueOf === 'function') {
            declNameStr = String(nameNode.valueOf());
          } else if (nameNode && typeof nameNode.value === 'string') {
            declNameStr = nameNode.value;
          } else {
            declNameStr = String(nameNode ?? '');
          }
          const declName = declNameStr.replace(/^[$@]/, '');
          if (declName === normalizedTarget) {
            out.push({
              uri,
              range: toRange(document, span.start, span.end)
            });
          }
        }
      }

      return out;
    },

    getDocumentSymbols(uri) {
      const tracked = ensure(uri);
      const document = tracked.document;
      const index = tracked.index;
      if (!index) {
        return [];
      }

      const out: DocumentSymbol[] = [];
      const seen = new Set<Node>();

      for (const entry of index.nodes) {
        const n = entry.node as any;
        if (!n || seen.has(n as Node)) {
          continue;
        }

        let kind: SymbolKind | null = null;
        let name: string | null = null;

        if (n.type === 'Ruleset') {
          kind = SymbolKind.Class;
          name = asStringName((n as any).valueOf?.() ?? (n.value?.selector ? asStringName(n.value.selector) : 'ruleset'));
        } else if (n.type === 'AtRule') {
          kind = SymbolKind.Namespace;
          name = asStringName(n.value?.name);
        } else if (n.type === 'VarDeclaration') {
          kind = SymbolKind.Variable;
          name = formatVarName(tracked.lang, asStringName(n.value?.name));
        } else if (n.type === 'Mixin') {
          kind = SymbolKind.Function;
          name = asStringName(n.value?.name ?? 'mixin');
        } else if (n.type === 'Func') {
          kind = SymbolKind.Function;
          name = asStringName(n.nameKey ?? n.value?.name ?? 'function');
        } else {
          continue;
        }

        const span = getSpan(n as Node);
        if (!span) {
          continue;
        }

        seen.add(n as Node);
        const range = toRange(document, span.start, span.end);
        out.push({
          name: name ?? n.type,
          kind,
          range,
          selectionRange: range,
          children: []
        });
      }

      return out;
    },

    getDiagnostics(uri) {
      const tracked = ensure(uri);
      const doc = tracked.document;
      const parse = tracked.parse;
      if (!parse) {
        return [];
      }

      const parseErrors = Array.isArray(parse.errors) ? parse.errors : [];
      const lexErrors = Array.isArray(parse.lexerResult?.errors) ? (parse.lexerResult?.errors ?? []) : [];
      if (parseErrors.length === 0 && lexErrors.length === 0) {
        return [];
      }

      const diagnostics: Diagnostic[] = [];

      const clampRange = (range: Range): Range => {
        const startOffset = doc.offsetAt(range.start);
        const endOffset = Math.max(startOffset, doc.offsetAt(range.end));
        return { start: doc.positionAt(startOffset), end: doc.positionAt(endOffset) } as Range;
      };

      const rangeFromTokenLike = (tok: any): Range | null => {
        if (!tok) return null;
        const startLine = tok.startLine ?? tok.line;
        const startCol = tok.startColumn ?? tok.column;
        const endLine = tok.endLine;
        const endCol = tok.endColumn;
        if (typeof startLine === 'number' && typeof startCol === 'number') {
          const start = pos(startLine, startCol);
          const end = typeof endLine === 'number'
            ? pos(endLine, typeof endCol === 'number' ? endCol : startCol)
            : Position.create(start.line, start.character + 1);
          return clampRange({ start, end } as Range);
        }
        return null;
      };

      const rangeFromOffsetLike = (err: any): Range | null => {
        const offset = err?.offset;
        const length = err?.length;
        if (typeof offset === 'number') {
          const start = doc.positionAt(Math.max(0, Math.min(doc.getText().length, offset)));
          const end = doc.positionAt(
            Math.max(0, Math.min(doc.getText().length, offset + (typeof length === 'number' ? Math.max(1, length) : 1)))
          );
          return clampRange({ start, end } as Range);
        }
        return null;
      };

      const rangeFromError = (err: any): Range => {
        return (
          rangeFromTokenLike(err?.token)
          ?? rangeFromTokenLike(err?.previousToken)
          ?? rangeFromTokenLike(err)
          ?? rangeFromOffsetLike(err)
          ?? clampRange({ start: Position.create(0, 0), end: Position.create(0, 1) } as Range)
        );
      };

      // Lexer errors.
      for (const err of lexErrors as any[]) {
        diagnostics.push({
          code: 'parse/lexer',
          source: 'jess',
          message: String(err?.message ?? 'Lexing error'),
          severity: DiagnosticSeverity.Error,
          range: rangeFromError(err)
        });
      }

      // Parser errors.
      for (const err of parseErrors as any[]) {
        diagnostics.push({
          code: 'parse/parser',
          source: 'jess',
          message: String(err?.message ?? 'Parsing error'),
          severity: DiagnosticSeverity.Error,
          range: rangeFromError(err)
        });
      }

      // Sort, dedupe, cap.
      diagnostics.sort((a, b) => {
        if (a.range.start.line !== b.range.start.line) return a.range.start.line - b.range.start.line;
        return a.range.start.character - b.range.start.character;
      });
      const seen = new Set<string>();
      const out: Diagnostic[] = [];
      for (const d of diagnostics) {
        const key = `${d.code ?? ''}:${d.range.start.line}:${d.range.start.character}:${d.range.end.line}:${d.range.end.character}:${d.message}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(d);
        if (out.length >= 200) break;
      }

      return out;
    }

    ,

    getSemanticTokens(uri) {
      const tracked = ensure(uri);
      const doc = tracked.document;
      const parse = tracked.parse;
      const data: number[] = [];

      if (!parse?.lexerResult?.tokens) {
        return { data };
      }

      type Pending = { line: number; char: number; length: number; typeIdx: number; modifiers: number };
      const pending: Pending[] = [];

      // Chevrotain uses 1-based line/column.
      const tokens = parse.lexerResult.tokens as ChevTok[];

      const nonWs = (t: ChevTok | undefined) => t && t.tokenType?.name !== 'WS' && t.tokenType?.name !== 'Newline';
      const prevNonWsIdx = (i: number) => {
        for (let j = i - 1; j >= 0; j--) {
          if (nonWs(tokens[j])) return j;
        }
        return -1;
      };
      const nextNonWsIdx = (i: number) => {
        for (let j = i + 1; j < tokens.length; j++) {
          if (nonWs(tokens[j])) return j;
        }
        return -1;
      };

      // tokenModifiers: ['declaration'] in server.ts
      const MOD_DECLARATION = 1 << 0;

      for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i]!;
        const type = tokenTypeFromChevrotain(tok, tracked.lang);
        if (!type) continue;

        const prevIdx = prevNonWsIdx(i);
        const nextIdx = nextNonWsIdx(i);
        const prev = prevIdx >= 0 ? tokens[prevIdx] : undefined;
        const next = nextIdx >= 0 ? tokens[nextIdx] : undefined;
        const prev2Idx = prevIdx >= 0 ? prevNonWsIdx(prevIdx) : -1;
        const prev2 = prev2Idx >= 0 ? tokens[prev2Idx] : undefined;

        const line = (tok.startLine ?? 1) - 1;
        const startChar = (tok.startColumn ?? 1) - 1;
        const endChar = (tok.endColumn ?? (tok.startColumn ?? 1)) - 1;
        const length = Math.max(1, endChar - startChar + 1);

        // Clamp to document bounds via offset conversions.
        const startPos = Position.create(Math.max(0, line), Math.max(0, startChar));
        const endPos = Position.create(Math.max(0, line), Math.max(0, startChar + length));
        const startOffset = doc.offsetAt(startPos);
        const endOffset = Math.max(startOffset, Math.min(doc.getText().length, doc.offsetAt(endPos)));
        const start = doc.positionAt(startOffset);
        const end = doc.positionAt(endOffset);

        if (start.line !== end.line) {
          // If a token ever spans lines, just drop it (rare for these grammars).
          continue;
        }

        const fullLen = Math.max(1, end.character - start.character);

        // 1) Property name vs value idents: if an ident is immediately before `:`, it's a property name.
        // Otherwise treat plain idents as value-ish.
        let effType: SemanticTokenType = type;
        if (type === 'property') {
          // Pseudo classes/elements: treat the pseudo identifier as part of the selector.
          // This covers cases like `:not(...)`, `:host`, `::after`, `:nth-child(...)` where
          // the lexer may tokenize the name as a plain ident.
          if (String(prev?.tokenType?.name ?? '') === 'Colon') {
            effType = 'class';
          } else if (next?.tokenType?.name === 'Colon') {
            effType = 'property';
          } else {
            // Heuristic: if an ident is followed by selector-ish tokens, treat it as a selector.
            // This covers `html {}` and `html .class {}` where `html` is a type selector.
            const nextType = String(next?.tokenType?.name ?? '');
            const selectorishNext = new Set([
              'LCurly',
              'Comma',
              'DotName',
              'HashName',
              'LSquare',
              'Ampersand',
              'Gt',
              'Plus',
              'Tilde',
              'Pipe',
              'Column',
              'SelectorPseudoClass',
              'NthPseudoClass'
            ]);
            if (selectorishNext.has(nextType)) {
              effType = 'class';
            } else {
              // Value-ish identifiers (e.g. `display: block`) should not look like at-rules.
              effType = 'enumMember';
            }
          }
        }

        // 1b) Selector pseudo-classes/elements: color the `:` / `::` as part of the selector,
        // not like declaration punctuation. The lexer isn't consistent across all pseudos
        // (e.g. :host / ::content), so we use structure-based heuristics.
        if (effType === 'operator' && tok.tokenType?.name === 'Colon') {
          const nextType = String(next?.tokenType?.name ?? '');
          const prevType = String(prev?.tokenType?.name ?? '');
          const prev2Type = String(prev2?.tokenType?.name ?? '');

          // Declaration colon pattern is usually: (LCurly|Semi|Newline) <ident> :
          const looksLikeDeclColon =
            prevType === 'PlainIdent'
            && (prev2Type === 'LCurly' || prev2Type === 'Semi' || prev2Type === 'Newline');

          const looksLikePseudoStart =
            nextType === 'SelectorPseudoClass'
            || nextType === 'NthPseudoClass'
            || nextType === 'PlainIdent'
            || nextType === 'Ident';

          const selectorishPrev = new Set([
            'PlainIdent',
            'DotName',
            'HashName',
            'RSquare',
            'RParen',
            'Ampersand',
            'Star',
            'Pipe',
            'Column'
          ]);

          // Also treat `::` as selector punctuation; first `:` sees next `Colon`.
          const isDoubleColon = nextType === 'Colon';

          if (!looksLikeDeclColon && (looksLikePseudoStart || isDoubleColon) && selectorishPrev.has(prevType)) {
            effType = 'class';
          }
        }

        // 2) Variable declarations: mark declaration modifier where we can.
        let modifiers = 0;
        if (effType === 'variable' && tracked.lang === 'less' && next?.tokenType?.name === 'Colon') {
          modifiers |= MOD_DECLARATION;
        }
        if (effType === 'variable' && tracked.lang === 'scss' && next?.tokenType?.name === 'Colon') {
          const prevLine1 = prev?.endLine ?? (prev?.startLine ?? 0);
          const thisLine1 = tok.startLine ?? 0;
          const prevType = String(prev?.tokenType?.name ?? '');
          const likelyStatementStart =
            !prev
            || prevLine1 < thisLine1
            || prevType === 'LCurly'
            || prevType === 'Semi';
          if (likelyStatementStart) {
            modifiers |= MOD_DECLARATION;
          }
        }

        // 3) Split dimensions like `1cm` into `number` + `unit` (we model unit as `type`).
        // This is purely for nicer theming (number colored differently from unit).
        const typeName = String(tok.tokenType?.name ?? '');
        if (effType === 'number' && typeName.includes('Dimension') && typeof tok.image === 'string') {
          const m = tok.image.match(/^([+-]?(?:\d*\.\d+|\d+))(.*)$/);
          if (m && m[1] && m[2]) {
            const numPart = m[1];
            const unitPart = m[2];
            const numLen = Math.max(1, numPart.length);
            const unitLen = Math.max(1, unitPart.length);
            const numIdx = SEMANTIC_TOKEN_TYPES.indexOf('number');
            const unitIdx = SEMANTIC_TOKEN_TYPES.indexOf('type');
            if (numIdx !== -1) {
              pending.push({ line: start.line, char: start.character, length: numLen, typeIdx: numIdx, modifiers });
            }
            if (unitIdx !== -1) {
              pending.push({ line: start.line, char: start.character + numLen, length: unitLen, typeIdx: unitIdx, modifiers: 0 });
            }
            continue;
          }
        }

        const typeIdx = SEMANTIC_TOKEN_TYPES.indexOf(effType);
        if (typeIdx === -1) continue;
        pending.push({ line: start.line, char: start.character, length: fullLen, typeIdx, modifiers });
      }

      // LSP semantic tokens are delta-encoded in document order.
      pending.sort((a, b) => (a.line - b.line) || (a.char - b.char));
      let prevLine = 0;
      let prevChar = 0;
      for (const t of pending) {
        const deltaLine = t.line - prevLine;
        const deltaStart = deltaLine === 0 ? (t.char - prevChar) : t.char;
        data.push(deltaLine, deltaStart, t.length, t.typeIdx, t.modifiers);
        prevLine = t.line;
        prevChar = t.char;
      }

      return { data };
    }
  };
}
