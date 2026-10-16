export interface BusEvent {
  type: string;
  payload?: unknown;
}

type Client = (data: string) => void;

const clients = new Set<Client>();

export function subscribe(client: Client): () => void {
  clients.add(client);
  return () => clients.delete(client);
}

export function publish(event: BusEvent): void {
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
