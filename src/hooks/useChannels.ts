import { useEffect, useState } from "react";
import {
  getChannels,
  isCacheReady,
  loadChannels,
  subscribeChannels,
  type Channel,
} from "@/lib/channelStore";
// re-export Channel so callers can import from here
export type { Channel };

export function useChannels() {
  const [channels, setChannels] = useState<Channel[]>(getChannels);
  const [loading, setLoading] = useState(!isCacheReady());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Subscribe to future store updates (e.g. background refresh)
    const unsub = subscribeChannels(setChannels);

    // Kick off load if not already cached / if stale
    if (!isCacheReady()) {
      loadChannels()
        .then(setChannels)
        .catch((e) => setError(String(e)))
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
      // Still trigger background refresh if stale (TTL expired)
      loadChannels().then(setChannels).catch(() => {});
    }

    return unsub;
  }, []);

  return { channels, loading, error };
}
