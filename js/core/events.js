/** Tiny synchronous event emitter used by the engine and sessions. */
export class Emitter {
  constructor() {
    this._listeners = new Map();
  }

  on(event, handler) {
    if (typeof handler !== "function") return () => {};
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  once(event, handler) {
    const off = this.on(event, (...args) => {
      off();
      handler(...args);
    });
    return off;
  }

  off(event, handler) {
    const set = this._listeners.get(event);
    if (!set) return;
    set.delete(handler);
    if (!set.size) this._listeners.delete(event);
  }

  emit(event, ...args) {
    const set = this._listeners.get(event);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        handler(...args);
      } catch (error) {
        console.error(`[emitter] ${event}`, error);
      }
    }
  }

  clear() {
    this._listeners.clear();
  }
}
