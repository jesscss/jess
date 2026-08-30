---
title: "Color Blending"
slug: "/functions/color-blending"
audiences:
  - less
origin: less
---
> These operations are _similar_ (though not necessarily identical) to the blend modes found in image editors like Photoshop, Fireworks, or GIMP, so you can use them to make your CSS colors match your images.

### multiply

> Multiply two colors. Corresponding RGB channels from each of the two colors are multiplied together then divided by 255. The result is a darker color.

Parameters:

* `color1`: A color object.
* `color2`: A color object.

Returns: `color`

**Examples**:

```less
multiply(#ff6600, #000000);
```
`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
multiply(#ff6600, #333333);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
multiply(#ff6600, #666666);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
multiply(#ff6600, #999999);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
multiply(#ff6600, #cccccc);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
multiply(#ff6600, #ffffff);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
multiply(#ff6600, #ff0000);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
multiply(#ff6600, #00ff00);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
multiply(#ff6600, #0000ff);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`


### screen

> Do the opposite of `multiply`. The result is a brighter color.

Parameters:

* `color1`: A color object.
* `color2`: A color object.

Returns: `color`

Example:

```less
screen(#ff6600, #000000);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
screen(#ff6600, #333333);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
screen(#ff6600, #666666);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
screen(#ff6600, #999999);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
screen(#ff6600, #cccccc);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
screen(#ff6600, #ffffff);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
screen(#ff6600, #ff0000);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
screen(#ff6600, #00ff00);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
screen(#ff6600, #0000ff);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`


### overlay

> Combines the effects of both `multiply` and `screen`. Conditionally make light channels lighter and dark channels darker. **Note**: The results of the conditions are determined by the first color parameter.

Parameters:

* `color1`: A base color object. Also the determinant color to make the result lighter or darker.
* `color2`: A color object to _overlay_.

Returns: `color`

Example:

```less
overlay(#ff6600, #000000);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
overlay(#ff6600, #333333);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
overlay(#ff6600, #666666);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
overlay(#ff6600, #999999);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
overlay(#ff6600, #cccccc);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
overlay(#ff6600, #ffffff);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
overlay(#ff6600, #ff0000);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
overlay(#ff6600, #00ff00);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
overlay(#ff6600, #0000ff);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`


### softlight

> Similar to `overlay` but avoids pure black resulting in pure black, and pure white resulting in pure white.

Parameters:

* `color1`: A color object to _soft light_ another.
* `color2`: A color object to be _soft lighten_.

Returns: `color`

Example:

```less
softlight(#ff6600, #000000);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
softlight(#ff6600, #333333);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
softlight(#ff6600, #666666);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
softlight(#ff6600, #999999);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
softlight(#ff6600, #cccccc);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
softlight(#ff6600, #ffffff);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
softlight(#ff6600, #ff0000);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
softlight(#ff6600, #00ff00);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
softlight(#ff6600, #0000ff);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`


### hardlight

> The same as `overlay` but with the color roles reversed.

Parameters:

* `color1`: A color object to _overlay_.
* `color2`: A base color object. Also the determinant color to make the result lighter or darker.

Returns: `color`

Example:

```less
hardlight(#ff6600, #000000);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
hardlight(#ff6600, #333333);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
hardlight(#ff6600, #666666);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
hardlight(#ff6600, #999999);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
hardlight(#ff6600, #cccccc);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
hardlight(#ff6600, #ffffff);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
hardlight(#ff6600, #ff0000);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
hardlight(#ff6600, #00ff00);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
hardlight(#ff6600, #0000ff);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`


### difference

> Subtracts the second color from the first color on a channel-by-channel basis. Negative values are inverted. Subtracting black results in no change; subtracting white results in color inversion.

Parameters:

* `color1`: A color object to act as the minuend.
* `color2`: A color object to act as the subtrahend.

Returns: `color`

Example:

```less
difference(#ff6600, #000000);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
difference(#ff6600, #333333);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
difference(#ff6600, #666666);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
difference(#ff6600, #999999);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
difference(#ff6600, #cccccc);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
difference(#ff6600, #ffffff);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
difference(#ff6600, #ff0000);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
difference(#ff6600, #00ff00);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
difference(#ff6600, #0000ff);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`


### exclusion

> A similar effect to `difference` with lower contrast.

Parameters:

* `color1`: A color object to act as the minuend.
* `color2`: A color object to act as the subtrahend.

Returns: `color`

Example:

```less
exclusion(#ff6600, #000000);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
exclusion(#ff6600, #333333);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
exclusion(#ff6600, #666666);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
exclusion(#ff6600, #999999);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
exclusion(#ff6600, #cccccc);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
exclusion(#ff6600, #ffffff);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
exclusion(#ff6600, #ff0000);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
exclusion(#ff6600, #00ff00);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
exclusion(#ff6600, #0000ff);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`


### average

> Compute the average of two colors on a per-channel (RGB) basis.

Parameters:

* `color1`: A color object.
* `color2`: A color object.

Returns: `color`

Example:

```less
average(#ff6600, #000000);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
average(#ff6600, #333333);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
average(#ff6600, #666666);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
average(#ff6600, #999999);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
average(#ff6600, #cccccc);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
average(#ff6600, #ffffff);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
average(#ff6600, #ff0000);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
average(#ff6600, #00ff00);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
average(#ff6600, #0000ff);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

### negation

> Do the opposite effect to `difference`.

The result is a brighter color. **Note**: The _opposite_ effect doesn't mean the _inverted_ effect as resulting from an _addition_ operation.

Parameters:

* `color1`: A color object to act as the minuend.
* `color2`: A color object to act as the subtrahend.

Returns: `color`

Example:

```less
negation(#ff6600, #000000);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
negation(#ff6600, #333333);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
negation(#ff6600, #666666);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
negation(#ff6600, #999999);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
negation(#ff6600, #cccccc);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
negation(#ff6600, #ffffff);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
negation(#ff6600, #ff0000);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
negation(#ff6600, #00ff00);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`

```less
negation(#ff6600, #0000ff);
```

`[color swatch]`
`[color swatch]`
`[color swatch]`
