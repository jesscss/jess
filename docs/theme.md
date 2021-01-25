```less
@import styles from 'library/variables.jess';
@import { config } from './my-vars.jess';

@let theme: styles(config);

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