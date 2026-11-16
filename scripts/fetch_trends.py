import time

from pytrends.request import TrendReq

from common import ROOT, load_json, utc_now, warn, write_json

CONFIG = ROOT / "config" / "keywords.json"
OUTPUT = ROOT / "data" / "trends.json"

RETRIES = 3


def fetch_group(pytrends, keywords, timeframe, geo):
    # Google Trends รับได้ครั้งละไม่เกิน 5 คำ
    if len(keywords) > 5:
        raise ValueError(f"group has {len(keywords)} keywords, Google Trends allows at most 5")
    pytrends.build_payload(keywords, timeframe=timeframe, geo=geo)
    df = pytrends.interest_over_time()
    if df.empty:
        raise RuntimeError(f"no data returned for {keywords}")
    if "isPartial" in df.columns:
        # ตัดวันที่ข้อมูลยังไม่ครบออก (บางเวอร์ชันส่งค่ามาเป็นข้อความ)
        df = df[df["isPartial"].astype(str) != "True"].drop(columns=["isPartial"])
    return df


def fetch_group_with_retry(pytrends, group, config):
    for attempt in range(RETRIES):
        try:
            return fetch_group(pytrends, group["keywords"], config["timeframe"], config["geo"])
        except ValueError:
            raise
        except Exception as e:
            # Google มักตอบ 429 เมื่อเรียกถี่ รอให้นานขึ้นแล้วลองใหม่
            if attempt == RETRIES - 1:
                raise
            wait = 30 * (attempt + 1)
            print(f"{group['name']}: {e}, retrying in {wait}s")
            time.sleep(wait)


def main():
    config = load_json(CONFIG)
    old = load_json(OUTPUT, {})
    reusable = old.get("geo") == config["geo"] and old.get("timeframe") == config["timeframe"]
    pytrends = TrendReq(hl="th-TH", tz=420, timeout=(10, 30))

    series = []
    failed = []
    for group in config["groups"]:
        try:
            df = fetch_group_with_retry(pytrends, group, config)
        except Exception as e:
            failed.append(group["name"])
            kept = [
                s for s in old.get("series", [])
                if reusable and s["group"] == group["name"] and s["name"] in group["keywords"]
            ]
            warn(f"{group['name']}: fetch failed ({e}), keeping {len(kept)} previous series")
            series.extend(kept)
            continue

        dates = [idx.strftime("%Y-%m-%d") for idx in df.index]
        for kw in group["keywords"]:
            values = [int(v) for v in df[kw]]
            points = [{"date": d, "value": v} for d, v in zip(dates, values)]
            series.append({"name": kw, "group": group["name"], "points": points})
        print(f"{group['name']}: {len(dates)} points")
        time.sleep(5)

    if len(failed) == len(config["groups"]):
        raise SystemExit("all keyword groups failed, keeping previous data")

    write_json(OUTPUT, {
        "updated_at": utc_now().isoformat(timespec="seconds"),
        "geo": config["geo"],
        "timeframe": config["timeframe"],
        "groups": [g["name"] for g in config["groups"]],
        "stale_groups": failed,
        "series": series,
    })
    print(f"wrote {len(series)} series to {OUTPUT}")


if __name__ == "__main__":
    main()
