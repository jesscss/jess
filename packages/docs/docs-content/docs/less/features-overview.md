---
title: "Features Overview"
slug: "/features-overview"
audiences:
  - less
origin: less
---
Less (which stands for **L**eaner **S**tyle **S**heets) is a backwards-compatible language extension for CSS. It keeps the CSS mental model, then adds just enough power to scale: variables, mixins, nesting, maps, and functions.

Because Less reads like CSS, teams can adopt it fast and still ship predictable output. It works well for design-token systems, component libraries, and multi-theme products.

* _For detailed documentation on Less language features, see [Features](./features/variables)_
* _For a list of Less built-in functions, see [Functions](./functions/math-functions)_
* _For detailed usage instructions, see [Using Less.js](./usage/using-less)_
* _For third-party tools for Less, see [Tools](./tools/editors-and-plugins)_

What does Less add to CSS in practice? Here is a quick overview.


# Variables

These are pretty self-explanatory:

```less
@width: 10px;
@height: @width + 10px;

#header {
  width: @width;
  height: @height;
}
```

Outputs:

```css
#header {
  width: 10px;
  height: 20px;
}
```

**[Learn More About Variables](./features/variables)** 


# Mixins

Mixins are a practical way to compose reusable utility bundles.

If you use Tailwind, this is conceptually similar to `@apply` composition, but mixins also support parameters, guards, and namespaced organization.

Example utility-style mixin:

```less
.u-surface() {
  background: var(--surface-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: 0.75rem;
}

.card {
  .u-surface();
}

.popover {
  .u-surface();
  box-shadow: 0 10px 30px rgb(15 23 42 / 0.18);
}
```

This keeps repeated patterns consistent without copying long property blocks.

**[Learn More About Mixins](./features/mixins)** 


# Nesting

Less gives you the ability to use nesting instead of, or in combination with cascading. Let's say we have the following CSS:

```css
#header {
  color: black;
}
#header .navigation {
  font-size: 12px;
}
#header .logo {
  width: 300px;
}
```

In Less, we can also write it this way:

```less
#header {
  color: black;
  .navigation {
    font-size: 12px;
  }
  .logo {
    width: 300px;
  }
}
```

The resulting code is more concise, and mimics the structure of your HTML.

You can also bundle pseudo-selectors with mixins (`&` references the current selector):

```less
.interactive-card() {
  transition: transform 160ms ease, box-shadow 160ms ease;
  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 12px 28px rgb(15 23 42 / 0.16);
  }
}

.pricing-card {
  .interactive-card();
}
```

**[Learn More About Parent Selectors](./features/parent-selectors)** 


## Nested At-Rules and Bubbling

At-rules such as `@media` or `@supports` can be nested in the same way as selectors.

In the 5.x track, when `collapseNesting: true` is enabled, nested at-rules are lifted outward but their nested structure is preserved. In other words, nested media queries are not automatically merged into a single `and (...)` condition.

Less 4.x often emitted combined media conditions in this pattern, so if you are comparing outputs across versions this is an expected difference.

```less
.component {
  width: 300px;
  @media (min-width: 768px) {
    width: 600px;
    @media  (min-resolution: 192dpi) {
      background-image: url(/img/retina2x.png);
    }
  }
  @media (min-width: 1280px) {
    width: 800px;
  }
}

```
One 5.x output shape with `collapseNesting: true`:

```css
.component {
  width: 300px;
}
@media (min-width: 768px) {
  .component {
    width: 600px;
  }
  @media (min-resolution: 192dpi) {
    .component {
      background-image: url(/img/retina2x.png);
    }
  }
}
@media (min-width: 1280px) {
  .component {
    width: 800px;
  }
}
```


# Operations

Arithmetical operations `+`, `-`, `*`, `/` can operate on any number, color or variable. If it is possible, mathematical operations take units into account and convert numbers before adding, subtracting or comparing them. The result has leftmost explicitly stated unit type. If the conversion is impossible or not meaningful, units are ignored. Example of impossible conversion: px to cm or rad to %.

```less
// numbers are converted into the same units
@conversion-1: 5cm + 10mm; // result is 6cm
@conversion-2: 2 - 3cm - 5mm; // result is -1.5cm

// conversion is impossible
@incompatible-units: 2 + 5px - 3cm; // result is 4px

// example with variables
@base: 5%;
@filler: @base * 2; // result is 10%
@other: @base + @filler; // result is 15%
```

Multiplication and division do not convert numbers. It would not be meaningful in most cases - a length multiplied by a length gives an area and css does not support specifying areas. Less will operate on numbers as they are and assign explicitly stated unit type to the result.

