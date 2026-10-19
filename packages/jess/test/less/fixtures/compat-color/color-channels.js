/* A legacy @plugin that reads a colour's channels, as bootstrap 4's color-yiq does. */
functions.add('channels', function(c) {
  return new tree.Anonymous(c.rgb.join(' ') + ' / ' + c.alpha);
});

functions.add('same', function(c) {
  return c;
});
