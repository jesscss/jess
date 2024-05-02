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

Notes 2 May, 2024
---
Okay, I think I figured this out.

1. We need to build "AND paths" and "OR paths" by traversing selectors
   from back to front, and flattening each :is into building a separate
   AND path.

   For example:
   .a:is(.b > .c).d {}

    - this is a single AND path
    - we traverse backwards
      - find .d in a compound and unshift
      - find :is(), we add an AND path by:
        - replicating our current AND path but referencing the SAME compound in each
        - so if we add more to compound, it will add to each
      - find .c and unshift to linked compound
      - find > and unshift to current AND (build complex)
      - find .b and unshift to current AND (finish complex), :is() is done
      - find .a and unshift to linked compound
    - Now we have these two AND paths:
      AND:
        - [.a.c.d]
        - [.b > .a.c.d]
    - At this point, we can be smart and recognize that an AND path with a single compound
      can be discarded (because effectively it targets a selector that is .a.c.d AND .a.c.d)
      (If linked is only member of AND, discard?)
    - Now we can extend with a flat list. Extending will create OR paths
      For example, .g:extend(.b > .d) would create:
      AND:
        - [.b > .a.c.d]
      OR:
        - [.g.a.c]

  Next example, something more complex:

    .q ~ .a:is(.b > .c):is(.e .f).d {}

      - Start traversing back to front

        - AND:
          - 0: []
        - AND:
          - 0: [.d]
        - AND: (we found :is())
          - 0: [.d] -- important that these two .d's are not separate cloned selectors, but the same compound object
          - 1: [.d]
        - AND:
          - 0: [.f.d] - same compound
          - 1: [.f.d]
        - AND:
          - 0: [.f.d] .f.d is same compound
          - 1: [.e .f.d] - .e. .f.d is a unique complex but holding inner .f.d compound
        - AND: (current :is() is finished, we exit, but then enter new :is())
          - 0: [.f.d]
          - 1: [.e .f.d]
          - 2: [.f.d]
        - AND:
          - 0: [.c.f.d]
          - 1: [.e .c.f.d]
          - 2: [.c.f.d]
        - AND:
          - 0: [.c.f.d]
          - 1: [.e .c.f.d]
          - 2: [.b > .c.f.d]
        - AND: (exit :is())
          - 0: [.a.c.f.d]
          - 1: [.e .a.c.f.d]
          - 2: [.b > .a.c.f.d]
        - AND: (we finished selector)
          - 0: [.q ~ .a.c.f.d]
          - 1: [.e .a.c.f.d]
          - 2: [.b > .a.c.f.d]



      - Now we can recursively extend, and re-assemble after
        - If nothing is extended, we can output as-is of course
        - any :is() context that is not extended can be output as-is
        - So, for example, if we again apply `.g:extend(.b > .d)`, we should get:

        OR:
          AND: (original, output as-is)
            - 0: [.q ~ .a.c.f.d]
            - 1: [.e .a.c.f.d]
            - 2: [.b > .a.c.f.d]

          AND: (extended)
            - 0: [.q ~ .a.c.f.d]
            - 1: [.e .a.c.f.d]
            - 2: [.g.a.c.f] <-- alteration

        The simplest is to just output as this:

        .q ~ .a:is(.b > .c):is(.e .f).d,
        :is(.q ~ .a.c.f.d):is(.e .a.c.f.d):is(.g.a.c.f) {}
        

Next example, OR lists

OR lists (comma-separate lists in :is()) do not need to be expanded unless they contain complex selectors

  e.g. .a:is(.b, .c).d

  When indexing, check the members of :is(). If all are simple or compound, preserve :is() to check as "or"
  when matching.

More complex:

.a:is(.q > .b, .c).d

  - start traversing:
    AND:
      - 0: [.d]
    AND:
      - 0: [.d]
      - 1: [.d]
    OR: (We encountered an :is selector list, yet not all are compounds)
        (Note: each AND's compound is linked within that AND)
      AND:
        - 0: [.d]
        - 1: [.d]
      AND:
        - 0: [.d] (clone of compound)
        - 1: [.d] (same clone of compound)
    OR:
      AND: (find .c), finish
        - 0: [.c.d]
        - 1: [.c.d]
      AND:
        - 0: [.d]
        - 1: [.d]

    OR:
      AND:
        - 0: [.c.d]
        - 1: [.c.d]
      AND: (next item in selector)
        - 0: [.b.d]
        - 1: [.b.d]

    OR:
      AND:
        - 0: [.c.d]
        - 1: [.c.d]
      AND: (next item in selector)
        - 0: [.b.d]
        - 1: [.q > .b.d]


    OR: (exit and find final .a)
      AND:
        - 0: [.a.c.d]
        - 1: [.a.c.d]
      AND: (next item in selector)
        - 0: [.a.b.d]
        - 1: [.q > .a.b.d]