import { log } from '../logger';

interface VirtualScrollOptions {
  container: HTMLElement;
  items: any[];
  renderItem: (item: any, index: number) => HTMLElement;
  itemHeight?: number; // Estimated height per item
  bufferSize?: number; // Number of items to render outside viewport
  onScroll?: (firstVisibleIndex: number, lastVisibleIndex: number) => void;
}

export class VirtualScroll {
  private container: HTMLElement;
  private items: any[];
  private renderItem: (item: any, index: number) => HTMLElement;
  private itemHeight: number;
  private bufferSize: number;
  private onScroll: ((firstVisibleIndex: number, lastVisibleIndex: number) => void) | undefined;
  
  private scrollContainer: HTMLElement;
  private viewport: HTMLElement;
  private spacer: HTMLElement;
  
  private renderedItems: Map<number, HTMLElement> = new Map();
  private observer: IntersectionObserver | null = null;
  
  private firstVisibleIndex: number = 0;
  private lastVisibleIndex: number = 0;

  constructor(options: VirtualScrollOptions) {
    this.container = options.container;
    this.items = options.items;
    this.renderItem = options.renderItem;
    this.itemHeight = options.itemHeight || 60; // Default estimated height
    this.bufferSize = options.bufferSize || 5; // Default buffer
    this.onScroll = options.onScroll;

    this.scrollContainer = document.createElement('div');
    this.viewport = document.createElement('div');
    this.spacer = document.createElement('div');

    this.init();
  }

  private init(): void {
    this.scrollContainer.style.cssText = `
      height: 100%;
      overflow-y: auto;
      overflow-x: hidden;
      position: relative;
    `;

    this.spacer.style.cssText = `
      height: ${this.items.length * this.itemHeight}px;
      position: relative;
    `;

    this.viewport.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
    `;

    this.spacer.appendChild(this.viewport);
    this.scrollContainer.appendChild(this.spacer);
    this.container.appendChild(this.scrollContainer);

    this.observer = new IntersectionObserver(
      (entries) => this.handleIntersection(entries),
      {
        root: this.scrollContainer,
        rootMargin: `${this.itemHeight * this.bufferSize}px 0px`,
        threshold: [0, 0.1, 0.9, 1],
      }
    );

    this.scrollContainer.addEventListener('scroll', () => this.handleScroll());
    this.handleScroll();
  }

  private handleScroll(): void {
    const scrollTop = this.scrollContainer.scrollTop;
    const viewportHeight = this.scrollContainer.clientHeight;

    const startIndex = Math.max(0, Math.floor(scrollTop / this.itemHeight) - this.bufferSize);
    const endIndex = Math.min(
      this.items.length - 1,
      Math.ceil((scrollTop + viewportHeight) / this.itemHeight) + this.bufferSize
    );

    this.firstVisibleIndex = startIndex;
    this.lastVisibleIndex = endIndex;

    this.renderedItems.forEach((element, index) => {
      if (index < startIndex || index > endIndex) {
        if (this.observer) {
          this.observer.unobserve(element);
        }
        element.remove();
        this.renderedItems.delete(index);
      }
    });

    for (let i = startIndex; i <= endIndex; i++) {
      if (!this.renderedItems.has(i)) {
        const element = this.renderItem(this.items[i]!, i);
        element.style.cssText = `
          position: absolute;
          top: ${i * this.itemHeight}px;
          left: 0;
          right: 0;
        `;
        element.dataset.index = String(i);
        
        this.viewport.appendChild(element);
        this.renderedItems.set(i, element);

        if (this.observer) {
          this.observer.observe(element);
        }
      }
    }

    if (this.onScroll) {
      this.onScroll(this.firstVisibleIndex, this.lastVisibleIndex);
    }
  }

  private handleIntersection(entries: IntersectionObserverEntry[]): void {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
      } else {
        entry.target.classList.remove('visible');
      }
    });
  }

  public updateItems(newItems: any[]): void {
    this.items = newItems;
    this.spacer.style.height = `${this.items.length * this.itemHeight}px`;

    this.renderedItems.forEach((element) => {
      if (this.observer) {
        this.observer.unobserve(element);
      }
      element.remove();
    });
    this.renderedItems.clear();

    this.handleScroll();
  }

  public scrollToIndex(index: number): void {
    const targetScroll = index * this.itemHeight;
    this.scrollContainer.scrollTop = targetScroll;
  }

  public destroy(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.renderedItems.clear();
    this.scrollContainer.remove();
  }

  public getVisibleRange(): { start: number; end: number } {
    return {
      start: this.firstVisibleIndex,
      end: this.lastVisibleIndex,
    };
  }
}

export function createVirtualScrollList(
  container: HTMLElement,
  items: any[],
  renderItem: (item: any, index: number) => HTMLElement,
  options?: Partial<VirtualScrollOptions>
): VirtualScroll {
  return new VirtualScroll({
    container,
    items,
    renderItem,
    ...options,
  });
}
