"""ฟังก์ชันที่สคริปต์ดึงข้อมูลใช้ร่วมกัน"""
import json
import os
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
HEADERS = {"User-Agent": "Mozilla/5.0 trend-dashboard"}


def warn(message):
    """พิมพ์คำเตือน ถ้ารันใน GitHub Actions จะขึ้นเป็น annotation ในหน้าสรุป"""
    prefix = "::warning::" if os.environ.get("GITHUB_ACTIONS") else "WARNING: "
    print(f"{prefix}{message}", flush=True)


def get_json(url, retries=3, backoff=3):
    """ดึง JSON พร้อมลองใหม่เมื่อเครือข่ายสะดุดหรือโดนจำกัดอัตรา"""
    last_error = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=30) as res:
                return json.loads(res.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            last_error = e
            # 4xx ที่ไม่ใช่ rate limit ลองใหม่ก็ไม่ช่วย
            if e.code < 500 and e.code not in (403, 429):
                break
        except (urllib.error.URLError, TimeoutError, ConnectionError, json.JSONDecodeError) as e:
            last_error = e
        if attempt < retries - 1:
            time.sleep(backoff * (attempt + 1))
    raise RuntimeError(f"request failed: {url} ({last_error})")


def load_json(path, default=None):
    """อ่านไฟล์ JSON ถ้าไม่มีไฟล์หรือไฟล์เสียให้คืนค่า default"""
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def write_json(path, data, indent=2, compact_lists=False):
    """เขียนลงไฟล์ชั่วคราวก่อนแล้วค่อยสลับ ไฟล์เดิมจึงไม่พังถ้าสคริปต์ล้มกลางทาง

    compact_lists=True จะเขียน list ของค่าธรรมดาไว้บรรทัดเดียว ไฟล์เล็กลงและ diff อ่านง่าย
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if indent is None:
        text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    else:
        text = json.dumps(data, ensure_ascii=False, indent=indent)
    if compact_lists:
        text = re.sub(
            r"\[\s+([^\[\]{}]*?)\s+\]",
            lambda m: "[" + re.sub(r",\s+", ",", m.group(1)) + "]",
            text,
        )
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text + "\n", encoding="utf-8")
    tmp.replace(path)


def utc_now():
    return datetime.now(timezone.utc)


def parse_date(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def genre_key(genre_id):
    return "all" if genre_id is None else str(genre_id)


def short_text(text, limit=280):
    """ย่อคำอธิบายแอป ตัดที่ช่องว่างถ้าทำได้ (ภาษาไทยมักไม่มีช่องว่าง จึงตัดตรง ๆ แทน)"""
    text = " ".join((text or "").split())
    if len(text) <= limit:
        return text
    cut = text[:limit]
    space = cut.rfind(" ")
    if space > limit * 0.6:
        cut = cut[:space]
    return cut.rstrip(" ,.;:-") + "…"


def fetch_chart(country, feed, limit, genre_id=None):
    """ดึงชาร์ตจาก App Store RSS คืนรายการแอปเรียงตามอันดับ"""
    url = f"https://itunes.apple.com/{country}/rss/{feed}/limit={limit}"
    if genre_id is not None:
        url += f"/genre={genre_id}"
    url += "/json"

    entries = get_json(url).get("feed", {}).get("entry", [])
    # ถ้ามีรายการเดียว Apple จะส่งเป็น object แทน array
    if isinstance(entries, dict):
        entries = [entries]

    apps = []
    for rank, e in enumerate(entries, start=1):
        images = e.get("im:image") or []
        apps.append({
            "rank": rank,
            "id": e["id"]["attributes"]["im:id"],
            "name": e["im:name"]["label"].strip(),
            "developer": e["im:artist"]["label"],
            "genre": e["category"]["attributes"]["label"],
            "url": e["id"]["label"],
            "icon": images[-1]["label"] if images else None,
        })
    return apps


CACHE = ROOT / ".cache"
CACHE_HOURS = 6


def lookup(country, ids, chunk=150, lang="en_us"):
    """ดึงรายละเอียดแอป (วันปล่อย รีวิว คำอธิบาย) จาก iTunes Lookup API

    แอปที่ไม่มีขายในประเทศนั้นจะไม่อยู่ในผลลัพธ์ จึงใช้เช็กได้ด้วยว่าแอปมีในสโตร์ประเทศไหน

    ผลลัพธ์ถูกเก็บไว้ใน .cache/ ชั่วคราว (ไม่ commit) สคริปต์ที่รันต่อกันในรอบเดียว
    จึงไม่ต้องถาม Apple ซ้ำสำหรับแอปเดิม

    lang เลือกภาษาของชื่อและคำอธิบายที่ได้กลับมา (ถ้านักพัฒนาทำหน้าสโตร์ภาษานั้นไว้)
    """
    ids = list(dict.fromkeys(str(i) for i in ids))
    cache_file = CACHE / f"lookup-{country}-{lang}.json"
    cache = load_json(cache_file, {})
    fresh = False
    if cache.get("fetched_at"):
        age = (utc_now() - parse_date(cache["fetched_at"])).total_seconds() / 3600
        fresh = age < CACHE_HOURS
    if not fresh:
        cache = {"fetched_at": utc_now().isoformat(timespec="seconds"), "found": {}, "missing": []}
    missing = set(cache["missing"])
    info = {i: cache["found"][i] for i in ids if i in cache["found"]}
    todo = [i for i in ids if i not in cache["found"] and i not in missing]
    for r in _lookup_remote(country, todo, chunk, missing, lang):
        info[str(r["trackId"])] = cache["found"][str(r["trackId"])] = r
    if todo:
        cache["missing"] = sorted(missing)
        write_json(cache_file, cache, indent=None)
    return info


def _lookup_remote(country, ids, chunk, missing, lang):
    found = []
    for i in range(0, len(ids), chunk):
        part = ids[i:i + chunk]
        url = f"https://itunes.apple.com/lookup?id={','.join(part)}&country={country}&lang={lang}"
        try:
            results = get_json(url).get("results", [])
        except RuntimeError as e:
            warn(f"lookup ({country}) failed, skipping {len(part)} apps ({e})")
            continue
        got = {str(r["trackId"]) for r in results if "trackId" in r}
        found.extend(r for r in results if "trackId" in r)
        # จำแอปที่ Apple ไม่ส่งกลับมาด้วย จะได้ไม่ถามซ้ำ (แต่ถ้าคำขอล้ม ไม่นับว่าไม่มี)
        missing.update(i for i in part if i not in got)
        time.sleep(1)
    return found


def load_themes():
    """อ่านรายการธีมจาก config/themes.json แล้วเตรียม regex ไว้ใช้ซ้ำ"""
    themes = []
    for t in load_json(ROOT / "config" / "themes.json", {}).get("themes", []):
        parts = []
        for kw in t["keywords"]:
            kw = kw.lower()
            # คำอังกฤษจับทั้งคำ (ไม่ให้ "ai" ไปตรงกับ "main") คำไทยไม่มีช่องว่างจึงจับแบบส่วนหนึ่งของข้อความ
            parts.append(rf"\b{re.escape(kw)}\b" if kw.isascii() else re.escape(kw))
        themes.append((t["name"], re.compile("|".join(parts))))
    return themes


def tag_themes(themes, name, description, limit=3, game=False):
    """ติดป้ายธีมให้แอปจากชื่อและคำอธิบาย ชื่อมีน้ำหนักมากกว่าคำอธิบาย

    เกมใช้เฉพาะธีมที่ขึ้นต้นด้วย "Game:" เพราะคำอธิบายเกมมักมีคำอย่าง pet หรือ chat ที่ไม่ได้บอกประเภทแอป
    """
    name = (name or "").lower()
    description = (description or "").lower()
    scored = []
    for order, (theme, pattern) in enumerate(themes):
        if theme.startswith("Game:") != game:
            continue
        score = 3 * len(pattern.findall(name)) + min(3, len(pattern.findall(description)))
        if score >= 2:
            scored.append((-score, order, theme))
    return [theme for _, _, theme in sorted(scored)[:limit]]


def chart_presence(country):
    """นับจำนวนวันที่แต่ละแอปอยู่ในชาร์ต (ชาร์ตไหนก็ได้) จากประวัติอันดับ

    คืน ({app_id: จำนวนวัน}, จำนวนวันที่มีข้อมูลทั้งหมด)
    """
    by_app = {}
    all_days = set()
    for path in (DATA / "rank_history").glob("*.json"):
        h = load_json(path, {})
        if h.get("country") != country:
            continue
        for day, ids in h.get("days", {}).items():
            all_days.add(day)
            for app_id in ids:
                if app_id:
                    by_app.setdefault(app_id, set()).add(day)
    return {app_id: len(days) for app_id, days in by_app.items()}, len(all_days)
