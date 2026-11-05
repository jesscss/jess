/* A plugin module with no ES build. `hidden` is out of reach of an import's export detection. */
const make = () => ({ name: 'commonjs-only' });
const holder = { make, data: 1 };
holder['hid' + 'den'] = function hidden() {
  return this.make();
};
holder.default = make;
module.exports = holder;
