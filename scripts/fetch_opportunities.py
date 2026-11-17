"""ให้คะแนน "โอกาส" กับแอป เพื่อชี้ว่าตรงไหนมีความต้องการแต่ยังไม่มีใครทำได้ดี

มี 2 แบบ
- improve: แอปที่ติดชาร์ตไทยแต่ผู้ใช้ไม่พอใจ (คะแนนรีวิวต่ำ) = มีคนต้องการ แต่ของที่มียังไม่ดี
- import:  แอปที่ติดชาร์ตหลายประเทศ แต่ยังไม่ติดชาร์ตไทย หรือยังไม่มีในสโตร์ไทย

คะแนนเป็นกฎตายตัว ไม่ได้ใช้ AI และไม่ได้ทำนายว่าทำแล้วจะสำเร็จ ใช้เป็นจุดเริ่มค้นต่อเท่านั้น
ต้องรันหลัง fetch_apps.py และ fetch_global.py
"""
import math
import re
import time
from datetime import timedelta

from common import (DATA, ROOT, chart_presence, get_json, load_json, load_themes, lookup,
                    parse_date, short_text, tag_themes, utc_now, warn, write_json)

CONFIG = ROOT / "config" / "app_charts.json"
OUTPUT = DATA / "opportunities.json"
DEVELOPERS = DATA / "developers.json"

CHART_WEIGHT = {"topfree": 1.0, "topgrossing": 1.0, "toppaid": 0.6}
GENRE_WEIGHT = 0.6
CHART_SHORT = {"topfree": "Free", "toppaid": "Paid", "topgrossing": "Grossing"}

DEFAULTS = {
    "min_reviews": 30,          # รีวิวน้อยกว่านี้ คะแนนดาวยังเชื่อไม่ได้
    "max_apps": 400,
    "review_apps": 50,          # ดึงรีวิวดาวต่ำให้แอปที่คะแนนสูงสุดกี่ตัว
    "review_samples": 6,
    "developer_refresh_days": 30,
    "developer_requests": 150,  # จำนวนคำขอสูงสุดต่อรอบสำหรับนับแอปของผู้พัฒนา
}

# ผู้พัฒนาที่ผูกกับสถาบัน (ธนาคาร รัฐ สาธารณูปโภค) คนบ่นเยอะจริง แต่สร้างแอปมาแทนไม่ได้
INSTITUTION_THEMES = {"Government & ID", "Banking", "Loans", "Telecom"}
INSTITUTION_DEV = re.compile(
    r"\b(bank|public company|pcl|plc|authority|ministry|government|department|office of|university)\b"
    r"|ธนาคาร|มหาชน|กรม|สำนักงาน|การไฟฟ้า|การประปา|กระทรวง|มหาวิทยาลัย", re.I)
THAI_CHARS = re.compile(r"[\u0e00-\u0e7f]")


# รีวิวที่ผู้เขียนใส่ชื่อจริง เบอร์โทร หรือเลขบัญชีของตัวเองไว้ ไม่เอามาแสดงต่อ
PERSONAL = re.compile(r"[0-9][0-9 -]{8,}|@|น[.]ส[.]|นางสาว|ข้าพเจ้า|(นาย|นาง) ?[ก-ฮ]")


def keyword_pattern(words):
    """คำอังกฤษจับทั้งคำ คำไทยจับแบบส่วนหนึ่งของข้อความ"""
    return re.compile("|".join(
        rf"\b{re.escape(w.lower())}\b" if w.isascii() else re.escape(w.lower()) for w in words))


def load_pains():
    """คำที่บอกว่าผู้ใช้บ่นเรื่องอะไร (ใช้ชุดเดียวกับ fetch_reviews.mjs)"""
    pains = load_json(ROOT / "config" / "pains.json", {}).get("pains", [])
    return [(p["name"], keyword_pattern(p["keywords"])) for p in pains]


def clamp(x):
    return max(0.0, min(1.0, x))


def best_rank(ranks, genre_names):
    """อันดับที่ดีที่สุด คืน (คะแนน 0-100, ข้อความ)"""
    best = (0.0, None)
    for chart, by_genre in ranks.items():
        for gkey, rank in by_genre.items():
            points = (101 - rank) * CHART_WEIGHT.get(chart, 0.6) * (1.0 if gkey == "all" else GENRE_WEIGHT)
            if points > best[0]:
                label = "Overall" if gkey == "all" else genre_names.get(gkey, gkey)
                best = (points, f"{CHART_SHORT.get(chart, chart)} #{rank} {label}")
    return best


