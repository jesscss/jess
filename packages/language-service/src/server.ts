import {
  createConnection,
  ProposedFeatures,
  TextDocuments,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
  TextDocumentChangeEvent,
  SemanticTokensLegend,
  type CodeActionParams,
  type DocumentLinkParams,
  type DocumentFormattingParams,
  type DocumentRangeFormattingParams,
  type FoldingRangeParams,
  type SelectionRangeParams,
  type CompletionParams,
  type HoverParams,
  type DefinitionParams,
  type ReferenceParams,
  type DocumentHighlightParams,
  type DocumentSymbolParams,
  type SemanticTokensParams,
  type DocumentColorParams,
  type ColorPresentationParams,
  type RenameParams,
  type PrepareRenameParams
} from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createEngine } from './engine.js';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const engine = createEngine();
let clientSettings: unknown = {};

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
        // Sigils/openers that begin a completion context: variables (@ $ -),
        // selectors/mixins (. #), pseudo (:), scss placeholder (%), jess
        // placeholder (\\), value/function/var()/url() ((), path segments (/),
        // scss interpolation (#{) and jess interpolation ($[).
        triggerCharacters: ['@', '-', '$', ':', '{', ';', ' ', '.', '#', '%', '\\', '(', '/', '[']
      },
      hoverProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      documentHighlightProvider: true,
      documentSymbolProvider: true,
      foldingRangeProvider: true,
      selectionRangeProvider: true,
      codeActionProvider: true,
      renameProvider: {
        // Advertise prepare support so the client asks the server for the exact
        // rename range/placeholder before showing the rename box.
        prepareProvider: true
      },
      documentFormattingProvider: true,
      documentRangeFormattingProvider: true,
      documentLinkProvider: {
        resolveProvider: false
      },
      semanticTokensProvider: {
        legend: semanticTokensLegend,
        // Be explicit: VS Code has historically been stricter about the object form
        // than the boolean shorthand.
        full: { delta: false }
      },
      colorProvider: true
    }
  };
  return result;
});

connection.onDidChangeConfiguration((change) => {
  clientSettings = change.settings;
  engine.configure(clientSettings);
  // Re-publish diagnostics under new severity settings.
  for (const doc of documents.all()) {
    connection.sendDiagnostics({ uri: doc.uri, diagnostics: engine.getDiagnostics(doc.uri) });
  }
});

documents.onDidOpen((e: TextDocumentChangeEvent<TextDocument>) => {
  engine.open(e.document.uri, e.document.languageId, e.document.version, e.document.getText());
  engine.configure(clientSettings);
  connection.sendDiagnostics({ uri: e.document.uri, diagnostics: engine.getDiagnostics(e.document.uri) });
});

documents.onDidChangeContent((e: TextDocumentChangeEvent<TextDocument>) => {
  // The `TextDocuments` manager delivers already-merged full text (not the raw
  // LSP change ranges), so `engine.change` recovers the minimal contiguous edit
  // and drives Parseman `ParseDoc.edit()` under the hood — incremental sync of
  // the CST, with the Jess analysis re-derived lazily on the next query.
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

connection.onDocumentHighlight((params: DocumentHighlightParams) => {
  return engine.findDocumentHighlights(params.textDocument.uri, params.position);
});

connection.onDocumentSymbol((params: DocumentSymbolParams) => {
  return engine.getDocumentSymbols(params.textDocument.uri);
});

connection.onFoldingRanges((params: FoldingRangeParams) => {
  return engine.getFoldingRanges(params.textDocument.uri);
});

connection.onSelectionRanges((params: SelectionRangeParams) => {
  return engine.getSelectionRanges(params.textDocument.uri, params.positions);
});

connection.onCodeAction((params: CodeActionParams) => {
  return engine.getCodeActions(params.textDocument.uri, params.range, params.context);
});

connection.onPrepareRename((params: PrepareRenameParams) => {
  return engine.prepareRename(params.textDocument.uri, params.position);
});

connection.onRenameRequest((params: RenameParams) => {
  return engine.rename(params.textDocument.uri, params.position, params.newName);
});

connection.onDocumentFormatting((params: DocumentFormattingParams) => {
  return engine.formatDocument(params.textDocument.uri);
});

connection.onDocumentRangeFormatting((params: DocumentRangeFormattingParams) => {
  return engine.formatRange(params.textDocument.uri, params.range);
});

connection.onDocumentLinks((params: DocumentLinkParams) => {
  return engine.getDocumentLinks(params.textDocument.uri);
});

connection.languages.semanticTokens.on((params: SemanticTokensParams) => {
  return engine.getSemanticTokens(params.textDocument.uri);
});

connection.onDocumentColor(async (params: DocumentColorParams) => {
  return await engine.getDocumentColors(params.textDocument.uri);
});

connection.onColorPresentation((params: ColorPresentationParams) => {
  return engine.getColorPresentations(params.textDocument.uri, params.color, params.range);
});

documents.listen(connection);
connection.listen();
