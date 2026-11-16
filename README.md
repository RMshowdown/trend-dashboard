# 🆕 Trend Dashboard

> ค้นหาไอเดียสร้างแอป จากแอปใหม่มาแรง แอปที่ผู้ใช้ยังไม่พอใจ แอปที่กำลังจะออก และแอปที่ดังในต่างประเทศ ทั้ง App Store และ Google Play อัปเดตทุกวันอัตโนมัติ

[![Update data](https://github.com/B1ackmonday/trend-dashboard/actions/workflows/update-trends.yml/badge.svg)](https://github.com/B1ackmonday/trend-dashboard/actions/workflows/update-trends.yml)
![Python](https://img.shields.io/badge/Python-3.11-3776AB?logo=python&logoColor=white)
![Node](https://img.shields.io/badge/Node-22-5FA04E?logo=nodedotjs&logoColor=white)
![GitHub Pages](https://img.shields.io/badge/Deploy-GitHub%20Pages-222?logo=github)

🔗 **เปิดใช้งาน:** [New & Trending Apps](https://b1ackmonday.github.io/trend-dashboard/new.html)

---

## ✨ ฟีเจอร์

หน้าเว็บเป็นภาษาอังกฤษ ใช้งานได้ทั้งคอมและมือถือ

| หน้า | ใช้ทำอะไร |
| --- | --- |
| 🆕 **New Apps** (`new.html`) | แอปที่ออกภายใน 60 วัน และแอปพรีออเดอร์ที่ยังไม่ออก เรียงตามคะแนนมาแรง ดูคำอธิบายและภาพหน้าจอได้ มีหมวดที่กำลังมาแรง และ export CSV |
| 💡 **Opportunities** (`opportunities.html`) | คะแนนโอกาส 0–100 ชี้ว่าตรงไหนมีความต้องการแต่ยังไม่มีใครทำได้ดี พร้อมรีวิวดาวต่ำและหัวข้อที่ผู้ใช้บ่น |
| 🏆 **Charts** (`apps.html`) | Top Free / Top Paid / Top Grossing ของไทย 12 หมวด พร้อมการขึ้นลงจากวันก่อน จำนวนวันที่อยู่ในชาร์ต และกราฟอันดับย้อนหลัง 30 วัน |
| 🤖 **Google Play** (`play.html`) | ชาร์ต Google Play ของไทย 13 หมวด พร้อมจำนวนติดตั้ง การเติบโตต่อวัน และแอปที่ติดชาร์ต Android แต่ไม่ติดชาร์ต iOS |
| 🌏 **Global** (`compare.html`) | เทียบชาร์ต 7 ประเทศ หาแอปที่ดังในต่างประเทศแต่ยังไม่ติดชาร์ตหรือยังไม่มีขายในไทย |
| 📈 **Google Trends** (`index.html`) | ความนิยมของคำค้นในไทย 3 เดือนย้อนหลัง แยกกราฟตามกลุ่มคำ |
| ⭐ **Watchlist** (`watchlist.html`) | แอปที่กด ☆ เก็บไว้จากหน้าไหนก็ได้ พร้อมโน้ตของคุณ เก็บในเบราว์เซอร์เครื่องนั้น สำรองเป็นไฟล์ได้ |
| 💬 **Discord** | ส่งสรุปรายวันเข้าช่องใน Discord (ดูวิธีตั้งค่าด้านล่าง) |

ตัวกรองทุกหน้าถูกเก็บไว้ใน URL จึง bookmark หรือส่งลิงก์มุมมองที่กรองแล้วให้คนอื่นได้

แอปถูกติดป้าย **ธีม** อัตโนมัติจากชื่อและคำอธิบาย (เช่น AI, Short drama, Loans) และกรองตาม **ขนาดผู้พัฒนา** ได้ เพราะแอปของผู้พัฒนารายเล็กที่ติดชาร์ตแปลว่าไอเดียชนะได้โดยไม่ต้องมีงบการตลาด

## 🧭 วิธีการจัดอันดับ "แอปใหม่"

| สัญญาณ | ความหมาย |
| --- | --- |
| **ติดชาร์ต** | สัญญาณที่ชัดที่สุด Top Free และ Top Grossing ได้น้ำหนักเต็ม Top Paid ได้ 60% ชาร์ตหมวดได้ 60% ของชาร์ตรวม |
| **รีวิวเพิ่มต่อวัน** | ตัวแทนของการเติบโต เพราะ Apple ไม่เปิดเผยยอดดาวน์โหลด |
| **ความใหม่** | แอปที่ทำผลงานได้ตั้งแต่อายุน้อยได้คะแนนเพิ่ม |

รายชื่อแอปมาจาก 3 ทาง คือชาร์ตทุกหมวด, feed แอปใหม่ (ฟรีและเสียเงิน) ของ Apple และแอปที่ติดตามไว้จากรอบก่อน

- **แอปพรีออเดอร์** ถูกเก็บไว้เสมอและติดตามต่อจนถึงวันปล่อย ดูได้ที่ตัวกรอง Status → Upcoming
- แอปที่ออกแล้วแต่ไม่มีรีวิวและไม่ติดชาร์ต จะถูกติดตามแค่ 7 วันแรก
- ประวัติรีวิวรายวันเก็บใน `data/new_apps.json` ประวัติอันดับเก็บใน `data/rank_history/`

## 💡 คะแนนโอกาส (Opportunities)

คะแนนคิดจากกฎตายตัว ไม่ได้ใช้ AI และ **ไม่ได้ทำนายว่าทำแล้วจะสำเร็จ** ใช้ชี้ว่าควรไปดูแอปไหนต่อ มี 2 แบบ

**Do it better** แอปที่ติดชาร์ตไทยแต่ผู้ใช้ไม่พอใจ

| ส่วน | คะแนนเต็ม | ได้คะแนนเมื่อ |
| --- | --- | --- |
| Unhappy users | 35 | คะแนนดาวต่ำกว่า 4.3 ยิ่งต่ำยิ่งได้มาก และต้องมีรีวิวมากพอให้เชื่อได้ |
| Demand | 25 | อันดับชาร์ตสูง และอยู่ในชาร์ตหลายวัน |
| Earning | 15 | ติด Top Grossing หรือ Top Paid ได้เพิ่มถ้าอายุไม่เกิน 1 ปี |
| Small developer | 15 | ผู้พัฒนามีแอปไม่เกิน 10 ตัว |
| No Thai listing | 10 | คนไทยใช้อยู่ทั้งที่หน้าสโตร์ของแอปไม่มีภาษาไทย |

**Bring it to Thailand** แอปที่ติดชาร์ตตั้งแต่ 2 ประเทศขึ้นไป แต่ไม่ติดชาร์ตไทย

| ส่วน | คะแนนเต็ม | ได้คะแนนเมื่อ |
| --- | --- | --- |
| Demand abroad | 40 | ติดชาร์ตหลายประเทศ และอันดับสูง |
| Gap in Thailand | 20 | ยังไม่มีในสโตร์ไทย หรือมีแต่หน้าสโตร์ไม่มีภาษาไทย |
| New | 15 | อายุไม่เกิน 2 ปี ยิ่งใหม่ยิ่งได้มาก |
| Small developer | 15 | ผู้พัฒนามีแอปไม่เกิน 10 ตัว |
| Earning | 10 | ติด Top Grossing ในต่างประเทศ |

ข้อควรรู้

- แอปธนาคาร ภาครัฐ และสาธารณูปโภคถูกซ่อนไว้ตั้งแต่แรก เพราะคนบ่นเยอะจริงแต่สร้างแอปมาแทนไม่ได้ เปิดดูได้จากตัวกรอง
- รีวิวดาวต่ำดึงให้เฉพาะแอปคะแนนสูงสุด 50 ตัว ส่วนใหญ่มาจาก Google Play เพราะ feed รีวิวของ Apple มักส่งกลับมาว่าง
- หัวข้อที่ผู้ใช้บ่น (Ads, Crashes, Login ฯลฯ) นับจากคำในรีวิว แก้รายการคำได้ที่ `config/pains.json`
- รีวิวที่มีชื่อจริง เบอร์โทร หรืออีเมลของผู้เขียนจะไม่ถูกนำมาแสดง
- "จำนวนวันที่อยู่ในชาร์ต" เริ่มมีความหมายหลังเก็บข้อมูลได้ราว 1 สัปดาห์

## 🤖 ข้อมูล Google Play

- Google Play ไม่มี API ทางการ ข้อมูลอ่านจากหน้าเว็บผ่านไลบรารี [`google-play-scraper`](https://github.com/facundoolano/google-play-scraper) ถ้า Google เปลี่ยนหน้าเว็บ ขั้นนี้อาจล้มชั่วคราวโดยไม่กระทบข้อมูลส่วนอื่น
- **จำนวนติดตั้งเป็นยอดรวมทั่วโลก** ไม่ใช่เฉพาะไทย การเติบโตต่อวันคิดจากส่วนต่างของยอดนี้ระหว่างวัน จึงเริ่มเห็นตั้งแต่วันที่ 2
- แอปในชาร์ตรวมถูกอ่านรายละเอียดทุกวัน แอปที่อยู่เฉพาะชาร์ตหมวดอ่านทุก 3 วัน เพื่อไม่ส่งคำขอมากเกินไป
- ตัวกรอง "Not on the App Store charts" จับคู่แอปด้วยชื่อ จึงใช้เป็นแนวทางเท่านั้น

## 💬 ตั้งค่าแจ้งเตือน Discord

ทำครั้งเดียว ใช้เวลาประมาณ 3 นาที

**1. สร้าง webhook ใน Discord**

1. เปิด Discord ไปที่ server ของคุณ คลิกชื่อ server มุมซ้ายบน → **Server Settings**
2. เลือก **Integrations** → **Webhooks** → **New Webhook**
3. ตั้งชื่อ (เช่น `Trend Dashboard`) และเลือกช่องที่จะให้โพสต์
4. กด **Copy Webhook URL**

> 🔒 URL นี้คือรหัสลับ ใครได้ไปก็โพสต์เข้าช่องคุณได้ ห้ามใส่ลงในไฟล์ใน repo หรือแปะในที่สาธารณะ

**2. เก็บ URL ไว้ใน GitHub Secret**

1. เปิด repo บน GitHub → **Settings** → **Secrets and variables** → **Actions**
2. กด **New repository secret**
3. Name: `DISCORD_WEBHOOK_URL` · Secret: วาง URL ที่ copy มา → **Add secret**

**3. ทดสอบ**

ไปที่แท็บ **Actions** → **Update trends** → **Run workflow** รอสักครู่ ข้อความจะเข้าช่อง Discord
หลังจากนั้นจะส่งอัตโนมัติทุกวันเวลา 08:00

ดูตัวอย่างข้อความบนเครื่องโดยไม่ส่งจริงได้ด้วย `python scripts/notify_discord.py --dry-run`

## ⚙️ การทำงาน

```mermaid
flowchart LR
    A[⏰ GitHub Actions<br/>ทุกวัน 08:00] --> B[📥 ดึงข้อมูล<br/>App Store 7 ประเทศ + Google Play + Google Trends]
    B --> C[💾 บันทึกเป็น JSON<br/>data/]
    C --> D[🚀 commit กลับเข้า repo]
    D --> E[🌐 GitHub Pages]
    D --> F[💬 Discord]
```

## 📁 โครงสร้างโปรเจกต์

```
trend-dashboard/
├── .github/workflows/   งานอัตโนมัติรายวัน
├── assets/              CSS และ JavaScript ของหน้าเว็บ
├── config/
│   ├── app_charts.json  ชาร์ต หมวด ประเทศ
│   ├── keywords.json    คำค้นของ Google Trends
│   ├── themes.json      คำที่ใช้ติดป้ายธีม
│   └── pains.json       คำที่ใช้นับว่าผู้ใช้บ่นเรื่องอะไร
├── data/                ข้อมูลที่สคริปต์สร้างทุกวัน
│   ├── rank_history/    ประวัติอันดับ App Store 30 วัน แยกไฟล์ตามชาร์ตและหมวด
│   └── play_history/    ประวัติอันดับ Google Play 30 วัน
├── scripts/
│   ├── fetch_apps.py           ชาร์ต App Store ไทย 3 ชาร์ต × 12 หมวด
│   ├── fetch_new_apps.py       แอปใหม่ แอปพรีออเดอร์ และคะแนนมาแรง
│   ├── fetch_global.py         ชาร์ตหลายประเทศ
│   ├── fetch_play.mjs          ชาร์ต Google Play และจำนวนติดตั้ง (Node)
│   ├── fetch_opportunities.py  คะแนนโอกาส และขนาดผู้พัฒนา
│   ├── fetch_reviews.mjs       รีวิวดาวต่ำจาก Google Play (Node)
│   ├── fetch_trends.py         Google Trends
│   └── notify_discord.py       ส่งสรุปเข้า Discord
├── package.json         รายการไลบรารีของสคริปต์ Node
├── new.html             New Apps
├── opportunities.html   Opportunities
├── apps.html            Charts
├── play.html            Google Play
├── compare.html         Global
├── index.html           Google Trends
└── watchlist.html       Watchlist
```

## 🛠️ รันบนเครื่อง

```bash
git clone https://github.com/B1ackmonday/trend-dashboard.git
cd trend-dashboard
python -m venv .venv
.venv\Scripts\activate        # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
npm ci                              # ต้องมี Node 20 ขึ้นไป ใช้กับข้อมูล Google Play
python scripts/fetch_apps.py        # ต้องรันก่อนสคริปต์อื่น
python scripts/fetch_new_apps.py
python scripts/fetch_global.py
node scripts/fetch_play.mjs
python scripts/fetch_opportunities.py   # ต้องรันหลัง fetch_new_apps.py และ fetch_global.py
node scripts/fetch_reviews.mjs          # ต้องรันหลัง fetch_opportunities.py
python scripts/fetch_trends.py
python -m http.server 8000
```

แล้วเปิด `http://localhost:8000/new.html`

## 🎛️ ปรับแต่ง

แก้ไฟล์ `config/app_charts.json`

| ค่า | ความหมาย |
| --- | --- |
| `country` | ประเทศหลัก เช่น `th` |
| `site_url` | URL ของหน้าเว็บ ใช้ทำลิงก์ในข้อความ Discord |
| `charts` | ชาร์ตที่ดึง (Top Free / Paid / Grossing) |
| `genres` | หมวดที่ดึง ใส่รหัสหมวดของ App Store |
| `new_app_max_days` | อายุแอปสูงสุดที่ยังนับเป็นแอปใหม่ |
| `quiet_track_days` | จำนวนวันที่ติดตามแอปที่ยังไม่มีสัญญาณ |
| `history_days` | จำนวนวันที่เก็บประวัติอันดับ |
| `compare.countries` | ประเทศที่ใช้เทียบในหน้า Global |
| `opportunities` | (ไม่ใส่ก็ได้) เช่น `min_reviews` จำนวนรีวิวขั้นต่ำ, `review_apps` จำนวนแอปที่ดึงรีวิว |
| `play` | (ไม่ใส่ก็ได้) เช่น `limit` จำนวนแอปต่อชาร์ต, `detail_budget` จำนวนแอปที่อ่านรายละเอียดต่อวัน |

แก้ `config/themes.json` เพื่อเพิ่มหรือปรับธีม และ `config/pains.json` เพื่อปรับหัวข้อที่นับจากรีวิว คำอังกฤษจับทั้งคำ ส่วนคำไทยจับแบบส่วนหนึ่งของข้อความ

แก้ไฟล์ `config/keywords.json` เพื่อเปลี่ยนคำค้นของ Google Trends (กลุ่มละไม่เกิน 5 คำ ค่าเทียบกันได้เฉพาะภายในกลุ่มเดียวกัน)

## 📡 แหล่งข้อมูล

- **App Store RSS** feed สาธารณะของ Apple สำหรับชาร์ตและแอปใหม่
- **iTunes Lookup API** สำหรับวันที่ปล่อย รีวิว คำอธิบาย ภาพหน้าจอ และเช็กว่าแอปมีขายในประเทศไหน
- **Google Play** ผ่านไลบรารี `google-play-scraper` สำหรับชาร์ต จำนวนติดตั้ง และรีวิว
- **Google Trends** ผ่านไลบรารี `pytrends`

> ⚠️ **ข้อจำกัด:** feed ของ Apple ไม่ได้รับรองอย่างเป็นทางการ Google Play ไม่มี API ทางการ และ Google Trends ให้ค่าความนิยมแบบสัมพัทธ์ (0–100) ไม่ใช่จำนวนจริง ข้อมูลนี้ใช้เป็นแนวทางประกอบการตัดสินใจ ไม่ใช่ตัวเลขที่ยืนยันได้

---

<sub>สร้างด้วย Python, GitHub Actions และ GitHub Pages</sub>
