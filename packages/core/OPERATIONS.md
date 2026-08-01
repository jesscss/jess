# Comparison between .less / .scss results and Jess target

Resolutions:
1. Remove "equalityMode" from Jess options
2. Instead, "lower" .scss / .less accordingly
3. Add a double-equality operator (equal to type) to .jess
4. Slightly shift Less / Sass+ behavior in moderately breaking ways.


Note that these comparisons should be function-based compare / operate primitives used in other places, like in .jess index lookup.

e.g.

```jess
$foo: {
  [1px]: bar;  // 1px is a true dimension value
}

.a {
  foo: $foo['1px']; // bar, because we use loose equality
}

```




## Less 4.x .less behavior

Input
```less
.a {
  a: 1 + 2;
  b: 1 + 2px;
  c: 1px + 2;
  d: 1 * 2px;
  e: 1px * 2;
  f: 1px * 2px;
  f2: 1px * 10%;
  f3: 10% * 1px;
  g: (1px / 2);
  g2: (2px / 1px);
  h: (1 / 2px);
  h2: calc(2px / 1);
  @val: 8px;
  h3: calc(@val / 2);
  i: boolean(1 = 2);
  j: boolean(1 = 1px);
  j2: boolean(1em = 1px);
  k: boolean(2 = 1px);
  l: boolean(2 = 2%);
  m: boolean(1 > 2);
  n: boolean(2 > 1);
  o: boolean(1 > 1px);
  p: boolean(1 >= 1px);
  q: boolean(a = b);
  r: boolean(a = "a");
  s: boolean(a = a);
  t: boolean(a > b);
  u: boolean(b > a);
  v: boolean(red = red);
  w: boolean(black = transparent);
  x: boolean(black = #000000);
  y: boolean(black = #00000000);
  z: boolean(black = #000000FF);
}
```

Output:
```css
.a {
  a: 3;
  b: 3px;
  c: 3px;
  d: 2px;
  e: 2px;
  f: 2px;
  f2: 10px;
  f3: 10%;
  g: 0.5px;
  g2: 2px;
  h: 0.5px;
  h2: calc(2px / 1);
  h3: calc(8px / 2);
  i: false;
  j: true;
  j2: false;
  k: false;
  l: true;
  m: false;
  n: true;
  o: false;
  p: true;
  q: false;
  r: false;
  s: true;
  t: false;
  u: false;
  v: true;
  w: false;
  x: true;
  y: false;
  z: true;
}
```

## dart-sass .scss behavior

Input
```scss
.a {
  a: 1 + 2;
  b: 1 + 2px;
  c: 1px + 2;
  d: 1 * 2px;
  e: 1px * 2;
  f: 1px * 2px;
  f2: 1px * 10%;
  f3: 10% * 1px;
  g: (1px / 2);
  g2: (2px / 1px);
  h: (1 / 2px);
  h2: calc(2px / 1);
  $val: 8px;
  h3: calc($val / 2);
  i: 1 == 2;
  j: 1 == 1px;
  j2: 1em == 1px;
  k: 2 == 1px;
  l: 2 == 2%;
  m: 1 > 2;
  n: 2 > 1;
  o: 1 > 1px;
  p: 1 >= 1px;
  q: a == b;
  r: a == "a";
  s: a == a;
  t: sass error; // a > b; Sass error
  u: sass error; // b > a; Sass error
  v: red == red;
  w: black == transparent;
  x: black == #000000;
  y: black == #00000000;
  z: black == #000000FF;
}
```

Output:
```css
.a {
  a: 3;
  b: 3px;
  c: 3px;
  d: 2px;
  e: 2px;
  f: calc(2px * 1px);
  f2: calc(10px * 1%);
  f3: calc(10% * 1px);
  g: 0.5px;
  g2: 2;
  h: calc(0.5 / 1px);
  h2: 2px;
  h3: 4px;
  i: false;
  j: false;
  j2: false;
  k: false;
  l: false;
  m: false;
  n: true;
  o: false;
  p: true;
  q: false;
  r: true;
  s: true;
  t: sass error;
  u: sass error;
  v: true;
  w: false;
  x: true;
  y: false;
  z: true;
}
```

## .jess expected

```scss
.a {
  a: $(1 + 2); // 3
  b: $(1 + 2px); // 3px;
  c: $(1px + 2); // 3px
  d: $(1 * 2px); // 2px
  e: $(1px * 2); // 2px
  f: $(1px * 2px); // EVAL Warning? -> calc(1px * 2px);
  f2: $(1px * 10%); // EVAL Warning? -> calc(1px * 10%);
  f3: $(10% * 1px); // EVAL Warning? -> calc(10% * 1px);
  g: $(1px / 2); // 0.5px
  g2: $(2px / 1px); // 2
  h: $(1 / 2px); // 0.5px
  $val: 8px;
  h3: calc($val / 2); // calc(8px / 2); // Jess respects more authorship
  h4: calc($(val / 2)); // 4px; -- single values in calc() can be unwrapped
  i: $(1 = 2); // false
  j: $(1 = 1px); // true
  j1: $(1 == 1px); // false
  j2: $(1em = 1px); // false
  k: $(2 = 1px); // false
  l: $(2 = 2%); // true
  l1: $(2 == 2%); // false 
  m: $(1 > 2); // false
  n: $(2 > 1); // true
  o: $(1 > 1px); // false
  p: $(1 >= 1px); // true
  q: $(a = b); // false
  r: $(a = "a"); // true -- Sass value to quoted comparisons are lowered to "="
  r1: $(a == "a"); // false
  s: $(a = a); // true
  t: $(a > b); // false
  u: $(b > a); // false
  v: $(red = red); // true
  w: $(black = transparent); // false
  x: $(black = #000000); // true
  y: $(black = #00000000); // false
  z: $(black = #000000FF); // true
}
```