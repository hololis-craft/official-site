/**
 * Shared plumbing for the two places that show the asset ranking: the full
 * page at /earnings/ranking and the LEADERBOARD block on /earnings.
 */

export type Account = {
  rank: number;
  uuid: string;
  name: string;
  balance: number;
  createdAt: string;
};

export type Ranking = {
  ok: true;
  updatedAt: string;
  count: number;
  total: number;
  accounts: Account[];
};

type RankingError = { ok: false; error: string };

export const POLL_MS = 60_000;

const nf = new Intl.NumberFormat("ja-JP");

export const timef = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export const money = (n: number) => `${nf.format(Math.round(n))}円`;

/** Escapes player names before they go through innerHTML. */
export const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]!,
  );

export async function fetchRanking(): Promise<Ranking> {
  const res = await fetch("/api/ranking.json", { cache: "no-store" });
  const body = (await res.json()) as Ranking | RankingError;
  if (!res.ok || !body.ok) {
    throw new Error("error" in body ? body.error : `HTTP ${res.status}`);
  }
  return body;
}

/**
 * Refreshes on an interval, pausing while the tab is hidden so a background
 * tab does not keep hitting the upstream.
 */
export function startPolling(reload: () => void) {
  let timer: number | undefined;
  const stop = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };
  const start = () => {
    stop();
    timer = window.setInterval(reload, POLL_MS);
  };

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stop();
    } else {
      reload();
      start();
    }
  });
  start();
}
