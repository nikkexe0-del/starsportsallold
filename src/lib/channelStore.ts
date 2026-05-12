/**
 * Global channel store — survives route changes, has a 5-minute TTL
 * so the playlist re-fetches when it changes upstream.
 */
import { fetchAllChannels, type Channel } from "./playlist";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface Store {
  channels: Channel[];
  fetchedAt: number | null;
  promise: Promise<Channel[]> | null;
}

const store: Store = {
  channels: [],
  fetchedAt: null,
  promise: null,
};

function isStale(): boolean {
  if (!store.fetchedAt) return true;
  return Date.now() - store.fetchedAt > CACHE_TTL_MS;
}

/** Returns cached channels instantly (may be empty on first call).
 *  Always kicks off a background re-fetch when cache is stale.
 */
export function getChannels(): Channel[] {
  return store.channels;
}

export function isCacheReady(): boolean {
  return store.channels.length > 0;
}

/** Ensures channels are loaded. Returns the channel list.
 *  De-duplicates concurrent calls — only one fetch in flight at a time.
 */
export async function ensureChannels(): Promise<Channel[]> {
  if (!isStale() && store.channels.length > 0) return store.channels;
  if (store.promise) return store.promise;

  store.promise = fetchAllChannels()
    .then((channels) => {
      store.channels = channels;
      store.fetchedAt = Date.now();
      store.promise = null;
      return channels;
    })
    .catch((err) => {
      store.promise = null;
      throw err;
    });

  return store.promise;
}

/** Subscribe to store updates (for React components that need reactivity) */
type Listener = (channels: Channel[]) => void;
const listeners = new Set<Listener>();

export function subscribeChannels(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notifyListeners(): void {
  listeners.forEach((fn) => fn(store.channels));
}

/** Enhanced fetch that notifies subscribers after loading */
export async function loadChannels(): Promise<Channel[]> {
  const channels = await ensureChannels();
  notifyListeners();
  return channels;
}
