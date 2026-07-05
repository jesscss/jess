import { attachSelectorBitLibrary, Selector } from '../selector.js';
import type { BitSetLibrary } from './bitset.js';

export function copySelectorForPlacement(
  selector: Selector,
  keySetLibrary?: BitSetLibrary<string>
): Selector {
  // Extend placement copies are reparented into extend records over a SHARED
  // source selector (the extend registry reuses it across matches), so this is a
  // copy-on-write detach: clone the source-free leaf AND detach non-reusable
  // child selectors, so reparenting the placement cannot mutate the shared source.
  const copied = selector.cloneForPlacement({ reuseLeaves: false, detachChildren: true });
  if (!(copied instanceof Selector)) {
    throw new TypeError('Expected selector copy');
  }
  return attachSelectorBitLibrary(copied, keySetLibrary ?? selector.keySetLibrary);
}
