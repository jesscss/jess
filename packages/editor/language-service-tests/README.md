# `language-service-tests`

Not a workspace package — this directory has no `package.json`. It is a harness
directory holding expected-output/parity-style tests for the Jess language
service engine.

## Goal

Use Microsoft’s `vscode-css-languageservice` behavior (and its test fixtures where practical) as a *guiding star*,
without inheriting its internal AST/service contracts.

