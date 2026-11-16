// Shared helpers for every page

// App names and developers come from outside: always escape before putting into HTML
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// Only allow https links (blocks things like javascript:)
function safeUrl(url) {
  return /^https:\/\//i.test(url || "") ? esc(url) : "#";
}

const LOCALE = "en-GB";
const TZ = "Asia/Bangkok";

function fmtNumber(n) {
  return n == null ? "-" : Number(n).toLocaleString(LOCALE);
}

function fmtDateTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso || "-";
  return d.toLocaleString(LOCALE, { dateStyle: "medium", timeStyle: "short", timeZone: TZ });
}

function fmtDate(iso, withYear = false) {
  const d = new Date(iso);
  if (isNaN(d)) return iso || "-";
  const opts = { day: "numeric", month: "short", timeZone: TZ };
  if (withYear) opts.year = "numeric";
  return d.toLocaleDateString(LOCALE, opts);
}

async function loadJson(path) {
  // no-cache: always revalidate so the page never shows yesterday's data
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json();
}

// Show last update time, warn when data is older than 36 hours (the daily job may have failed)
function setStatus(el, updatedAt, extra) {
  const hours = (Date.now() - new Date(updatedAt).getTime()) / 36e5;
  let html = `${extra ? esc(extra) + " · " : ""}Updated ${esc(fmtDateTime(updatedAt))}`;
  if (hours > 36) {
    html += ` <span class="badge warn">Data is ${Math.floor(hours / 24)} days old, the update may have failed</span>`;
  }
  el.innerHTML = html;
}

function showError(el, err) {
  el.textContent = "Could not load data: " + (err && err.message ? err.message : err);
  el.classList.add("error");
}

// ---------- Watchlist: saved in this browser only (localStorage) ----------
const WATCH_KEY = "td-watchlist";
const watchSeen = {};  // apps rendered on this page, so a click on a star knows what to save

const watchlist = {
  all() {
    try { return JSON.parse(localStorage.getItem(WATCH_KEY)) || {}; } catch { return {}; }
  },
  save(items) {
    try { localStorage.setItem(WATCH_KEY, JSON.stringify(items)); return true; } catch { return false; }
  },
  has(id) { return Boolean(this.all()[id]); },
  toggle(id) {
    const items = this.all();
    if (items[id]) delete items[id];
    else if (watchSeen[id]) items[id] = { ...watchSeen[id], added: new Date().toISOString().slice(0, 10), note: "" };
    else return false;
    this.save(items);
    return Boolean(items[id]);
  }
};

function starButton(app, store) {
  const id = String(app.id);
  watchSeen[id] = {
    id, store, name: app.name, developer: app.developer, url: app.url, icon: app.icon, genre: app.genre || ""
  };
  const on = watchlist.has(id);
  return `<button type="button" class="star${on ? " on" : ""}" data-watch="${esc(id)}" aria-pressed="${on}"
    title="${on ? "Remove from watchlist" : "Save to watchlist"}">${on ? "★" : "☆"}</button>`;
}

document.addEventListener("click", e => {
  const btn = e.target.closest("button[data-watch]");
  if (!btn) return;
  const on = watchlist.toggle(btn.dataset.watch);
  btn.classList.toggle("on", on);
  btn.setAttribute("aria-pressed", String(on));
  btn.title = on ? "Remove from watchlist" : "Save to watchlist";
  btn.textContent = on ? "★" : "☆";
  document.dispatchEvent(new CustomEvent("watchlist-change"));
});

// store: "ios" (App Store) or "play" (Google Play). Pass star: false to leave the star out.
function appCell(app, { details = false, store = "ios", star = true } = {}) {
  const icon = app.icon
    ? `<img class="icon" src="${safeUrl(app.icon)}" alt="" loading="lazy" width="40" height="40">`
    : `<span class="icon"></span>`;
  const more = details
    ? `<button type="button" class="more" aria-expanded="false" title="Show details">Details</button>`
    : "";
  return `
    <div class="app">
      ${icon}
      <div class="app-text">
        <a href="${safeUrl(app.url)}" target="_blank" rel="noopener">${esc(app.name)}</a>
        <small>${esc(app.developer)}</small>
      </div>
      ${more}
      ${star ? starButton(app, store) : ""}
    </div>`;
}

