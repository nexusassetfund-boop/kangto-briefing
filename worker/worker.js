var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/portfolio.js
var DEFAULT_BOOK = {
  settings: { fee_rate: 15e-5, tax_rate: 15e-4, initial_capital: 0 },
  opening: { date: null, cash: 0, realized_pnl_carry: 0, positions: [] },
  transactions: [],
  universe: [],
  nav: { indexed: [], value: [], base: {} }
};
function dateKey(d) {
  return (d || "").replaceAll(".", "-");
}
__name(dateKey, "dateKey");
function replayBook(book) {
  const pos = /* @__PURE__ */ new Map();
  for (const p of book.opening?.positions || []) {
    pos.set(p.code, { ...p });
  }
  let cash = book.opening?.cash ?? 0;
  let realized = book.opening?.realized_pnl_carry ?? 0;
  let dividends = book.opening?.dividend_carry ?? 0;
  const initial = book.settings?.initial_capital || 0;
  let units = initial > 0 ? initial / 1e3 : 0;
  let netFlows = 0;
  const txs = (book.transactions || []).filter((t) => !t.legacy).slice().sort((a, b) => dateKey(a.date).localeCompare(dateKey(b.date)) || (a.seq || 0) - (b.seq || 0));
  const errors = [];
  const perCode = /* @__PURE__ */ new Map();
  const agg = /* @__PURE__ */ __name((code, name, strategy) => {
    if (!perCode.has(code)) {
      perCode.set(code, { code, name, strategy: strategy || "", bought_amt: 0, bought_qty: 0, sold_amt: 0, sold_qty: 0, realized: 0, dividends: 0, first_date: null, last_date: null });
    }
    const a = perCode.get(code);
    if (name) a.name = name;
    if (strategy) a.strategy = strategy;
    return a;
  }, "agg");
  for (const t of txs) {
    const qty = t.qty || 0;
    const price = t.unit_price || 0;
    const amount = ["\uC785\uAE08", "\uCD9C\uAE08", "\uBC30\uB2F9"].includes(t.side) ? t.amount || 0 : qty * price;
    if (t.side === "\uB9E4\uC218") {
      const h = pos.get(t.code) || {
        strategy: t.strategy || "",
        code: t.code,
        name: t.name,
        qty: 0,
        avg_price: 0,
        buy_date: t.date
      };
      const newQty = h.qty + qty;
      h.avg_price = newQty > 0 ? (h.avg_price * h.qty + amount) / newQty : 0;
      h.qty = newQty;
      if (!h.buy_date) h.buy_date = t.date;
      if (t.strategy) h.strategy = t.strategy;
      pos.set(t.code, h);
      cash -= amount + (t.fee || 0);
      t.realized_pnl = null;
      const a = agg(t.code, t.name, t.strategy);
      a.bought_amt += amount;
      a.bought_qty += qty;
      if (!a.first_date) a.first_date = t.date;
      a.last_date = t.date;
    } else if (t.side === "\uB9E4\uB3C4") {
      const h = pos.get(t.code);
      if (!h || h.qty < qty - 1e-9) {
        errors.push(`${t.date} ${t.name} \uB9E4\uB3C4 \uC218\uB7C9(${qty})\uC774 \uBCF4\uC720(${h ? h.qty : 0})\uB97C \uCD08\uACFC \u2014 \uC774 \uAC70\uB798\uB294 \uACC4\uC0B0\uC5D0\uC11C \uC81C\uC678\uB428`);
        t.realized_pnl = null;
      } else {
        t.realized_pnl = Math.round((price - h.avg_price) * qty - (t.fee || 0) - (t.tax || 0));
        realized += t.realized_pnl;
        h.qty -= qty;
        if (h.qty <= 1e-9) pos.delete(t.code);
        cash += amount - (t.fee || 0) - (t.tax || 0);
        const a = agg(t.code, t.name, t.strategy);
        a.sold_amt += amount;
        a.sold_qty += qty;
        a.realized += t.realized_pnl;
        a.last_date = t.date;
      }
    } else if (t.side === "\uC785\uAE08") {
      cash += amount;
      netFlows += amount;
      units += amount / (t.nav_at || 1e3);
    } else if (t.side === "\uCD9C\uAE08") {
      cash -= amount;
      netFlows -= amount;
      units -= amount / (t.nav_at || 1e3);
    } else if (t.side === "\uBC30\uB2F9") {
      cash += amount;
      dividends += amount;
      t.realized_pnl = null;
      if (t.code) {
        const a = agg(t.code, t.name, t.strategy);
        a.dividends += amount;
      }
    }
    t.amount = Math.round(amount);
  }
  return {
    positions: [...pos.values()],
    cash: Math.round(cash),
    realized: Math.round(realized),
    dividends: Math.round(dividends),
    units,
    netFlows: Math.round(netFlows),
    perCode,
    errors
  };
}
__name(replayBook, "replayBook");
function holdDays(buyDate) {
  if (!buyDate) return null;
  const d = new Date(dateKey(buyDate));
  if (isNaN(d)) return null;
  return Math.max(0, Math.round((Date.now() - d.getTime()) / 864e5));
}
__name(holdDays, "holdDays");
function buildPortfolio(book, prices, indices, pricesUpdated) {
  const { positions, cash, realized, dividends, units, netFlows, perCode, errors } = replayBook(book);
  const initial = book.settings?.initial_capital || 0;
  const holdings = positions.map((p) => {
    const px = prices[p.code] || {};
    const price = px.price ?? p.avg_price;
    const chg = px.change_pct ?? null;
    const evalAmount = Math.round(price * p.qty);
    const buyAmount = Math.round(p.avg_price * p.qty);
    const a = perCode.get(p.code);
    const evalPnl2 = evalAmount - buyAmount;
    const totalPnl = evalPnl2 + (a ? a.realized + a.dividends : 0);
    return {
      strategy: p.strategy || "",
      code: p.code,
      name: p.name,
      qty: p.qty,
      price,
      change_pct: chg,
      // 일일 수익 (₩) = 전일 종가 대비 보유분 변동
      day_value: chg != null ? Math.round(evalAmount * chg / (100 + chg)) : null,
      avg_price: Math.round(p.avg_price),
      eval_pnl: evalPnl2,
      return_pct: buyAmount ? Math.round((evalAmount / buyAmount - 1) * 1e4) / 100 : 0,
      realized_cum: a ? a.realized : 0,
      dividends: a ? a.dividends : 0,
      total_pnl: totalPnl,
      total_return_pct: a && a.bought_amt ? Math.round(totalPnl / a.bought_amt * 1e4) / 100 : null,
      eval_amount: evalAmount,
      buy_amount: buyAmount,
      target_price: p.target_price ?? null,
      buy_date: p.buy_date || "",
      hold_days: holdDays(p.buy_date),
      memo: p.memo || ""
    };
  });
  const openCodes = new Set(positions.map((p) => p.code));
  const closed = [...perCode.values()].filter((a) => !openCodes.has(a.code) && a.bought_qty > 0).map((a) => ({
    strategy: a.strategy,
    code: a.code,
    name: a.name,
    qty: a.sold_qty,
    avg_buy: a.bought_qty ? Math.round(a.bought_amt / a.bought_qty) : 0,
    avg_sell: a.sold_qty ? Math.round(a.sold_amt / a.sold_qty) : 0,
    bought_amt: Math.round(a.bought_amt),
    realized: Math.round(a.realized),
    dividends: Math.round(a.dividends),
    total_pnl: Math.round(a.realized + a.dividends),
    total_return_pct: a.bought_amt ? Math.round((a.realized + a.dividends) / a.bought_amt * 1e4) / 100 : null,
    first_date: a.first_date,
    last_date: a.last_date
  })).sort((a, b) => (b.last_date || "").localeCompare(a.last_date || ""));
  const evalTotal = holdings.reduce((s, h) => s + h.eval_amount, 0);
  const buyTotal = holdings.reduce((s, h) => s + h.buy_amount, 0);
  const total = cash + evalTotal;
  for (const h of holdings) {
    h.weight = total ? (h.eval_amount / total * 100).toFixed(1) + "%" : "-";
    h.contrib_pct = total ? Math.round(h.eval_pnl / total * 1e4) / 100 : null;
  }
  const evalPnl = evalTotal - buyTotal;
  const nav = book.nav || { indexed: [], value: [] };
  const kstNow = new Date(Date.now() + 9 * 3600 * 1e3);
  const todayStr = `${kstNow.getUTCFullYear()}.${String(kstNow.getUTCMonth() + 1).padStart(2, "0")}.${String(kstNow.getUTCDate()).padStart(2, "0")}`;
  const lastVal = (nav.value || []).find((p) => p.date < todayStr);
  const dayChange = lastVal && lastVal.portfolio_value ? total - lastVal.portfolio_value : null;
  const universe = (book.universe || []).map((u) => {
    const px = prices[u.code] || {};
    return {
      ...u,
      price: px.price ?? u.price ?? null,
      change_pct: px.change_pct ?? null,
      per: px.per ?? u.per ?? null,
      mktcap: px.mktcap ?? u.mktcap ?? null,
      high52: px.high52 ?? u.high52 ?? null,
      low52: px.low52 ?? u.low52 ?? null,
      upside_pct: u.target_price && px.price ? Math.round((u.target_price / px.price - 1) * 1e3) / 10 : u.upside_pct ?? null
    };
  });
  const txs = (book.transactions || []).slice().sort((a, b) => dateKey(b.date).localeCompare(dateKey(a.date)) || (b.seq || 0) - (a.seq || 0));
  let annualPct = null;
  const openDate = book.opening?.date ? new Date(book.opening.date) : null;
  if (openDate && units > 0) {
    const days = (Date.now() - openDate.getTime()) / 864e5;
    if (days >= 30) {
      const nav2 = (cash + holdings.reduce((s, h) => s + h.eval_amount, 0)) / units / 1e3;
      if (nav2 > 0) annualPct = Math.round((Math.pow(nav2, 365 / days) - 1) * 1e4) / 100;
    }
  }
  return {
    updated: (/* @__PURE__ */ new Date()).toISOString(),
    editable: true,
    errors,
    closed,
    kpi: {
      portfolio_value: total,
      cash,
      eval_pnl: evalPnl,
      eval_pnl_pct: buyTotal ? Math.round(evalPnl / buyTotal * 1e4) / 100 : 0,
      // 누적손익: 외부 입출금(netFlows)을 제외한 순수 운용 성과
      cum_pnl: initial ? total - initial - netFlows : null,
      cum_pnl_pct: units > 0 ? Math.round((total / units / 1e3 - 1) * 1e4) / 100 : null,
      day_change: dayChange,
      day_change_pct: dayChange != null && lastVal.portfolio_value ? Math.round(dayChange / lastVal.portfolio_value * 1e4) / 100 : null,
      realized_pnl: realized,
      dividend_income: dividends,
      total_return: initial ? total - initial - netFlows : null,
      net_flows: netFlows,
      // 기준가: 좌수 방식 (입출금 시점의 nav로 좌수 증감 — 수익률 왜곡 없음)
      nav_index: units > 0 ? Math.round(total / units * 100) / 100 : null,
      prices_updated: pricesUpdated || null,
      annual_return_pct: annualPct,
      inception_date: book.opening?.date || null,
      n_stocks: holdings.length,
      n_win: holdings.filter((h) => h.eval_pnl > 0).length,
      n_loss: holdings.filter((h) => h.eval_pnl < 0).length,
      indices: indices || {}
    },
    holdings,
    universe,
    transactions: txs,
    nav
  };
}
__name(buildPortfolio, "buildPortfolio");
function appendNavPoint(book, prices, indices) {
  const { positions, cash, units } = replayBook(book);
  const initial = book.settings?.initial_capital || 0;
  if (!initial || units <= 0) return book;
  let evalTotal = 0, buyTotal = 0;
  for (const p of positions) {
    const px = prices[p.code] || {};
    evalTotal += Math.round((px.price ?? p.avg_price) * p.qty);
    buyTotal += Math.round(p.avg_price * p.qty);
  }
  const total = cash + evalTotal;
  const now = new Date(Date.now() + 9 * 3600 * 1e3);
  const date = `${now.getUTCFullYear()}.${String(now.getUTCMonth() + 1).padStart(2, "0")}.${String(now.getUTCDate()).padStart(2, "0")}`;
  const nav = book.nav || (book.nav = { indexed: [], value: [], base: {} });
  const base = nav.base || {};
  const kospiRaw = indices?.kospi?.value, kosdaqRaw = indices?.kosdaq?.value;
  const point = {
    date,
    nav: Math.round(total / units * 100) / 100,
    kospi: base.kospi_raw && kospiRaw ? Math.round(kospiRaw / base.kospi_raw * 1e5) / 100 : null,
    kosdaq: base.kosdaq_raw && kosdaqRaw ? Math.round(kosdaqRaw / base.kosdaq_raw * 1e5) / 100 : null
  };
  nav.indexed = (nav.indexed || []).filter((p) => p.date !== date).concat([point]);
  const valPoint = { date, portfolio_value: total, total_value: total, eval_pnl: evalTotal - buyTotal };
  nav.value = [valPoint].concat((nav.value || []).filter((p) => p.date !== date));
  return book;
}
__name(appendNavPoint, "appendNavPoint");

