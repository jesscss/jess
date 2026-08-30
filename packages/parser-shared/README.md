# `@jesscss/parser-shared`

Published runtime support for the Parseman grammar facts that the CSS, Less,
SCSS, and Jess parsers compose. The CSS grammar keeps these modules external so
downstream dialect packages can follow their composed pieces across the package
boundary; parser consumers receive this package through the parser dependency
closure.

The package intentionally has no root entrypoint. Its public surface is limited
to the three grammar-fact modules in `exports`.

## Admission test

Modules here are consumed by **two or more parsers** and are
**parser-specific**. Anything used by one parser belongs in that parser.
Anything general-purpose belongs elsewhere.

## Build order

This package builds **first**. All four parsers depend on it, and building them
against a stale `lib/` fails silently and green.
