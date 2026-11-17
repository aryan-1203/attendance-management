import "@testing-library/jest-dom/vitest";

// jsdom lacks layout: give elements a size so virtualized grids render rows.
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get() { return 800; } });
Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get() { return 1400; } });
HTMLElement.prototype.getBoundingClientRect = function () {
  return { x: 0, y: 0, top: 0, left: 0, bottom: 800, right: 1400, width: 1400, height: 800, toJSON() {} } as DOMRect;
};
HTMLElement.prototype.scrollTo = function () {};
HTMLElement.prototype.hasPointerCapture = () => false;
HTMLElement.prototype.scrollIntoView = function () {};
window.matchMedia = window.matchMedia || ((q: string) => ({
  matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {},
  removeEventListener() {}, dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;
