/**
 * The web demo's built page in the shape an Artifact publishes, written to `packages/web/dist/page.html` (`pnpm web:build` runs
 * it). An Artifact wraps the page in its own document, so the page carries no <html>, <head>, or <body> of its own. Its frame runs
 * scripts only inline or from a few CDNs, and stylesheets only inline: the page carries the title, the CSS and the game's script
 * inline, and the body's elements. The worker and Lua's WebAssembly, which the frame does load from the page's own files, are
 * published beside it under the names this prints.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const html = readFileSync(`${dist}index.html`, 'utf8');
const pick = (pattern: RegExp, what: string): RegExpMatchArray => {
  const match = html.match(pattern);
  if (!match) throw new Error(`the built page has no ${what}`);
  return match;
};
const title = pick(/<title>[^<]*<\/title>/, 'title')[0];
const scriptPath = pick(/<script type="module"[^>]*src="\.\/([^"]+)"[^>]*><\/script>/, 'module script')[1]!;
const cssPath = pick(/<link rel="stylesheet"[^>]*href="\.\/([^"]+)"[^>]*>/, 'stylesheet')[1]!;
const body = pick(/<body>([\s\S]*)<\/body>/, 'body')[1]!.trim();
const css = readFileSync(`${dist}${cssPath}`, 'utf8');
// Inline, a closing tag in the code would end the script element early.
const code = readFileSync(`${dist}${scriptPath}`, 'utf8').replaceAll('</script', '<\\/script');
const script = `<script type="module">${code}</script>`;
// The game is laid out for a desktop window; on a narrow screen it scrolls inside its own box, never the page.
const narrow = 'html,body{overflow-x:hidden}#start,#game{max-width:100vw;overflow-x:auto}';
writeFileSync(`${dist}page.html`, `${title}\n<style>${css}${narrow}</style>\n${script}\n${body}\n`);
const beside = readdirSync(dist).filter((f) => f.endsWith('.wasm') || (f.endsWith('.js') && f !== scriptPath));
console.log(`wrote ${dist}page.html; publish beside it: ${beside.join(', ')}`);
