import { StreamLanguage } from '@codemirror/language';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { EditorState } from '@codemirror/state';
import { basicSetup, EditorView } from 'codemirror';

/** What the editor window needs of the code editor. */
export interface LuaEditor {
  getText(): string;
  setText(text: string): void;
  focus(): void;
  destroy(): void;
}

/**
 * A light sheet for the code in the dark page: basicSetup's highlighting is made for a light background, and a second theme
 * package for a dark one would be one more dependency.
 */
const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '12px', backgroundColor: '#fbfbf8', color: '#1d232b' },
  '.cm-scroller': { fontFamily: 'ui-monospace, Menlo, monospace', lineHeight: '1.5' },
  '.cm-gutters': { backgroundColor: '#f0f0ea', color: '#8a8f96', border: 'none' },
  '&.cm-focused': { outline: 'none' },
});

/** CodeMirror 6 with Lua (a legacy stream mode), the usual editing keys, and long lines wrapped. */
export function createLuaEditor(parent: HTMLElement, doc: string): LuaEditor {
  const view = new EditorView({
    parent,
    state: EditorState.create({ doc, extensions: [basicSetup, StreamLanguage.define(lua), theme, EditorView.lineWrapping] }),
  });
  return {
    getText: () => view.state.doc.toString(),
    setText: (text) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }),
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}
