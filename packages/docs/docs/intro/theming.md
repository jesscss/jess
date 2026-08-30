---
id: theming
title: Theming
---

Jess is good for theming in general, but Jess is also designed to be a good platform for building theming libraries like Bootstrap, Tailwind, UIKit, etc. It's highly configurable, from either `.jess` or `.js` (or `.ts` with a plugin) files, and can provide custom static CSS for a down-stream website, or be used in "live" theming for applications like white-labeling.

### Example

Here's [an example setup](https://github.com/jesscss/theme-library-example) for a theming library.

#### config.jess

```scss
@let value: red;
@let config {
  global {
    borderRadius: 3px;
  }
  buttons {
    borderRadius: $config.global.borderRadius;
  }
  colors {
    value: $value;
  }
}
```
#### buttons.jess
```scss
@import { config as defaultConfig } from './config.jess';

@let config: $defaultConfig;

.button {
  color: $config.colors.value;
  border-radius: $config.buttons.borderRadius;
}
```
#### nav.jess
```scss
@import { config as defaultConfig } from './config.jess';

@let config: $defaultConfig;

.nav {
  color: $config.colors.value;
}
```
#### library.jess
```scss
@import getConfig from './config.jess';
@import buttons from './buttons.jess';
@import nav from './nav.jess';

@let settings {
  global {
    borderRadius: 4px;
  }
  colors {
    value: blue;
  }
}
/****************************************
Stylesheets can return new values as a
result of passing in values.
****************************************/
@let config: $getConfig({
  config: settings
}).config;

/****************************************
We pass our new `config` object to our
stylesheets.
****************************************/
@include buttons(${config});
@include nav(${config});
```
:::note

We pass in the config object to `buttons.jess` and `nav.jess` even though they import a default configuration. This:
1. makes sure that Jess merges your updated values based on that key.
2. makes your code easier to reason about (so that a `@let` is always a "default" value)
3. allows future IDE plugins to do tricks like auto-completion of key names based on collection structure


If you're just building a website (not building a consumable theme package), it's sufficient to just have your `.jess` files import a default configuration without exposing a `config` variable.

:::

#### Output

Running `jess library.jess` from above will produce the following CSS:
```css
.button {
  color: blue;
  border-radius: 4px;
}
.nav {
  color: blue;
}
```

[You can clone a working example of this here.](https://github.com/jesscss/theme-library-example)