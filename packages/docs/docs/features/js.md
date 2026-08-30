---
id: js
title: JS-in-CSS
---

Jess allows you to insert JavaScript expressions with the use of the `$` symbol. Think of it like `${}` in a template tag (although a bit more sophisticated).

As long as the JavaScript statement is continuous (no spaces outside of parens), then it will be treated as a JS expression. The exception is that an initial `$(` will match a final `)` as the end of the expression.

A very simple example would be:

```css
.box {
  width: $(1 + 1)px;
}
```
This would produce:
```css
.box {
  width: 2px;
}
```

These are also all considered valid JS expressions:
```scss
.box {
  one:   $content;
  two:   $( content ); // Same as previous line
  three: $content.prop;
  four:  $content['prop'];
  five:  $'content';
  six:   $myFunction(1, 2, 3);
}
```

You can, of course, mix JS expressions with CSS values, like:
```scss
.box {
  border: 1px solid $myColor;
}
```