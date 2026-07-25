---
id: nesting
title: Nesting
audiences:
  - jess
origin: jess
---
:::caution The `&('')` at-root template is not implemented yet

The parent selector `&`, the name concatenation (`&__el`, `&--mod`, `&-suffix`),
and its explicit `&(X)` spelling all work today. The **`&('')` at-root template**
described below does not: it is an output-PLACEMENT instruction rather than
selector text, and no dialect implements it. That section is intended design, not
current behavior.

:::

Jess supports CSS nesting syntax, and unlike Sass and Less 1.x-4.x, will:
 - preserve `&` if possible
 - will "join" with dashes or numerical suffixes (which CSS Nesting does not support)
 - when "collapsing" an `&`, will intelligently wrap the output with an `:is()` selector when possible.

Here's a basic example of nesting:

```less
.categories {
  margin: 0 0 20px;
  width: auto;
  p {
    margin: 0;
    color: blue;
    &:hover {
      color: rebeccapurple;
    }
  }
}
```

### Advanced ampersand templates

Jess's selector model distinguishes two explicit parent forms:

- `&` means "render the parent normally"
- `&('')` means "render this selector at the root, not under the parent" — the equivalent of Sass's `@at-root`

`&(X)` is the explicit spelling of the name concatenation, so `&-primary` and `&(-primary)` mean the same thing.

The explicit form matters because Jess only fuses `&` with a **valid identifier**. Less lexes `&-1` as one token and appends `-1`; Jess rejects it, because `-1` is not an identifier. Write `&(-1)` instead — it produces exactly what Less's `&-1` produces.

```less
.button {
  &-primary {
    font-weight: 700;
  }

  &(-1) {
    order: 1;
  }

  &('') .icon {
    inline-size: 1em;
  }
}
```

Conceptually, this lowers to:

```css
.button-primary {
  font-weight: 700;
}

.button-1 {
  order: 1;
}

.icon {
  inline-size: 1em;
}
```

`nil` is not a Jess keyword, so `&(nil)` is not a supported spelling of anything.

### At-Rule bubbling

One of the best ideas to come out of Less/Sass is the idea of at-rule bubbling, which can make your stylesheets easier to read, by putting different property values next to each other. The CSS Nesting syntax has adopted this, and is now available in all major browsers.

However, for legacy Less support, Jess can bubble and collapse at-rules to the root.

For example:

```less
.box {
  font-size: 10px;

  @media (min-width: 800px) {
    font-size: 12px;
  }
  @media (min-width: 1200px) {
    font-size: 14px;
  }
}
```
This will produce:
```css
.box {
  font-size: 10px;
}
@media (min-width: 800px) {
  .box {
    font-size: 12px;
  }
}
@media (min-width: 1200px) {
  .box {
    font-size: 14px;
  }
}
```

:::caution

Less has unique logic for bubbling behavior of specific at-rules. In Jess, if `collapseNesting` is set to true, all at-rules will bubble to the root, or the next enclosing at-rule.

:::