def update_developers(country, artist_ids, settings, today):
    """นับจำนวนแอปของผู้พัฒนาแต่ละราย (ผู้พัฒนารายเล็ก = ไอเดียชนะได้โดยไม่ต้องมีงบการตลาด)

    ผลลัพธ์เก็บสะสมใน data/developers.json และถามซ้ำเมื่อเก่ากว่า developer_refresh_days
    artist_ids เรียงตามความสำคัญ รอบหนึ่งถามได้ไม่เกิน developer_requests คำขอ
    """
    cache = load_json(DEVELOPERS, {})
    if cache.get("country") != country:
        cache = {"country": country, "developers": {}}
    devs = cache["developers"]
    cutoff = (parse_date(today + "T00:00:00+00:00")
              - timedelta(days=settings["developer_refresh_days"])).strftime("%Y-%m-%d")
    todo = [a for a in dict.fromkeys(artist_ids) if a not in devs or devs[a]["checked"] < cutoff]

    def ask(ids):
        url = (f"https://itunes.apple.com/lookup?id={','.join(ids)}"
               f"&entity=software&country={country}&limit=200")
        results = get_json(url).get("results", [])
        counts = {i: 0 for i in ids}
        for r in results:
            if r.get("wrapperType") == "software" and str(r.get("artistId")) in counts:
                counts[str(r["artistId"])] += 1
        return counts, len(results) >= 200

    budget = settings["developer_requests"]
    done = 0
    for i in range(0, len(todo), 5):
        if budget <= 0:
            break
        group = todo[i:i + 5]
        try:
            counts, truncated = ask(group)
            budget -= 1
            if truncated:
                # ผลถูกตัดที่ 200 รายการ นับแยกทีละรายจะได้ไม่ปนกัน (200 = "200 ขึ้นไป")
                counts = {}
                for a in group:
                    if budget <= 0:
                        break
                    one, _ = ask([a])
                    counts.update(one)
                    budget -= 1
                    time.sleep(0.7)
        except RuntimeError as e:
            warn(f"developer lookup failed ({e})")
            break
        for a, n in counts.items():
            devs[a] = {"apps": n, "checked": today}
            done += 1
        time.sleep(0.7)

    write_json(DEVELOPERS, cache, indent=None)
    print(f"developers: checked {done}, {len(todo) - done} left for later runs, {len(devs)} known")
    return {a: d["apps"] for a, d in devs.items()}


def fetch_reviews(country, app_id, samples, pain_patterns):
    """ดึงรีวิวล่าสุด 50 รายการจาก RSS ของ Apple แล้วเก็บเฉพาะรีวิว 1-3 ดาว

    feed นี้ของ Apple มักส่งกลับมาว่างเปล่าแม้แอปจะมีรีวิวมาก (คืน None)
    แอปที่ไม่ได้รีวิวจากตรงนี้ fetch_reviews.mjs จะไปหาจาก Google Play แทน
    """
    url = f"https://itunes.apple.com/{country}/rss/customerreviews/id={app_id}/sortBy=mostRecent/json"
    entries = get_json(url, retries=2).get("feed", {}).get("entry", [])
    if isinstance(entries, dict):
        entries = [entries]
    reviews = []
    for e in entries:
        try:
            reviews.append({
                "rating": int(e["im:rating"]["label"]),
                "title": e.get("title", {}).get("label", "").strip(),
                "text": " ".join(e.get("content", {}).get("label", "").split()),
                "date": e.get("updated", {}).get("label", "")[:10],
            })
        except (KeyError, ValueError):
            continue
    if not reviews:
        return None
    low = [r for r in reviews if r["rating"] <= 3 and not PERSONAL.search(f"{r['title']} {r['text']}")]
    pains = []
    for name, pattern in pain_patterns:
        n = sum(1 for r in low if pattern.search(f"{r['title']} {r['text']}".lower()))
        if n:
            pains.append({"tag": name, "count": n})
    pains.sort(key=lambda p: -p["count"])
    # รีวิวยาวมักบอกปัญหาชัดกว่า เอารีวิวที่มีเนื้อหามาก่อน
    picks = sorted(low, key=lambda r: -min(len(r["text"]), 400))[:samples]
    picks.sort(key=lambda r: r["date"], reverse=True)
    return {
        "source": "App Store",
        "country": country,
        "sample": len(reviews),
        "low": len(low),
        "pains": pains[:5],
        "items": [{**r, "text": short_text(r["text"], 260)} for r in picks],
    }


