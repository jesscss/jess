/** Detect that we're in a browser */
let isBrowser = new Function('try { return this===window } catch(e) { return false }')()

/**
 * Insert a stylesheet by id
 * 
 * @todo - cache in localStorage?
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
    const head = document.getElementsByTagName('head')[0]
    el.innerHTML = text
    head.appendChild(el)
  } else {
    el.innerHTML = text
  }
  return el
}

// function getCachedSheets() {

// }


// function attachLoad() {
//   window.addEventListener('DOMContentLoaded', getCachedSheets)
// }

// if (isBrowser) {
//   attachLoad()
// }