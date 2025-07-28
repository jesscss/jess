---
title: Interpolation
---

Want to jam the result of a Jess expression anywhere in your CSS output? Use interpolation: just wrap your Jess expression in `#()`. Jess will evaluate it and stick the value right into the code, wherever you put it.

## Interpolation examples

### 1. Selectors in style rules

```scss
$side: left;
.widget-#($side) {
  float: $side;
}
```
→
```css
.widget-left {
  float: left;
}
```

### 2. Property names in declarations
```scss
$radius: top-right;
.card {
  border-#($radius)-radius: 12px;
}
```
→
```css
.card {
  border-top-right-radius: 12px;
}
```

### 3. Custom property values
```less
$theme: dark;
body {
  --theme-mode: #($theme);
}
```
→
```css
body {
  --theme-mode: dark;
}
```

:::info

Note: in normal property values, you can just use `$theme`, but in custom property values, you must use interpolation `#($theme)` because custom property values have very loose syntax rules.

:::

### 4. :-extend
```scss
$type: `.notice`;
.notice {
  color: orange;
}
.danger:-extend(#($type));
```
→
```css
.danger, .notice {
  color: orange;
}
```

### 5. Plain CSS @imports
```scss
$family: "modern";
@import url("fonts/#($family).css");
```
→
```css
@import url("fonts/modern.css");
```

### 6. Plain CSS function names
```scss
$fn: "min";
$s1: 30vw;
$s2: 50vw;
.container {
  width: #($fn)( $s1, $s2 );
}
```
→
```css
.container {
  width: min(30vw, 50vw);
}
```

### 7. Any plain output

```scss
$color-name: "red";
.container {
  color: ~"#($color-name)";
}
```
→
```css
.container {
  color: red;
}
```

## TL;DR
1. Use #() for dynamic bits—selectors, property names, and anything clever you want in output.
2. Don’t wrap variables for no reason; use direct variables unless you need interpolation.
3. Never interpolate numbers if you want to do math with them.
4. Escape strings with `~""` for clarity when you want to drop quotes from a string.

Jess is meant to be simple and explicit. Keep it that way.

Go forth and interpolate responsibly.