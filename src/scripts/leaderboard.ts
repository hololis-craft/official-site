/**
 * Fills the LEADERBOARD block on /earnings with the live top of the asset
 * ranking. The full table lives at /earnings/ranking.
 */
import { esc, fetchRanking, money, startPolling, timef } from "./ranking-data";

const TOP_N = 5;

const rowsEl = document.getElementById("lb-rows");
const statusEl = document.getElementById("lb-status");
const noteEl = document.getElementById("lb-note");

async function load() {
  if (!rowsEl) return;
  try {
    const body = await fetchRanking();
    const top = body.accounts.slice(0, TOP_N);

    if (top.length === 0) {
      rowsEl.innerHTML =
        '<div class="earn-rank-row is-muted"><span class="pos earn-mono">--</span><div class="name">集計対象がまだいません</div><div class="amount earn-mono">—</div></div>';
    } else {
      rowsEl.innerHTML = top
        .map(
          (a) => `<div class="earn-rank-row${a.rank === 1 ? " is-top" : ""}">
            <span class="pos earn-mono">${String(a.rank).padStart(2, "0")}</span>
            <div class="name">${esc(a.name)}</div>
            <div class="amount earn-mono">${money(a.balance)}</div>
          </div>`,
        )
        .join("");
    }

    if (statusEl) {
      statusEl.textContent = `${timef.format(new Date(body.updatedAt))} JST 時点 / 全${body.count}人`;
    }
  } catch {
    // The block is decorative on this page, so a failure just says so instead
    // of pushing an error banner into the middle of the landing page.
    if (statusEl) statusEl.textContent = "取得できませんでした";
    if (noteEl) {
      noteEl.textContent =
        "※ ただいまランキングを取得できません。時間をおいて再度お試しください。";
    }
    rowsEl.innerHTML =
      '<div class="earn-rank-row is-muted"><span class="pos earn-mono">--</span><div class="name">データを表示できません</div><div class="amount earn-mono">—</div></div>';
  }
}

void load().then(() => startPolling(() => void load()));
