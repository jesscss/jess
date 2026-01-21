import {
  createConnection,
  ProposedFeatures,
  TextDocuments,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
  TextDocumentChangeEvent
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { CompletionParams } from 'vscode-languageserver-types';
import { createEngine } from './engine.js';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const engine = createEngine();

connection.onInitialize((_params: InitializeParams): InitializeResult => {
  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        triggerCharacters: ['@', '-', '$', ':', '{', ';', ' ']
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

documents.listen(connection);
connection.listen();

