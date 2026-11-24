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
  /** Attributes set with `setAttribute` (the panels mark whether a section is open this way). */
  readonly attributes: Record<string, string> = {};
  clientWidth = 800;
  clientHeight = 400;
  /** Class names added with `classList` (the scene marks a drag this way). */
  readonly classes = new Set<string>();
  readonly classList = {
    add: (name: string): void => void this.classes.add(name),
    remove: (name: string): void => void this.classes.delete(name),
  };
  parent: FakeNode | undefined;
  private readonly listeners = new Map<string, ((event: never) => void)[]>();

  constructor(readonly tag: string) {}

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  append(...nodes: Child[]): void {
    for (const node of nodes) if (typeof node !== 'string') node.parent = this;
    this.children.push(...nodes);
  }

  replaceChildren(...nodes: Child[]): void {
    for (const node of nodes) if (typeof node !== 'string') node.parent = this;
    this.children = [...nodes];
  }

  remove(): void {
    this.parent?.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = undefined;
  }

  set textContent(value: string) {
    this.children = value === '' ? [] : [value];
  }

  get textContent(): string {
    return this.children
      .map((child) => (typeof child === 'string' ? child : child.textContent))
      .join('');
  }

  addEventListener(type: string, listener: (event: never) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  removeEventListener(type: string, listener: (event: never) => void): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((existing) => existing !== listener),
    );
  }

  /** Runs the listeners of an event, as the browser does when it happens. */
  fire(type: string, event: object = {}): void {
    for (const listener of (this.listeners.get(type) ?? []) as ((event: object) => void)[]) {
      listener(event);
    }
  }

  /** What a click on the element does. A disabled button does nothing, as in a browser. */
  click(): void {
    if (this.disabled) return;
    this.fire('click');
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
