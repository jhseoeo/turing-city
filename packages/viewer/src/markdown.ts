import { el } from './dom.ts';

/** A run of text inside a block: plain, `code`, or **bold**. */
export interface Inline {
  readonly kind: 'text' | 'code' | 'bold';
  readonly text: string;
}

/** The blocks of the markdown the manual uses (contract §14), and nothing else. */
export type Block =
  | { readonly kind: 'heading'; readonly level: 1 | 2 | 3; readonly inlines: readonly Inline[] }
  | { readonly kind: 'paragraph'; readonly inlines: readonly Inline[] }
  | { readonly kind: 'list'; readonly items: ReadonlyArray<readonly Inline[]> }
  | {
      readonly kind: 'table';
      readonly header: ReadonlyArray<readonly Inline[]>;
      readonly rows: ReadonlyArray<ReadonlyArray<readonly Inline[]>>;
    }
  | { readonly kind: 'code'; readonly lang: string; readonly text: string };

const HEADING = /^(#{1,3}) (.*)$/;
const ITEM = /^- (.*)$/;
const FENCE = /^```(\w*)\s*$/;
const FENCE_END = /^```\s*$/;
const RULE = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/**
 * `code` spans and **bold** in a line of text. Whichever opens first and also closes wins; nothing inside a code span is markup, and
 * an unmatched marker is plain text.
 */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const pushText = (t: string): void => {
    if (t === '') return;
    const last = out[out.length - 1];
    if (last?.kind === 'text') out[out.length - 1] = { kind: 'text', text: last.text + t };
    else out.push({ kind: 'text', text: t });
  };
  let rest = text;
  while (rest !== '') {
    const tick = rest.indexOf('`');
    const tickEnd = tick >= 0 ? rest.indexOf('`', tick + 1) : -1;
    const bold = rest.indexOf('**');
    const boldEnd = bold >= 0 ? rest.indexOf('**', bold + 2) : -1;
    const code = tickEnd > tick ? tick : -1;
    const strong = boldEnd > bold && bold >= 0 ? bold : -1;
    if (code >= 0 && (strong < 0 || code < strong)) {
      pushText(rest.slice(0, code));
      out.push({ kind: 'code', text: rest.slice(code + 1, tickEnd) });
      rest = rest.slice(tickEnd + 1);
    } else if (strong >= 0) {
      pushText(rest.slice(0, strong));
      out.push({ kind: 'bold', text: rest.slice(strong + 2, boldEnd) });
      rest = rest.slice(boldEnd + 2);
    } else {
      pushText(rest);
      rest = '';
    }
  }
  return out;
}

/** A table row's cells: split on the pipes that are not escaped (\|), with the outer ones dropped and each cell trimmed. */
export function tableCells(line: string): string[] {
  const body = line
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '');
  const cells: string[] = [];
  let cell = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\' && body[i + 1] === '|') {
      cell += '|';
      i += 1;
    } else if (c === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += c;
    }
  }
  cells.push(cell.trim());
  return cells;
}

const isTableStart = (lines: readonly string[], i: number): boolean =>
  (lines[i] ?? '').trimStart().startsWith('|') && i + 1 < lines.length && RULE.test(lines[i + 1] ?? '');

const startsBlock = (lines: readonly string[], i: number): boolean => {
  const line = lines[i] ?? '';
  return FENCE.test(line) || HEADING.test(line) || ITEM.test(line) || isTableStart(lines, i);
};

export function parseMarkdown(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE_END.test(lines[i] ?? '')) body.push(lines[i++] ?? '');
      i += 1; // the closing fence, or past the end
      blocks.push({ kind: 'code', lang: fence[1] ?? '', text: body.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: (heading[1] ?? '#').length as 1 | 2 | 3, inlines: parseInline(heading[2] ?? '') });
      i += 1;
      continue;
    }
    if (ITEM.test(line)) {
      const items: Inline[][] = [];
      while (i < lines.length && ITEM.test(lines[i] ?? '')) items.push(parseInline(ITEM.exec(lines[i++] ?? '')?.[1] ?? ''));
      blocks.push({ kind: 'list', items });
      continue;
    }
    if (isTableStart(lines, i)) {
      const header = tableCells(line).map(parseInline);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && (lines[i] ?? '').trimStart().startsWith('|')) rows.push(tableCells(lines[i++] ?? '').map(parseInline));
      blocks.push({ kind: 'table', header, rows });
      continue;
    }
    const paragraph: string[] = [];
    while (i < lines.length && (lines[i] ?? '').trim() !== '' && (paragraph.length === 0 || !startsBlock(lines, i))) {
      paragraph.push((lines[i++] ?? '').trim());
    }
    blocks.push({ kind: 'paragraph', inlines: parseInline(paragraph.join(' ')) });
  }
  return blocks;
}

function inlineNodes(inlines: readonly Inline[]): Array<Node | string> {
  return inlines.map((x) => (x.kind === 'text' ? x.text : x.kind === 'code' ? el('code', {}, [x.text]) : el('strong', {}, [x.text])));
}

/** The markdown as page elements, built with el(): every piece of text goes in as text, never as markup. */
export function renderMarkdown(md: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const b of parseMarkdown(md)) {
    switch (b.kind) {
      case 'heading':
        fragment.append(el(b.level === 1 ? 'h1' : b.level === 2 ? 'h2' : 'h3', {}, inlineNodes(b.inlines)));
        break;
      case 'paragraph':
        fragment.append(el('p', {}, inlineNodes(b.inlines)));
        break;
      case 'list':
        fragment.append(
          el(
            'ul',
            {},
            b.items.map((item) => el('li', {}, inlineNodes(item))),
          ),
        );
        break;
      case 'table':
        fragment.append(
          el('table', {}, [
            el('thead', {}, [
              el(
                'tr',
                {},
                b.header.map((cell) => el('th', {}, inlineNodes(cell))),
              ),
            ]),
            el(
              'tbody',
              {},
              b.rows.map((row) =>
                el(
                  'tr',
                  {},
                  row.map((cell) => el('td', {}, inlineNodes(cell))),
                ),
              ),
            ),
          ]),
        );
        break;
      case 'code':
        fragment.append(el('pre', {}, [el('code', b.lang === '' ? {} : { class: `lang-${b.lang}` }, [b.text])]));
        break;
    }
  }
  return fragment;
}
