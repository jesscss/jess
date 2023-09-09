# Jess Core runtime

This is separate from the `jess` package, because it contains the AST, therefore parsers can import this package to export an AST, and `jess` can import the parser + core. (Avoids circular dependencies.)