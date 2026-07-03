import { attachSelectorBitLibrary, Selector } from '../selector.js';
import type { BitSetLibrary } from './bitset.js';

export function copySelectorForPlacement(
  selector: Selector,
  keySetLibrary?: BitSetLibrary<string>
): Selector {
  const copied = selector.cloneForPlacement({ reuseLeaves: false });
  if (!(copied instanceof Selector)) {
    throw new TypeError('Expected selector copy');
  }
  return attachSelectorBitLibrary(copied, keySetLibrary ?? selector.keySetLibrary);
}
