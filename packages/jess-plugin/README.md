# jess-plugin

Provides the Jess parser and evaluator

## Status

This package reflects a **legacy plugin architecture** (pre-`jess` `Compiler` pipeline).
It is currently kept mainly for historical/experimental packages in this repo.

For modern usage, prefer using the `jess` package directly (see `Compiler`) and the maintained
language plugins (e.g. `@jesscss/plugin-less` + `@jesscss/plugin-less-compat`).

Plugins set how we:

1. Parse a stylesheet.
2. Set and shadow variables.
3. Set and evaluate mixins.
4. Determine evaluation order (within a set of rules).
5. Lookup mixins and variable values.
6. Retrieve files from the file system