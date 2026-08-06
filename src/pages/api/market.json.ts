import type { APIRoute } from "astro";

export const prerender = false;

const UPSTREAM = "https://luna.fortefibre.net/kinsaku.php";
const TIMEOUT_MS = 8000;

// The upstream caps a single history query well above what this server needs
// (all stocks, entire season) so one round trip is enough.
const HISTORY_LIMIT = 2000;

type UpstreamEnvelope<T> = {
  ok: boolean;
  count?: number;
  data?: T[];
  error?: { code: string; message: string };
};

type UpstreamStock = {
  stock_id: string;
  code: string;
  display_name: string;
  type: "NATIONAL" | "COMPANY";
  status: string;
  current_price: number;
  ipo_price: number;
  day_open_price: number;
  day_change: number;
  day_change_pct: number;
  listed_at: string;
};

type UpstreamHistory = {
  stock_id: string;
  code: string;
  price: number;
  updated_at: string;
  t: number;
  update_type: string;
  delta_pct: number;
};

async function fetchUpstream<T>(params: Record<string, string>): Promise<T[]> {
  const url = new URL(UPSTREAM);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`upstream ${params.endpoint} returned HTTP ${res.status}`);
  }
  const body = (await res.json()) as UpstreamEnvelope<T>;
  if (!body.ok) {
    throw new Error(
      `upstream ${params.endpoint} error: ${body.error?.message ?? "unknown"}`,
    );
  }
  return body.data ?? [];
}

function json(body: unknown, status: number, cache: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cache,
    },
  });
}

export const GET: APIRoute = async () => {
  try {
    // Market cap is not shown anywhere, but it still gives the list a stable
    // "biggest first" order that does not jump around as prices move.
    const rawStocks = await fetchUpstream<UpstreamStock>({
      endpoint: "stocks",
      limit: "200",
      sort: "market_cap",
      order: "desc",
    });

    const codes = rawStocks.map((s) => s.code);
    const rawHistory = codes.length
      ? await fetchUpstream<UpstreamHistory>({
          endpoint: "stocks/history",
          code: codes.join(","),
          limit: String(HISTORY_LIMIT),
          order: "asc",
        })
      : [];

    const history: Record<
      string,
      { t: number; price: number; updateType: string; deltaPct: number }[]
    > = {};
    for (const code of codes) history[code] = [];
    for (const row of rawHistory) {
      history[row.code]?.push({
        t: row.t,
        price: row.price,
        updateType: row.update_type,
        deltaPct: row.delta_pct,
      });
    }
    // The upstream interleaves stocks when several codes are requested at
    // once, so `order=asc` does not guarantee per-stock ordering.
    for (const series of Object.values(history))
      series.sort((a, b) => a.t - b.t);

    const stocks = rawStocks.map((s) => ({
      stockId: s.stock_id,
      code: s.code,
      name: s.display_name,
      type: s.type,
      status: s.status,
      price: s.current_price,
      ipoPrice: s.ipo_price,
      dayOpen: s.day_open_price,
      dayChange: s.day_change,
      dayChangePct: s.day_change_pct,
      listedAt: s.listed_at,
    }));

    return json(
      { ok: true, updatedAt: new Date().toISOString(), stocks, history },
      200,
      "public, max-age=30, s-maxage=30",
    );
  } catch (err) {
    return json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      502,
      "no-store",
    );
  }
};
