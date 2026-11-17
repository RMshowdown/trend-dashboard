"""ส่งสรุปรายวันเข้า Discord ผ่าน webhook

ส่ง 2 ข้อความต่อวัน
1. Daily app report: แอปใหม่มาแรง แอปพรีออเดอร์ อันดับขึ้นลง และแอปที่ดังต่างประเทศ
2. Ideas & Google Play: แอปที่เพิ่งเข้า Top ของหน้า Opportunities และความเคลื่อนไหวใน Google Play
แยกเป็น 2 ข้อความเพราะ Discord รับได้ไม่เกิน 6,000 ตัวอักษรต่อข้อความ

ตั้งค่า URL ของ webhook ใน environment variable ชื่อ DISCORD_WEBHOOK_URL
(บน GitHub ใส่เป็น repository secret) ถ้าไม่ได้ตั้งไว้ สคริปต์จะข้ามไปเฉย ๆ

ทดสอบโดยไม่ส่งจริง:  python scripts/notify_discord.py --dry-run
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

from common import DATA, HEADERS, ROOT, load_json, utc_now

CONFIG = ROOT / "config" / "app_charts.json"
ITEMS = 6
CHART_SHORT = {"topfree": "Free", "toppaid": "Paid", "topgrossing": "Grossing"}
USERNAME = "Trend Dashboard"


def md(text):
    """escape ตัวอักษรพิเศษของ Discord markdown ในชื่อแอป"""
    return re.sub(r"([\\*_~`|\[\]()>#])", r"\\\1", str(text))


def link(app):
    return f"[{md(app['name'])}]({app['url']})"


def fmt_compact(n):
    """1234567 -> 1.2M"""
    for size, unit in ((1e9, "B"), (1e6, "M"), (1e3, "K")):
        if n >= size:
            return f"{n / size:.1f}".rstrip("0").rstrip(".") + unit
    return str(n)


# ---------------------------------------------------------------- ข้อความที่ 1

def best_rank(app, genre_names):
    best = None
    for chart, by_genre in app.get("ranks", {}).items():
        for gkey, rank in by_genre.items():
            points = (101 - rank) * (1 if gkey == "all" else 0.6)
            if best is None or points > best[0]:
                label = "Overall" if gkey == "all" else genre_names.get(gkey, gkey)
                best = (points, f"{CHART_SHORT.get(chart, chart)} #{rank} {label}")
    return best[1] if best else None


def trending_section(new, today, genre_names):
    apps = [a for a in new["apps"] if not a.get("upcoming") and a["score"] > 0][:ITEMS]
    lines = []
    for i, a in enumerate(apps, 1):
        parts = [md(a["genre"]), f"{a['days_since_release']}d old"]
        rank = best_rank(a, genre_names)
        if rank:
            parts.append(rank)
        if a.get("rating_delta"):
            parts.append(f"+{a['rating_delta']:,} reviews")
        flag = " 🆕" if a.get("first_seen") == today else ""
        lines.append(f"**{i}.** {link(a)}{flag}\n   {' · '.join(parts)}")
    return lines


def upcoming_section(new, today):
    apps = [a for a in new["apps"] if a.get("upcoming")]
    fresh = [a for a in apps if a.get("first_seen") == today]
    picks = sorted(fresh or apps, key=lambda a: a["release_date"])[:ITEMS]
    lines = []
    for a in picks:
        date = a["release_date"][:10]
        lines.append(f"• {link(a)} · {md(a['genre'])} · out {date}")
    if fresh:
        lines.insert(0, f"_{len(fresh)} newly announced today_")
    return lines


def movers_section(top):
    apps = top.get("snapshots", {}).get("topfree", {}).get("all", [])
    if not top.get("compared", {}).get("topfree", {}).get("all"):
        return []
    entered = [a for a in apps if a.get("prev_rank") is None][:3]
    risers = sorted(
        (a for a in apps if a.get("prev_rank") and a["prev_rank"] - a["rank"] >= 5),
        key=lambda a: a["rank"] - a["prev_rank"],
    )[:ITEMS - len(entered)]
    lines = [f"▲{a['prev_rank'] - a['rank']} → **#{a['rank']}** {link(a)}" for a in risers]
    lines += [f"NEW → **#{a['rank']}** {link(a)}" for a in entered]
    return lines


def global_section(glob):
    home = glob.get("home", "th")
    names = {c["code"]: c["code"].upper() for c in glob.get("countries", [])}
    # เน้นแอปอายุไม่เกิน 1 ปี แอปยักษ์เก่า ๆ อย่าง Roblox ไม่ได้ช่วยเรื่องไอเดีย
    gaps = [
        a for a in glob.get("apps", [])
        if a["markets"] >= 2
        and home not in a["ranks"].get("topfree", {})
        and a.get("days_since_release") is not None and a["days_since_release"] <= 365
    ][:ITEMS]
    lines = []
    for a in gaps:
        where = sorted(
            {c for by in a["ranks"].values() for c in by if c != home},
        )
        note = "" if a.get("available_home") else " · ❌ not in TH store"
        lines.append(f"• {link(a)} · {md(a['genre'])} · {', '.join(names.get(c, c) for c in where)}{note}")
    return lines


# ---------------------------------------------------------------- ข้อความที่ 2

def opportunity_section(opps, today):
    """แอปที่เพิ่งเข้ามาอยู่ใน Top ของหน้า Opportunities วันนี้ (มุมมองเริ่มต้น: ไม่รวมเกม และแอปธนาคาร/รัฐ)"""
    fresh = [a for a in opps.get("apps", []) if a.get("top_since") == today]
    if not fresh:
        return []
    lines = []
    if opps.get("top_tracking_since") == today:
        lines.append(f"_Tracking starts today, so this is the current top {opps.get('top_n', 20)}. "
                     "From tomorrow only apps that newly enter it are listed._")
    for a in fresh[:ITEMS]:
        parts = ["Do it better" if a["kind"] == "improve" else "Bring to TH",
                 md(a["genre"]), f"★ {a['rating']:.1f}"]
        pains = [p["tag"] for p in ((a.get("reviews") or {}).get("pains") or [])[:2]]
        if pains:
            parts.append("complaints: " + ", ".join(pains))
        elif a["kind"] == "import":
            parts.append(f"charting in {a['markets']} countries")
        elif a.get("best_rank"):
            parts.append(a["best_rank"])
        lines.append(f"**{round(a['score'])}** {link(a)}\n   {' · '.join(parts)}")
    return lines


def play_on_chart(play):
    """แอป Google Play ที่อยู่ในชาร์ตใดชาร์ตหนึ่งวันนี้"""
    apps = play.get("apps", {})
    ids = {row["id"] for by_cat in play.get("snapshots", {}).values()
           for rows in by_cat.values() for row in rows}
    return [{"id": i, **apps[i]} for i in ids if i in apps]


def play_growth_section(play, today):
    """แอปอายุไม่เกิน 1 ปีที่ยอดติดตั้งเพิ่มต่อวันมากที่สุด (ยอดรวมทั่วโลก)

    ไม่จำกัดอายุจะเห็นแต่แอปยักษ์อย่าง Gemini หรือ Messenger ซึ่งไม่ช่วยเรื่องไอเดีย
    เริ่มมีข้อมูลตั้งแต่วันที่สองของการเก็บ
    """
    year_ago = f"{int(today[:4]) - 1}{today[4:]}"
    apps = sorted(
        (a for a in play_on_chart(play)
         if (a.get("installs_per_day") or 0) > 0 and (a.get("released") or "") >= year_ago),
        key=lambda a: -a["installs_per_day"])[:ITEMS]
    return [f"**+{fmt_compact(a['installs_per_day'])}/day** {link(a)} · {md(a.get('genre') or '-')}"
            f" · {fmt_compact(a.get('installs') or 0)} installs · out {a['released']}" for a in apps]


def play_new_section(play):
    """แอปที่เพิ่งเข้าชาร์ต Top Free ของ Google Play วันนี้ และไม่ได้ติดชาร์ต App Store"""
    apps = play.get("apps", {})
    labels = {"all": "Overall", "apps": "Apps", "games": "Games"}
    seen, lines = set(), []
    for cat, label in labels.items():
        if not play.get("compared", {}).get("topfree", {}).get(cat):
            continue  # ยังไม่มีวันก่อนหน้าให้เทียบ
        for row in play["snapshots"]["topfree"].get(cat, []):
            a = apps.get(row["id"])
            if row["prev_rank"] is not None or not a or a.get("on_ios") or row["id"] in seen:
                continue
            seen.add(row["id"])
            lines.append(f"NEW → **#{row['rank']} {label}** {link(a)} · {md(a.get('genre') or '-')}")
    return lines[:ITEMS]


# ---------------------------------------------------------------- รวมเป็นข้อความ

def to_embeds(sections, site):
    embeds = []
    for title, page, color, lines in sections:
        if not lines:
            continue
        # ตัดทีละรายการ (หนึ่งรายการอาจมีสองบรรทัด) ไม่ให้รายการสุดท้ายขาดครึ่ง
        kept = []
        for line in lines:
            if len("\n".join(kept + [line])) > 1000:
                break
            kept.append(line)
        text = "\n".join(kept)
        embed = {"title": title, "color": color, "description": text}
        if site:
            embed["url"] = f"{site}/{page}"
        embeds.append(embed)
    return embeds


def build_payloads():
    config = load_json(CONFIG)
    site = config.get("site_url", "").rstrip("/")
    today = utc_now().strftime("%Y-%m-%d")
    new = load_json(DATA / "new_apps.json", {"apps": []})
    top = load_json(DATA / "apps.json", {})
    glob = load_json(DATA / "global.json", {})
    opps = load_json(DATA / "opportunities.json", {})
    play = load_json(DATA / "play.json", {})
    genre_names = {g["key"]: g["name"] for g in top.get("genres", [])}

    daily = to_embeds([
        ("🔥 Trending new apps", "new.html", 0xF97316, trending_section(new, today, genre_names)),
        ("🔜 Upcoming (pre-order)", "new.html?status=upcoming", 0x8B5CF6, upcoming_section(new, today)),
        ("🚀 Biggest movers · Top Free", "apps.html", 0x22C55E, movers_section(top)),
        ("🌏 Newer apps hot abroad, not on TH chart", "compare.html?age=365", 0x0EA5E9, global_section(glob)),
    ], site)
    ideas = to_embeds([
        ("💡 New in top opportunities", "opportunities.html", 0xEAB308, opportunity_section(opps, today)),
        ("🤖 Google Play · fastest-growing newer apps", "play.html?show=new90&sort=growth", 0x34A853,
         play_growth_section(play, today)),
        ("🆕 Google Play · new on chart, not on iOS charts", "play.html?show=noios", 0x14B8A6,
         play_new_section(play)),
    ], site)

    content = f"**Daily app report** · {today}"
    if site:
        content += f" · <{site}/new.html>"
    payloads = [{"username": USERNAME, "content": content, "embeds": daily,
                 "allowed_mentions": {"parse": []}}]
    # ข้อความที่สองส่งเฉพาะวันที่มีอะไรใหม่
    if ideas:
        content = "**Ideas & Google Play**"
        if site:
            content += f" · <{site}/opportunities.html>"
        payloads.append({"username": USERNAME, "content": content, "embeds": ideas,
                         "allowed_mentions": {"parse": []}})
    return payloads


def size_of(payload):
    """จำนวนตัวอักษรที่ Discord นับรวม (จำกัด 6,000 ต่อข้อความ)"""
    return len(payload["content"]) + sum(len(e["title"]) + len(e["description"]) for e in payload["embeds"])


def main():
    payloads = build_payloads()
    if "--dry-run" in sys.argv:
        for payload in payloads:
            print(json.dumps(payload, ensure_ascii=False, indent=2))
            print(f"-- {size_of(payload)} of 6000 characters", file=sys.stderr)
        return

    url = os.environ.get("DISCORD_WEBHOOK_URL", "").strip()
    if not url:
        print("DISCORD_WEBHOOK_URL is not set, skipping Discord notification")
        return

    for i, payload in enumerate(payloads, 1):
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={**HEADERS, "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                print(f"message {i}/{len(payloads)} sent to Discord ({res.status})")
        except urllib.error.HTTPError as e:
            # ไม่พิมพ์ URL ออกมา เพราะ URL ของ webhook คือรหัสลับ
            raise SystemExit(
                f"Discord rejected message {i}: {e.code} {e.read().decode('utf-8', 'replace')[:300]}")
        time.sleep(1)  # เว้นระยะให้ข้อความเรียงลำดับถูก และไม่ชน rate limit


if __name__ == "__main__":
    main()