function themeBadges(themes) {
  return (themes || []).map(t => `<span class="badge theme">${esc(t)}</span>`).join(" ");
}

// 1234567 -> "1.2M" (install counts are too long to read otherwise)
function fmtCompact(n) {
  if (n == null) return "-";
  return Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

function fillSelect(select, values) {
  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = v.key ?? v;
    opt.textContent = v.name ?? v;
    select.appendChild(opt);
  }
}

// Expand/collapse the details row that follows a row (event delegation on the tbody)
function enableDetails(tbody) {
  tbody.addEventListener("click", e => {
    const btn = e.target.closest("button.more");
    if (!btn) return;
    const row = btn.closest("tr").nextElementSibling;
    if (!row || !row.classList.contains("details")) return;
    row.hidden = !row.hidden;
    btn.setAttribute("aria-expanded", String(!row.hidden));
    btn.textContent = row.hidden ? "Details" : "Hide";
  });
}

// Small inline SVG line chart. invert=true for ranks (lower is better = higher on the chart)
function sparkline(values, { invert = false, width = 72, height = 22, title = "" } = {}) {
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => v != null);
  if (pts.length < 2) return `<span class="muted spark-empty" title="Not enough history yet">·</span>`;
  const ys = pts.map(([, v]) => v);
  let min = Math.min(...ys), max = Math.max(...ys);
  if (min === max) { min -= 1; max += 1; }
  const x = i => (i / (values.length - 1)) * (width - 4) + 2;
  const y = v => {
    const t = (v - min) / (max - min);
    return (invert ? t : 1 - t) * (height - 4) + 2;
  };
  // Break the line where a value is missing (e.g. app dropped out of the chart)
  let d = "", prev = -2;
  for (const [i, v] of pts) {
    d += `${i === prev + 1 ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    prev = i;
  }
  const [li, lv] = pts[pts.length - 1];
  return `<svg class="spark" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">
    <title>${esc(title)}</title>
    <path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
    <circle cx="${x(li).toFixed(1)}" cy="${y(lv).toFixed(1)}" r="2" fill="currentColor"/>
  </svg>`;
}

// Download rows as a CSV file (opens fine in Excel / Google Sheets)
function downloadCsv(filename, columns, rows) {
  const cell = v => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map(c => cell(c.label)).join(",")];
  for (const r of rows) lines.push(columns.map(c => cell(c.value(r))).join(","));
  // BOM so Excel reads UTF-8 (Thai/Japanese names) correctly
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Keep filters in the URL so a filtered view can be bookmarked or shared
function readParams(controls) {
  const params = new URLSearchParams(location.search);
  for (const [name, el] of Object.entries(controls)) {
    if (!params.has(name)) continue;
    const v = params.get(name);
    if (el.type === "checkbox") el.checked = v === "1";
    else if (el.tagName === "SELECT" && ![...el.options].some(o => o.value === v)) continue;
    else el.value = v;
  }
}

function writeParams(controls, defaults) {
  const params = new URLSearchParams();
  for (const [name, el] of Object.entries(controls)) {
    const v = el.type === "checkbox" ? (el.checked ? "1" : "0") : el.value;
    if (v !== defaults[name]) params.set(name, v);
  }
  const qs = params.toString();
  history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
}

function currentValues(controls) {
  const out = {};
  for (const [name, el] of Object.entries(controls)) {
    out[name] = el.type === "checkbox" ? (el.checked ? "1" : "0") : el.value;
  }
  return out;
}

// Highlight the current page in the nav
document.querySelectorAll("nav a").forEach(a => {
  const here = location.pathname.split("/").pop() || "index.html";
  if (a.getAttribute("href") === here) a.setAttribute("aria-current", "page");
});
