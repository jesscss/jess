```less
.box {
  display: block;
  @media (min-width: 300px) {
    display: flex;
  }
  @nest .foo & {
    background: white;
  }
}
```
