# Language Ideas / Spitballin'

## Nesting Rules
TBD


## Variables
```css
.foo {
  @define {
    size: 30px;
  }
  @define theme {
    red: #F00;
  }
  width: [size];
  color: theme[red];
}
```

## Element Queries

```css
@define {
  foo-match: 0;
}
.foo {
  background: red;
  :query(width > 300px) {
    /** @set updates in-scope var, @define can override a new var for local scope */
    @set { foo-match: 1; }
    background: blue;
  }
}
/** Set properties based on query matches elsewhere */
.bar {
  color: white;
  :when([foo-match] = 1) {
    color: yellow;
  }
}
```

