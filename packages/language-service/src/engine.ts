import { CssParser } from '@jesscss/css-parser';
import { Parser as LessParser } from '@jesscss/less-parser';
import { Parser as ScssParser } from '@jesscss/scss-parser';
import type { IParseResult, Rules } from '@jesscss/core';
import { getErrorFromParser, toDiagnostic } from '@jesscss/core';
import { createRequire } from 'node:module';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  CompletionItem,
  CompletionItemKind,
  CompletionList,
  Diagnostic,
  DiagnosticSeverity,
  Position,
  Range,
  TextEdit
} from 'vscode-languageserver-types';

export type JessLang = 'css' | 'less' | 'scss' | 'jess';

type TrackedDoc = {
  document: TextDocument;
  lang: JessLang;
  parse: IParseResult<Rules> | null;
};

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
  let i = offset - 1;
  while (i >= 0 && ' \t\n\r":{[()]},*>+'.indexOf(text.charAt(i)) === -1) {
    i--;
  }
  return text.substring(i + 1, offset);
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
  atDirectives?: Array<{ name: string }>;
  properties?: Array<{ name: string; values?: Array<{ name: string }> }>;
};

const AT_RULES: string[] = (webCssData.atDirectives ?? []).map(d => d.name).filter(Boolean);
const knownCssProperties = require('known-css-properties') as { all?: unknown };
const CSS_PROPERTIES: string[] = Array.isArray(knownCssProperties.all) ? (knownCssProperties.all as string[]) : [];

// Build property name -> values map for value completions.
const PROPERTY_VALUES = new Map<string, string[]>();
for (const prop of webCssData.properties ?? []) {
  if (prop.name && prop.values) {
    PROPERTY_VALUES.set(prop.name.toLowerCase(), prop.values.map(v => v.name).filter(Boolean) as string[]);
  }
}

export type JessLanguageServiceEngine = {
  open(uri: string, languageId: string, version: number, text: string): void;
  change(uri: string, version: number, text: string): void;
  close(uri: string): void;

  getCompletions(uri: string, position: Position): CompletionList;
  getDiagnostics(uri: string): Diagnostic[];
};

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
    } catch {
      t.parse = null;
    }
  }

  return {
    open(uri, languageId, version, text) {
      const lang = getJessLangFromLanguageId(languageId);
      const document = TextDocument.create(uri, languageId, version, text);
      const tracked: TrackedDoc = { document, lang, parse: null };
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

    getDiagnostics(uri) {
      const tracked = ensure(uri);
      const doc = tracked.document;
      const parse = tracked.parse;
      if (!parse) {
        return [];
      }

      const source = doc.getText();
      const jerr = getErrorFromParser(
        parse.errors ?? [],
        parse.lexerResult?.errors,
        uri,
        source
      );

      const diag = toDiagnostic(jerr);
      const message = (diag as any).reason && (diag as any).fix
        ? `${diag.message}\n\nReason: ${(diag as any).reason}\nFix: ${(diag as any).fix}`
        : diag.message;

      const endLine = (diag as any).endLine as (number | undefined);
      const endColumn = (diag as any).endColumn as (number | undefined);

      return [
        {
          code: diag.code,
          source: 'jess',
          message,
          severity: ('errors' in diag) ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
          range: rangeFrom(doc, diag.line, diag.column, endLine, endColumn)
        }
      ];
    }
  };
}
