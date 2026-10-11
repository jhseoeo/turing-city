import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown, tableCells } from '../src/markdown.ts';

describe('markdown: inline', () => {
  it('reads `code` and **bold** in text, and leaves the rest as text', () => {
    expect(parseInline('call `io.process()` **once** a tick')).toEqual([
      { kind: 'text', text: 'call ' },
      { kind: 'code', text: 'io.process()' },
      { kind: 'text', text: ' ' },
      { kind: 'bold', text: 'once' },
      { kind: 'text', text: ' a tick' },
    ]);
  });

  it('keeps everything inside a code span as it is, ** included', () => {
    expect(parseInline('`a ** b`')).toEqual([{ kind: 'code', text: 'a ** b' }]);
  });

  it('reads an unmatched marker as plain text', () => {
    expect(parseInline('a ` b')).toEqual([{ kind: 'text', text: 'a ` b' }]);
    expect(parseInline('5 ** 2')).toEqual([{ kind: 'text', text: '5 ** 2' }]);
  });
});

describe('markdown: blocks', () => {
  it('reads the three heading levels, and joins the lines of a paragraph', () => {
    expect(parseMarkdown('# 공통 규칙\n## 틱\n### mem\n첫 줄\n둘째 줄\n\n다음 문단')).toEqual([
      { kind: 'heading', level: 1, inlines: [{ kind: 'text', text: '공통 규칙' }] },
      { kind: 'heading', level: 2, inlines: [{ kind: 'text', text: '틱' }] },
      { kind: 'heading', level: 3, inlines: [{ kind: 'text', text: 'mem' }] },
      { kind: 'paragraph', inlines: [{ kind: 'text', text: '첫 줄 둘째 줄' }] },
      { kind: 'paragraph', inlines: [{ kind: 'text', text: '다음 문단' }] },
    ]);
  });

  it('reads a list of "- " items', () => {
    expect(parseMarkdown('- `day`\n- clock')).toEqual([
      {
        kind: 'list',
        items: [[{ kind: 'code', text: 'day' }], [{ kind: 'text', text: 'clock' }]],
      },
    ]);
  });

  it('reads a pipe table with a header row, and an escaped pipe inside a cell', () => {
    const blocks = parseMarkdown('| 필드 | 뜻 |\n|---|---|\n| `temp` | 온도 |\n| a \\| b | c |');
    expect(blocks).toEqual([
      {
        kind: 'table',
        header: [[{ kind: 'text', text: '필드' }], [{ kind: 'text', text: '뜻' }]],
        rows: [
          [[{ kind: 'code', text: 'temp' }], [{ kind: 'text', text: '온도' }]],
          [[{ kind: 'text', text: 'a | b' }], [{ kind: 'text', text: 'c' }]],
        ],
      },
    ]);
    expect(tableCells('| a | b |')).toEqual(['a', 'b']);
  });

  it('reads a fenced code block as it is, markup and blank lines included', () => {
    expect(parseMarkdown('```lua\nfunction tick(io, mem)\n\n  -- **not bold**\nend\n```\nafter')).toEqual([
      { kind: 'code', lang: 'lua', text: 'function tick(io, mem)\n\n  -- **not bold**\nend' },
      { kind: 'paragraph', inlines: [{ kind: 'text', text: 'after' }] },
    ]);
  });

  it('reads a line that starts with a pipe but has no rule under it as a paragraph', () => {
    expect(parseMarkdown('| not a table')).toEqual([{ kind: 'paragraph', inlines: [{ kind: 'text', text: '| not a table' }] }]);
  });

  it('ends an unclosed code block at the end of the text', () => {
    expect(parseMarkdown('```\nx = 1')).toEqual([{ kind: 'code', lang: '', text: 'x = 1' }]);
  });
});
