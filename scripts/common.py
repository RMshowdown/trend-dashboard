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


def lookup(country, ids, chunk=150):
    """ดึงรายละเอียดแอป (วันปล่อย รีวิว คำอธิบาย) จาก iTunes Lookup API

    แอปที่ไม่มีขายในประเทศนั้นจะไม่อยู่ในผลลัพธ์ จึงใช้เช็กได้ด้วยว่าแอปมีในสโตร์ประเทศไหน
    """
    info = {}
    ids = list(ids)
    for i in range(0, len(ids), chunk):
        part = ids[i:i + chunk]
        url = f"https://itunes.apple.com/lookup?id={','.join(part)}&country={country}&lang=en_us"
        try:
            results = get_json(url).get("results", [])
        except RuntimeError as e:
            warn(f"lookup ({country}) failed, skipping {len(part)} apps ({e})")
            continue
        for r in results:
            if "trackId" in r:
                info[str(r["trackId"])] = r
        time.sleep(1)
    return info
