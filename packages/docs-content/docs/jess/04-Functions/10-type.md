---
id: type
title: Type Functions
sidebar_label: Type
audiences:
  - jess
origin: jess
---
Type functions test the kind of a value and return a boolean. Import the ones you
need from `@jesscss/fns`. Each mirrors the equivalent Less built-in.

```css
@-from '@jesscss/fns' import (isnumber, isstring, iscolor, iskeyword, isurl);
```

### isnumber(_value_)

Returns `true` when the value is a number (a `Dimension`, with or without a unit),
`false` otherwise.

```css
isnumber(#ff0);     // false
isnumber("string"); // false
isnumber(1234);     // true
isnumber(56px);     // true
isnumber(7.8%);     // true
```

### isstring(_value_)

Returns `true` when the value is a quoted string, `false` otherwise.

```css
isstring("string"); // true
isstring(blue);     // false
isstring(1234);     // false
```

### iscolor(_value_)

Returns `true` when the value is a color, `false` otherwise.

```css
iscolor(#ff0);     // true
iscolor(blue);     // true
iscolor("string"); // false
```

### iskeyword(_value_)

Returns `true` when the value is an unquoted keyword/identifier, `false` otherwise.

```css
iskeyword(keyword); // true
iskeyword(blue);    // false
iskeyword(1234);    // false
```

### isurl(_value_)

Returns `true` when the value is a `url(…)`, `false` otherwise.

```css
isurl(url(...));  // true
isurl("string");  // false
```

### ispixel(_value_)

Returns `true` when the value is a number in pixels, `false` otherwise.

```css
ispixel(56px);  // true
ispixel(7.8%);  // false
```

### isem(_value_)

Returns `true` when the value is a number in `em`, `false` otherwise.

```css
isem(7.8em);  // true
isem(56px);   // false
```

### ispercentage(_value_)

Returns `true` when the value is a percentage, `false` otherwise.

```css
ispercentage(7.8%);  // true
ispercentage(56px);  // false
```

### isunit(_value_, _unit_)

Returns `true` when the value is a number in the specified unit (matched
case-insensitively), `false` otherwise.

```css
isunit(11px, px);  // true
isunit(4rem, rem); // true
isunit(2.2%, px);  // false
isunit(7.8%, '%'); // true
```

### isruleset(_value_)

Returns `true` when the value is a detached ruleset (or mixin/collection), `false`
otherwise. The argument is evaluated lazily.

```css
@-from '@jesscss/fns' import (isruleset);
@-let rules: {
  color: red;
};
.box {
  a: isruleset($rules); // true
  b: isruleset(#ff0);   // false
}
```

### isdefined(_value_)

Returns `true` when the referenced variable is defined, `false` otherwise. The
argument is evaluated lazily, so an undefined reference yields `false` rather than
erroring.

```css
@-from '@jesscss/fns' import (isdefined);
@-let foo: 1;
.box {
  a: isdefined($foo); // true
  b: isdefined($bar); // false
}
```
