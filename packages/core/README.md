# Jess Core - Syntax Tree & Core Evaluation

This is separate from the `jess` package, because it contains the AST, therefore parsers can import this package to export an AST, and `jess` can import the parser + core. (Avoids circular dependencies.)

## Data structures

Evaluation uses native `Array` for queues (push/shift) and `Map` for registries — no external data-structure libraries. The eval queue is partitioned by priority; rules are evaluated in order with retry/step-down for `StyleImport` only.