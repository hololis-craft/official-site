import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type MouseEventParams,
  type UTCTimestamp,
} from "lightweight-charts";

// ---------------------------------------------------------------- types

type Stock = {
  stockId: string;
  code: string;
  name: string;
  type: "NATIONAL" | "COMPANY";
  price: number;
  ipoPrice: number;
  dayOpen: number;
  dayChange: number;
  dayChangePct: number;
  listedAt: string;
};

type Tick = {
  t: number;
  price: number;
  updateType: string;
  deltaPct: number;
};

type Market = {
  ok: true;
  updatedAt: string;
  stocks: Stock[];
  history: Record<string, Tick[]>;
};

type Range = "24h" | "3d" | "all";
type Mode = "line" | "candle";
type TypeFilter = "all" | "NATIONAL" | "COMPANY";

// ---------------------------------------------------------------- constants

// lightweight-charts always renders its time axis in UTC. Shifting every
// timestamp by +9h makes that axis read as JST, which is the only timezone
// the server ever reports.
const JST_OFFSET = 9 * 3600;
const HOUR_MS = 3600_000;
const RANGE_MS: Record<Range, number> = {
  "24h": 24 * HOUR_MS,
  "3d": 72 * HOUR_MS,
  all: Infinity,
};
const POLL_MS = 60_000;

const UP = "#3fbf8f";
const DOWN = "#e0574d";
const GOLD = "#e6c554";

const UPDATE_TYPE_LABEL: Record<string, string> = {
  IPO: "上場",
  HOURLY: "定時更新",
  IDLE_DRIFT: "自然変動",
  SPECIAL_EVENT: "特別イベント",
};

// ---------------------------------------------------------------- state

let market: Market | null = null;
let selectedCode = "";
let range: Range = "24h";
let mode: Mode = "line";
let typeFilter: TypeFilter = "all";

let chart: IChartApi | null = null;
let lineSeries: ISeriesApi<"Line"> | null = null;
let candleSeries: ISeriesApi<"Candlestick"> | null = null;

// ---------------------------------------------------------------- dom

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T | null;

const rowsEl = $("market-rows");
const statusEl = $("market-status");
const errorEl = $("market-error");
const emptyEl = $("market-empty");
const chartEl = $("market-chart");
const chartEmptyEl = $("market-chart-empty");
const tooltipEl = $("market-tooltip");
const titleEl = $("market-chart-title");
const typeEl = $("market-chart-type");
const priceEl = $("market-chart-price");
const changeEl = $("market-chart-change");
const statsEl = $("market-chart-stats");

// ---------------------------------------------------------------- format

const nf = new Intl.NumberFormat("ja-JP");
const dtf = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const dayf = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "numeric",
  day: "numeric",
});
const timef = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const money = (n: number) => `${nf.format(Math.round(n))}円`;
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
const signClass = (n: number) =>
  n > 0 ? "is-up" : n < 0 ? "is-down" : "is-flat";

// ---------------------------------------------------------------- data helpers

function ticksFor(code: string): Tick[] {
  return market?.history[code] ?? [];
}

function sliceRange(ticks: Tick[], r: Range): Tick[] {
  if (r === "all" || ticks.length === 0) return ticks;
  const cutoff = Date.now() - RANGE_MS[r];
  const sliced = ticks.filter((d) => d.t >= cutoff);
  // A stock listed minutes ago has almost no ticks inside a short window.
  // Falling back keeps the chart from rendering as a single dot.
  return sliced.length >= 2 ? sliced : ticks.slice(-2);
}

const toChartTime = (t: number) =>
  (Math.floor(t / 1000) + JST_OFFSET) as UTCTimestamp;

function toLineData(ticks: Tick[]): LineData[] {
  const out: LineData[] = [];
  for (const d of ticks) {
    const time = toChartTime(d.t);
    const prev = out[out.length - 1];
    // The series requires strictly ascending, unique timestamps; two ticks
    // inside the same second collapse to the later one.
    if (prev && prev.time === time) prev.value = d.price;
    else out.push({ time, value: d.price });
  }
  return out;
}

