import { vi } from 'vitest';

// Just enough of a DOM to run the panel code in a test (decision 028: no jsdom). Elements keep their
// children, text, listeners and a few properties; `click()` runs the click listeners of a button.

type Child = FakeNode | string;

export class FakeNode {
  children: Child[] = [];
  className = '';
  type = '';
  disabled = false;
  style: Record<string, string> = {};
  private readonly listeners = new Map<string, (() => void)[]>();

  constructor(readonly tag: string) {}

  append(...nodes: Child[]): void {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes: Child[]): void {
    this.children = [...nodes];
  }

  set textContent(value: string) {
    this.children = value === '' ? [] : [value];
  }

  get textContent(): string {
    return this.children
      .map((child) => (typeof child === 'string' ? child : child.textContent))
      .join('');
  }

  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  /** What a click on the element does. A disabled button does nothing, as in a browser. */
  click(): void {
    if (this.disabled) return;
    for (const listener of this.listeners.get('click') ?? []) listener();
  }

  /** Every element below this one (and itself) that fits. */
  findAll(fits: (node: FakeNode) => boolean): FakeNode[] {
    const found: FakeNode[] = fits(this) ? [this] : [];
    for (const child of this.children) {
      if (typeof child !== 'string') found.push(...child.findAll(fits));
    }
    return found;
  }

  /** The button with exactly this text. */
  button(text: string): FakeNode {
    const [found] = this.findAll((node) => node.tag === 'button' && node.textContent === text);
    if (!found) throw new Error(`no button "${text}"`);
    return found;
  }
}

export function installFakeDom(): void {
  vi.stubGlobal('document', { createElement: (tag: string) => new FakeNode(tag) });
}

export const asElement = (node: FakeNode): HTMLElement => node as unknown as HTMLElement;
