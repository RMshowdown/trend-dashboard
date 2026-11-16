"""หาแอปใหม่ที่กำลังมาแรง และแอปพรีออเดอร์ที่กำลังจะออก

แหล่งรายชื่อแอปมี 3 ทาง
1. ชาร์ต Top Free / Paid / Grossing ทุกหมวด (จาก fetch_apps.py) แอปใหม่ที่ติดชาร์ตคือสัญญาณที่ชัดที่สุด
2. feed แอปใหม่ของ Apple (ฟรีและเสียเงิน) เป็นแค่รายการแอปที่เพิ่งปล่อยหรือเปิดพรีออเดอร์
   ไม่ได้บอกความนิยมและไม่แยกหมวด จึงใช้เป็นรายชื่อเริ่มติดตาม
3. แอปที่ติดตามไว้ในรอบก่อน เพื่อเห็นรีวิวที่เพิ่มขึ้นต่อเนื่อง และติดตามแอปพรีออเดอร์จนถึงวันปล่อย
"""
import math
import time
from datetime import datetime, timedelta

from common import (DATA, ROOT, fetch_chart, load_json, lookup, parse_date,
                    short_text, utc_now, warn, write_json)

CONFIG = ROOT / "config" / "app_charts.json"
APPS = DATA / "apps.json"
OUTPUT = DATA / "new_apps.json"

HISTORY_DAYS = 30
# น้ำหนักของแต่ละชาร์ต Top Paid มีแอปน้อยกว่ามาก จึงให้น้ำหนักต่ำกว่า
CHART_WEIGHT = {"topfree": 1.0, "topgrossing": 1.0, "toppaid": 0.6}
GENRE_WEIGHT = 0.6


def review_growth(history, today):
    """คืน (ค่าครั้งก่อน, ส่วนต่าง, จำนวนวันที่ห่าง, ส่วนต่าง 7 วัน) จากประวัติรีวิวรายวัน"""
    count = history[today]
    earlier = sorted(d for d in history if d < today)
    if not earlier:
        return None, None, None, None

    last = earlier[-1]
    gap = (datetime.fromisoformat(today) - datetime.fromisoformat(last)).days
    delta = count - history[last]

    week_ago = (datetime.fromisoformat(today) - timedelta(days=7)).strftime("%Y-%m-%d")
    in_week = [d for d in earlier if d >= week_ago]
    delta_7d = count - history[in_week[0]] if in_week else None
    return history[last], delta, gap, delta_7d


def chart_points(ranks):
    """แปลงอันดับที่ดีที่สุดในทุกชาร์ตเป็นคะแนน 0-100"""
    best = 0.0
    for chart, by_genre in ranks.items():
        weight = CHART_WEIGHT.get(chart, 0.6)
        for gkey, rank in by_genre.items():
            scale = 1.0 if gkey == "all" else GENRE_WEIGHT
            best = max(best, (101 - rank) * weight * scale)
    return best


def trend_score(days, max_days, ranks, per_day):
    """คะแนนมาแรง รวม 3 สัญญาณ: อันดับชาร์ต, รีวิวที่เพิ่มต่อวัน, ความใหม่"""
    chart = chart_points(ranks)
    growth = min(40.0, 15 * math.log10(1 + max(per_day, 0)))
    # ความใหม่ให้คะแนนเฉพาะแอปที่มีสัญญาณอื่นแล้ว ไม่งั้นแอปเพิ่งปล่อยจะลอยขึ้นมาเฉย ๆ
    fresh = 20 * (max_days - days) / max_days if (chart or growth) else 0.0
    return round(chart + growth + fresh, 1)


