// ดึงชาร์ต Google Play ของไทย พร้อมจำนวนติดตั้ง แล้วเก็บประวัติรายวัน
//
// Google Play ไม่มี API ทางการ สคริปต์นี้อ่านจากหน้าเว็บผ่านไลบรารี google-play-scraper
// ถ้า Google เปลี่ยนหน้าเว็บ ขั้นนี้อาจล้มได้ จึงเป็นขั้นเสริมที่ไม่ทำให้ข้อมูล App Store เสีย
//
// จุดเด่นเทียบกับ App Store: Google Play บอกจำนวนติดตั้ง จึงเห็นการเติบโตจริง ไม่ต้องเดาจากรีวิว
import path from "node:path";
import gplay from "google-play-scraper";
import {
  DATA, ROOT, loadJson, loadThemes, nameKey, pool, retry, shortText, sleep, tagThemes, today, warn, writeJson
} from "./play_common.mjs";

const OUTPUT = path.join(DATA, "play.json");
const HISTORY_DIR = path.join(DATA, "play_history");

const DEFAULTS = {
  country: "th",
  lang: "en",
  limit: 100,
  history_days: 30,
  keep_days: 7,          // แอปที่หลุดชาร์ต เก็บข้อมูลไว้อีกกี่วัน (เผื่อกลับมา)
  detail_budget: 900,    // จำนวนแอปสูงสุดต่อรอบที่ขอรายละเอียด (จำนวนติดตั้ง วันปล่อย)
  detail_refresh_days: 3,
  charts: [
    { key: "topfree", collection: "TOP_FREE", name: "Top Free" },
    { key: "topgrossing", collection: "GROSSING", name: "Top Grossing" },
    { key: "toppaid", collection: "TOP_PAID", name: "Top Paid" }
  ],
  categories: [
    { key: "all", id: null, name: "All" },
    { key: "apps", id: "APPLICATION", name: "Apps (no games)" },
    { key: "games", id: "GAME", name: "Games" },
    { key: "finance", id: "FINANCE", name: "Finance" },
    { key: "tools", id: "TOOLS", name: "Tools" },
    { key: "productivity", id: "PRODUCTIVITY", name: "Productivity" },
    { key: "social", id: "SOCIAL", name: "Social" },
    { key: "health", id: "HEALTH_AND_FITNESS", name: "Health & Fitness" },
    { key: "education", id: "EDUCATION", name: "Education" },
    { key: "lifestyle", id: "LIFESTYLE", name: "Lifestyle" },
    { key: "photography", id: "PHOTOGRAPHY", name: "Photography" },
    { key: "entertainment", id: "ENTERTAINMENT", name: "Entertainment" },
    { key: "shopping", id: "SHOPPING", name: "Shopping" }
  ]
};

const historyPath = (chart, cat) => path.join(HISTORY_DIR, `${chart}-${cat}.json`);

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 864e5);
}

