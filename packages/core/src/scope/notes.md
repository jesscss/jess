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



Notes 29 Apr, 2024
----
What if sets were tuples of
not classes but sets

.a:is(.b > .c):is(.e .f).d .q {}
.g:extend(.b > .d .q) {}

1. Search .q
   a. Find .q,' ',.d,>,.b
   b. Match .q
   c. Match ' '
   d. Match .d.f.c.a
   e. Match .d.f.c.a --> parent is compound 1
   f. Match > --> parent is compound 2
   g. Match .b
   h. We've crossed an :is() boundary, so let's absorb the whole :is() with all :is() expressions:
        :is(.b > .c.a.f.d .q):is(.e .c.a.f.d .q) 
          We should have kept track of the matching :is(), so let's do the extend
        :is(.b > .c.a.f.d .q, .g):is(.e .c.a.f.d .q)
          So... technically, we could match .g.q, but fuck that...

2. We never finished...

  3. Search .d
  4. Search .f
  5. Search .c
  6. Search .a


paths: [
  :is([.b, >, .c.a.f.d .q]),
  :is([.e, ' ', .c.a.f.d .q])
]

.g:extend(.b > .d !all) {}

Map {
  .b -> { selector: sel([.b, >, .d]) }
}