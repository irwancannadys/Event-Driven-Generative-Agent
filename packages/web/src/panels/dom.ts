/** A small way to make DOM elements without a framework: `el('div', 'card', 'text', child, ...)`. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  ...content: (string | Node)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.append(...content);
  return node;
}

/** Calls `draw` only when `view` is not the same as the last time for this `key`, to spare the DOM. */
export function changeDetector() {
  const last = new Map<string, string>();
  return (key: string, view: unknown, draw: () => void): void => {
    const json = JSON.stringify(view);
    if (last.get(key) === json) return;
    last.set(key, json);
    draw();
  };
}
