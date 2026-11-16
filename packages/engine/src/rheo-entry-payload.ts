import type { RheoEntry } from "./rheo-knowledge";
import { neutralizeUntrusted } from "./untrusted";

/** Budget the complete JSON before recording sources or applying the external-data envelope. */
export function rheoEntryPayload(
  rows: Pick<RheoEntry, "id" | "kind" | "title" | "body" | "orgId" | "spaceId" | "revision">[],
  maxChars: number,
) {
  const entries: {
    id: string;
    orgId: string;
    spaceId: string | null;
    revision: number;
    kind: string;
    title: string;
    body: string;
    truncated: boolean;
  }[] = [];
  for (const row of rows) {
    const entry = {
      id: row.id,
      orgId: row.orgId,
      spaceId: row.spaceId,
      revision: row.revision,
      kind: row.kind,
      title: neutralizeUntrusted(row.title),
      body: neutralizeUntrusted(row.body),
      truncated: false,
    };
    const fits = (body: string) =>
      JSON.stringify({ entries: [...entries, { ...entry, body }], omittedCount: rows.length - entries.length - 1 })
        .length <= maxChars;
    if (!fits(entry.body)) {
      if (entries.length) break;
      entry.truncated = true;
      let low = 0;
      let high = entry.body.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (fits(entry.body.slice(0, middle))) low = middle;
        else high = middle - 1;
      }
      entry.body = entry.body.slice(0, low);
    }
    entries.push(entry);
  }
  return { entries, omittedCount: rows.length - entries.length };
}