def main():
    config = load_json(CONFIG)
    settings = {**DEFAULTS, **config.get("opportunities", {})}
    country = config["country"]
    now = utc_now()
    today = now.strftime("%Y-%m-%d")
    themes = load_themes()
    pain_patterns = load_pains()

    top = load_json(DATA / "apps.json")
    if not top or top.get("country") != country:
        raise SystemExit("data/apps.json missing, run fetch_apps.py first")
    genre_names = {g["key"]: g["name"] for g in top["genres"]}
    glob = load_json(DATA / "global.json", {})
    if glob.get("home") != country:
        glob = {}

    # ---------- แอปที่ติดชาร์ตไทย ----------
    ranks, base = {}, {}
    for ck, by_genre in top["snapshots"].items():
        for gk, apps in by_genre.items():
            for a in apps:
                ranks.setdefault(a["id"], {}).setdefault(ck, {})[gk] = a["rank"]
                base.setdefault(a["id"], a)
    info = lookup(country, base)
    print(f"looked up {len(info)}/{len(base)} charting apps")
    if not info:
        raise SystemExit("lookup returned nothing, keeping previous data")
    presence, tracked_days = chart_presence(country)

    # ---------- แอปที่ดังต่างประเทศแต่ไม่ติดชาร์ตไทย ----------
    abroad = [
        a for a in glob.get("apps", [])
        if a.get("markets", 0) >= 2 and a["id"] not in base
        and not any(country in by for by in a["ranks"].values())
    ]
    by_market = {}
    for a in abroad:
        if a.get("available_home"):
            by_market.setdefault(country, []).append(a["id"])
        else:
            market = sorted(c for by in a["ranks"].values() for c in by)[0]
            by_market.setdefault(market, []).append(a["id"])
    abroad_info = {}
    abroad_market = {}
    for market, ids in by_market.items():
        found = lookup(market, ids)
        abroad_info.update(found)
        abroad_market.update({i: market for i in found})

    def record(app_id, r, fallback):
        release = parse_date(r["releaseDate"]) if r.get("releaseDate") else None
        langs = [c.upper() for c in r.get("languageCodesISO2A") or []]
        name = (r.get("trackName") or fallback["name"]).strip()
        developer = r.get("artistName") or fallback["developer"]
        tags = tag_themes(themes, name, r.get("description"), game=(r.get("primaryGenreName") == "Games"))
        # นักพัฒนาหลายรายไม่ได้ระบุภาษาไทยไว้ทั้งที่แอปเป็นภาษาไทย จึงดูจากตัวอักษรในชื่อและคำอธิบายด้วย
        thai = "TH" in langs or bool(THAI_CHARS.search(f"{name} {r.get('description') or ''}"))
        return {
            "id": app_id,
            "name": name,
            "developer": developer,
            "artist_id": str(r["artistId"]) if r.get("artistId") else None,
            "genre": r.get("primaryGenreName") or fallback["genre"],
            "url": r.get("trackViewUrl") or fallback["url"],
            "icon": r.get("artworkUrl100") or fallback.get("icon"),
            "price": r.get("formattedPrice") or "Free",
            "description": short_text(r.get("description"), 240),
            "themes": tags,
            "institutional": bool(
                INSTITUTION_THEMES & set(tags) or INSTITUTION_DEV.search(f"{developer} {r.get('sellerName') or ''}")
                or (r.get("primaryGenreName") == "Finance")),
            "release_date": r.get("releaseDate"),
            "days_since_release": (now - release).days if release else None,
            "rating": round(r.get("averageUserRating") or 0, 2),
            "rating_count": r.get("userRatingCount") or 0,
            "thai": thai,
        }

    candidates = []
    for app_id, r in info.items():
        rec = record(app_id, r, base[app_id])
        if rec["rating_count"] < settings["min_reviews"]:
            continue
        rec["kind"] = "improve"
        rec["ranks"] = ranks[app_id]
        points, label = best_rank(ranks[app_id], genre_names)
        rec["chart_points"] = round(points, 1)
        rec["best_rank"] = label
        rec["chart_days"] = presence.get(app_id, 1)
        candidates.append(rec)
    for a in abroad:
        r = abroad_info.get(a["id"])
        if not r:
            continue
        rec = record(a["id"], r, a)
        rec["kind"] = "import"
        rec["available_home"] = bool(a.get("available_home"))
        rec["markets"] = a["markets"]
        rec["global_score"] = a["global_score"]
        rec["countries"] = sorted({c for by in a["ranks"].values() for c in by})
        rec["grossing_abroad"] = bool(a["ranks"].get("topgrossing"))
        rec["review_country"] = abroad_market[a["id"]]
        candidates.append(rec)

    # ---------- หน้าสโตร์มีภาษาไทยไหม ----------
    # รอบแรกขอข้อมูลเป็นภาษาอังกฤษ แอปที่ทำหน้าสโตร์ไว้ทั้งสองภาษาจึงดูเหมือนไม่มีภาษาไทย
    # ขออีกรอบเป็นภาษาไทยเฉพาะแอปที่ยังไม่แน่ใจ ถ้าได้ข้อความไทยกลับมาแปลว่ามีหน้าสโตร์ภาษาไทย
    unsure = [r["id"] for r in candidates if not r["thai"] and r.get("available_home", True)]
    thai_info = lookup(country, unsure, lang="th")
    for rec in candidates:
        t = thai_info.get(rec["id"])
        if t and THAI_CHARS.search(f"{t.get('trackName') or ''} {t.get('description') or ''}"):
            rec["thai"] = True
    print(f"thai listing: checked {len(unsure)}, {sum(1 for r in candidates if not r['thai'])} have none")

    # ---------- คะแนนรอบแรก (ยังไม่รู้ขนาดผู้พัฒนา) ใช้จัดลำดับว่าจะถามผู้พัฒนารายไหนก่อน ----------
    window = max(1, min(tracked_days, 14))

    def score(rec, dev_apps):
        parts = {}
        age = rec["days_since_release"]
        if rec["kind"] == "improve":
            confidence = clamp(math.log10(max(rec["rating_count"], 1)) / 3)  # 1,000 รีวิวขึ้นไป = เชื่อเต็มที่
            parts["pain"] = 35 * clamp((4.3 - rec["rating"]) / 1.8) * confidence
            staying = clamp(min(rec["chart_days"], window) / window)
            parts["demand"] = 15 * rec["chart_points"] / 100 + 10 * staying
            money = 0.0
            if "topgrossing" in rec["ranks"]:
                g, _ = best_rank({"topgrossing": rec["ranks"]["topgrossing"]}, {})
                money = 4 + 6 * g / 100
            elif "toppaid" in rec["ranks"]:
                money = 4
            if money and age is not None and age <= 365:
                money += 5  # ทำเงินได้ตั้งแต่อายุน้อย
            parts["money"] = money
            parts["gap"] = 0 if rec["thai"] else 10  # คนไทยใช้ทั้งที่หน้าสโตร์ไม่มีภาษาไทย
        else:
            parts["demand"] = 20 * clamp(rec["markets"] / 4) + 20 * clamp(rec["global_score"] / 400)
            parts["gap"] = 20 if not rec["available_home"] else (4 if rec["thai"] else 12)
            parts["fresh"] = 0 if age is None else 15 if age <= 180 else 10 if age <= 365 else 5 if age <= 730 else 0
            parts["money"] = 10 if rec["grossing_abroad"] else 0
        if dev_apps is None:
            parts["dev"] = 0
        else:
            parts["dev"] = 15 if dev_apps <= 2 else 10 if dev_apps <= 5 else 5 if dev_apps <= 10 else 0
        return {k: round(v, 1) for k, v in parts.items()}

    for rec in candidates:
        rec["score"] = sum(score(rec, None).values())
    candidates.sort(key=lambda r: -r["score"])

    # หน้า New Apps ใช้ขนาดผู้พัฒนาเหมือนกัน จึงนับให้แอปใหม่ที่มีสัญญาณด้วย
    new_apps = (load_json(DATA / "new_apps.json", {}) or {}).get("apps", [])
    wanted = [r["artist_id"] for r in candidates[:300] if r["artist_id"]]
    wanted += [a["artist_id"] for a in new_apps if a.get("artist_id") and a.get("score", 0) > 0]
    wanted += [r["artist_id"] for r in candidates[300:] if r["artist_id"]]
    dev_counts = update_developers(country, wanted, settings, today)

    for rec in candidates:
        # 0 = ผู้พัฒนาไม่มีแอปในสโตร์ไทยเลย (แอปต่างประเทศ) จึงไม่รู้ขนาดจริง
        rec["dev_apps"] = dev_counts.get(rec["artist_id"]) or None
        rec["parts"] = score(rec, rec["dev_apps"])
        rec["score"] = round(sum(rec["parts"].values()), 1)
    candidates.sort(key=lambda r: (-r["score"], r["name"]))

    # เก็บทั้งสองแบบให้พอดีกัน ไม่ให้แบบใดแบบหนึ่งกินที่หมด
    limit = settings["max_apps"]
    improve = [r for r in candidates if r["kind"] == "improve" and r["parts"].get("pain", 0) > 0][:limit * 2 // 3]
    imports = [r for r in candidates if r["kind"] == "import"][:limit - len(improve)]
    result = sorted(improve + imports, key=lambda r: (-r["score"], r["name"]))

    # ---------- วันที่แอปเข้ามาอยู่ใน "Top" (มุมมองเริ่มต้นของหน้าเว็บ: ไม่รวมเกม และแอปธนาคาร/รัฐ) ----------
    # Discord ใช้ค่านี้แจ้งเฉพาะแอปที่เพิ่งเข้ามาใหม่ ไม่ส่งรายชื่อเดิมซ้ำทุกวัน
    old_data = load_json(OUTPUT, {}) or {}
    old = {a["id"]: a for a in old_data.get("apps", [])}
    top_n = settings.get("top_n", 20)
    visible = [r for r in result if not r["institutional"] and r["genre"] != "Games"]
    for rec in visible[:top_n]:
        rec["top_since"] = old.get(rec["id"], {}).get("top_since") or today
    # รอบแรกที่เริ่มติดตาม ทุกแอปจะดูเหมือนเพิ่งเข้ามา จึงจำวันเริ่มไว้ให้ Discord รู้
    top_tracking_since = old_data.get("top_tracking_since") or today
    fetched = 0
    for rec in result[:settings["review_apps"]]:
        market = rec.get("review_country") or country
        try:
            rec["reviews"] = fetch_reviews(market, rec["id"], settings["review_samples"], pain_patterns)
            fetched += 1
        except RuntimeError as e:
            warn(f"reviews for {rec['name']} failed ({e})")
            rec["reviews"] = old.get(rec["id"], {}).get("reviews")
        time.sleep(0.7)
    for rec in result:
        rec.setdefault("reviews", None)
        rec.pop("review_country", None)
        rec.pop("global_score", None)
        # รีวิวจาก Google Play ที่ fetch_reviews.mjs เติมไว้รอบก่อน เก็บไว้จนกว่าจะได้ชุดใหม่
        if not rec["reviews"]:
            rec["reviews"] = old.get(rec["id"], {}).get("reviews")
    print(f"reviews: App Store returned reviews for {sum(1 for r in result[:settings['review_apps']] if r['reviews'] and r['reviews'].get('source') == 'App Store')} of {fetched} apps")

    # ---------- ภาพรวมรายหมวด: หมวดไหนผู้ใช้ไม่พอใจมาก หมวดไหนมีแอปใหม่เข้ามาเยอะ ----------
    by_genre = {}
    for rec in candidates:
        if rec["kind"] != "improve":
            continue
        g = by_genre.setdefault(rec["genre"], {"apps": 0, "rating_sum": 0.0, "low": 0, "new": 0})
        g["apps"] += 1
        g["rating_sum"] += rec["rating"]
        g["low"] += rec["rating"] < 3.5
        g["new"] += rec["days_since_release"] is not None and rec["days_since_release"] <= 180
    genres = sorted((
        {"name": name, "apps": g["apps"], "avg_rating": round(g["rating_sum"] / g["apps"], 2),
         "low_share": round(g["low"] / g["apps"], 3), "new_share": round(g["new"] / g["apps"], 3)}
        for name, g in by_genre.items() if g["apps"] >= 8
    ), key=lambda g: -g["low_share"])

    write_json(OUTPUT, {
        "updated_at": now.isoformat(timespec="seconds"),
        "country": country,
        "tracked_days": tracked_days,
        "min_reviews": settings["min_reviews"],
        "top_n": top_n,
        "top_tracking_since": top_tracking_since,
        "genres": genres,
        "apps": result,
    }, indent=None)
    print(f"wrote {len(result)} opportunities ({len(improve)} improve, {len(imports)} import) to {OUTPUT}")


if __name__ == "__main__":
    main()
