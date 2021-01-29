import { tree } from 'jess'

type RGBValue = tree.Dimension | number

export function rgba(...values: [RGBValue, RGBValue, RGBValue, RGBValue]) {
  const rgba = values.map(v => +v)
  const value = `rgba(${rgba.join(', ')})`
  return new tree.Color({ value, rgba })
}

export function rgb(...values: [RGBValue, RGBValue, RGBValue]) {
  const rgb = values.map(v => +v)
  const value = `rgb(${rgb.join(', ')})`
  rgb.push(1)
  const color = rgba(rgb[0], rgb[1], rgb[2], rgb[3])
  color.value = value
  return color
}