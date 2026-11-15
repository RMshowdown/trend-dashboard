import json
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "config" / "app_charts.json"
APPS = ROOT / "data" / "apps.json"
OUTPUT = ROOT / "data" / "new_apps.json"

HEADERS = {"User-Agent": "Mozilla/5.0 trend-dashboard"}


def get_json(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read().decode("utf-8"))


def fetch_new_chart(country, chart, limit, genre_id):
    url = f"https://itunes.apple.com/{country}/rss/{chart}/limit={limit}"
    if genre_id is not None:
        url += f"/genre={genre_id}"
    url += "/json"
    entries = get_json(url)["feed"].get("entry", [])
    if isinstance(entries, dict):
        entries = [entries]
    return [
        {
            "id": e["id"]["attributes"]["im:id"],
            "name": e["im:name"]["label"],
            "developer": e["im:artist"]["label"],
            "genre": e["category"]["attributes"]["label"],
            "url": e["id"]["label"],
        }
        for e in entries
    ]


def lookup(country, ids):
    info = {}
    for i in range(0, len(ids), 100):
        chunk = ids[i:i + 100]
        url = f"https://itunes.apple.com/lookup?id={','.join(chunk)}&country={country}"
        for r in get_json(url).get("results", []):
            info[str(r["trackId"])] = r
        time.sleep(1)
    return info


def main():
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    country = config["country"]
    max_days = config["new_app_max_days"]
    now = datetime.now(timezone.utc)

    # ค่ารีวิวของวันก่อน ใช้คำนวณการเปลี่ยนแปลง
    prev_counts = {}
    if OUTPUT.exists():
        old = json.loads(OUTPUT.read_text(encoding="utf-8"))
        for a in old.get("apps", []):
            prev_counts[a["id"]] = a.get("rating_count")

    # อันดับชาร์ตขายดีจากสคริปต์ fetch_apps.py ที่รันก่อนหน้า
    top_rank = {}
    top_data = json.loads(APPS.read_text(encoding="utf-8"))
    for key, apps in top_data["snapshots"].items():
        for a in apps:
            top_rank.setdefault(a["id"], {})[key] = a["rank"]

    # ดึงรายการแอปใหม่ทุกหมวด
    apps_by_id = {}
    for genre in config["genres"]:
        gkey = "all" if genre["id"] is None else str(genre["id"])
        entries = fetch_new_chart(country, config["new_chart"], config["new_limit"], genre["id"])
        print(f"{genre['name']}: {len(entries)} new apps")
        for rank, e in enumerate(entries, start=1):
            app = apps_by_id.setdefault(e["id"], {**e, "new_rank": {}})
            app["new_rank"][gkey] = rank
        time.sleep(2)

    # ดึงวันที่ปล่อยและจำนวนรีวิว
    info = lookup(country, list(apps_by_id.keys()))

    apps = []
    for app_id, app in apps_by_id.items():
        r = info.get(app_id)
        if r is None or not r.get("releaseDate"):
            continue
        release = datetime.fromisoformat(r["releaseDate"].replace("Z", "+00:00"))
        days = (now - release).days
        if days > max_days:
            continue

        count = r.get("userRatingCount", 0)
        prev = prev_counts.get(app_id)
        apps.append({
            "id": app_id,
            "name": app["name"],
            "developer": app["developer"],
            "genre": app["genre"],
            "url": app["url"],
            "release_date": r["releaseDate"],
            "days_since_release": days,
            "rating": round(r.get("averageUserRating", 0), 2),
            "rating_count": count,
            "rating_count_prev": prev,
            "rating_delta": None if prev is None else count - prev,
            "new_rank": app["new_rank"],
            "top_rank": top_rank.get(app_id, {}),
        })

    # เรียงตามการเติบโตของรีวิวมากสุดก่อน แอปที่ยังไม่มีค่าเดิมไปท้าย
    apps.sort(key=lambda a: (a["rating_delta"] is None, -(a["rating_delta"] or 0)))

    result = {
        "updated_at": now.isoformat(timespec="seconds"),
        "country": country,
        "apps": apps,
    }
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {len(apps)} new apps to {OUTPUT}")


if __name__ == "__main__":
    main()