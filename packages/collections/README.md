# Jess Collections

Helper functions and utilities for efficiently working with array and object
collections.

## Notes

Originally I had custom Hashmaps and ArrayLists, in order to normalize
generators and iterators for each. But using non-native collections
adds complexity but, more importantly, performance overhead, especially
if you don't use those iterators.

Even using a Map over an object for a dictionary, in theory, has faster
lookups, but in total evaluation time, when the file is parsed, it would
be passing in either a Map or an object, and converting the object
to a map has object creation overhead, and so does creating the map itself,
if you pass in an array of arrays.

Maps are good for dynamic property additions and repeated lookups. Nodes
look up / evaluate properties, at most, once per node, so an object-as-map
will either be faster or the differences will be negligible.
