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