// "Sep 14, 2015" -> "2015-09-14"
function isoDate(value) {
  if (!value) return null;
  const d = new Date(typeof value === "number" ? value : `${value} UTC`);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

async function main() {
  const config = loadJson(path.join(ROOT, "config", "app_charts.json"), {});
  const cfg = { ...DEFAULTS, ...(config.play || {}) };
  const day = today();
  const themes = loadThemes();

  let old = loadJson(OUTPUT, {}) || {};
  if (old.country !== cfg.country) old = {};
  const oldApps = old.apps || {};

  // ---------- ชาร์ต ----------
  const snapshots = {};
  const compared = {};
  const stale = [];
  const listed = {};       // ข้อมูลพื้นฐานจากหน้าชาร์ต
  const priority = new Set(); // แอปในชาร์ตรวม ขอรายละเอียดทุกวันเพื่อดูการเติบโต
  let ok = 0;

  for (const chart of cfg.charts) {
    snapshots[chart.key] = {};
    compared[chart.key] = {};
    for (const cat of cfg.categories) {
      let apps;
      try {
        apps = await retry(() => gplay.list({
          collection: gplay.collection[chart.collection],
          ...(cat.id ? { category: gplay.category[cat.id] } : {}),
          country: cfg.country, lang: cfg.lang, num: cfg.limit
        }));
        if (!apps.length) throw new Error("empty chart");
      } catch (e) {
        // บางหมวดไม่มีแอปเสียเงินเลย (เช่น Social) ไลบรารีจะโยน error แบบนี้ออกมา ถือว่าเป็นชาร์ตว่าง
        if (/fantasy-land/.test(String(e && e.message))) {
          snapshots[chart.key][cat.key] = [];
          compared[chart.key][cat.key] = null;
          continue;
        }
        // หมวดเดียวล้มไม่ควรทำให้ทั้งรอบเสีย ใช้ข้อมูลเดิมของหมวดนั้นไปก่อน
        warn(`Google Play ${chart.name} / ${cat.name}: fetch failed (${e.message}), keeping previous data`);
        stale.push(`${chart.key}/${cat.key}`);
        snapshots[chart.key][cat.key] = ((old.snapshots || {})[chart.key] || {})[cat.key] || [];
        compared[chart.key][cat.key] = ((old.compared || {})[chart.key] || {})[cat.key] || null;
        continue;
      }

      let history = loadJson(historyPath(chart.key, cat.key), {}) || {};
      if (history.country !== cfg.country) history = { country: cfg.country, days: {} };
      const earlier = Object.keys(history.days).filter(d => d < day).sort();
      const prevDay = earlier[earlier.length - 1];
      const prev = {};
      if (prevDay) history.days[prevDay].forEach((id, i) => { if (id) prev[id] = i + 1; });

      snapshots[chart.key][cat.key] = apps.map((a, i) => {
        listed[a.appId] ||= a;
        if (cat.key === "all") priority.add(a.appId);
        return { id: a.appId, rank: i + 1, prev_rank: prev[a.appId] ?? null };
      });
      compared[chart.key][cat.key] = prevDay || null;

      history.days[day] = apps.map(a => a.appId);
      history.days = Object.fromEntries(Object.entries(history.days).sort().slice(-cfg.history_days));
      writeJson(historyPath(chart.key, cat.key), history);
      ok++;
      await sleep(700);
    }
    console.log(`${chart.name}: ${Object.keys(snapshots[chart.key]).length} categories`);
  }
  if (!ok) {
    console.error("all Google Play charts failed, nothing written");
    process.exit(1);
  }

  // ---------- รายละเอียดแอป (จำนวนติดตั้ง วันปล่อย) ----------
  const ids = Object.keys(listed);
  const age = id => oldApps[id]?.checked ? daysBetween(oldApps[id].checked, day) : Infinity;
  const queue = ids
    .filter(id => age(id) > 0 && (priority.has(id) || age(id) >= cfg.detail_refresh_days))
    // แอปที่ยังไม่เคยดู มาก่อน ตามด้วยแอปในชาร์ตรวม แล้วค่อยเป็นแอปที่ข้อมูลเก่าสุด
    .sort((a, b) =>
      (age(b) === Infinity) - (age(a) === Infinity) || priority.has(b) - priority.has(a) || age(b) - age(a))
    .slice(0, cfg.detail_budget);

  const details = {};
  let failed = 0;
  await pool(queue, 4, async id => {
    try {
      details[id] = await retry(() => gplay.app({ appId: id, country: cfg.country, lang: cfg.lang }), 2, 3000);
    } catch (e) {
      failed++;
    }
    await sleep(150);
  });
  console.log(`details: fetched ${Object.keys(details).length}/${queue.length} (${failed} failed), ` +
    `${ids.length - queue.length} not requested this run (already fresh, or over the daily budget)`);
  if (queue.length && failed === queue.length) warn("Google Play: every app detail request failed");

  // ---------- จับคู่กับแอปที่ติดชาร์ต App Store ไทย ----------
  const ios = loadJson(path.join(DATA, "apps.json"), {}) || {};
  const iosKeys = new Set();
  for (const byGenre of Object.values(ios.snapshots || {})) {
    for (const apps of Object.values(byGenre)) {
      for (const a of apps) iosKeys.add(nameKey(a.name));
    }
  }

  const apps = {};
  for (const id of new Set([...ids, ...Object.keys(oldApps)])) {
    const base = listed[id];
    const before = oldApps[id] || {};
    if (!base && (!before.last_seen || daysBetween(before.last_seen, day) > cfg.keep_days)) continue;
    const d = details[id];
    const rec = { ...before };
    if (base) {
      Object.assign(rec, {
        name: base.title, developer: base.developer, icon: base.icon, url: base.url,
        free: base.free !== false, rating: base.score ? Math.round(base.score * 100) / 100 : rec.rating ?? null,
        last_seen: day
      });
      rec.summary ||= shortText(base.summary, 200);
    }
    if (d) {
      const hist = d.histogram || {};
      const total = Object.values(hist).reduce((s, n) => s + (n || 0), 0);
      Object.assign(rec, {
        name: d.title, developer: d.developer, icon: d.icon, url: d.url,
        genre: d.genre || null,
        summary: shortText(d.summary, 200),
        themes: tagThemes(themes, d.title, `${d.summary || ""} ${d.description || ""}`, String(d.genreId || "").startsWith("GAME")),
        game: String(d.genreId || "").startsWith("GAME"),
        rating: d.score ? Math.round(d.score * 100) / 100 : null,
        ratings: d.ratings ?? null,
        low_share: total ? Math.round(((hist[1] || 0) + (hist[2] || 0)) / total * 1000) / 1000 : null,
        installs: d.maxInstalls ?? d.minInstalls ?? null,
        installs_text: d.installs || null,
        released: isoDate(d.released),
        updated: isoDate(d.updated),
        free: d.free !== false,
        price: d.free === false ? d.priceText || null : null,
        iap: Boolean(d.offersIAP),
        ads: Boolean(d.adSupported),
        checked: day
      });
      if (rec.installs != null) {
        const history = { ...(rec.history || {}), [day]: rec.installs };
        rec.history = Object.fromEntries(Object.entries(history).sort().slice(-cfg.history_days));
      }
    }

    // การเติบโตของจำนวนติดตั้ง เทียบกับครั้งก่อนที่มีข้อมูล
    const dates = Object.keys(rec.history || {}).sort();
    rec.installs_per_day = null;
    rec.installs_7d = null;
    if (dates.length > 1) {
      const last = dates[dates.length - 1];
      const prevDate = dates[dates.length - 2];
      rec.installs_per_day = Math.round((rec.history[last] - rec.history[prevDate]) / Math.max(1, daysBetween(prevDate, last)));
      const weekAgo = new Date(new Date(last) - 7 * 864e5).toISOString().slice(0, 10);
      const inWeek = dates.filter(x => x >= weekAgo && x < last);
      if (inWeek.length) rec.installs_7d = rec.history[last] - rec.history[inWeek[0]];
    }
    rec.on_ios = iosKeys.has(nameKey(rec.name));
    apps[id] = rec;
  }

  writeJson(OUTPUT, {
    updated_at: new Date().toISOString().slice(0, 19) + "+00:00",
    country: cfg.country,
    charts: cfg.charts.map(c => ({ key: c.key, name: c.name })),
    categories: cfg.categories.map(c => ({ key: c.key, name: c.name })),
    compared,
    stale,
    snapshots,
    apps
  });
  const withInstalls = Object.values(apps).filter(a => a.installs != null).length;
  console.log(`wrote ${ok} charts, ${Object.keys(apps).length} apps (${withInstalls} with install counts) to ${OUTPUT}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
