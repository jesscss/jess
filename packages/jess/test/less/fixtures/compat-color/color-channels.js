/* A legacy @plugin that reads a colour's channels, as bootstrap 4's color-yiq does. */
functions.add('channels', function(c) {
  const channels = c.rgb.map(n => Math.round(n));
  return new tree.Anonymous(channels.join(' ') + ' / ' + c.alpha);
});
