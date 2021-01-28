---
id: logical
title: Logical Functions
sidebar_label: Logical
---

### iif(_condition_, _ifValue_, _elseValue_)

```scss
@import { iif } from '@jesscss/fns';
.box {
  width: iif($(value > 10), 20px, 10px);
}
```