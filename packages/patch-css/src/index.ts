/** Detect that we're in a browser */
const isBrowser = new Function('try { return this===window } catch(e) { return false }')()

const sheetMap: Record<string, string> = {}
/**
 * Insert a stylesheet by id
 */
export const updateSheet = (text: string, id: string) => {
  if (!isBrowser) {
    return
  }
  if (!id) {
    throw new Error('ID is required.')
  }
  id = 'id_' + id
  let el = document.getElementById(id)
  if (!el) {
    el = document.createElement('style')
    el.setAttribute('id', id)
    let head = document.getElementsByTagName('head')[0]
    el.innerHTML = text
    head.appendChild(el)
  } else {
    el.innerHTML = text
  }
  sheetMap[id] = text
  localStorage.setItem('patchcss:sheets', JSON.stringify(sheetMap))
  return el
}

/**
 * We don't set sheetMap to the cached value, because ids can
 * change (maybe?), and we expect the host script to run
 * updateSheet for every current value.
 */
function getCachedSheets() {
  let cache = localStorage.getItem('patchcss:sheets')
  if (!cache) {
    return
  }
  let coll: Record<string, string> = JSON.parse(cache)
  let head = document.getElementsByTagName('head')[0]

  let fragment = document.createDocumentFragment()

  for (let id in coll) {
    if (coll.hasOwnProperty(id)) {
      /** Sanity check, in case this script gets loaded twice */
      let exists = document.getElementById(id)
      if (exists) {
        continue
      }
      let el = document.createElement('style')
      let text = coll[id]
      el.setAttribute('id', id)
      el.innerHTML = text
      fragment.appendChild(el)
    }
  }
  head.appendChild(fragment)
}

if (isBrowser) {
  getCachedSheets()
}