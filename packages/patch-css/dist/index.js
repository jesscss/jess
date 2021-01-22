(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
  typeof define === 'function' && define.amd ? define(['exports'], factory) :
  (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.jess = {}));
}(this, (function (exports) { 'use strict';

  /** Detect that we're in a browser */
  let isBrowser = new Function('try { return this===window } catch(e) { return false }')();

  let sheetLength;

  let _searchStart = '#__jess_start';
  let _searchEnd = '#__jess_end';


  const sheetMap = new Map();

  /**
   * Stringify the contents of all loaded stylesheets
   */
  function collectStylesheets() {
    sheetLength = document.styleSheets.length;
    for(let i = 0; i < sheetLength; i++) {
      const sheet = document.styleSheets[i];
      if (sheetMap.has(sheet.ownerNode)) {
        continue
      }

      try {
        const rules = sheet.cssRules;
        const numRules = rules.length;
        let ruleText = '';
        for (let j = 0; j < numRules; j++) {
          ruleText += rules[j].cssText;
        }
        sheetMap.set(sheet.ownerNode, ruleText);
      } catch (e) {}
    }
  }

  function attachLoad() {
    window.addEventListener('DOMContentLoaded', collectStylesheets);
  }

  function init({ searchStart, searchEnd }) {
    _searchStart = searchStart || _searchStart;
    _searchEnd = searchEnd || _searchEnd;

    if (isBrowser) {
      attachLoad();
    }
  }

  /**
   * Insert a stylesheet just after the node where styles are found.
   * 
   * @todo
   * This is prime for lots of optimization. For Alpha, we just always
   * generate or replace a style block without diffing.
   */
  function updateSheet(styleContents, id) {
    let previousSheet;




    sheetMap.forEach((text, node) => {
      if (previousSheet) {
        return
      }
      if (node instanceof Element && node.id === id) {
        previousSheet = { node, text };
      }
    });

    let key = id;

    if (!previousSheet) {
      /** Update our map */
      collectStylesheets();
      key = null;

      let startText = `${_searchStart} { content: "${id}"; }`;
      let endText = `${_searchEnd} { content: "${id}"; }`;

      sheetMap.forEach((text, node) => {
        if (key !== null) {
          return
        }
        let start = text.indexOf(startText);
        if (start !== -1) {
          /** This should be the sheet */
          let end = text.indexOf(endText);
          if (end !== -1) {
            previousSheet = { text, node };
            key = 'true';
          }
        }
      });
    }

    const createStyleElement = (text) => {
      const style = document.createElement('style');
      style.setAttribute('media', 'all,jess');
      style.setAttribute('id', id);
      style.innerHTML = text;
      return style
    };

    if (previousSheet) {
      /** Update existing sheet */
      if (key === id && previousSheet.node instanceof Element) {
        previousSheet.node.innerHTML = styleContents;
        collectStylesheets();
        return
      }
      const next = previousSheet.node.nextElementSibling;
      const style = createStyleElement(styleContents);
      if (next) {
        previousSheet.node.parentNode.insertBefore(style, next);
        return
      }
    }

    const head = document.getElementById('head');
    const style = createStyleElement(styleContents);
    head.appendChild(style);
  }

  exports.init = init;
  exports.isBrowser = isBrowser;
  exports.updateSheet = updateSheet;

  Object.defineProperty(exports, '__esModule', { value: true });

})));