function toCandleData(ticks: Tick[]): CandlestickData[] {
  const buckets = new Map<
    number,
    { high: number; low: number; close: number }
  >();
  for (const d of ticks) {
    const bucket = Math.floor(d.t / HOUR_MS) * (HOUR_MS / 1000);
    const b = buckets.get(bucket);
    if (b) {
      b.high = Math.max(b.high, d.price);
      b.low = Math.min(b.low, d.price);
      b.close = d.price;
    } else {
      buckets.set(bucket, { high: d.price, low: d.price, close: d.price });
    }
  }

  const out: CandlestickData[] = [];
  let prevClose: number | null = null;
  for (const [sec, b] of [...buckets.entries()].sort((a, b2) => a[0] - b2[0])) {
    // Opening at the previous bucket's close gives candles a real body;
    // opening at the bucket's own first tick would flatten every hour that
    // only received a single update.
    const open = prevClose ?? b.close;
    out.push({
      time: (sec + JST_OFFSET) as UTCTimestamp,
      open,
      high: Math.max(b.high, open),
      low: Math.min(b.low, open),
      close: b.close,
    });
    prevClose = b.close;
  }
  return out;
}

// ---------------------------------------------------------------- list

function sparkline(ticks: Tick[]): string {
  const pts = ticks.length >= 2 ? ticks : [];
  if (pts.length < 2) return '<span class="spark-none">—</span>';

  const w = 108;
  const h = 30;
  const pad = 3;
  const prices = pts.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const t0 = pts[0].t;
  const tSpan = pts[pts.length - 1].t - t0 || 1;

  const d = pts
    .map((p, i) => {
      const x = ((p.t - t0) / tSpan) * (w - pad * 2) + pad;
      const y = h - pad - ((p.price - min) / span) * (h - pad * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  const dir = prices[prices.length - 1] - prices[0];
  const color = dir > 0 ? UP : dir < 0 ? DOWN : "rgba(232,226,212,0.45)";
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

function visibleStocks(): Stock[] {
  if (!market) return [];
  return market.stocks.filter(
    (s) => typeFilter === "all" || s.type === typeFilter,
  );
}

function renderList() {
  if (!rowsEl || !market) return;
  const stocks = visibleStocks();

  if (emptyEl) emptyEl.hidden = stocks.length > 0;

  rowsEl.innerHTML = stocks
    .map((s) => {
      const spark = sparkline(sliceRange(ticksFor(s.code), "24h"));
      const cls = signClass(s.dayChange);
      return `<tr class="market-row${s.code === selectedCode ? " is-selected" : ""}" data-code="${s.code}" tabindex="0" role="button" aria-label="${s.name} のチャートを表示">
        <td class="c-name"><span class="nm">${s.name}</span></td>
        <td class="c-type"><span class="type-tag t-${s.type.toLowerCase()}">${s.type === "NATIONAL" ? "国営" : "会社"}</span></td>
        <td class="c-price earn-mono">${money(s.price)}</td>
        <td class="c-change earn-mono ${cls}">
          <span class="chg">${s.dayChange >= 0 ? "+" : ""}${money(s.dayChange)}</span>
          <span class="chgp">${pct(s.dayChangePct)}</span>
        </td>
        <td class="c-spark">${spark}</td>
      </tr>`;
    })
    .join("");
}

// ---------------------------------------------------------------- chart

function ensureChart() {
  if (chart || !chartEl) return;

  chart = createChart(chartEl, {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: "transparent" },
      textColor: "rgba(232, 226, 212, 0.65)",
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 11,
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: "rgba(232, 226, 212, 0.06)" },
      horzLines: { color: "rgba(232, 226, 212, 0.06)" },
    },
    rightPriceScale: {
      borderColor: "rgba(201, 162, 39, 0.25)",
      scaleMargins: { top: 0.12, bottom: 0.12 },
    },
    timeScale: {
      borderColor: "rgba(201, 162, 39, 0.25)",
      timeVisible: true,
      secondsVisible: false,
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: {
        color: "rgba(201, 162, 39, 0.5)",
        labelBackgroundColor: "#c9a227",
      },
      horzLine: {
        color: "rgba(201, 162, 39, 0.5)",
        labelBackgroundColor: "#c9a227",
      },
    },
    localization: {
      locale: "ja-JP",
      priceFormatter: (p: number) => nf.format(Math.round(p)),
    },
    handleScale: { axisPressedMouseMove: { price: false } },
  });

  chart.subscribeCrosshairMove(onCrosshair);

  // autoSize resizes the canvas but keeps the visible logical range, which
  // leaves the series bunched against one edge after a width change.
  let refit: number | undefined;
  new ResizeObserver(() => {
    if (refit !== undefined) clearTimeout(refit);
    refit = window.setTimeout(() => chart?.timeScale().fitContent(), 80);
  }).observe(chartEl);
}

function onCrosshair(param: MouseEventParams) {
  if (!tooltipEl || !chartEl) return;

  const series = mode === "line" ? lineSeries : candleSeries;
  if (!param.point || !param.time || !series) {
    tooltipEl.hidden = true;
    return;
  }
  const data = param.seriesData.get(series);
  if (!data) {
    tooltipEl.hidden = true;
    return;
  }

  const ms = ((param.time as number) - JST_OFFSET) * 1000;
  let body: string;
  if (mode === "line") {
    const value = (data as LineData).value;
    const tick = ticksFor(selectedCode).find(
      (d) => Math.floor(d.t / 1000) === (param.time as number) - JST_OFFSET,
    );
    const label = tick
      ? (UPDATE_TYPE_LABEL[tick.updateType] ?? tick.updateType)
      : "";
    body =
      `<b>${money(value)}</b>` +
      (tick
        ? `<span class="tt-sub ${signClass(tick.deltaPct)}">${pct(tick.deltaPct * 100)} / ${label}</span>`
        : "");
  } else {
    const c = data as CandlestickData;
    const chg = c.open === 0 ? 0 : ((c.close - c.open) / c.open) * 100;
    body =
      `<b>${money(c.close)}</b>` +
      `<span class="tt-sub ${signClass(chg)}">${pct(chg)}</span>` +
      `<span class="tt-ohlc">始 ${nf.format(c.open)} / 高 ${nf.format(c.high)} / 安 ${nf.format(c.low)}</span>`;
  }

  tooltipEl.innerHTML = `<span class="tt-time">${dtf.format(ms)}</span>${body}`;
  tooltipEl.hidden = false;

  const box = chartEl.getBoundingClientRect();
  const tw = tooltipEl.offsetWidth;
  const left = Math.min(
    Math.max(param.point.x - tw / 2, 6),
    box.width - tw - 6,
  );
  tooltipEl.style.left = `${left}px`;
  tooltipEl.style.top = `${Math.max(param.point.y - 12, 6)}px`;
}

function renderChart() {
  if (!market || !selectedCode) return;
  const stock = market.stocks.find((s) => s.code === selectedCode);
  if (!stock) return;

  const ticks = sliceRange(ticksFor(selectedCode), range);
  const hasData = ticks.length >= 2;

  if (chartEmptyEl) chartEmptyEl.hidden = hasData;
  if (chartEl) chartEl.style.visibility = hasData ? "visible" : "hidden";

  renderHeader(stock, ticks);

  if (!hasData) return;
  ensureChart();
  if (!chart) return;

  if (mode === "line") {
    if (candleSeries) {
      chart.removeSeries(candleSeries);
      candleSeries = null;
    }
    const data = toLineData(ticks);
    if (!lineSeries) {
      lineSeries = chart.addSeries(LineSeries, {
        color: GOLD,
        lineWidth: 2,
        priceLineColor: "rgba(201, 162, 39, 0.5)",
        lastValueVisible: true,
      });
    }
    // Sparse windows read as an empty canvas without explicit markers.
    lineSeries.applyOptions({ pointMarkersVisible: data.length <= 40 });
    lineSeries.setData(data);
  } else {
    if (lineSeries) {
      chart.removeSeries(lineSeries);
      lineSeries = null;
    }
    if (!candleSeries) {
      candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: UP,
        downColor: DOWN,
        borderUpColor: UP,
        borderDownColor: DOWN,
        wickUpColor: UP,
        wickDownColor: DOWN,
      });
    }
    candleSeries.setData(toCandleData(ticks));
  }

  chart.timeScale().fitContent();
}

