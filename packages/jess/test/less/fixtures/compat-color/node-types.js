/* A legacy @plugin that reports the Less node type it receives. */
functions.add('type-of', function(node) {
  return new tree.Anonymous(node.type + (node instanceof tree.Keyword ? '+' : ''));
});
