type Attrs = Record<string, string | boolean | ((event: Event) => void)>;

/** Builds an element. Text goes in as textContent, so game text never becomes markup. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === 'function') node.addEventListener(key.replace(/^on/, ''), value);
    else if (typeof value === 'boolean') node.toggleAttribute(key, value);
    else node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

export function clear(node: Element): void {
  node.replaceChildren();
}
