/**
 * `pnpm web:page`: the web demo's built page in the shape an Artifact publishes, written to `packages/web/dist/page.html`. An
 * Artifact wraps the page in its own document, so the page carries no <html>, <head>, or <body> of its own: the title, the CSS
 * inlined, the module script that loads the game from `assets/`, and the body's elements. The files in `dist/assets/` are
 * published beside it at the same paths.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const html = readFileSync(`${dist}index.html`, 'utf8');
const pick = (pattern: RegExp, what: string): RegExpMatchArray => {
  const match = html.match(pattern);
  if (!match) throw new Error(`the built page has no ${what}`);
  return match;
};
const title = pick(/<title>[^<]*<\/title>/, 'title')[0];
const script = pick(/<script type="module"[^>]*><\/script>/, 'module script')[0];
const cssPath = pick(/<link rel="stylesheet"[^>]*href="\.\/([^"]+)"[^>]*>/, 'stylesheet')[1]!;
const body = pick(/<body>([\s\S]*)<\/body>/, 'body')[1]!.trim();
const css = readFileSync(`${dist}${cssPath}`, 'utf8');
// The game is laid out for a desktop window; on a narrow screen it scrolls inside its own box, never the page.
const narrow = 'html,body{overflow-x:hidden}#start,#game{max-width:100vw;overflow-x:auto}';
writeFileSync(`${dist}page.html`, `${title}\n<style>${css}${narrow}</style>\n${script}\n${body}\n`);
console.log(`wrote ${dist}page.html (assets: ${cssPath.replace(/\/[^/]+$/, '')}/)`);
