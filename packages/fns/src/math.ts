const mathFunctions = {
  // name,  unit
  ceil: null,
  floor: null,
  sqrt: null,
  abs: null,
  tan: '',
  sin: '',
  cos: '',
  atan: 'rad',
  asin: 'rad',
  acos: 'rad'
}

for (const f in mathFunctions) {
  // eslint-disable-next-line no-prototype-builtins
  if (mathFunctions.hasOwnProperty(f)) {
    mathFunctions[f] = mathHelper.bind(null, Math[f], mathFunctions[f])
  }
}

mathFunctions.round = (n, f) => {
  const fraction = typeof f === 'undefined' ? 0 : f.value
  return mathHelper(num => num.toFixed(fraction), null, n)
}

export default mathFunctions