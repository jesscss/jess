No special `:extend` or `@extend` is needed.

Here's a Sass block for Bootstrap

```less
  %grid-column {
    position: relative;
    width: 100%;
    padding-right: ($gutter / 2);
    padding-left: ($gutter / 2);
  }

  @each $breakpoint in map-keys($breakpoints) {
    $infix: breakpoint-infix($breakpoint, $breakpoints);

    // Allow columns to stretch full width below their breakpoints
    @for $i from 1 through $columns {
      .col#{$infix}-#{$i} {
        @extend %grid-column;
      }
    }
    .col#{$infix},
    .col#{$infix}-auto {
      @extend %grid-column;
    }
  }
```

Here's the same in Jess... hmmm... needs a helper?
```less
${each(map-keys(breakpoints), (breakpoint) => {
  let infix = breakpoint-infix(breakpoint, breakpoints)
  let arr = []
  for(1, columns, (i) => {
    arr.push(`.col-${infix}-${i}`)
  })
  return arr.join(',')
})} {
  position: relative;
  width: 100%;
  padding-right: ($gutter / 2);
  padding-left: ($gutter / 2);
}
```
