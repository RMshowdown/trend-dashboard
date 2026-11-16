// เติมรีวิวดาวต่ำให้แอปในหน้า Opportunities โดยอ่านจาก Google Play
//
// feed รีวิวของ Apple มักส่งกลับมาว่างเปล่า จึงหาแอปเดียวกันบน Google Play แล้วอ่านรีวิวจากที่นั่นแทน
// (ผู้ใช้ไทยส่วนใหญ่ใช้ Android อยู่แล้ว เสียงบ่นจึงใกล้เคียงกัน)
// ไม่ได้ใช้ AI: แค่คัดรีวิว 1-3 ดาว และนับคำที่บอกว่าบ่นเรื่องอะไร (config/pains.json)
// ต้องรันหลัง fetch_opportunities.py
import path from "node:path";
import gplay from "google-play-scraper";
import {
  DATA, ROOT, loadJson, loadPains, nameKey, retry, shortText, sleep, today, warn, writeJson
} from "./play_common.mjs";

const FILE = path.join(DATA, "opportunities.json");
const DEFAULTS = { review_apps: 50, review_samples: 6, review_refresh_days: 3, review_fetch: 150 };

// รีวิวที่ผู้เขียนใส่ชื่อจริง เบอร์โทร หรือเลขบัญชีของตัวเองไว้ ไม่เอามาแสดงต่อ (กฎเดียวกับ fetch_opportunities.py)
const PERSONAL = /[0-9][0-9 -]{8,}|@|น[.]ส[.]|นางสาว|ข้าพเจ้า|(นาย|นาง) ?[ก-ฮ]/;

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 864e5);
}

const devKey = s => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")
  .replace(/(co|ltd|inc|llc|pte|limited|company|corp|corporation|public|pcl|plc)+$/g, "");

// หาแอปเดียวกันบน Google Play: ชื่อย่อต้องตรงกัน และถ้าเจอหลายตัวให้เลือกตัวที่ผู้พัฒนาตรงด้วย
async function findOnPlay(app, playByKey, country) {
  const key = nameKey(app.name);
  if (key.length < 2) return null;
  if (playByKey[key]) return playByKey[key];
  const results = await retry(() => gplay.search({ term: app.name, num: 8, country, lang: "en" }), 2);
  const same = results.filter(r => nameKey(r.title) === key);
  if (!same.length) return null;
  const dev = devKey(app.developer);
  const byDev = same.find(r => {
    const d = devKey(r.developer);
    return d && dev && (d.includes(dev) || dev.includes(d));
  });
  // ชื่อสั้น ๆ ซ้ำกันได้ง่าย ถ้าผู้พัฒนาไม่ตรงก็ไม่เดา
  if (!byDev && key.length < 6) return null;
  const hit = byDev || same[0];
  return { id: hit.appId, url: hit.url };
}

async function fetchReviews(appId, country, lang, num) {
  const res = await retry(() => gplay.reviews({ appId, country, lang, sort: gplay.sort.NEWEST, num }), 2);
  return (res.data || []).map(r => ({
    rating: r.score,
    title: "",
    text: String(r.text || "").split(/\s+/).join(" ").trim(),
    date: r.date ? new Date(r.date).toISOString().slice(0, 10) : ""
  }));
}

async function main() {
  const config = loadJson(path.join(ROOT, "config", "app_charts.json"), {});
  const cfg = { ...DEFAULTS, ...(config.opportunities || {}) };
  const data = loadJson(FILE);
  if (!data || !Array.isArray(data.apps)) {
    console.error("data/opportunities.json missing, run fetch_opportunities.py first");
    process.exit(1);
  }
  const day = today();
  const pains = loadPains();

  const play = loadJson(path.join(DATA, "play.json"), {}) || {};
  const playByKey = {};
  for (const [id, a] of Object.entries(play.apps || {})) {
    playByKey[nameKey(a.name)] ||= { id, url: a.url };
  }

  let fetched = 0, kept = 0, missing = 0, failed = 0;
  for (const app of data.apps.slice(0, cfg.review_apps)) {
    const have = app.reviews;
    if (have && have.source === "App Store") { kept++; continue; }
    if (have && have.fetched && daysBetween(have.fetched, day) < cfg.review_refresh_days) { kept++; continue; }

    // แอปที่ยังไม่มีในไทย อ่านรีวิวภาษาอังกฤษจากสหรัฐฯ แทน
    const abroad = app.kind === "import" && app.available_home === false;
    const country = abroad ? "us" : data.country;
    const lang = abroad ? "en" : "th";
    try {
      const match = await findOnPlay(app, abroad ? {} : playByKey, country);
      if (!match) { missing++; app.reviews = have || null; continue; }
      let reviews = await fetchReviews(match.id, country, lang, cfg.review_fetch);
      // แอปที่รีวิวภาษาไทยน้อย เติมด้วยรีวิวภาษาอังกฤษ
      if (!abroad && reviews.length < 20) {
        await sleep(400);
        reviews = reviews.concat(await fetchReviews(match.id, country, "en", cfg.review_fetch));
      }
      if (!reviews.length) { missing++; app.reviews = have || null; continue; }

      const low = reviews.filter(r => r.rating <= 3 && r.text && !PERSONAL.test(r.text));
      const tags = pains
        .map(p => ({ tag: p.name, count: low.filter(r => { p.pattern.lastIndex = 0; return p.pattern.test(r.text.toLowerCase()); }).length }))
        .filter(p => p.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
      // รีวิวยาวมักบอกปัญหาชัดกว่า เอารีวิวที่มีเนื้อหามาก่อน แล้วเรียงใหม่ตามวันที่
      const picks = [...low]
        .sort((a, b) => Math.min(b.text.length, 400) - Math.min(a.text.length, 400))
        .slice(0, cfg.review_samples)
        .sort((a, b) => b.date.localeCompare(a.date))
        .map(r => ({ ...r, text: shortText(r.text, 260) }));

      app.reviews = {
        source: "Google Play", country, fetched: day, url: match.url,
        sample: reviews.length, low: low.length, pains: tags, items: picks
      };
      fetched++;
    } catch (e) {
      failed++;
      warn(`Google Play reviews for ${app.name} failed (${e.message})`);
      app.reviews = have || null;
    }
    await sleep(600);
  }

  writeJson(FILE, data);
  console.log(`reviews: ${fetched} fetched from Google Play, ${kept} kept, ${missing} not found on Google Play, ${failed} failed`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
