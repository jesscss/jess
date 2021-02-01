---
id: theming
title: Theming
---

Jess is good for theming in general, but Jess is also designed to be a good platform for building theming libraries like Bootstrap, Tailwind, UIKit, etc. It's highly configurable, from either `.jess` or `.js` files, and can provide custom static CSS for a down-stream website, or be used in "live" theming for applications like white-labeling.

### Example

Here's an example setup for a theming library.

#### config.jess

```scss
@let config {
  colors {
    value: red;
  }
}
```
#### hello.jess
```scss
@import { config as defaultConfig } from './config.jess';

@let config: $defaultConfig;

.hello {
  foo: $config.colors.value;
}
```
#### index.jess
```scss
@import { config as defaultConfig } from './config.jess';
@import hello from './hello.jess';

@let config: $defaultConfig;

@include hello(${config});
```
:::note

We pass in the config object to `hello.jess` (and all imported stylesheets) even though it imports a default configuration. This is so that, when someone imports your theming library, their configuration object will propogate through all your stylesheets.

If you're just building a website (not building a consumable theme), it's sufficient to just have your `.jess` files import config without exposing a `config` variable.

:::

#### Output

Running `jess index.jess` from above will produce the following CSS:
```css
.hello {
  foo: red;
}
```