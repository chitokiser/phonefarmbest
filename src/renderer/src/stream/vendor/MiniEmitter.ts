type Listener<T> = (payload: T) => void

export class MiniEmitter<Events> {
  private readonly listeners = new Map<keyof Events, Set<Listener<unknown>>>()

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    const set = this.listeners.get(event) ?? new Set()
    set.add(listener as Listener<unknown>)
    this.listeners.set(event, set)
  }

  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    this.listeners.get(event)?.delete(listener as Listener<unknown>)
  }

  protected emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    this.listeners.get(event)?.forEach((listener) => listener(payload))
  }
}
