import { randomUUID } from 'node:crypto';

export type LiveTopic = 'sessions' | 'audit';
export type LiveEvent = { type: 'changed'; id: string; topics: LiveTopic[] };
type Listener = (event: LiveEvent) => void;
type Subscription = { listener: Listener; sessionId?: string; close?: () => void };

// One API process currently serves this app. Only invalidation hints are kept here.
export class LiveBroker {
  private listeners = new Map<string, Set<Subscription>>();
  private total = 0;
  hasCapacity(owner: string) {
    return this.total < 100 && (this.listeners.get(owner)?.size || 0) < 10;
  }
  subscribe(owner: string, listener: Listener, session?: { sessionId: string; close: () => void }) {
    if (!this.hasCapacity(owner)) return null;
    const group = this.listeners.get(owner) || new Set<Subscription>();
    const subscription = { listener, ...session };
    group.add(subscription);
    this.listeners.set(owner, group);
    this.total++;
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      group.delete(subscription);
      this.total--;
      if (!group.size) this.listeners.delete(owner);
    };
  }
  publish(owner: string, topics: LiveTopic[]) {
    if (!topics.length) return;
    const event: LiveEvent = { type: 'changed', id: randomUUID(), topics: [...new Set(topics)] };
    for (const subscription of this.listeners.get(owner) || []) {
      try {
        subscription.listener(event);
      } catch {
        /* A subscriber cannot fail an already committed write. */
      }
    }
  }
  disconnect(owner: string, sessionId?: string) {
    for (const subscription of this.listeners.get(owner) || []) {
      if (!sessionId || subscription.sessionId === sessionId) subscription.close?.();
    }
  }
}

export function topicsForAction(action: string): LiveTopic[] {
  return action.startsWith('auth.') || action.startsWith('admin.')
    ? ['sessions', 'audit']
    : ['audit'];
}

declare module 'fastify' {
  interface FastifyInstance {
    realtime?: LiveBroker;
  }
}
