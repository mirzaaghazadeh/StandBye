import { EventEmitter } from "node:events";
import type { PushEvent } from "@crew/shared";

type Handler<E extends PushEvent["event"]> = (data: Extract<PushEvent, { event: E }>["data"]) => void;

/** Typed event bus. Everything the UI sees and everything the scheduler reacts to goes through here. */
export class Bus {
  private readonly em = new EventEmitter();

  constructor() {
    this.em.setMaxListeners(100);
  }

  emit<E extends PushEvent["event"]>(event: E, data: Extract<PushEvent, { event: E }>["data"]): void {
    this.em.emit(event, data);
    this.em.emit("*", { event, data } as PushEvent);
  }

  on<E extends PushEvent["event"]>(event: E, handler: Handler<E>): () => void {
    const h = handler as (...args: unknown[]) => void;
    this.em.on(event, h);
    return () => this.em.off(event, h);
  }

  onAny(handler: (e: PushEvent) => void): () => void {
    this.em.on("*", handler);
    return () => this.em.off("*", handler);
  }
}
