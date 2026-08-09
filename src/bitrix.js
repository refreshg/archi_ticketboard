/**
 * Bitrix24 REST client.
 *
 * Two behaviours of this portal drove the design here and are load-bearing:
 *
 *  1. Inside a `batch` command string, filter keys carrying operator prefixes
 *     (`>=`, `<=`, `>`, `<`, `!`) are silently dropped unless percent-encoded.
 *     An unencoded `filter[>=DATE_CREATE]` returns the *unfiltered* set — no
 *     error, just wrong numbers. `encodeQuery` encodes every key, so the
 *     operator survives.
 *  2. `crm.deal.list` omits every UF_ field unless it is named in `select`.
 *     The default response carries only system fields.
 *
 * Paging uses `order[ID]=ASC` so the window is stable across the 50-row pages
 * that a batch fans out over.
 */

export const WEBHOOKS = {
  deal: 'https://crm.archi.ge/rest/1/xmbjzulaie03bgxg',
  userfield: 'https://crm.archi.ge/rest/1/er8pswwfzwon0f8q',
  lists: 'https://crm.archi.ge/rest/1/6q41f4tld4nyr99e',
  user: 'https://crm.archi.ge/rest/1/7d15qad3886t8m72',
};

const PAGE = 50;            // Bitrix hard page size for list methods
const BATCH_MAX = 50;       // max commands per batch call
const MAX_PARALLEL = 4;     // concurrent batch calls; portal throttles above this

/** Flatten a nested object into Bitrix's `a[b][c]=v` query form, encoding keys. */
function encodeQuery(obj, prefix = '') {
  const parts = [];
  for (const [rawKey, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    // Encoding the key is what keeps `>=DATE_CREATE` alive inside a batch cmd.
    const key = prefix ? `${prefix}[${encodeURIComponent(rawKey)}]` : encodeURIComponent(rawKey);
    if (Array.isArray(value)) {
      for (const v of value) parts.push(`${key}[]=${encodeURIComponent(v)}`);
    } else if (typeof value === 'object') {
      parts.push(encodeQuery(value, key));
    } else {
      parts.push(`${key}=${encodeURIComponent(value)}`);
    }
  }
  return parts.filter(Boolean).join('&');
}

async function callJson(base, method, payload, { signal } = {}) {
  const res = await fetch(`${base}/${method}.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) throw new Error(`${method} failed: HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error_description || json.error}`);
  return json;
}

/** Run up to BATCH_MAX prepared command strings in one round trip. */
async function callBatch(base, cmd, { signal } = {}) {
  const json = await callJson(base, 'batch', { halt: 0, cmd }, { signal });
  const result = json.result || {};
  const errors = result.result_error || {};
  const firstError = Object.values(errors)[0];
  if (firstError) {
    const msg = firstError.error_description || firstError.error || String(firstError);
    throw new Error(`batch: ${msg}`);
  }
  return result.result || {};
}

async function mapLimited(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

/**
 * Fetch every row of a list method, reporting progress as pages land.
 * The first page doubles as the count probe, so a small result set costs
 * exactly one request.
 */
export async function fetchAll(base, method, params, { signal, onProgress } = {}) {
  const first = await callJson(base, method, { ...params, start: 0 }, { signal });
  const total = first.total ?? 0;
  let rows = first.result || [];
  onProgress?.(rows.length, total);

  if (rows.length >= total) return rows;

  const starts = [];
  for (let s = rows.length; s < total; s += PAGE) starts.push(s);

  // Group page offsets into batches of BATCH_MAX, then run those in parallel.
  const groups = [];
  for (let i = 0; i < starts.length; i += BATCH_MAX) {
    groups.push(starts.slice(i, i + BATCH_MAX));
  }

  const base_q = encodeQuery(params);
  const collected = await mapLimited(groups, MAX_PARALLEL, async (group) => {
    const cmd = {};
    group.forEach((start, i) => {
      cmd[`c${i}`] = `${method}?${base_q}&start=${start}`;
    });
    const result = await callBatch(base, cmd, { signal });
    const chunk = Object.values(result).flat();
    onProgress?.(chunk.length, total);
    return chunk;
  });

  rows = rows.concat(collected.flat());

  // Batch pages can overlap if rows shift mid-read; dedupe defensively.
  const seen = new Map();
  for (const row of rows) seen.set(String(row.ID), row);
  return Array.from(seen.values());
}

export const api = {
  deals: (params, opts) => fetchAll(WEBHOOKS.deal, 'crm.deal.list', params, opts),
  users: (params, opts) => fetchAll(WEBHOOKS.user, 'user.get', params, opts),
  listElements: (params, opts) => fetchAll(WEBHOOKS.lists, 'lists.element.get', params, opts),
  dealFields: (opts) => callJson(WEBHOOKS.userfield, 'crm.deal.userfield.list', { start: 0 }, opts),
  userfieldPage: (start, opts) =>
    callJson(WEBHOOKS.userfield, 'crm.deal.userfield.list', { start }, opts),
  statuses: (entityId, opts) =>
    fetchAll(WEBHOOKS.deal, 'crm.status.list', { filter: { ENTITY_ID: entityId } }, opts),
};

export { encodeQuery };
