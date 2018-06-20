# Language Ideas / Spitballin'

## Nesting Rules
There's no `&`. It's automatically implied. This helps output stay flatter
```css
.my-component {
  -modifier {} /* .my-component-modifier */
}
```
```jsx
import styles from `style.jess.css`

<div className={styles.myComponentModifier} />
<div className={styles['my-component-modifier']} />
```
Child components must be explicit using the explicit descendent combinator `>>`

```css
.my-component {
  >> [data-component] {...}  /* .my-component [data-component] */
}
```

## Variables
```css
.foo {
  @define {
    size: 30px;
  }
  @define theme {
    red: #F00;
  }
  width: [[size]];
  color: [[theme.red]];
}
```

## Exporting Vars


## Element Queries

```css
@define {
  foo-match: 0;
}
.foo {
  background: red;
  /* :q for :query? */
  :q(width > 300px) {
    /** @set updates in-scope var, @define creates (or overrides) a new var for local scope */
    @set { foo-match: 1; }
    background: blue;
  }
}
/** Set properties based on query matches elsewhere */
.bar {
  color: white;
  :when(foo-match = 1) {
    color: yellow;
  }
}
```
## Scroll Position
```css
@define { scroll: 0 }
/* pass in scrollY as local var */
body:q(scrollY?) {
   @set { scroll: [[scrollY]] }
}

div:q(visible > 50%) {
  transform: translateY(-[[scroll / 2]]);
}
```

