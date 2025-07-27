---
title: Variables
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

Jess supports both scoped (Less- and CSS-style) and linear (Sass-style) variables.

## Scoped variables

Like CSS, variables have a value per scope. This is similar to how CSS custom properties work, but the scope is according to the stylesheet, instead of the DOM (as it is with CSS custom properties).

<Tabs>
  <TabItem value="jess" label="Jess">
    ```scss
    .btn {
      // In Jess/Less this is fine
      color: $color;
      $color: #06c;
      // In CSS this is also fine
      background: var(--background);
      --background: white;
    }
    ```
  </TabItem>
  <TabItem value="less" label="Less">
    ```scss
    .btn {
      color: @color;
      @color: #06c;
      background: var(--background);
      --background: white;
    }
    ```
  </TabItem>
  <TabItem value="sass" label="Sass (unsupported)">
    ```scss
    .btn {
      color: $color; // Error
      $color: #06c;
      // ...
    }
    ```
  </TabItem>
</Tabs>

## Linear variables

Linear variables are evaluated (and can be set) linearly.

### Get linearly

In Jess, linear variable lookup is done using `^$`. (You can think of `^` like the "pointer" to the declared variable.)

<Tabs>
  <TabItem value="jess" label="Jess">
    ```scss
    .btn {
      $color: red;
      color: ^$color; // value is red
      $color: blue;
    }
    ```
  </TabItem>
  <TabItem value="less" label="Less (unsupported)">
    ```scss
    .btn {
      @color: red;
      color: @color; // value is blue
      @color: blue;
    }
    ```
  </TabItem>
  <TabItem value="sass" label="Sass">
    ```scss
    .btn {
      $color: red;
      color: $color; // value is red
      $color: blue;
    }
    ```
  </TabItem>
</Tabs>

### Set linearly

Similar to getting, you can set previously-declared variables using `^$`. Jess will search upwards linearly and outwardly (by scope), and override the last known declaration. Among stylesheet languages, this feature is unique to Jess, but is more familiar to those used to conventional programming languages.

Note: this can be used as a replacement for Sass's `!global` if the referenced variable was global.

For example:

<Tabs>
  <TabItem value="js" label="JavaScript">
    ```js
    let color = 'red';
    {
      // Do not shadow, but assign
      color = 'blue';
    }
    console.log(color); // blue
    ```
  </TabItem>
  <TabItem value="jess" label="Jess">
    ```scss
    $color: red;
    .btn {
      // Do not shadow, but assign
      ^$color: blue;
    }
    .box {
      color: $color; // blue
    }
    ```
  </TabItem>
  <TabItem value="sass" label="Sass">
    ```scss
    $color: red;
    .btn {
      // Do not shadow, but assign
      $color: blue !global;
    }
    .box {
      color: $color; // blue
    }
    ```
  </TabItem>
</Tabs>