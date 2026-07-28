# `@jesscss/parser-shared`

Private, unpublished workspace package (`private: true`). It supplies Parseman
macro inputs that the CSS, Less, SCSS and Jess parsers compose over at build
time; macro expansion leaves no runtime import of it, so it must never appear
in a published package's `dependencies`.

## Admission test

Modules here are consumed by **two or more parsers** and are
**parser-specific**. Anything used by one parser belongs in that parser.
Anything general-purpose belongs elsewhere.

## Build order

This package builds **first**. All four parsers depend on it, and building them
against a stale `lib/` fails silently and green.
