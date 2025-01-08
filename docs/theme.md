```less
@--use './my-vars.jess' (config);
@--use 'library/variables.jess' (theme) with $config;


.box {
  color: $theme.colors.primary;
}
```
Hmmm....
```less
// library/box.jess
@--from 'library/variables.jess' import (theme);
// ^^ theme needs to be inherited / over-written? 

.box {
  color: $theme.colors.primary;
}
```