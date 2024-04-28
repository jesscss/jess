.a:is(.b > .c):is(.e .f).d {}

input search tree - back to front
 .a .c .f .d 
  \  \  /  /
   .a.c.f.d   <- .d remove
    /   \
   ' '  '>'   <- >
    |    |
    .e   .b   <- .b remove

.d
 \
  .d
  |
 '>'
  |
  .b


.g:extend(.b > .d !all) {}

1. search .d - start search(es)
2. go to .a.c.f.d
  a. start path
3. search > - match
4. search .b - match
5. prune empty paths
6. assemble final selector -> .g:is(.e .a.c.f) 
7. add to original selector list .a:is(.b > .c):is(.e .f).d, .g:is(.e .a.c.f) {}


All possible matches:



- [set] > [set] AND [set] [set]
- Set { .a, .b., .c, .e. .f, .d }


.g:extend(.b > .d !all) {}

.b

# Match sets
- .a 
- .b > .c

Is it easier backwards?

.d(.f .e):si(.c < .b):si.a

.d - yes, continue
.co(' ') - no
.co('>') - yes, continue 
.c - yes, match
.a - collect

.g:extend(.b > .d) {}

Set {.b, .d } -> [.b > .d, .g]

sets
  - A: Nodes { .a, .c, .d, .f }
  - B: .b > {A}
  - C: .e {A}
  - D: .g{.a, .c. .f}