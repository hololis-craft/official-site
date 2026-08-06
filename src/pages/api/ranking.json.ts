import type { APIRoute } from "astro";

export const prerender = false;

const UPSTREAM = "https://luna.fortefibre.net/kinsaku.php";
const TIMEOUT_MS = 8000;

// Comfortably above the number of participants; the upstream caps it anyway.
const LIMIT = 300;

type UpstreamEnvelope<T> = {
  ok: boolean;
  count?: number;
  data?: T[];
  error?: { code: string; message: string };
};

type UpstreamAccount = {
  rank: number;
  uuid: string;
  alias: string;
  is_player: boolean;
  namespace: string | null;
  balance: number;
  balance_raw: number;
  created_at: string;
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
    // The endpoint returns player accounts only unless asked otherwise, which
    // is exactly the set the competition is scored on.
    const rawAccounts = await fetchUpstream<UpstreamAccount>({
      endpoint: "money/top",
      limit: String(LIMIT),
      order: "desc",
    });

    const accounts = rawAccounts.map((a) => ({
      rank: a.rank,
      uuid: a.uuid,
      name: a.alias,
      balance: a.balance,
      createdAt: a.created_at,
    }));

    const total = accounts.reduce((sum, a) => sum + a.balance, 0);

    return json(
      {
        ok: true,
        updatedAt: new Date().toISOString(),
        count: accounts.length,
        total,
        accounts,
      },
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
