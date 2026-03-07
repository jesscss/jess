## Extend

Same as Less, but allow:
  1. without parens if in the ruleset
  2. :-extend or :-extends (note that it is non-standard)
  3. without `&` in the ruleset

```less
.class:-extend(.foo);
```
or
```less
// all valid forms
.class {
  &:-extend(.foo);
  :-extend(.foo);
  :-extends(.foo);
  :-extends .foo !all;
}
```
In addition, allow extending mixins. This allows extending "anonymous" rulesets.
```less
.class {
  :-extends .foo();
}
```