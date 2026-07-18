---
id: misc
title: Misc Functions
sidebar_label: Misc
audiences:
  - jess
origin: jess
---
Assorted helpers from `@jesscss/fns`. Import the ones you need. Each mirrors the
equivalent Less built-in.

### color(_string_)

Parses a string into a color. Accepts a named CSS color or a 3/4/6/8-digit hex
string.

```css
@-from '@jesscss/fns' import (color);
.box {
  color: color("#aaa");
}
```
Output:
```css
.box {
  color: #aaa;
}
```

### unit(_dimension_[, _unit_])

Removes or changes the unit of a dimension without converting the number. Omit
`unit` to strip the unit. See the `convert` function below to change the unit
*with* conversion.

```css
@-from '@jesscss/fns' import (unit);
.box {
  a: unit(5, px); // 5px
  b: unit(5em);   // 5
}
```

### getUnit(_dimension_)

Returns the unit of a dimension as a keyword (empty when the number is unitless).
Exposed under the JavaScript export name `getUnit` (the Less function is `get-unit`).

```css
@-from '@jesscss/fns' import (getUnit);
.box {
  a: getUnit(5px); // px
  b: getUnit(5);   //
}
```

### convert(_value_, _unit_)

Converts a number from one unit into another within the same family. If the units
are incompatible, the value is returned unchanged.

Compatible unit groups:

* lengths: `m`, `cm`, `mm`, `in`, `px`, `pt`, `pc`
* time: `s`, `ms`
* angle: `rad`, `deg`, `grad`, `turn`

```css
@-from '@jesscss/fns' import (convert);
.box {
  a: convert(9s, "ms");  // 9000ms
  b: convert(14cm, mm);  // 140mm
  c: convert(8, mm);     // 8 (incompatible)
}
```

### data-uri(_mimetype_[, _url_])

Inlines a file as a `data:` URL. If the MIME type is omitted it is guessed from the
file extension; text is percent-encoded and binary is base64-encoded. If the file
can't be read, it falls back to a plain `url()` of the path.

:::info

This function reads from the filesystem, so it is only available in the node
environment.

:::

```css
@-from '@jesscss/fns' import (dataUri);
.box {
  background: dataUri('image/jpeg;base64', '../data/image.jpg');
}
```

### svg-gradient(_direction_, _stops..._)

Generates a multi-stop SVG gradient as an inline `data:` URL. `direction` must be one
of `to bottom`, `to right`, `to bottom right`, `to top right`, `ellipse` or
`ellipse at center`, followed by two or more color stops (each a color with an
optional position).

```css
@-from '@jesscss/fns' import (svgGradient);
.box {
  @-let stops: red, green 30%, blue;
  background-image: svgGradient(to right, $stops);
}
```

### image-size(_string_) · image-width(_string_) · image-height(_string_)

Read the intrinsic dimensions of an image file. `imageSize` returns `width height`;
`imageWidth` and `imageHeight` return a single `px` dimension.

:::info

These read from the filesystem, so they are only available in the node environment.

:::

```css
@-from '@jesscss/fns' import (imageSize, imageWidth, imageHeight);
.box {
  a: imageWidth("file.png");  // 10px
  b: imageHeight("file.png"); // 10px
  c: imageSize("file.png");   // 10px 10px
}
```
