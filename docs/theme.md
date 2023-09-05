```less
@use './my-vars.jess' (config);
@use 'library/variables.jess' theme with config;


.box {
  color: $theme.colors.primary;
}
```
Hmmm....
```less
// library/box.jess
@import { theme } from 'library/variables.jess';
// ^^ theme needs to be inherited / over-written? 

.box {
  color: $theme.colors.primary;
}
```