function renderHeader(stock: Stock, ticks: Tick[]) {
  if (titleEl) titleEl.textContent = stock.name;
  if (typeEl) {
    typeEl.textContent = stock.type === "NATIONAL" ? "国営銘柄" : "会社銘柄";
  }
  if (priceEl) priceEl.textContent = money(stock.price);
  if (changeEl) {
    changeEl.textContent = `${stock.dayChange >= 0 ? "+" : ""}${money(stock.dayChange)} (${pct(stock.dayChangePct)})`;
    changeEl.className = `chart-change earn-mono ${signClass(stock.dayChange)}`;
  }

  if (!statsEl) return;
  const prices = ticks.map((d) => d.price);
  const high = prices.length ? Math.max(...prices) : stock.price;
  const low = prices.length ? Math.min(...prices) : stock.price;
  const first = prices.length ? prices[0] : stock.price;
  const periodPct = first === 0 ? 0 : ((stock.price - first) / first) * 100;
  const ipoPct =
    stock.ipoPrice === 0
      ? 0
      : ((stock.price - stock.ipoPrice) / stock.ipoPrice) * 100;
  const rangeLabel =
    range === "24h" ? "24時間" : range === "3d" ? "3日間" : "全期間";

  const items: [string, string, string][] = [
    [`${rangeLabel}騰落`, pct(periodPct), signClass(periodPct)],
    [`${rangeLabel}高値`, money(high), ""],
    [`${rangeLabel}安値`, money(low), ""],
    ["IPO価格", money(stock.ipoPrice), ""],
    ["IPO比", pct(ipoPct), signClass(ipoPct)],
    ["上場日", dayf.format(new Date(stock.listedAt)), ""],
  ];

  statsEl.innerHTML = items
    .map(
      ([label, value, cls]) =>
        `<div class="stat"><span class="k">${label}</span><span class="v earn-mono ${cls}">${value}</span></div>`,
    )
    .join("");
}

