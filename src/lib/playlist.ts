export interface Channel {
  id: string;
  name: string;
  group: string;
  logo?: string;
  url: string;
}

// Standard M3U playlists (HLS / TS streams only — no MPD/DRM sources)
export const PLAYLIST_URLS = [
  "https://m3u-tvb.pages.dev/ixp.m3u",
  "https://raw.githubusercontent.com/Tarangg5/sports/refs/heads/main/sonur.m3u",
  // Sagar878796/Ip — standard HLS m3u8 streams
  "https://raw.githubusercontent.com/Sagar878796/Ip/refs/heads/main/playlist.m3u",
  // LayaSync — Indian channels, mix of .ts streams
  "https://raw.githubusercontent.com/layasync/LayaSync.github.io/0dcc38e4281761de08a946619e51f48a34e0bed3/playlist%20(10).m3u",
];

// JSON sources with { name, link } shape
export const JSON_PLAYLIST_URLS: { url: string; group: string }[] = [
  // perelive TW.json — mix of m3u8 and .ts streams
  { url: "https://perelive.pages.dev/TW.json", group: "Sports" },
];

// NOTE: Sagar878796/Sdtvlive and greenhck/WillowCricbuzz are intentionally
// excluded — they contain only DRM-protected MPD streams (#KODIPROP ClearKey)
// which cannot play in any browser without a Widevine/ClearKey pipeline.

export function parseM3U(text: string, idOffset = 0): Channel[] {
  const lines = text.split(/\r?\n/);
  const out: Channel[] = [];
  let pending: Partial<Channel> | null = null;
  let idx = idOffset;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF")) {
      const groupMatch = line.match(/group-title="([^"]*)"/i);
      const logoMatch = line.match(/tvg-logo="([^"]*)"/i);
      const commaIdx = line.indexOf(",");
      const name = commaIdx >= 0 ? line.slice(commaIdx + 1).trim() : "Unknown";
      pending = {
        name,
        group: groupMatch?.[1] || "Other",
        logo: logoMatch?.[1],
      };
    } else if (!line.startsWith("#") && pending) {
      out.push({
        id: `${idx++}`,
        name: pending.name || "Unknown",
        group: pending.group || "Other",
        logo: pending.logo,
        url: line,
      });
      pending = null;
    }
  }
  return out;
}

/** Parse a JSON playlist of shape Array<{ name, link, logo? }> */
export function parseJsonPlaylist(
  json: { name: string; link: string; logo?: string }[],
  group: string,
  idOffset = 0
): Channel[] {
  return json
    .filter((item) => item.link && item.name)
    .map((item, i) => ({
      id: `${idOffset + i}`,
      name: item.name,
      group,
      logo: item.logo,
      url: item.link,
    }));
}

/** Fetch all playlists and merge, deduplicating by stream URL */
export async function fetchAllChannels(): Promise<Channel[]> {
  const [m3uResults, jsonResults] = await Promise.all([
    Promise.allSettled(
      PLAYLIST_URLS.map((url) => fetch(url).then((r) => r.text()))
    ),
    Promise.allSettled(
      JSON_PLAYLIST_URLS.map(({ url }) => fetch(url).then((r) => r.json()))
    ),
  ]);

  const all: Channel[] = [];
  const seenUrls = new Set<string>();
  let idOffset = 0;

  const addChannels = (channels: Channel[]) => {
    for (const ch of channels) {
      if (!seenUrls.has(ch.url)) {
        seenUrls.add(ch.url);
        all.push({ ...ch, id: `${idOffset++}` });
      }
    }
  };

  // M3U sources
  for (const result of m3uResults) {
    if (result.status === "fulfilled") {
      addChannels(parseM3U(result.value, idOffset));
    }
  }

  // JSON sources
  for (let i = 0; i < jsonResults.length; i++) {
    const result = jsonResults[i];
    if (result.status === "fulfilled") {
      addChannels(
        parseJsonPlaylist(result.value, JSON_PLAYLIST_URLS[i].group, idOffset)
      );
    }
  }

  return all;
}

export function getProxyUrl(streamUrl: string): string {
  const base = import.meta.env.VITE_SUPABASE_URL;
  return `${base}/functions/v1/stream-proxy?url=${encodeURIComponent(streamUrl)}`;
}
