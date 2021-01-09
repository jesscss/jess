```less
.box {
  display: block;
  // Nope, not supported yet
  @media (min-width: 300px) {
    display: flex;
  }

  @nest .foo & {
    background: white;
  }
}
```
