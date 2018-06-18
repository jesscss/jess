# Language Ideas / Spitballin'

## Nesting
Nested classes object tree, not child selectors
```css
.foo {
  color: red;
  .bar {
    color: blue;
  }
}
```
```jsx
import styles from './style.jess.css'

<div className={styles.foo}>
  <div className={styles.foo.bar}>...</div>
</div>
```

Child nesting still supported


## Variables
```css
.foo {
  @define red #F00;
  
}
```
