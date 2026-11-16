// ฟังก์ชันที่สคริปต์ฝั่ง Google Play ใช้ร่วมกัน
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA = path.join(ROOT, "data");

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function warn(message) {
  console.log(`${process.env.GITHUB_ACTIONS ? "::warning::" : "WARNING: "}${message}`);
}

export function loadJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

// เขียนลงไฟล์ชั่วคราวก่อนแล้วค่อยสลับ ไฟล์เดิมจึงไม่พังถ้าสคริปต์ล้มกลางทาง
export function writeJson(file, data, pretty = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, pretty ? 2 : undefined) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

export const today = () => new Date().toISOString().slice(0, 10);

// ลองใหม่เมื่อ Google ตอบช้าหรือจำกัดอัตรา
export async function retry(fn, tries = 3, wait = 4000) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      // 404 = ไม่มีแอปนี้ ลองใหม่ก็ไม่ช่วย
      if (/404|not found/i.test(String(e && e.message))) break;
      if (i < tries - 1) await sleep(wait * (i + 1));
    }
  }
  throw last;
}

// ทำงานหลายชิ้นพร้อมกันแบบจำกัดจำนวน
export async function pool(items, size, worker) {
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  }));
}

// ชื่อแอปแบบย่อ ใช้จับคู่แอปเดียวกันระหว่าง App Store กับ Google Play
// "Shopee TH: ซื้อของออนไลน์" กับ "Shopee TH - Online Shopping" ได้ค่าเดียวกันคือ "shopeeth"
export function nameKey(name) {
  const head = String(name || "").split(/\s[-–—|]\s|[:：|]/)[0];
  return head.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// คำอังกฤษจับทั้งคำ คำไทยจับแบบส่วนหนึ่งของข้อความ (กฎเดียวกับ common.py)
function keywordPattern(words) {
  const parts = words.map(w => {
    const k = w.toLowerCase();
    return /^[\x00-\x7f]+$/.test(k) ? `\\b${escapeRe(k)}\\b` : escapeRe(k);
  });
  return new RegExp(parts.join("|"), "g");
}

export function loadThemes() {
  const themes = (loadJson(path.join(ROOT, "config", "themes.json"), {}) || {}).themes || [];
  return themes.map(t => ({ name: t.name, pattern: keywordPattern(t.keywords) }));
}

// เกมใช้เฉพาะธีมที่ขึ้นต้นด้วย "Game:" (กฎเดียวกับ common.py)
export function tagThemes(themes, name, description, game = false, limit = 3) {
  const n = String(name || "").toLowerCase();
  const d = String(description || "").toLowerCase();
  const scored = [];
  themes.forEach((t, order) => {
    if (t.name.startsWith("Game:") !== game) return;
    const score = 3 * (n.match(t.pattern) || []).length + Math.min(3, (d.match(t.pattern) || []).length);
    if (score >= 2) scored.push({ score, order, name: t.name });
  });
  return scored.sort((a, b) => b.score - a.score || a.order - b.order).slice(0, limit).map(t => t.name);
}

export function loadPains() {
  const pains = (loadJson(path.join(ROOT, "config", "pains.json"), {}) || {}).pains || [];
  return pains.map(p => ({ name: p.name, pattern: keywordPattern(p.keywords) }));
}

export function shortText(text, limit = 260) {
  const t = String(text || "").split(/\s+/).join(" ").trim();
  return t.length <= limit ? t : t.slice(0, limit).replace(/[ ,.;:-]+$/, "") + "…";
}
