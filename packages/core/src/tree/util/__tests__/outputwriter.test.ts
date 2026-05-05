import { describe, it, expect } from 'vitest';
import { OutputWriter } from '../print.js';

type WriterPosition = {
  line: number;
  column: number;
  segments: number;
  length: number;
};

function isWriterPosition(value: unknown): value is WriterPosition {
  return typeof value === 'object'
    && value !== null
    && typeof Reflect.get(value, 'line') === 'number'
    && typeof Reflect.get(value, 'column') === 'number'
    && typeof Reflect.get(value, 'segments') === 'number'
    && typeof Reflect.get(value, 'length') === 'number';
}

function positionsFor(writer: OutputWriter): WriterPosition[] {
  const positions: unknown = Reflect.get(writer, '_positions');
  if (!Array.isArray(positions) || !positions.every(isWriterPosition)) {
    throw new TypeError('Expected OutputWriter positions');
  }
  return positions;
}

describe('OutputWriter', () => {
  describe('position tracking', () => {
    it('properly advances output position with plain add', () => {
      const w = new OutputWriter();

      expect(w.line).toBe(0);
      expect(w.column).toBe(0);

      w.add('hello');
      expect(w.line).toBe(0);
      expect(w.column).toBe(5);

      w.add(' world');
      expect(w.line).toBe(0);
      expect(w.column).toBe(11);
    });

    it('properly counts lines during add', () => {
      const w = new OutputWriter();

      w.add('line1\nline2\nline3');
      expect(w.line).toBe(2);
      expect(w.column).toBe(5); // length of 'line3'
    });

    it('handles multiple newlines correctly', () => {
      const w = new OutputWriter();

      w.add('a\nb\nc\nd');
      expect(w.line).toBe(3);
      expect(w.column).toBe(1); // length of 'd'
    });

    it('handles empty string', () => {
      const w = new OutputWriter();

      w.add('');
      expect(w.line).toBe(0);
      expect(w.column).toBe(0);
    });

    it('handles string ending with newline', () => {
      const w = new OutputWriter();

      w.add('hello\n');
      expect(w.line).toBe(1);
      expect(w.column).toBe(0); // after newline
    });
  });

  describe('capture behavior', () => {
    it('captures content without advancing the output index', () => {
      const w = new OutputWriter();

      w.add('before ');
      const beforeLine = w.line;
      const beforeColumn = w.column;

      const captured = w.capture(() => {
        w.add('captured content\nwith newlines');
      });

      // Position should be unchanged after capture
      expect(w.line).toBe(beforeLine);
      expect(w.column).toBe(beforeColumn);
      expect(w.toString()).toBe('before ');
      expect(captured).toBe('captured content\nwith newlines');
    });

    it('capture does not affect main buffer', () => {
      const w = new OutputWriter();

      w.add('start');
      const captured = w.capture(() => {
        w.add('middle');
      });
      w.add('end');

      expect(w.toString()).toBe('startend');
      expect(captured).toBe('middle');
    });

    it('capture with newlines does not affect position', () => {
      const w = new OutputWriter();

      w.add('line1\n');
      const captured = w.capture(() => {
        w.add('line2\nline3\n');
      });

      expect(w.line).toBe(1);
      expect(w.column).toBe(0);
      expect(w.toString()).toBe('line1\n');
      expect(captured).toBe('line2\nline3\n');
    });
  });

  describe('mark and restore', () => {
    it('mark returns current chunk count', () => {
      const w = new OutputWriter();

      expect(w.mark()).toBe(0);
      w.add('chunk1');
      expect(w.mark()).toBe(1);
      w.add('chunk2');
      expect(w.mark()).toBe(2);
    });

    it('getSince returns content since mark', () => {
      const w = new OutputWriter();

      w.add('chunk1');
      const mark1 = w.mark();
      w.add('chunk2');
      w.add('chunk3');

      expect(w.getSince(mark1)).toBe('chunk2chunk3');
    });

    it('checks suffixes without materializing the buffer', () => {
      const w = new OutputWriter();

      w.add('one');
      w.add('\n');
      w.add('two');

      expect(w.endsWith('two')).toBe(true);
      expect(w.endsWith('\ntwo')).toBe(true);
      expect(w.endsWith('one\ntwo')).toBe(true);
      expect(w.endsWith('three')).toBe(false);
      expect(w.endsWith('')).toBe(true);
    });

    it('reads the last emitted character without materializing the buffer', () => {
      const w = new OutputWriter();

      expect(w.lastChar()).toBeUndefined();
      w.add('one');
      expect(w.lastChar()).toBe('e');
      w.add('\n');
      expect(w.lastChar()).toBe('\n');
      w.add('two');
      expect(w.lastChar()).toBe('o');
    });

    it('replaces a marked range while keeping earlier chunks', () => {
      const w = new OutputWriter();

      w.add('before ');
      const mark = w.mark();
      w.add('one\n  two');

      w.replaceSince(mark, text => text.replace(/\n\s*/u, ' '));

      expect(w.toString()).toBe('before one two');
      expect(w.line).toBe(0);
      expect(w.column).toBe(14);
    });

    it('queues a spacer before the next non-whitespace chunk', () => {
      const w = new OutputWriter();

      w.add('one');
      w.queueSpacer(' ');
      w.add('two');

      expect(w.toString()).toBe('one two');
    });

    it('drops a queued spacer when the next chunk already starts with whitespace', () => {
      const w = new OutputWriter();

      w.add('one');
      w.queueSpacer(' ');
      w.add(' two');

      expect(w.toString()).toBe('one two');
    });

    it('uses a queued spacer predicate to protect identifier boundaries', () => {
      const w = new OutputWriter();

      w.add('one');
      w.queueSpacer(' ', nextText => /^[A-Za-z0-9_-]/u.test(nextText));
      w.add('.two');
      w.queueSpacer(' ', nextText => /^[A-Za-z0-9_-]/u.test(nextText));
      w.add('three');

      expect(w.toString()).toBe('one.two three');
    });

    it('restore reverts to mark position', () => {
      const w = new OutputWriter();

      w.add('line1\n');
      const mark = w.mark();
      w.add('line2\nline3\n');

      expect(w.line).toBe(3);
      expect(w.column).toBe(0);

      w.restore(mark);
      expect(w.line).toBe(1);
      expect(w.column).toBe(0);
      expect(w.toString()).toBe('line1\n');
    });

    it('restore with invalid mark does nothing', () => {
      const w = new OutputWriter();

      w.add('content');
      const originalLine = w.line;
      const originalColumn = w.column;
      const originalString = w.toString();

      w.restore(-1);
      w.restore(999);

      expect(w.line).toBe(originalLine);
      expect(w.column).toBe(originalColumn);
      expect(w.toString()).toBe(originalString);
    });

    it('trimEndSince removes trailing whitespace after a mark', () => {
      const w = new OutputWriter();

      w.add('before ');
      const mark = w.mark();
      w.add('value');
      w.add(' \n\t');

      w.trimEndSince(mark);

      expect(w.toString()).toBe('before value');
      expect(w.line).toBe(0);
      expect(w.column).toBe(12);
    });

    it('trimEndSince does not trim before the mark', () => {
      const w = new OutputWriter();

      w.add('before ');
      const mark = w.mark();
      w.add(' \n\t');

      w.trimEndSince(mark);

      expect(w.toString()).toBe('before ');
      expect(w.line).toBe(0);
      expect(w.column).toBe(7);
    });

    it('trims all whitespace at the start of a marked range', () => {
      const w = new OutputWriter();

      w.add('before ');
      const mark = w.mark();
      w.add(' \n\tvalue');

      w.trimStartSince(mark);

      expect(w.toString()).toBe('before value');
      expect(w.line).toBe(0);
      expect(w.column).toBe(12);
    });

    it('trims horizontal whitespace at the start of a marked range', () => {
      const w = new OutputWriter();

      w.add('before ');
      const mark = w.mark();
      w.add(' \t\r\fvalue');

      w.trimHorizontalStartSince(mark);

      expect(w.toString()).toBe('before value');
    });

    it('trims horizontal whitespace at the end of a marked range', () => {
      const w = new OutputWriter();

      w.add('before ');
      const mark = w.mark();
      w.add('value \t\r\f');

      w.trimHorizontalEndSince(mark);

      expect(w.toString()).toBe('before value');
    });
  });

  describe('_positions array behavior', () => {
    it('tracks positions for each chunk', () => {
      const w = new OutputWriter();

      w.add('hello');
      w.add(' world');
      w.add('\nnew line');

      // Access private _positions array for testing
      const positions = positionsFor(w);
      expect(positions).toHaveLength(3);
      expect(positions[0]).toEqual({ line: 0, column: 5, segments: 0, length: 5 });
      expect(positions[1]).toEqual({ line: 0, column: 11, segments: 0, length: 11 });
      expect(positions[2]).toEqual({ line: 1, column: 8, segments: 0, length: 20 });
    });

    it('capture does not affect _positions array', () => {
      const w = new OutputWriter();

      w.add('before');
      const beforePositions = [...positionsFor(w)];

      const captured = w.capture(() => {
        w.add('captured\ncontent');
      });

      // _positions should be unchanged after capture
      expect(positionsFor(w)).toEqual(beforePositions);
      expect(captured).toBe('captured\ncontent');
    });

    it('restore properly resets _positions array', () => {
      const w = new OutputWriter();

      w.add('line1\n');
      const mark = w.mark();
      const positionsAtMark = [...positionsFor(w)];

      w.add('line2\nline3\n');
      expect(positionsFor(w)).toHaveLength(2); // Only 2 chunks: 'line2\n' and 'line3\n'

      w.restore(mark);
      expect(positionsFor(w)).toEqual(positionsAtMark);
    });

    it('_positions tracks segments count', () => {
      const w = new OutputWriter();

      // Add content with origin that has location info
      const mockOrigin = {
        location: [0, 1, 1, 0, 1, 5], // [start, startLine, startColumn, end, endLine, endColumn]
        treeContext: { file: { fullPath: 'test.css' } }
      };

      w.add('content', mockOrigin);
      const positions = positionsFor(w);
      expect(positions[0].segments).toBe(1);
    });
  });

  describe('sourcemap segments behavior', () => {
    it('creates segments for content with origin location', () => {
      const w = new OutputWriter();

      const mockOrigin = {
        location: [0, 1, 1, 0, 1, 5], // [start, startLine, startColumn, end, endLine, endColumn]
        treeContext: { file: { fullPath: 'test.css' } }
      };

      w.add('hello', mockOrigin);
      const segments = w.getSegments();

      expect(segments).toHaveLength(1);
      expect(segments[0]).toEqual({
        genLine: 0,
        genColumn: 0,
        source: 'test.css',
        origLine: 0, // 1-based to 0-based conversion
        origColumn: 0 // 1-based to 0-based conversion
      });
    });

    it('capture does not create segments in main buffer', () => {
      const w = new OutputWriter();

      const mockOrigin = {
        location: [0, 1, 1, 0, 1, 5],
        treeContext: { file: { fullPath: 'test.css' } }
      };

      w.add('before');
      const beforeSegments = [...w.getSegments()];

      const captured = w.capture(() => {
        w.add('captured', mockOrigin);
      });

      // Segments should be unchanged after capture
      expect(w.getSegments()).toEqual(beforeSegments);
      expect(captured).toBe('captured');
    });

    it('restore properly resets segments array', () => {
      const w = new OutputWriter();

      const mockOrigin = {
        location: [0, 1, 1, 0, 1, 5],
        treeContext: { file: { fullPath: 'test.css' } }
      };

      w.add('before');
      const mark = w.mark();
      const segmentsAtMark = [...w.getSegments()];

      w.add('after', mockOrigin);
      expect(w.getSegments()).toHaveLength(1);

      w.restore(mark);
      expect(w.getSegments()).toEqual(segmentsAtMark);
    });

    it('segments track correct generated positions', () => {
      const w = new OutputWriter();

      const mockOrigin = {
        location: [0, 1, 1, 0, 1, 5],
        treeContext: { file: { fullPath: 'test.css' } }
      };

      w.add('hello\nworld', mockOrigin);
      const segments = w.getSegments();

      expect(segments).toHaveLength(1);
      expect(segments[0]!.genLine).toBe(0);
      expect(segments[0]!.genColumn).toBe(0);
    });

    it('multiple segments track positions correctly', () => {
      const w = new OutputWriter();

      const origin1 = {
        location: [0, 1, 1, 0, 1, 5],
        treeContext: { file: { fullPath: 'test1.css' } }
      };

      const origin2 = {
        location: [0, 2, 1, 0, 2, 5],
        treeContext: { file: { fullPath: 'test2.css' } }
      };

      w.add('hello', origin1);
      w.add(' world', origin2);

      const segments = w.getSegments();
      expect(segments).toHaveLength(2);
      expect(segments[0]!.genLine).toBe(0);
      expect(segments[0]!.genColumn).toBe(0);
      expect(segments[1]!.genLine).toBe(0);
      expect(segments[1]!.genColumn).toBe(5);
    });

    it('segments handle newlines correctly', () => {
      const w = new OutputWriter();

      const mockOrigin = {
        location: [0, 1, 1, 0, 1, 5],
        treeContext: { file: { fullPath: 'test.css' } }
      };

      w.add('line1\nline2', mockOrigin);
      const segments = w.getSegments();

      expect(segments).toHaveLength(1);
      expect(segments[0]!.genLine).toBe(0);
      expect(segments[0]!.genColumn).toBe(0);
    });

    it('restore with segments maintains correct mapping', () => {
      const w = new OutputWriter();

      const mockOrigin = {
        location: [0, 1, 1, 0, 1, 5],
        treeContext: { file: { fullPath: 'test.css' } }
      };

      w.add('before');
      const mark = w.mark();

      w.add('content', mockOrigin);
      expect(w.getSegments()).toHaveLength(1);

      w.restore(mark);
      expect(w.getSegments()).toHaveLength(0);

      // Adding after restore should work correctly
      w.add('after', mockOrigin);
      expect(w.getSegments()).toHaveLength(1);
      expect(w.getSegments()[0]!.genLine).toBe(0);
      expect(w.getSegments()[0]!.genColumn).toBe(6); // after 'before'
    });
  });

  describe('declaration-like serialization pattern', () => {
    it('handles basic declaration pattern', () => {
      const w = new OutputWriter();

      w.add('property:');
      const valOut = w.capture(() => {
        w.add('value');
      });
      w.add(' ');
      w.add(valOut);
      w.add(';');

      expect(w.toString()).toBe('property: value;');
    });

    it('handles trailing spaces in captured content', () => {
      const w = new OutputWriter();

      w.add('property:');
      const valOut = w.capture(() => {
        w.add('value ');
      });
      w.add(' ');
      w.add(valOut);
      w.add(';');

      expect(w.toString()).toBe('property: value ;');
    });

    it('handles leading spaces in captured content', () => {
      const w = new OutputWriter();

      w.add('property:');
      const valOut = w.capture(() => {
        w.add(' value');
      });
      w.add(' ');
      w.add(valOut);
      w.add(';');

      expect(w.toString()).toBe('property:  value;');
    });

    it('handles both leading and trailing spaces', () => {
      const w = new OutputWriter();

      w.add('property:');
      const valOut = w.capture(() => {
        w.add(' value ');
      });
      w.add(' ');
      w.add(valOut);
      w.add(';');

      expect(w.toString()).toBe('property:  value ;');
    });

    it('demonstrates the actual CSS serialization issue', () => {
      const w = new OutputWriter();

      w.add('color:');
      const valOut = w.capture(() => {
        w.add('white '); // Note the trailing space
      });
      w.add(' ');
      w.add(valOut.replace(/^\s+/, '')); // Remove leading whitespace only
      w.add('!important');

      // This produces "color: white !important" instead of "color: white!important"
      expect(w.toString()).toBe('color: white !important');
    });

    it('demonstrates the correct behavior with trailing space removal', () => {
      const w = new OutputWriter();

      w.add('color:');
      const valOut = w.capture(() => {
        w.add('white '); // Note the trailing space
      });
      w.add(' ');
      w.add(valOut.replace(/^\s+/, '').replace(/\s+$/, '')); // Remove both leading and trailing whitespace
      w.add('!important');

      // This produces the correct "color: white!important"
      expect(w.toString()).toBe('color: white!important');
    });
  });

  describe('toString and chunks', () => {
    it('toString joins all chunks', () => {
      const w = new OutputWriter();

      w.add('chunk1');
      w.add('chunk2');
      w.add('chunk3');

      expect(w.toString()).toBe('chunk1chunk2chunk3');
    });

    it('toString returns empty string for empty writer', () => {
      const w = new OutputWriter();
      expect(w.toString()).toBe('');
    });
  });

  describe('edge cases', () => {
    it('handles null/undefined text gracefully', () => {
      const w = new OutputWriter();

      // @ts-ignore - testing edge case
      w.add(null);
      // @ts-ignore - testing edge case
      w.add(undefined);
      w.add('');

      expect(w.toString()).toBe('');
      expect(w.line).toBe(0);
      expect(w.column).toBe(0);
    });

    it('handles very long strings', () => {
      const w = new OutputWriter();
      const longString = 'a'.repeat(1000);

      w.add(longString);
      expect(w.line).toBe(0);
      expect(w.column).toBe(1000);
      expect(w.toString()).toBe(longString);
    });

    it('handles strings with only newlines', () => {
      const w = new OutputWriter();

      w.add('\n\n\n');
      expect(w.line).toBe(3);
      expect(w.column).toBe(0);
      expect(w.toString()).toBe('\n\n\n');
    });
  });
});