```less
@base: 2cm * 3mm; // result is 6cm
```

You can also do arithmetic on colors:

```less
@color: (#224488 / 2); // result is #112244
background-color: #112244 + #111; // result is #223355
```
However, you may find Less's [Color Functions](./functions/color-operations) more useful.

From 4.0, No division is performed outside of parens using `/` operator.

```less
@color: #222 / 2; // results in `#222 / 2`, not #111
background-color: (#FFFFFF / 16); //results is #101010
```
You can change the [Math](./usage/less-options#math) setting to a more eager mode, but the `parens-division` default is recommended because `/` is often ambiguous in CSS values. With the default, division only happens when you express it explicitly (for example with parentheses), which avoids accidental transforms of valid CSS syntax.

## calc() exception

_Released [v3.0.0](https://github.com/less/less.js/blob/master/CHANGELOG.md)_

For CSS compatibility, `calc()` does not evaluate math expressions, but will evaluate variables
and math in nested functions.

```less
@var: 50vh/2;
width: calc(50% + (@var - 20px));  // result is calc(50% + (25vh - 20px))
```


# Escaping

Escaping allows you to use any arbitrary string as property or variable value. Anything inside `~"anything"` or `~'anything'` is used as is with no changes except [interpolation](./features/variables#variable-interpolation).

```less
@min768: ~"(min-width: 768px)";
.element {
  @media @min768 {
    font-size: 1.2rem;
  }
}
```

results in:
```less
@media (min-width: 768px) {
  .element {
    font-size: 1.2rem;
  }
}
```


# Functions

Less provides a variety of functions which transform colors, manipulate strings and do maths. They are documented fully in the [function reference](./functions/math-functions).

Using them is pretty straightforward. The following example uses percentage to convert 0.5 to 50%, increases the saturation of a base color by 5% and then sets the background color to one that is lightened by 25% and spun by 8 degrees:

```less
@base: #f04615;
@width: 0.5;

.class {
  width: percentage(@width); // returns `50%`
  color: saturate(@base, 5%);
  background-color: spin(lighten(@base, 25%), 8);
}
```

**[See: Function Reference](./functions/math-functions)** 


# Namespaces and Accessors

(Not to be confused with [CSS `@namespace`](http://www.w3.org/TR/css3-namespace/) or [namespace selectors](http://www.w3.org/TR/css3-selectors/#typenmsp)).

Sometimes, you may want to group your mixins, for organizational purposes, or just to offer some encapsulation. You can do this pretty intuitively in Less. Say you want to bundle some mixins and variables under `#bundle`, for later reuse or distributing:

```less
#bundle() {
  .button {
    display: block;
    border: 1px solid black;
    background-color: grey;
    &:hover {
      background-color: white;
    }
  }
  .tab { ... }
  .citation { ... }
}
```

Now if we want to mixin the `.button` class in our `#header a`, we can do:

```less
#header a {
  color: orange;
  #bundle.button();  // can also be written as #bundle > .button
}
```
Note: append `()` to your namespace (e.g. `#bundle()`) if you don't want it to appear in your CSS output i.e. `#bundle .tab`.

# Maps

As of Less 3.5, you can also use mixins and rulesets as maps of values.
```less
#colors() {
  primary: blue;
  secondary: green;
}

.button {
  color: #colors[primary];
  border: 1px solid #colors[secondary];
}
```
This outputs, as expected:
```css
.button {
  color: blue;
  border: 1px solid green;
}
```

**[See also: Maps](./features/maps)**

# Scope

Scope in Less is very similar to that of CSS. Variables and mixins are first looked for locally, and if they aren't found, it's inherited from the "parent" scope.

```less
@var: red;

#page {
  @var: white;
  #header {
    color: @var; // white
  }
}
```

Like CSS custom properties, mixin and variable definitions do not have to be placed before a line where they are referenced. So the following Less code is identical to the previous example:

```less
@var: red;

#page {
  #header {
    color: @var; // white
  }
  @var: white;
}
```

**[See also: Lazy Loading](./features/variables)**


# Comments

Both block-style and inline comments may be used:

```less
/* One heck of a block
 * style comment! */
@var: red;

// Get in line!
@var: white;
```

# Importing

Importing works pretty much as expected. You can import a `.less` file, and all the variables in it will be available. The extension is optionally specified for `.less` files.

```css
@import "./library"; // ./library.less
@import "./typo.css";
```

**[Learn More About Imports](./features/imports)**
