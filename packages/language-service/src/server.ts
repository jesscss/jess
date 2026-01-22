import {
  createConnection,
  ProposedFeatures,
  TextDocuments,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
  TextDocumentChangeEvent,
  SemanticTokensLegend,
  type CompletionParams,
  type HoverParams,
  type DefinitionParams,
  type ReferenceParams,
  type DocumentSymbolParams,
  type SemanticTokensParams
} from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createEngine } from './engine.js';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const engine = createEngine();

const semanticTokensLegend: SemanticTokensLegend = {
  tokenTypes: [
    // Use common token types most themes color strongly.
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
  ],
  tokenModifiers: ['declaration']
};

connection.onInitialize((_params: InitializeParams): InitializeResult => {
  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        triggerCharacters: ['@', '-', '$', ':', '{', ';', ' ']
      },
      hoverProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      documentSymbolProvider: true,
      semanticTokensProvider: {
        legend: semanticTokensLegend,
        // Be explicit: VS Code has historically been stricter about the object form
        // than the boolean shorthand.
        full: { delta: false }
      }
    }
  };
  return result;
});

documents.onDidOpen((e: TextDocumentChangeEvent<TextDocument>) => {
  engine.open(e.document.uri, e.document.languageId, e.document.version, e.document.getText());
  connection.sendDiagnostics({ uri: e.document.uri, diagnostics: engine.getDiagnostics(e.document.uri) });
});

documents.onDidChangeContent((e: TextDocumentChangeEvent<TextDocument>) => {
  engine.change(e.document.uri, e.document.version, e.document.getText());
  connection.sendDiagnostics({ uri: e.document.uri, diagnostics: engine.getDiagnostics(e.document.uri) });
});

documents.onDidClose((e: TextDocumentChangeEvent<TextDocument>) => {
  engine.close(e.document.uri);
  connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
});

connection.onCompletion((params: CompletionParams) => {
  return engine.getCompletions(params.textDocument.uri, params.position);
});

connection.onHover((params: HoverParams) => {
  return engine.getHover(params.textDocument.uri, params.position);
});

connection.onDefinition((params: DefinitionParams) => {
  return engine.findDefinition(params.textDocument.uri, params.position);
});

connection.onReferences((params: ReferenceParams) => {
  return engine.findReferences(params.textDocument.uri, params.position);
});

connection.onDocumentSymbol((params: DocumentSymbolParams) => {
  return engine.getDocumentSymbols(params.textDocument.uri);
});

connection.languages.semanticTokens.on((params: SemanticTokensParams) => {
  return engine.getSemanticTokens(params.textDocument.uri);
});

documents.listen(connection);
connection.listen();

