import { attachSelectorBitLibrary, Selector } from '../selector.js';
import type { BitSetLibrary } from '../../util/bitset.js';

export function copySelectorForPlacement(
  selector: Selector,
  keySetLibrary?: BitSetLibrary<string>
): Selector {
  /*
   * Extend placement copies live in extend records over a SHARED source selector
   * (the extend registry reuses it across matches). Since B2-pre made extend's
   * selector composition parent-pointer-free, child selectors are now SHARED
   * (frozen), not deep-copied: the shared source child keeps its canonical
   * `.parent`, and the frozen bit makes the placement's `inherit`/`adopt` skip
   * the reparent, so placement never mutates the shared source tree.
   */
  const copied = selector.cloneForPlacement({ reuseLeaves: false, shareChildren: true });
  if (!(copied instanceof Selector)) {
    throw new TypeError('Expected selector copy');
  }
  return attachSelectorBitLibrary(copied, keySetLibrary ?? selector.keySetLibrary);
}
