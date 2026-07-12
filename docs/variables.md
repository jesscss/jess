# Variable evaluation

## Less

Evaluates per scope.
```scss
.box {
  @color: red;
  background-color: @color;
  @color: blue;
}
```
Output:
```css
.box {
  background-color: blue;
}
```

## Sass

Evaluates linearly.

```scss
.box {
  @color: red;
  background-color: @color;
  @color: blue;
}
```
Output:
```css
.box {
  background-color: red;
}
```

## Jess

Evaluates linearly...

```scss
.box {
  $let color: red;
  background-color: $color;
  $color: blue;
}
```
Output:
```css
.box {
  background-color: red;
}
```

AND Jess evaluates by scope. In the case of props, they are accessed like Less's, because CSS props follow "last one wins".

```scss
.box {
  color: red;
  background-color: $.color;
  color: blue;
}
```
Output:
```css
.box {
  color: red;
  background-color: blue;
  color: blue;
}
```

When converting Less to Jess, Jess hoists variables (maybe?)
