---
id: logical
title: Logical Functions
sidebar_label: Logical
audiences:
  - jess
origin: jess
---

Jess has no logical *functions*. Conditional evaluation is a language form,
`$if` / `$else`, not something you import from `@jesscss/fns`.

:::caution `iif()` is retired

Pre-2.x Jess spelled conditionals `iif(cond, a, b)` and
`@include $iif(cond, mixin());`. That syntax no longer exists: `iif` is not
registered in the Jess built-in function set, and `@let` / `@mixin` / `@include`
are not Jess at-rules. Use `$if` / `$else` instead. (The `iif()` helper still
ships in `@jesscss/fns` for **Less** sources — it is Less's `if()`, not a Jess
API.)

:::

## `$if` / `$else`

```css
$value: 20;

.box {
  $if ($value > 10) { width: 20px; } $else { width: 10px; }
}
```

Outputs:
```css
.box {
  width: 20px;
}
```

### Guard-style dispatch

This is the Jess equivalent of Less's `when` guards with a `default()` fallback:
nested mixin definitions selected by `$if`.

```css
one($value) {
  one_1() {
    width: 2px;
  }
  one_2() {
    height: 10px;
  }
  def() {
    width: 4px;
  }

  $if ($value > 1) { $ > one_1(); }
  $if ($value > 5) { $ > one_2(); }
  $if (not ($value > 1) and not ($value > 5)) { $ > def(); }
}

.box-0 {
  $ > one(0);
}
.box-2 {
  $ > one(2);
}
.box-10 {
  $ > one(10);
  $if (true) { color: #333; } $else { color: #555; }
  $if (false) { background-color: #333; } $else { background-color: #555; }
}
```

This produces:
```css
.box-0 {
  width: 4px;
}
.box-2 {
  width: 2px;
}
.box-10 {
  width: 2px;
  height: 10px;
  color: #333;
  background-color: #555;
}
```

:::info

Logical operators are condition-position forms: write `not`, `and`, and `or`
inside a `$if (…)` header rather than `!`, `&&`, and `||`.

:::

See [Conditionals & iteration](/docs/Language/conditionals-iteration) for
`$else if`, comparison operators, and scoping rules.
