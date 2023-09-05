TODO: Align with CSS Nesting (do not allow plain identifiers)

```less
.box {
  display: block;

  @media (min-width: 300px) {
    display: flex;
  }

  .foo & {
    background: white;
  }
}
```
