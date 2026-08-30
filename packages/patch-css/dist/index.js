(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
  typeof define === 'function' && define.amd ? define(['exports'], factory) :
  (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.patchCss = {}));
}(this, (function (exports) { 'use strict';

  /** Detect that we're in a browser */
  let isBrowser = new Function('try { return this===window } catch(e) { return false }')();

  const sheetMap = {};
  /**
   * Insert a stylesheet by id
   */
  const updateSheet = (text, id) => {
    if (!isBrowser) {
      return
    }
    if (!id) {
      throw new Error('ID is required.')
    }
    id = 'id_' + id;
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('style');
      el.setAttribute('id', id);
      const head = document.getElementsByTagName('head')[0];
      el.innerHTML = text;
      head.appendChild(el);
    } else {
      el.innerHTML = text;
    }
    sheetMap[id] = text;
    localStorage.setItem('patchcss:sheets', JSON.stringify(sheetMap));
    return el
  };

  /**
   * We don't set sheetMap to the cached value, because ids can
   * change (maybe?), and we expect the host script to run
   * updateSheet for every current value.
   */
  function getCachedSheets() {
    const cache = localStorage.getItem('patchcss:sheets');
    if (!cache) {
      return
    }
    const coll = JSON.parse(cache);
    const head = document.getElementsByTagName('head')[0];

    const fragment = document.createDocumentFragment();

    for (let id in coll) {
      if (coll.hasOwnProperty(id)) {
        /** Sanity check, in case this script gets loaded twice */
        const exists = document.getElementById(id);
        if (exists) {
          continue
        }
        const el = document.createElement('style');
        const text = coll[id];
        el.setAttribute('id', id);
        el.innerHTML = text;
        fragment.appendChild(el);
      }
    }
    head.appendChild(fragment);
  }

  if (isBrowser) {
    getCachedSheets();
  }

  exports.updateSheet = updateSheet;

  Object.defineProperty(exports, '__esModule', { value: true });

})));
