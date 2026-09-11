/* Minimal color-yiq-shaped legacy @plugin: returns a looked-up color variable
   unmodified, plus a plugin-constructed color, to pin the compat color round-trip. */
function lookupVariable(context, name) {
  return tree.Variable.prototype.find(context.frames, (frame) => {
    const hit = frame.variable(name);
    if (!hit || hit.value === undefined) {
      return undefined;
    }
    return hit.value.eval(context);
  });
}

functions.add('passthrough-color', function() {
  return lookupVariable(this.context, '@brand');
});

functions.add('constructed-color', function() {
  return new tree.Color('fff');
});