def main():
    config = load_json(CONFIG)
    country = config["country"]
    max_days = config["new_app_max_days"]
    quiet_days = config.get("quiet_track_days", 7)
    now = utc_now()
    today = now.strftime("%Y-%m-%d")

    old = load_json(OUTPUT, {})
    if old.get("country") != country:
        old = {}
    old_date = old.get("updated_at", "")[:10]
    old_apps = {a["id"]: a for a in old.get("apps", [])}

    top_data = load_json(APPS)
    if not top_data or not isinstance(top_data.get("charts"), list):
        raise SystemExit(f"{APPS} missing or outdated, run fetch_apps.py first")

    # อันดับของแต่ละแอป: {chart: {genre: rank}}
    ranks = {}
    candidates = {}
    for ck, by_genre in top_data["snapshots"].items():
        for gk, apps in by_genre.items():
            for a in apps:
                ranks.setdefault(a["id"], {}).setdefault(ck, {})[gk] = a["rank"]
                candidates.setdefault(a["id"], a)

    new_feed = set()
    for feed in config.get("new_feeds", ["newfreeapplications"]):
        try:
            entries = fetch_chart(country, feed, config["new_limit"])
            print(f"{feed}: {len(entries)} apps")
            for e in entries:
                new_feed.add(e["id"])
                candidates.setdefault(e["id"], e)
        except Exception as e:
            warn(f"{feed} failed ({e}), continuing without it")
        time.sleep(1.5)

    for app_id, a in old_apps.items():
        candidates.setdefault(app_id, a)

    info = lookup(country, candidates)
    print(f"looked up {len(info)}/{len(candidates)} apps")
    if not info:
        raise SystemExit("lookup returned nothing, keeping previous data")

    apps = []
    for app_id, base in candidates.items():
        r = info.get(app_id)
        if r is None or not r.get("releaseDate"):
            continue
        release = parse_date(r["releaseDate"])
        upcoming = release > now  # แอปพรีออเดอร์ ยังไม่ปล่อยจริง
        days = (now - release).days
        if days > max_days:
            continue

        count = r.get("userRatingCount") or 0
        app_ranks = ranks.get(app_id, {})
        # แอปเงียบ (ไม่มีรีวิว ไม่ติดชาร์ต) ติดตามแค่ช่วงแรก ไม่งั้นรายการจะบวมขึ้นทุกวัน
        if not upcoming and not app_ranks and count == 0 and days > quiet_days:
            continue

        previous = old_apps.get(app_id, {})
        history = dict(previous.get("history") or {})
        if not history and old_date and previous.get("rating_count") is not None:
            history[old_date] = previous["rating_count"]
        history[today] = count
        history = dict(sorted(history.items())[-HISTORY_DAYS:])

        prev, delta, gap, delta_7d = review_growth(history, today)
        if upcoming:
            per_day = 0.0
        elif delta is not None:
            per_day = delta / gap
        else:
            per_day = count / max(days, 1)  # ยังไม่มีค่าเทียบ ใช้ค่าเฉลี่ยตั้งแต่วันปล่อยแทน

        screenshots = r.get("screenshotUrls") or r.get("ipadScreenshotUrls") or []
        apps.append({
            "id": app_id,
            "name": (r.get("trackName") or base["name"]).strip(),
            "developer": r.get("artistName") or base["developer"],
            "genre": r.get("primaryGenreName") or base["genre"],
            "url": r.get("trackViewUrl") or base["url"],
            "icon": r.get("artworkUrl100") or base.get("icon"),
            "price": r.get("formattedPrice") or "Free",
            "description": short_text(r.get("description")),
            "screenshots": screenshots[:3],
            "release_date": r["releaseDate"],
            "days_since_release": days,
            "upcoming": upcoming,
            "first_seen": previous.get("first_seen") or today,
            "rating": round(r.get("averageUserRating") or 0, 2),
            "rating_count": count,
            "rating_count_prev": prev,
            "rating_delta": delta,
            "rating_delta_days": gap,
            "rating_delta_7d": delta_7d,
            "rating_per_day": round(per_day, 1),
            "in_new_feed": app_id in new_feed,
            "ranks": app_ranks,
            "score": 0.0 if upcoming else trend_score(days, max_days, app_ranks, per_day),
            "history": history,
        })

    apps.sort(key=lambda a: (-a["score"], a["release_date"], a["name"]))

    write_json(OUTPUT, {
        "updated_at": now.isoformat(timespec="seconds"),
        "country": country,
        "max_days": max_days,
        "charts": top_data["charts"],
        "genres": top_data["genres"],
        "apps": apps,
    }, compact_lists=True)
    charted = sum(1 for a in apps if a["ranks"])
    upcoming = sum(1 for a in apps if a["upcoming"])
    print(f"wrote {len(apps)} apps ({charted} on charts, {upcoming} upcoming) to {OUTPUT}")


if __name__ == "__main__":
    main()
