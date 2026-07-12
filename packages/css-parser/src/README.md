# @jesscss/css-parser

This is the base CSS parser. It's maintained separately from the Jess parser so that we can define CSS syntax / grammar and then show just the extensions / modifications by Jess or Less.

See [some notes](./CSS_NOTES.md) on CSS syntax.

## Scanner-First AST Proof

`parseCssStylesheet(filePath, source)` is the narrow compiler-facing
scanner-first proof path. It returns a core `Stylesheet` and keeps cheap fields
as strings, for example:

```ts
Stylesheet {
  rules: [
    Ruleset {
      selector: '.a',
      rules: [
        Declaration {
          name: 'color',
          value: 'blue'
        }
      ]
    }
  ]
}
```

This path does not use the removed structural/island prototype API. New parser
work should keep producing real AST nodes rather than a parallel schema.