// ---------------------------------------------------------------- interaction

function select(code: string, pushUrl = true) {
  if (!market?.stocks.some((s) => s.code === code)) return;
  selectedCode = code;
  if (pushUrl) {
    const url = new URL(location.href);
    url.searchParams.set("code", code);
    history.replaceState(null, "", url);
  }
  renderList();
  renderChart();
}

function bindControls() {
  rowsEl?.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>(".market-row");
    if (row?.dataset.code) select(row.dataset.code);
  });
  rowsEl?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const row = (e.target as HTMLElement).closest<HTMLElement>(".market-row");
    if (row?.dataset.code) {
      e.preventDefault();
      select(row.dataset.code);
    }
  });

  document
    .querySelectorAll<HTMLButtonElement>("[data-filter]")
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        typeFilter = btn.dataset.filter as TypeFilter;
        setPressed("[data-filter]", btn);
        renderList();
      });
    });

  document
    .querySelectorAll<HTMLButtonElement>("[data-range]")
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        range = btn.dataset.range as Range;
        setPressed("[data-range]", btn);
        renderChart();
      });
    });

  document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      mode = btn.dataset.mode as Mode;
      setPressed("[data-mode]", btn);
      renderChart();
    });
  });
}

function setPressed(selector: string, active: HTMLElement) {
  document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
    const on = el === active;
    el.classList.toggle("is-active", on);
    el.setAttribute("aria-pressed", String(on));
  });
}

// ---------------------------------------------------------------- load

async function load(initial: boolean) {
  try {
    const res = await fetch("/api/market.json", { cache: "no-store" });
    const body = (await res.json()) as Market | { ok: false; error: string };
    if (!res.ok || !body.ok) {
      throw new Error("error" in body ? body.error : `HTTP ${res.status}`);
    }

    market = body;
    if (errorEl) errorEl.hidden = true;
    if (statusEl) {
      statusEl.textContent = `最終取得 ${timef.format(new Date(body.updatedAt))} JST`;
    }

    if (initial) {
      const wanted = new URL(location.href).searchParams.get("code");
      selectedCode =
        (wanted && market.stocks.some((s) => s.code === wanted)
          ? wanted
          : "") ||
        market.stocks[0]?.code ||
        "";
    }
    renderList();
    renderChart();
  } catch (err) {
    if (errorEl) {
      errorEl.hidden = false;
      errorEl.textContent = `株価データを取得できませんでした (${err instanceof Error ? err.message : String(err)})`;
    }
    // A failed refresh keeps the previously rendered data on screen; only a
    // cold failure has to clear the "loading" placeholder.
    if (market) return;
    if (statusEl) statusEl.textContent = "";
    if (rowsEl) {
      rowsEl.innerHTML =
        '<tr class="market-skeleton"><td colspan="5">データを表示できません。</td></tr>';
    }
  }
}

function startPolling() {
  let timer: number | undefined;
  const stop = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };
  const start = () => {
    stop();
    timer = window.setInterval(() => void load(false), POLL_MS);
  };

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stop();
    } else {
      void load(false);
      start();
    }
  });
  start();
}

bindControls();
void load(true).then(startPolling);
