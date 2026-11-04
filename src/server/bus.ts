export interface BusEvent {
  type: string;
  payload?: unknown;
}

type Client = (data: string) => void;
type Handler = (event: BusEvent) => void;

const clients = new Set<Client>();
const handlers = new Set<Handler>();

export function subscribe(client: Client): () => void {
  clients.add(client);
  return () => clients.delete(client);
}

/** In-process listeners (scheduler, etc.). */
export function onBus(handler: Handler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

export function publish(event: BusEvent): void {
  for (const handler of handlers) {
    try {
      handler(event);
    } catch {
      // ignore listener errors
    }
  }
  const data = JSON.stringify({ ...event, ts: new Date().toISOString() });
  for (const client of clients) {
    try {
      client(data);
    } catch {
      clients.delete(client);
    }
  }
}

export function subscriberCount(): number {
  return clients.size;
}
