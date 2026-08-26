functions.add('read-asset', function() {
  return new tree.Variable('@asset').eval(this.context);
});

functions.add('capability-probe', function() {
  less.logger.warn('IMPORTED_CAPABILITY_LOG');
  const percentage = this.context.pluginManager.less.functions.functionRegistry.get('percentage');
  return percentage(new tree.Dimension(0.5));
});

functions.add('current-file-after', function(value) {
  void value;
  return new tree.Anonymous(this.currentFileInfo.filename.split('/').pop());
});

functions.add('fail-asset', function() {
  new tree.Variable('@asset').eval(this.context);
  throw new Error('IMPORTED_ASSET_FAILURE');
});
