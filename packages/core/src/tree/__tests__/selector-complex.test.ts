import { sel, compound, el, co, pseudo, sellist } from '..';

describe('Complex selector', () => {
  describe('keys', () => {
    test('simple complex', () => {
      let sel1 = sel([
        compound([
          el('.one'),
          el('.two')
        ]),
        co('>'),
        el('.three')
      ]);
      expect([...sel1.keySet]).toEqual(['.one', '.two', '.three']);
    });
    test('nested complex (w/ relative :is)', () => {
      let sel2 = sel([
        compound([
          pseudo({ name: ':is', arg: el('a') }),
          el('#id'),
          pseudo({ name: ':is', arg: sel([co('>'), compound([el('.two'), el('.one')])]) })
        ])
      ]);
      expect([...sel2.keySet]).toEqual(['a', '#id', '.two', '.one']);
    });
    test('nested complex (w/o relative :is)', () => {
      let sel2 = sel([
        compound([
          pseudo({ name: ':is', arg: el('a') }),
          el('#id'),
          pseudo({ name: ':is', arg: sel([compound([el('.two'), el('.one')])]) })
        ])
      ]);
      expect([...sel2.keySet]).toEqual(['a', '#id', '.two', '.one']);
    });
    test(':is w/ selector list', () => {
      let sel2 = sel([
        compound([
          pseudo({ name: ':is', arg: sellist([el('a'), el('b')]) }),
          el('#id'),
          pseudo({ name: ':is', arg: sel([compound([el('.two'), el('.one')])]) })
        ])
      ]);
      expect([...sel2.keySet]).toEqual(['a', 'b', '#id', '.two', '.one']);
    });

    test(':is w/ complex selector list', () => {
      let sel2 = sel([
        compound([
          pseudo({
            name: ':is',
            arg: sellist([
              sel([el('a'), co('>'), el('b')]),
              sel([el('c'), co('>'), el('d')])
            ])
          }),
          el('#id'),
          pseudo({ name: ':is', arg: sel([compound([el('.two'), el('.one')])]) })
        ])
      ]);
      expect([...sel2.keySet]).toEqual(['a', 'b', 'c', 'd', '#id', '.two', '.one']);
    });
  });
});