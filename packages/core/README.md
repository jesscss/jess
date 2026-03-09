# Jess Core - Syntax Tree & Core Evaluation

This is separate from the `jess` package, because it contains the AST, therefore parsers can import this package to export an AST, and `jess` can import the parser + core. (Avoids circular dependencies.)

## Data structures

I've fiddled around with lots of data structures trying to find optimal node insertion / removal. With the latest code, I've eliminated most (if not all?) of mid-list insertion/deletion in array-like structures. I had a lot of code based on [Queue from data-structure-typed](https://github.com/zrwusa/data-structure-typed) (and tried some other structures), but Queue is really only faster when items need to be removed / added to the beginning, because of Array resizing. If we're doing only pushes & pops, no mid-list insertions, and only indexed lookups, then a native Array will always win. In those array-like structures for that library, pushes / pops, then an Array will be fine (and its an ArrayList internally).

For HashMap-like structures, I actually think using a simple extension of Map might be ideal. It's roughly the same speed as `data-structure-typed`'s HashMap, and I can do a custom clone that utilizes a [custom while loop that is currently fastest in Chrome](https://jsperf.app/savivi/6).