// src/worker.js
var BookStore = class {
  static {
    __name(this, "BookStore");
  }
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }
  async fetch(request) {
    const { op, data } = await request.json();
    if (typeof op === "string" && op.startsWith("ipo")) {
      let ipo = await this.state.storage.get("ipo");
      if (!ipo) {
        const kv = await this.env.KV.get("post_ipo_book");
        ipo = kv ? JSON.parse(kv) : { stocks: [], updated: null };
      }
      const resp = /* @__PURE__ */ __name((o) => new Response(JSON.stringify(o), { headers: { "content-type": "application/json" } }), "resp");
      if (op === "ipoGet") return resp({ ok: true, book: ipo });
      if (op === "ipoReplace") {
        ipo = { ...data, signal: data.signal !== void 0 ? data.signal : ipo.signal };
      } else if (op === "ipoSignal") {
        ipo.signal = data;
      } else if (op === "ipoUpsert") {
        const idx = (ipo.stocks || []).findIndex((s) => s.id === data.id);
        if (idx >= 0) ipo.stocks[idx] = { ...ipo.stocks[idx], ...data, id: ipo.stocks[idx].id };
        else ipo.stocks = (ipo.stocks || []).concat([data]);
      } else if (op === "ipoDelete") {
        const idx = (ipo.stocks || []).findIndex((s) => s.id === data.id);
        if (idx < 0) return resp({ ok: false, error: "\uC885\uBAA9 \uC5C6\uC74C" });
        ipo.stocks.splice(idx, 1);
      } else if (op === "ipoMilestones") {
        for (const u of data.updates || []) {
          const s = (ipo.stocks || []).find((x) => x.id === u.id);
          if (!s) continue;
          s.milestones = s.milestones || {};
          s.milestones[u.key] = { date: u.date, close: u.close };
        }
      } else if (op === "ipoArchive") {
        for (const id of data.ids || []) {
          const s = (ipo.stocks || []).find((x) => x.id === id);
          if (s) s.status = "archived";
        }
      } else {
        return resp({ ok: false, error: "unknown op" });
      }
      ipo.updated = (/* @__PURE__ */ new Date()).toISOString();
      await this.state.storage.put("ipo", ipo);
      await this.env.KV.put("post_ipo_book", JSON.stringify(ipo));
      return resp({ ok: true, book: ipo });
    }
    let book = await this.state.storage.get("book");
    if (!book) {
      const kv = await this.env.KV.get("portfolio_book");
      book = kv ? JSON.parse(kv) : structuredClone(DEFAULT_BOOK);
    }
    if (op === "get") {
      return new Response(JSON.stringify({ ok: true, book }), { headers: { "content-type": "application/json" } });
    }
    if (op === "replace") {
      book = data;
    } else if (op === "addTx") {
      book.transactions = (book.transactions || []).concat([data]);
    } else if (op === "updateTx") {
      const idx = (book.transactions || []).findIndex((t) => t.id === data.id);
      if (idx < 0) {
        return new Response(JSON.stringify({ ok: false, error: "\uAC70\uB798 \uC5C6\uC74C" }), { headers: { "content-type": "application/json" } });
      }
      const keep = book.transactions[idx];
      book.transactions[idx] = { ...keep, ...data.patch, id: keep.id, legacy: keep.legacy };
    } else if (op === "deleteTx") {
      const idx = (book.transactions || []).findIndex((t) => t.id === data.id);
      if (idx < 0) {
        return new Response(JSON.stringify({ ok: false, error: "\uAC70\uB798 \uC5C6\uC74C" }), { headers: { "content-type": "application/json" } });
      }
      book.transactions.splice(idx, 1);
    } else if (op === "setUniverse") {
      book.universe = data;
    } else if (op === "appendNav") {
      appendNavPoint(book, data.prices, data.indices);
    } else {
      return new Response(JSON.stringify({ ok: false, error: "unknown op" }), { headers: { "content-type": "application/json" } });
    }
    await this.state.storage.put("book", book);
    await this.env.KV.put("portfolio_book", JSON.stringify(book));
    return new Response(JSON.stringify({ ok: true, book }), { headers: { "content-type": "application/json" } });
  }
};
async function mutateBook(env, op, data) {
  const stub = env.BOOK.get(env.BOOK.idFromName("book"));
  const r = await stub.fetch("https://book/", { method: "POST", body: JSON.stringify({ op, data }) });
  return r.json();
}
__name(mutateBook, "mutateBook");
var JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};
var DATA_FILES = /* @__PURE__ */ new Set([
  "scan.json",
  "tracking.json",
  "portfolio.json",
  "value.json",
  "value_price.json",
  "portfolio_prices.json",
  "post_ipo.json",
  "briefings.json",
  "weekly_review.json"
]);
var PUSH_FILES = /* @__PURE__ */ new Set([
  "scan.json",
  "tracking.json",
  "value.json",
  "value_price.json",
  "portfolio_prices.json",
  "weekly_review.json"
]);
var DATA_FALLBACK = {
  "scan.json": { scan_time: null, results: [] },
  "tracking.json": { updated: null, holdings: [], exited: [], stats: {} },
  "portfolio.json": { holdings: [], universe: [] },
  "value.json": { stocks: [] },
  "value_price.json": {},
  "post_ipo.json": { stocks: [], quotes: {} },
  "briefings.json": { items: [] },
  "weekly_review.json": { updated: null, reports: [] }
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}
__name(json, "json");
function rawJson(text, fallback) {
  return new Response(text ?? JSON.stringify(fallback ?? {}), { headers: JSON_HEADERS });
}
__name(rawJson, "rawJson");
function authorized(request, env) {
  const auth = request.headers.get("authorization") || "";
  return Boolean(env.ADMIN_TOKEN) && auth === `Bearer ${env.ADMIN_TOKEN}`;
}
__name(authorized, "authorized");
async function loadBook(env) {
  const v = await env.KV.get("portfolio_book");
  return v ? JSON.parse(v) : structuredClone(DEFAULT_BOOK);
}
__name(loadBook, "loadBook");
function validateTx(t) {
  if (!["\uB9E4\uC218", "\uB9E4\uB3C4", "\uC785\uAE08", "\uCD9C\uAE08", "\uBC30\uB2F9"].includes(t.side)) return "side\uB294 \uB9E4\uC218/\uB9E4\uB3C4/\uC785\uAE08/\uCD9C\uAE08/\uBC30\uB2F9";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(t.date || ""))) return "date\uB294 YYYY-MM-DD \uD615\uC2DD\uC774\uC5B4\uC57C \uD569\uB2C8\uB2E4";
  if (t.side === "\uB9E4\uC218" || t.side === "\uB9E4\uB3C4") {
    if (!/^\d{6}$/.test(t.code || "")) return "\uC885\uBAA9\uCF54\uB4DC 6\uC790\uB9AC \uD544\uC694";
    if (!(t.qty > 0) || !(t.unit_price > 0)) return "\uC218\uB7C9/\uB2E8\uAC00\uB294 \uC591\uC218";
  } else if (!(t.amount > 0)) {
    return "\uAE08\uC561\uC740 \uC591\uC218";
  }
  return null;
}
__name(validateTx, "validateTx");
async function loadPrices(env, codes) {
  const prices = {};
  let indices = {};
  let pricesUpdated = null;
  const pp = await env.KV.get("data:portfolio_prices.json");
  if (pp) {
    try {
      const d = JSON.parse(pp);
      Object.assign(prices, d.prices || {});
      indices = d.indices || {};
      pricesUpdated = d.updated || null;
    } catch {
    }
  }
  const missing = (codes || []).filter((c) => !prices[c]);
  if (missing.length) {
    const sv = await env.KV.get("data:scan.json");
    if (sv) {
      try {
        const scan = JSON.parse(sv);
        for (const r of scan.results || []) {
          if (missing.includes(r.ticker) && r.current_price) {
            prices[r.ticker] = { price: r.current_price, change_pct: r.change_pct ?? null };
          }
        }
      } catch {
      }
    }
  }
  return { prices, indices, pricesUpdated };
}
__name(loadPrices, "loadPrices");
async function recomputePortfolio(env, book) {
  const codes = [
    .../* @__PURE__ */ new Set([
      ...(book.opening?.positions || []).map((p) => p.code),
      ...(book.transactions || []).map((t) => t.code).filter(Boolean),
      ...(book.universe || []).map((u) => u.code)
    ])
  ];
  const { prices, indices, pricesUpdated } = await loadPrices(env, codes);
  const doc = buildPortfolio(book, prices, indices, pricesUpdated);
  await env.KV.put("data:portfolio.json", JSON.stringify(doc));
  return doc;
}
__name(recomputePortfolio, "recomputePortfolio");
function fetchT(url, opts = {}, ms = 8e3) {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
}
__name(fetchT, "fetchT");
var GH_RAW = "https://raw.githubusercontent.com/nexusassetfund-boop/nexus-platform/main/docs/data";
var GH_SYNC_FILES = ["scan.json", "tracking.json", "value.json", "value_price.json"];
async function syncFromGitHub(env) {
  try {
    const r = await fetchT(`${GH_RAW}/scan.json`, { headers: { "user-agent": "kangto-worker" } });
    if (!r.ok) return;
    const scan = await r.json();
    const marker = await env.KV.get("gh_sync_marker");
    if (!scan.scan_time || scan.scan_time === marker) return;
    await env.KV.put("data:scan.json", JSON.stringify(scan));
    let allOk = true;
    for (const name of GH_SYNC_FILES.slice(1)) {
      try {
        const fr = await fetchT(`${GH_RAW}/${name}`, { headers: { "user-agent": "kangto-worker" } });
        if (fr.ok) await env.KV.put(`data:${name}`, await fr.text());
        else allOk = false;
      } catch {
        allOk = false;
      }
    }
    if (allOk) await env.KV.put("gh_sync_marker", scan.scan_time);
  } catch {
  }
}
__name(syncFromGitHub, "syncFromGitHub");
async function refreshScanQuotes(env) {
  const sv = await env.KV.get("data:scan.json");
  if (!sv) return;
  let scan;
  try {
    scan = JSON.parse(sv);
  } catch {
    return;
  }
  const results = scan.results || [];
  if (!results.length) return;
  let tracking = null;
  try {
    const tv = await env.KV.get("data:tracking.json");
    if (tv) tracking = JSON.parse(tv);
  } catch {
  }
  const holdTickers = (tracking && tracking.holdings || []).map((h) => h.ticker);
  const tickers = [.../* @__PURE__ */ new Set([
    ...results.filter((r) => r.mtt_pass).map((r) => r.ticker),
    ...holdTickers
  ])].filter((c) => /^\d{6}$/.test(c || ""));
  if (!tickers.length) return;
  const quotes = {};
  for (let i = 0; i < tickers.length; i += 300) {
    const chunk = tickers.slice(i, i + 300);
    try {
      const q = `SERVICE_ITEM:${chunk.join(",")}`;
      const r = await fetchT(`https://polling.finance.naver.com/api/realtime?query=${q}`, {
        headers: { "user-agent": "Mozilla/5.0", "referer": "https://finance.naver.com/" }
      }, 1e4);
      if (!r.ok) continue;
      const j = await r.json();
      for (const area of j.result?.areas || []) {
        for (const d of area.datas || []) {
          if (d.nv) quotes[d.cd] = { price: d.nv, chg: d.cr != null ? _naverSign(d) * Math.abs(d.cr) : null };
        }
      }
    } catch {
    }
  }
  if (!Object.keys(quotes).length) return;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  for (const r of results) {
    const q = quotes[r.ticker];
    if (!q) continue;
    r.current_price = q.price;
    if (q.chg != null) r.change_pct = q.chg;
  }
  scan.quotes_updated = now;
  await env.KV.put("data:scan.json", JSON.stringify(scan));
  const dbg = { quotes: Object.keys(quotes).length, targets: tickers.length, touched: 0, err: null };
  try {
    if (tracking) {
      let touched = 0;
      for (const h of tracking.holdings || []) {
        const q = quotes[h.ticker];
        if (!q || !h.entry_price) continue;
        h.last_price = q.price;
        h.return_pct = Math.round((q.price / h.entry_price - 1) * 1e4) / 100;
        h.total_return_pct = Math.round(((h.realized_pct || 0) + (h.qty_frac ?? 1) * h.return_pct) * 100) / 100;
        touched++;
      }
      dbg.touched = touched;
      if (touched) {
        if (tracking.stats && (tracking.holdings || []).length) {
          tracking.stats.avg_return = Math.round(tracking.holdings.reduce((s, h) => s + (h.total_return_pct ?? h.return_pct ?? 0), 0) / tracking.holdings.length * 100) / 100;
        }
        tracking.quotes_updated = now;
        await env.KV.put("data:tracking.json", JSON.stringify(tracking));
      }
    }
  } catch (e) {
    dbg.err = String(e);
  }
  return dbg;
}
__name(refreshScanQuotes, "refreshScanQuotes");
var IPO_MILESTONE_KEYS = ["d15", "m1", "m3", "m6", "y1"];
function _rollWeekend(d) {
  const wd = d.getUTCDay();
  if (wd === 6) d.setUTCDate(d.getUTCDate() + 2);
  else if (wd === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}
__name(_rollWeekend, "_rollWeekend");
function ipoMilestoneDates(listing) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(listing || "")) return {};
  const addDays = /* @__PURE__ */ __name((n) => {
    const d = /* @__PURE__ */ new Date(listing + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d;
  }, "addDays");
  const addMonths = /* @__PURE__ */ __name((n) => {
    const d = /* @__PURE__ */ new Date(listing + "T00:00:00Z");
    const day = d.getUTCDate();
    d.setUTCMonth(d.getUTCMonth() + n);
    if (d.getUTCDate() < day) d.setUTCDate(0);
    return d;
  }, "addMonths");
  const f = /* @__PURE__ */ __name((d) => _rollWeekend(d).toISOString().slice(0, 10), "f");
  return { d15: f(addDays(15)), m1: f(addMonths(1)), m3: f(addMonths(3)), m6: f(addMonths(6)), y1: f(addMonths(12)) };
}
__name(ipoMilestoneDates, "ipoMilestoneDates");
function kstToday() {
  return new Date(Date.now() + 9 * 3600 * 1e3).toISOString().slice(0, 10);
}
__name(kstToday, "kstToday");
function validateIpoStock(s) {
  if (!String(s.name || "").trim()) return "\uC885\uBAA9\uBA85 \uD544\uC694";
  if (s.code && !/^[0-9A-Z]{6}$/.test(String(s.code).toUpperCase())) return "\uC885\uBAA9\uCF54\uB4DC\uB294 6\uC790\uB9AC(\uC601\uC22B\uC790)";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.listing_date || "")) return "\uC0C1\uC7A5\uC77C\uC740 YYYY-MM-DD \uD615\uC2DD";
  if (!(Number(s.ipo_price) > 0)) return "\uACF5\uBAA8\uAC00\uB294 \uC591\uC218";
  return null;
}
__name(validateIpoStock, "validateIpoStock");
function cleanIpoStock(s) {
  const num = /* @__PURE__ */ __name((v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }, "num");
  const pos = /* @__PURE__ */ __name((v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, "pos");
  return {
    id: String(s.id || crypto.randomUUID()),
    code: s.code ? String(s.code).toUpperCase() : "",
    name: String(s.name || ""),
    kind: s.kind === "SPAC" ? "SPAC" : "\uC77C\uBC18",
    status: s.status === "archived" ? "archived" : "active",
    listing_date: s.listing_date,
    ipo_price: pos(s.ipo_price),
    ipo_price_adj: pos(s.ipo_price_adj),
    // 수정공모가 (액면분할 등 보정 — 수익률 계산 기준)
    last_price: pos(s.last_price),
    // 임포트 시점 최근가 (실시간 시세 없는 이력 종목 폴백)
    last_date: String(s.last_date || ""),
    day1_open: pos(s.day1_open),
    day1_high: pos(s.day1_high),
    day1_close: pos(s.day1_close),
    lockup_ratio: num(s.lockup_ratio),
    float_ratio: num(s.float_ratio),
    shares: pos(s.shares),
    ipo_amount: num(s.ipo_amount),
    expected_mcap: num(s.expected_mcap),
    underwriter: String(s.underwriter || ""),
    compete_rate: String(s.compete_rate || ""),
    grade: num(s.grade),
    sector: String(s.sector || ""),
    target_price: pos(s.target_price),
    target_price2: pos(s.target_price2),
    point: String(s.point || ""),
    risk: String(s.risk || ""),
    milestones: s.milestones && typeof s.milestones === "object" && !Array.isArray(s.milestones) ? s.milestones : {}
  };
}
__name(cleanIpoStock, "cleanIpoStock");
async function recomputeIpo(env, book, quotes = null, quotesUpdated = null) {
  let prevQ = {};
  let prevQU = null;
  const old = await env.KV.get("data:post_ipo.json");
  if (old) {
    try {
      const d = JSON.parse(old);
      prevQ = d.quotes || {};
      prevQU = d.quotes_updated || null;
    } catch {
    }
  }
  const doc = {
    updated: book.updated || null,
    quotes_updated: quotesUpdated || prevQU,
    quotes: quotes || prevQ,
    signal: book.signal || null,
    stocks: book.stocks || []
  };
  await env.KV.put("data:post_ipo.json", JSON.stringify(doc));
  return doc;
}
__name(recomputeIpo, "recomputeIpo");
async function refreshIpoQuotes(env) {
  const v = await env.KV.get("post_ipo_book");
  if (!v) return;
  let book;
  try {
    book = JSON.parse(v);
  } catch {
    return;
  }
  const codes = [...new Set((book.stocks || []).map((s) => s.code).filter((c) => /^[0-9A-Z]{6}$/.test(c || "")))];
  if (!codes.length) return;
  const quotes = {};
  for (let i = 0; i < codes.length; i += 300) {
    const chunk = codes.slice(i, i + 300);
    try {
      const q = `SERVICE_ITEM:${chunk.join(",")}`;
      const r = await fetchT(`https://polling.finance.naver.com/api/realtime?query=${q}`, {
        headers: { "user-agent": "Mozilla/5.0", "referer": "https://finance.naver.com/" }
      }, 1e4);
      if (!r.ok) continue;
      const j = await r.json();
      for (const area of j.result?.areas || []) {
        for (const d of area.datas || []) {
          if (d.nv) {
            quotes[d.cd] = {
              price: d.nv,
              change_pct: d.cr != null ? _naverSign(d) * Math.abs(d.cr) : null,
              low: d.lv || null
              // 당일 저가 — 매수 신호의 장중 터치 판정용
            };
          }
        }
      }
    } catch {
    }
  }
  if (!Object.keys(quotes).length) return;
  await recomputeIpo(env, book, quotes, (/* @__PURE__ */ new Date()).toISOString());
  return quotes;
}
__name(refreshIpoQuotes, "refreshIpoQuotes");
async function snapshotIpoMilestones(env) {
  const r = await mutateBook(env, "ipoGet");
  const book = r.book;
  if (!book || !(book.stocks || []).length) return;
  let quotes = {};
  const old = await env.KV.get("data:post_ipo.json");
  if (old) {
    try {
      quotes = JSON.parse(old).quotes || {};
    } catch {
    }
  }
  const today = kstToday();
  const weekAgo = new Date(Date.now() + 9 * 3600 * 1e3 - 7 * 86400 * 1e3).toISOString().slice(0, 10);
  const updates = [];
  for (const s of book.stocks || []) {
    const price = quotes[s.code]?.price;
    if (!price) continue;
    const dates = ipoMilestoneDates(s.listing_date);
    for (const k of IPO_MILESTONE_KEYS) {
      const due = dates[k];
      if (!due || due > today || due < weekAgo) continue;
      if (s.milestones && s.milestones[k] && s.milestones[k].close) continue;
      updates.push({ id: s.id, key: k, date: today, close: price });
    }
  }
  if (!updates.length) return;
  const r2 = await mutateBook(env, "ipoMilestones", { updates });
  if (r2.ok) await recomputeIpo(env, r2.book);
}
__name(snapshotIpoMilestones, "snapshotIpoMilestones");
async function archiveExpiredIpo(env) {
  const r = await mutateBook(env, "ipoGet");
  const book = r.book;
  if (!book || !(book.stocks || []).length) return;
  const today = kstToday();
  const ids = [];
  for (const s of book.stocks || []) {
    if (s.status === "archived" || !/^\d{4}-\d{2}-\d{2}$/.test(s.listing_date || "")) continue;
    const d = /* @__PURE__ */ new Date(s.listing_date + "T00:00:00Z");
    const day = d.getUTCDate();
    d.setUTCMonth(d.getUTCMonth() + 18);
    if (d.getUTCDate() < day) d.setUTCDate(0);
    if (d.toISOString().slice(0, 10) <= today) ids.push(s.id);
  }
  if (!ids.length) return;
  const r2 = await mutateBook(env, "ipoArchive", { ids });
  if (r2.ok) await recomputeIpo(env, r2.book);
}
__name(archiveExpiredIpo, "archiveExpiredIpo");
async function isTradingDayToday() {
  try {
    const r = await fetchT("https://query1.finance.yahoo.com/v8/finance/chart/%5EKS11?range=5d&interval=1d", {
      headers: { "user-agent": "Mozilla/5.0" }
    });
    if (!r.ok) return true;
    const j = await r.json();
    const ts = j.chart?.result?.[0]?.timestamp;
    if (!ts || !ts.length) return true;
    const lastKst = new Date(ts[ts.length - 1] * 1e3 + 9 * 3600 * 1e3).toISOString().slice(0, 10);
    const todayKst = new Date(Date.now() + 9 * 3600 * 1e3).toISOString().slice(0, 10);
    return lastKst === todayKst;
  } catch {
    return true;
  }
}
__name(isTradingDayToday, "isTradingDayToday");
async function dispatchScan(env) {
  if (!env.GH_TOKEN) return;
  let ok = false, status = 0;
  try {
    const r = await fetchT("https://api.github.com/repos/nexusassetfund-boop/nexus-platform/actions/workflows/scan.yml/dispatches", {
      method: "POST",
      headers: {
        "authorization": `Bearer ${env.GH_TOKEN}`,
        "accept": "application/vnd.github+json",
        "user-agent": "kangto-worker"
      },
      body: JSON.stringify({ ref: "main" })
    });
    status = r.status;
    ok = r.status === 204;
  } catch {
  }
  try {
    await env.KV.put("dispatch_status", JSON.stringify({ at: (/* @__PURE__ */ new Date()).toISOString(), ok, status }));
  } catch {
  }
}
__name(dispatchScan, "dispatchScan");
async function backupBookToKV(env) {
  const book = await env.KV.get("portfolio_book");
  if (!book) return;
  const kst = new Date(Date.now() + 9 * 3600 * 1e3);
  const date = kst.toISOString().slice(0, 10);
  await env.KV.put(`book_backup:${date}`, book);
  try {
    const list = await env.KV.list({ prefix: "book_backup:" });
    const keys = list.keys.map((k) => k.name).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - 30))) {
      await env.KV.delete(k);
    }
  } catch {
  }
}
__name(backupBookToKV, "backupBookToKV");
var WORLD_SYMS = [["kospi", "^KS11"], ["kosdaq", "^KQ11"], ["nasdaq", "^IXIC"], ["sp500", "^GSPC"], ["dow", "^DJI"], ["usdkrw", "KRW=X"]];
function _naverSign(d) {
  return d.rf === "4" || d.rf === "5" ? -1 : d.rf === "3" ? 0 : 1;
}
__name(_naverSign, "_naverSign");
async function refreshQuotes(env) {
  const book = await loadBook(env);
  const { positions } = replayBook(book);
  const codes = [.../* @__PURE__ */ new Set([
    ...positions.map((p) => p.code),
    ...(book.universe || []).map((u) => u.code)
  ])].filter((c) => /^\d{6}$/.test(c || ""));
  let doc = { prices: {}, indices: {} };
  const old = await env.KV.get("data:portfolio_prices.json");
  if (old) {
    try {
      doc = JSON.parse(old);
    } catch {
    }
  }
  doc.prices = doc.prices || {};
  doc.indices = doc.indices || {};
  let fetchedOk = 0;
  try {
    const q = `SERVICE_ITEM:${codes.join(",")}`;
    const r = await fetchT(`https://polling.finance.naver.com/api/realtime?query=${q}`, {
      headers: { "user-agent": "Mozilla/5.0", "referer": "https://finance.naver.com/" }
    });
    if (r.ok) {
      const j = await r.json();
      for (const area of j.result?.areas || []) {
        for (const d of area.datas || []) {
          if (area.name === "SERVICE_ITEM" && d.nv) {
            const p = doc.prices[d.cd] || (doc.prices[d.cd] = {});
            p.price = d.nv;
            fetchedOk++;
            p.change_pct = d.cr != null ? _naverSign(d) * Math.abs(d.cr) : null;
            if (d.hv && d.lv) {
              p.high52 = Math.max(p.high52 || 0, d.hv) || p.high52;
              p.low52 = p.low52 ? Math.min(p.low52, d.lv) : p.low52;
            }
          }
        }
      }
    }
  } catch {
  }
  const noPrice = codes.filter((c) => !doc.prices[c]?.price).slice(0, 5);
  for (const c of noPrice) {
    try {
      const r = await fetchT(`https://m.stock.naver.com/api/stock/${c}/basic`, {
        headers: { "user-agent": "Mozilla/5.0" }
      });
      if (!r.ok) continue;
      const j = await r.json();
      const price = parseInt(String(j.closePrice || "").replace(/[^\d]/g, ""), 10);
      if (!price) continue;
      const sign = j.compareToPreviousPrice?.name === "FALLING" ? -1 : j.compareToPreviousPrice?.name === "RISING" ? 1 : 0;
      const p = doc.prices[c] || (doc.prices[c] = {});
      p.price = price;
      fetchedOk++;
      const fr = parseFloat(j.fluctuationsRatio);
      p.change_pct = Number.isFinite(fr) ? sign === 0 ? fr : sign * Math.abs(fr) : null;
    } catch {
    }
  }
  const staleLimit = Date.now() - 20 * 3600 * 1e3;
  const needMeta = codes.filter((c) => {
    const p = doc.prices[c];
    return !p || p.per == null || p.mktcap == null || p.high52 == null || (p.meta_ts || 0) < staleLimit;
  }).slice(0, 4);
  for (const c of needMeta) {
    try {
      const r = await fetchT(`https://m.stock.naver.com/api/stock/${c}/integration`, {
        headers: { "user-agent": "Mozilla/5.0" }
      });
      if (!r.ok) continue;
      const j = await r.json();
      const info = {};
      for (const t of j.totalInfos || []) info[t.code] = t.value;
      const p = doc.prices[c] || (doc.prices[c] = {});
      const num = /* @__PURE__ */ __name((s) => {
        const n = parseInt(String(s || "").replace(/[^\d]/g, ""), 10);
        return Number.isFinite(n) && n > 0 ? n : null;
      }, "num");
      if (info.per) p.per = info.per;
      if (info.marketValue) p.mktcap = info.marketValue;
      if (num(info.highPriceOf52Weeks)) p.high52 = num(info.highPriceOf52Weeks);
      if (num(info.lowPriceOf52Weeks)) p.low52 = num(info.lowPriceOf52Weeks);
      p.meta_ts = Date.now();
    } catch {
    }
  }
  for (const [key, sym] of WORLD_SYMS) {
    try {
      const r = await fetchT(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=5d&interval=1d`, {
        headers: { "user-agent": "Mozilla/5.0" }
      });
      if (!r.ok) continue;
      const j = await r.json();
      const res = j.chart?.result?.[0];
      if (!res) continue;
      const last = res.meta?.regularMarketPrice;
      const closes = (res.indicators?.quote?.[0]?.close || []).filter((v) => v != null);
      const prev = closes.length >= 2 ? closes[closes.length - 2] : res.meta?.chartPreviousClose;
      if (last) {
        doc.indices[key] = {
          value: Math.round(last * 100) / 100,
          change: prev ? Math.round((last - prev) * 100) / 100 : null
        };
        fetchedOk++;
      }
    } catch {
    }
  }
  if (fetchedOk > 0) doc.updated = (/* @__PURE__ */ new Date()).toISOString();
  doc.source = "worker";
  await env.KV.put("data:portfolio_prices.json", JSON.stringify(doc));
  return recomputePortfolio(env, book);
}
__name(refreshQuotes, "refreshQuotes");
var worker_default = {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const method = request.method;
    const brfGet = pathname.match(/^\/data\/briefing\/([\w.-]+)$/);
    if (brfGet && method === "GET") {
      const v = await env.KV.get(`briefing:${brfGet[1]}`);
      return v ? rawJson(v) : json({ error: "not found" }, 404);
    }
    if (pathname.startsWith("/data/") && method === "GET") {
      const name = pathname.slice("/data/".length);
      if (DATA_FILES.has(name)) {
        const v = await env.KV.get(`data:${name}`);
        return rawJson(v, DATA_FALLBACK[name]);
      }
      return json({ error: "not found" }, 404);
    }
    if (pathname === "/api/config") {
      if (method === "GET") {
        const v = await env.KV.get("config");
        return rawJson(v, { watchlist: [], params: {} });
      }
      if (method === "PUT") {
        if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
        let body;
        try {
          body = await request.json();
        } catch {
          return json({ error: "invalid json" }, 400);
        }
        const watchlist = Array.isArray(body.watchlist) ? [...new Set(body.watchlist.map(String).filter((t) => /^\d{6}$/.test(t)))] : [];
        const params = body.params && typeof body.params === "object" && !Array.isArray(body.params) ? body.params : {};
        const doc = { watchlist, params, updated: (/* @__PURE__ */ new Date()).toISOString() };
        await env.KV.put("config", JSON.stringify(doc));
        return json({ ok: true, config: doc });
      }
      return json({ error: "method not allowed" }, 405);
    }
    if (pathname === "/api/push" && method === "POST") {
      if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "invalid json" }, 400);
      }
      const files = body.files && typeof body.files === "object" ? body.files : {};
      const puts = [];
      const stored = [];
      for (const [name, content] of Object.entries(files)) {
        if (PUSH_FILES.has(name) && content != null) {
          puts.push(env.KV.put(`data:${name}`, JSON.stringify(content)));
          stored.push(name);
        }
      }
      if (!puts.length) return json({ error: "nothing to store" }, 400);
      await Promise.all(puts);
      if (stored.includes("portfolio_prices.json") || stored.includes("scan.json")) {
        try {
          await recomputePortfolio(env, await loadBook(env));
        } catch {
        }
      }
      return json({ ok: true, stored });
    }
    if (pathname === "/api/portfolio/book") {
      if (method === "GET") {
        const r = await mutateBook(env, "get");
        return json(r.book || structuredClone(DEFAULT_BOOK));
      }
      if (method === "PUT") {
        if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
        let body;
        try {
          body = await request.json();
        } catch {
          return json({ error: "invalid json" }, 400);
        }
        const r = await mutateBook(env, "replace", body);
        const doc = await recomputePortfolio(env, r.book);
        return json({ ok: true, kpi: doc.kpi, errors: doc.errors });
      }
      return json({ error: "method not allowed" }, 405);
    }
    if (pathname === "/api/portfolio/tx" && method === "POST") {
      if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
      let t;
      try {
        t = await request.json();
      } catch {
        return json({ error: "invalid json" }, 400);
      }
      const invalid = validateTx(t);
      if (invalid) return json({ error: invalid }, 400);
      const side = t.side;
      const cur = (await mutateBook(env, "get")).book;
      if (side === "\uB9E4\uB3C4") {
        const { positions } = replayBook(cur);
        const h = positions.find((p) => p.code === t.code);
        if (!h || h.qty < t.qty) return json({ error: `\uBCF4\uC720 \uC218\uB7C9 \uBD80\uC871 (\uBCF4\uC720 ${h ? h.qty : 0}\uC8FC)` }, 400);
      }
      let navAt;
      if (side === "\uC785\uAE08" || side === "\uCD9C\uAE08") {
        const doc0 = await recomputePortfolio(env, cur);
        navAt = doc0.kpi.nav_index || 1e3;
      }
      const tx = {
        id: crypto.randomUUID(),
        seq: Date.now(),
        date: t.date,
        side,
        strategy: t.strategy || "",
        code: t.code || "",
        name: String(t.name || ""),
        qty: t.qty ?? null,
        unit_price: t.unit_price ?? null,
        amount: t.amount ?? null,
        fee: t.fee ?? 0,
        tax: t.tax ?? 0,
        memo: String(t.memo || "")
      };
      if (navAt != null) tx.nav_at = navAt;
      const r = await mutateBook(env, "addTx", tx);
      const doc = await recomputePortfolio(env, r.book);
      return json({ ok: true, tx, kpi: doc.kpi, errors: doc.errors });
    }
    const txMatch = pathname.match(/^\/api\/portfolio\/tx\/([\w-]+)$/);
    if (txMatch && (method === "PUT" || method === "DELETE")) {
      if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
      if (method === "DELETE") {
        const r2 = await mutateBook(env, "deleteTx", { id: txMatch[1] });
        if (!r2.ok) return json({ error: r2.error }, 404);
        const doc2 = await recomputePortfolio(env, r2.book);
        return json({ ok: true, kpi: doc2.kpi, errors: doc2.errors });
      }
      let patch;
      try {
        patch = await request.json();
      } catch {
        return json({ error: "invalid json" }, 400);
      }
      const cur = (await mutateBook(env, "get")).book;
      const idx = (cur.transactions || []).findIndex((t) => t.id === txMatch[1]);
      if (idx < 0) return json({ error: "\uAC70\uB798 \uC5C6\uC74C" }, 404);
      const merged = { ...cur.transactions[idx], ...patch, id: cur.transactions[idx].id, legacy: cur.transactions[idx].legacy };
      if (!merged.legacy) {
        const invalid = validateTx(merged);
        if (invalid) return json({ error: invalid }, 400);
        const errsBefore = replayBook(cur).errors.length;
        const preview = { ...cur, transactions: cur.transactions.map((t, i) => i === idx ? merged : t) };
        const errsAfter = replayBook(preview).errors;
        if (errsAfter.length > errsBefore) return json({ error: `\uC218\uC815 \uBD88\uAC00: ${errsAfter[errsAfter.length - 1]}` }, 400);
      }
      const r = await mutateBook(env, "updateTx", { id: txMatch[1], patch });
      if (!r.ok) return json({ error: r.error }, 404);
      const doc = await recomputePortfolio(env, r.book);
      return json({ ok: true, kpi: doc.kpi, errors: doc.errors });
    }
    if (pathname === "/api/briefing" && method === "POST") {
      if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
      let b;
      try {
        b = await request.json();
      } catch {
        return json({ error: "invalid json" }, 400);
      }
      if (!["\uC7A5\uC804", "\uC7A5\uB9C8\uAC10"].includes(b.type)) return json({ error: "type\uC740 \uC7A5\uC804/\uC7A5\uB9C8\uAC10" }, 400);
      if (!String(b.title || "").trim()) return json({ error: "title \uD544\uC694" }, 400);
      if (!Array.isArray(b.sections) || !b.sections.length) return json({ error: "sections \uBC30\uC5F4 \uD544\uC694" }, 400);
      const kst = new Date(Date.now() + 9 * 3600 * 1e3);
      const id = b.id && /^[\w.-]{1,40}$/.test(b.id) ? b.id : `${kst.toISOString().slice(0, 10)}-${b.type === "\uC7A5\uC804" ? "am" : "pm"}`;
      const doc = {
        id,
        type: b.type,
        sentiment: ["\uAE0D\uC815", "\uC911\uB9BD", "\uBD80\uC815"].includes(b.sentiment) ? b.sentiment : "\uC911\uB9BD",
        title: String(b.title).slice(0, 120),
        summary: String(b.summary || "").slice(0, 300),
        date: b.date && /^\d{4}-\d{2}-\d{2}T/.test(b.date) ? b.date : (/* @__PURE__ */ new Date()).toISOString(),
        sections: b.sections.slice(0, 20).map((s) => ({
          heading: String(s && s.heading || "").slice(0, 80),
          body: String(s && s.body || "").slice(0, 8e3)
        }))
      };
      await env.KV.put(`briefing:${id}`, JSON.stringify(doc));
      let idx = { items: [] };
      const old = await env.KV.get("data:briefings.json");
      if (old) {
        try {
          idx = JSON.parse(old);
        } catch {
        }
      }
      const item = { id, type: doc.type, sentiment: doc.sentiment, title: doc.title, summary: doc.summary, date: doc.date };
      idx.items = [item, ...(idx.items || []).filter((x) => x.id !== id)].sort((a, b2) => (b2.date || "").localeCompare(a.date || "")).slice(0, 200);
      idx.updated = (/* @__PURE__ */ new Date()).toISOString();
      await env.KV.put("data:briefings.json", JSON.stringify(idx));
      return json({ ok: true, id });
    }
    if (pathname === "/api/ipo/book") {
      if (method === "GET") {
        const r = await mutateBook(env, "ipoGet");
        return json(r.book || { stocks: [] });
      }
      if (method === "PUT") {
        if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
        let body;
        try {
          body = await request.json();
        } catch {
          return json({ error: "invalid json" }, 400);
        }
        if (!Array.isArray(body.stocks)) return json({ error: "stocks \uBC30\uC5F4 \uD544\uC694" }, 400);
        const cleaned = [];
        for (const s of body.stocks) {
          const err = validateIpoStock(s);
          if (err) return json({ error: `${s && s.name}: ${err}` }, 400);
          cleaned.push(cleanIpoStock(s));
        }
        const r = await mutateBook(env, "ipoReplace", { stocks: cleaned });
        await recomputeIpo(env, r.book);
        return json({ ok: true, count: cleaned.length });
      }
      return json({ error: "method not allowed" }, 405);
    }
    if (pathname === "/api/ipo/signal" && method === "PUT") {
      if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
      let b;
      try {
        b = await request.json();
      } catch {
        return json({ error: "invalid json" }, 400);
      }
      const clamp = /* @__PURE__ */ __name((v, lo, hi, dflt) => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
      }, "clamp");
      const cfg = {
        ref: b.ref === "ipo_price" ? "ipo_price" : "listing_open",
        drop_pct: clamp(b.drop_pct, 0, 100, 20),
        window_months: clamp(b.window_months, 0, 48, 6),
        target_pct: clamp(b.target_pct, 1, 200, 20),
        losscut_pct: clamp(b.losscut_pct, 0, 50, 10),
        hold_months: clamp(b.hold_months, 1, 12, 3)
        // 최대 보유기간 (청산 규칙 — 표시·기록용)
      };
      const r = await mutateBook(env, "ipoSignal", cfg);
      await recomputeIpo(env, r.book);
      return json({ ok: true, signal: cfg });
    }
    if (pathname === "/api/ipo/stock" && method === "POST") {
      if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
      let s;
      try {
        s = await request.json();
      } catch {
        return json({ error: "invalid json" }, 400);
      }
      const err = validateIpoStock(s);
      if (err) return json({ error: err }, 400);
      const stock = cleanIpoStock({ ...s, id: crypto.randomUUID() });
      const r = await mutateBook(env, "ipoUpsert", stock);
      await recomputeIpo(env, r.book);
      await refreshIpoQuotes(env);
      return json({ ok: true, stock });
    }
    const ipoMatch = pathname.match(/^\/api\/ipo\/stock\/([\w-]+)$/);
    if (ipoMatch && (method === "PUT" || method === "DELETE")) {
      if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
      if (method === "DELETE") {
        const r2 = await mutateBook(env, "ipoDelete", { id: ipoMatch[1] });
        if (!r2.ok) return json({ error: r2.error }, 404);
        await recomputeIpo(env, r2.book);
        return json({ ok: true });
      }
      let patch;
      try {
        patch = await request.json();
      } catch {
        return json({ error: "invalid json" }, 400);
      }
      const cur = (await mutateBook(env, "ipoGet")).book;
      const exist = (cur.stocks || []).find((x) => x.id === ipoMatch[1]);
      if (!exist) return json({ error: "\uC885\uBAA9 \uC5C6\uC74C" }, 404);
      const merged = cleanIpoStock({ ...exist, ...patch, id: exist.id });
      const err = validateIpoStock(merged);
      if (err) return json({ error: err }, 400);
      const r = await mutateBook(env, "ipoUpsert", merged);
      await recomputeIpo(env, r.book);
      if (patch.code && patch.code !== exist.code) await refreshIpoQuotes(env);
      return json({ ok: true, stock: merged });
    }
    if (pathname === "/api/kis/token") {
      if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
      if (method === "GET") {
        const v = await env.KV.get("kis_token");
        return v ? rawJson(v) : json({ error: "not found" }, 404);
      }
      if (method === "PUT") {
        let b;
        try {
          b = await request.json();
        } catch {
          return json({ error: "invalid json" }, 400);
        }
        if (!b.access_token || !(Number(b.expires_at) > Date.now() / 1e3)) return json({ error: "access_token/expires_at \uD544\uC694" }, 400);
        await env.KV.put("kis_token", JSON.stringify({ access_token: String(b.access_token), expires_at: Number(b.expires_at) }));
        return json({ ok: true });
      }
      return json({ error: "method not allowed" }, 405);
    }
    if (pathname === "/api/scan/dispatch" && method === "POST") {
      if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
      if (!await isTradingDayToday()) return json({ ok: true, skipped: "\uD734\uC7A5\uC77C" });
      await dispatchScan(env);
      const st = await env.KV.get("dispatch_status");
      return json({ ok: true, dispatch: st ? JSON.parse(st) : null });
    }
    if (pathname === "/api/briefing/dispatch" && method === "POST") {
      if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
      if (!env.GH_TOKEN) return json({ error: "GH_TOKEN \uC5C6\uC74C" }, 500);
      const mode = new URL(request.url).searchParams.get("mode") === "pm" ? "pm" : "am";
      if (mode === "pm") {
        if (!await isTradingDayToday()) return json({ ok: true, skipped: "\uD734\uC7A5\uC77C" });
      } else {
        const dow = new Date(Date.now() + 9 * 3600 * 1e3).getUTCDay();
        if (dow === 0 || dow === 6) return json({ ok: true, skipped: "\uC8FC\uB9D0" });
      }
      let status = 0;
      try {
        const r = await fetchT("https://api.github.com/repos/nexusassetfund-boop/nexus-platform/actions/workflows/briefing.yml/dispatches", {
          method: "POST",
          headers: {
            "authorization": `Bearer ${env.GH_TOKEN}`,
            "accept": "application/vnd.github+json",
            "user-agent": "kangto-worker"
          },
          body: JSON.stringify({ ref: "main", inputs: { mode } })
        });
        status = r.status;
      } catch {
      }
      return json({ ok: status === 204, status, mode }, status === 204 ? 200 : 502);
    }
    if (pathname === "/api/quotes/refresh" && method === "POST") {
      if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
      await syncFromGitHub(env).catch(() => {
      });
      const scanDbg = await refreshScanQuotes(env).catch(() => null);
      const doc = await refreshQuotes(env).catch(() => ({}));
      const ipoQ = await refreshIpoQuotes(env).catch(() => null);
      let closed = false;
      if (new URL(request.url).searchParams.get("close") === "1" && await isTradingDayToday()) {
        await backupBookToKV(env).catch(() => {
        });
        await snapshotIpoMilestones(env).catch(() => {
        });
        await archiveExpiredIpo(env).catch(() => {
        });
        try {
          const book = (await mutateBook(env, "get")).book;
          if (book?.settings?.initial_capital) {
            const codes = [.../* @__PURE__ */ new Set([
              ...(book.opening?.positions || []).map((p) => p.code),
              ...(book.transactions || []).map((t) => t.code).filter(Boolean)
            ])];
            const { prices, indices } = await loadPrices(env, codes);
            const r = await mutateBook(env, "appendNav", { prices, indices });
            await recomputePortfolio(env, r.book);
          }
        } catch {
        }
        closed = true;
      }
      return json({ ok: true, kpi: doc.kpi, scanDbg, ipoQuotes: ipoQ ? Object.keys(ipoQ).length : 0, closed });
    }
    if (pathname === "/api/portfolio/universe" && method === "PUT") {
      if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "invalid json" }, 400);
      }
      if (!Array.isArray(body.universe)) return json({ error: "universe \uBC30\uC5F4 \uD544\uC694" }, 400);
      const cleaned = [];
      for (const u of body.universe) {
        if (!u || !/^\d{6}$/.test(u.code || "")) return json({ error: `\uC798\uBABB\uB41C \uC885\uBAA9\uCF54\uB4DC: ${u && u.code}` }, 400);
        cleaned.push({
          ...u,
          code: u.code,
          name: String(u.name || ""),
          strategy: String(u.strategy || ""),
          sector: String(u.sector || ""),
          subclass: String(u.subclass || ""),
          point: String(u.point || ""),
          risk: String(u.risk || ""),
          target_price: Number(u.target_price) > 0 ? Number(u.target_price) : null
        });
      }
      await mutateBook(env, "setUniverse", cleaned);
      await refreshQuotes(env);
      return json({ ok: true, count: cleaned.length });
    }
    return env.ASSETS.fetch(request);
  },
  // 크론: 장중 10분 주기 시세 갱신 + GitHub 스캔 동기화 + 장마감(15:45 KST) 자산추이 적립·백업
  // + 10:07/12:07/14:07/15:35 KST 감지기 스캔 디스패치
  async scheduled(event, env) {
    if (event.cron === "7 1-6 * * 1-5" || event.cron === "35 6 * * 1-5") {
      if (await isTradingDayToday()) {
        await dispatchScan(env);
      }
      return;
    }
    await syncFromGitHub(env).catch(() => {
    });
    await refreshScanQuotes(env).catch(() => {
    });
    await refreshQuotes(env).catch(() => {
    });
    await refreshIpoQuotes(env).catch(() => {
    });
    if (event.cron === "45 6 * * 1-5") {
      await backupBookToKV(env).catch(() => {
      });
      if (!await isTradingDayToday()) return;
      await snapshotIpoMilestones(env).catch(() => {
      });
      await archiveExpiredIpo(env).catch(() => {
      });
      const book = (await mutateBook(env, "get")).book;
      if (!book?.settings?.initial_capital) return;
      const codes = [
        .../* @__PURE__ */ new Set([
          ...(book.opening?.positions || []).map((p) => p.code),
          ...(book.transactions || []).map((t) => t.code).filter(Boolean)
        ])
      ];
      const { prices, indices } = await loadPrices(env, codes);
      const r = await mutateBook(env, "appendNav", { prices, indices });
      await recomputePortfolio(env, r.book);
    }
  }
};
export {
  BookStore,
  worker_default as default
};
//# sourceMappingURL=worker.js.map