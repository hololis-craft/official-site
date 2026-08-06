import {
  esc,
  fetchRanking,
  money,
  startPolling,
  timef,
  type Account,
  type Ranking,
} from "./ranking-data";

// ---------------------------------------------------------------- state

let ranking: Ranking | null = null;
let query = "";

// ---------------------------------------------------------------- dom

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T | null;

const rowsEl = $("rank-rows");
const podiumEl = $("rank-podium");
const statsEl = $("rank-stats");
const statusEl = $("rank-status");
const errorEl = $("rank-error");
const emptyEl = $("rank-empty");
const searchEl = $<HTMLInputElement>("rank-search");

// ---------------------------------------------------------------- render

function visibleAccounts(): Account[] {
  if (!ranking) return [];
  const q = query.trim().toLowerCase();
  if (!q) return ranking.accounts;
  return ranking.accounts.filter((a) => a.name.toLowerCase().includes(q));
}

function renderStats() {
  if (!statsEl || !ranking) return;
  const { accounts, count, total } = ranking;
  const top = accounts[0];
  const average = count > 0 ? total / count : 0;

  const items: [string, string][] = [
    ["参加者", `${count}人`],
    ["首位", top ? top.name : "—"],
    ["総資産", money(total)],
    ["平均資産", money(average)],
  ];

  statsEl.innerHTML = items
    .map(
      ([label, value]) =>
        `<div class="stat"><span class="k">${label}</span><span class="v earn-mono">${esc(value)}</span></div>`,
    )
    .join("");
}

function renderPodium() {
  if (!podiumEl || !ranking) return;
  const top3 = ranking.accounts.slice(0, 3);
  if (top3.length === 0) {
    podiumEl.innerHTML = "";
    return;
  }

  podiumEl.innerHTML = top3
    .map(
      (a) => `<div class="podium-card p-${a.rank}">
        <span class="pod-pos earn-mono">${String(a.rank).padStart(2, "0")}</span>
        <span class="pod-name">${esc(a.name)}</span>
        <span class="pod-amount earn-mono">${money(a.balance)}</span>
      </div>`,
    )
    .join("");
}

function renderRows() {
  if (!rowsEl || !ranking) return;
  const accounts = visibleAccounts();
  const topBalance = ranking.accounts[0]?.balance ?? 0;

  if (emptyEl) emptyEl.hidden = accounts.length > 0;

  rowsEl.innerHTML = accounts
    .map((a) => {
      // Bars are measured against the leader, so the top row always fills the
      // column and everyone else reads as a share of first place.
      const share = topBalance > 0 ? (a.balance / topBalance) * 100 : 0;
      return `<tr class="rank-row${a.rank <= 3 ? ` is-top is-top${a.rank}` : ""}">
        <td class="c-pos earn-mono">${String(a.rank).padStart(2, "0")}</td>
        <td class="c-player"><span class="nm">${esc(a.name)}</span></td>
        <td class="c-amount earn-mono">${money(a.balance)}</td>
        <td class="c-bar">
          <span class="bar"><i style="width:${share.toFixed(1)}%"></i></span>
          <span class="bar-pct earn-mono">${share.toFixed(1)}%</span>
        </td>
      </tr>`;
    })
    .join("");
}

function render() {
  renderStats();
  renderPodium();
  renderRows();
}

// ---------------------------------------------------------------- interaction

function bindControls() {
  searchEl?.addEventListener("input", () => {
    query = searchEl.value;
    renderRows();
  });
}

// ---------------------------------------------------------------- load

async function load() {
  try {
    const body = await fetchRanking();

    ranking = body;
    if (errorEl) errorEl.hidden = true;
    if (statusEl) {
      statusEl.textContent = `最終取得 ${timef.format(new Date(body.updatedAt))} JST`;
    }
    render();
  } catch (err) {
    if (errorEl) {
      errorEl.hidden = false;
      errorEl.textContent = `資産データを取得できませんでした (${err instanceof Error ? err.message : String(err)})`;
    }
    // A failed refresh keeps the previously rendered ranking on screen; only a
    // cold failure has to clear the "loading" placeholder.
    if (ranking) return;
    if (statusEl) statusEl.textContent = "";
    if (rowsEl) {
      rowsEl.innerHTML =
        '<tr class="rank-skeleton"><td colspan="4">データを表示できません。</td></tr>';
    }
  }
}

bindControls();
void load().then(() => startPolling(() => void load()));
