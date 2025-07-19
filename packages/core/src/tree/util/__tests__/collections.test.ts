import { IndexedTrie } from '../collections';
import { el } from '../../.';

describe('IndexedTrie', () => {
  test('can create a trie', () => {
    let trie = new IndexedTrie();
    expect(trie).toBeInstanceOf(IndexedTrie);
  });

  test('can push a value', () => {
    let trie = new IndexedTrie();
    trie.push(el('.foo'));
    expect(trie.keySet).toEqual(new Set(['foo']));
  });

  test('can get a value', () => {
    let trie = new IndexedTrie();
    let src = el('.foo');
    trie.push(src);
    expect(trie.get('foo')).toEqual(new Set([src]));
  });

  test('can add an edge', () => {
    let trie = new IndexedTrie();
    let src = el('.foo');
    let target = el('.bar');
    trie.addEdge(src, target);
    expect(trie.edgeMaps.get(src)?.size).toBe(1);
  });

  /** Find .foo.bar within .foo.bar */
  test('can add classes', () => {
    let trie = new IndexedTrie();
    let src = el('.foo');
    let target = el('.bar');
    trie.addEdge(src, target);
  });
});