/**
 * Text labels above things in the room. They are DOM elements laid over the picture and moved to where
 * the 3D point lands on the screen, so the text stays sharp and can be styled with CSS.
 */
export class LabelLayer {
  private readonly labels = new Map<string, HTMLElement>();

  constructor(
    private readonly container: HTMLElement,
    private readonly className: string,
  ) {}

  /** Makes the label for `id` if it is not there yet, and gives it its text. */
  set(id: string, text: string, extraClass = ''): void {
    let label = this.labels.get(id);
    if (!label) {
      label = document.createElement('div');
      this.labels.set(id, label);
      this.container.append(label);
    }
    const className = `${this.className} ${extraClass}`.trim();
    if (label.className !== className) label.className = className;
    if (label.textContent !== text) label.textContent = text;
  }

  place(id: string, x: number, y: number, visible: boolean): void {
    const label = this.labels.get(id);
    if (!label) return;
    label.style.display = visible ? '' : 'none';
    label.style.left = `${x}px`;
    label.style.top = `${y}px`;
  }

  clear(): void {
    for (const label of this.labels.values()) label.remove();
    this.labels.clear();
  }
}
