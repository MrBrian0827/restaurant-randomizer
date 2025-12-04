台灣餐廳隨機推薦器 🇹🇼🍽️

一個基於 LocationIQ / Nominatim（地理編碼）以及 Overpass API（OSM 餐廳資料）的網頁工具，讓你可依照「縣市 → 區 → 街道（可選） → 店家類型 → 搜尋半徑」來查詢附近餐廳，並自動從結果中挑選 三間距離最近的店家。

支援

🔍 地址自動完成（街道 / 門牌）

📍 使用者定位

🗺️ Leaflet 地圖標示

🔁 重新抽選三家（不需重新查詢 Overpass）

🧭 多個 Overpass API 端點自動備援

🧹 過濾「歇業」「停業」「廢棄」等店家

🌐 Demo

（你可以放 GitHub Pages / Vercel 連結）

📂 專案結構
project/
│── index.html     # 主頁面
│── style.css      # UI 與版面配置
│── script.js      # 主邏輯：地理編碼 / Overpass / 地圖 / 介面
└── README.md

✨ 功能特色
1. 地址查詢（LocationIQ → Nominatim Fallback）

優先使用 LocationIQ

如果失敗，自動換成 Nominatim

都失敗則回報 null

2. Overpass API 查餐廳

依照地點與半徑搜尋

支援多個類型（餐廳、速食、咖啡、飲料、夜市小吃…）

有多個 Overpass API server 備援

自動重試與 timeout 中止

3. 自動過濾失效店家

排除以下店家：

disused / abandoned

name 或 opening_hours 出現「歇業」「停業」「closed」

shop=vacant

contact:status=closed

4. 三家最近的店家推薦

若使用者按「取得我的位置」，距離以使用者座標排序

若無，則以搜尋中心排序

重新抽選不會再對 API 造成負擔

5. 地圖（Leaflet）

顯示搜尋位置、三家推薦餐廳

click marker → 高亮對應卡片

🚀 使用方式
1. 放到任意 HTTPS 靜態伺服器

例如：

GitHub Pages

Netlify

Vercel

自己的 nginx

2. 必須設定 LocationIQ API Key

打開 script.js：

const API_KEY = "你的 LocationIQ 金鑰";


沒有金鑰會無法使用「街道搜尋」與「地址定位」。
免費方案每日 5000 次，足夠使用。

🧭 搜尋流程
(1) 使用者選縣市 → 選區

↓

(2) 可輸入街道 / 門牌（可選，支援建議清單）

↓

(3) 設定搜尋類型 / 半徑

↓

(4) 前往地理編碼（LocationIQ / Nominatim）

↓

(5) 使用中心點至 Overpass API 搜尋餐廳資料

↓

(6) 排除失效店家 → 排序（距離最近）

↓

(7) 顯示前 3 名 + 地圖 Marker
📦 支援的店家分類（typeSelect）
類別	OSM 對應欄位
餐廳 restaurant	amenity=restaurant
速食 fast_food	amenity=fast_food
咖啡 cafe	amenity=cafe
酒吧 bar	amenity=bar
麵包 bakery	shop=bakery
甜點 ice_cream/patisserie	shop=ice_cream
夜市小吃 takeaway	shop=takeaway
飲料 beverages	shop=beverages
Food court	amenity=food_court
全部	amenity=restaurant（預設多樣查詢）
⚠️ 注意事項

LocationIQ Key 請勿公開放在 GitHub

建議把專案設成 private or 使用 serverless proxy。

Overpass API 若被大量呼叫可能 rate limit

已內建多個 server + 自動重試

過度頻繁仍可能遭拒

輸入門牌地址時

若 OSM 資料不完整，可能需要調整搜尋半徑較大（例如 0 = 全區）

🛠️ 開發 / Build / Deploy
本機開發

用任何 static server（node、python、VSCode Live Server）

例如：

npx serve .


或：

python3 -m http.server

GitHub Pages

把 repo 命名為：

username.github.io


直接推上去即可。

Vercel / Netlify

直接把整個資料夾丟上即可（無 build 步驟）。

🙌 License

MIT — Free for any use.

📧 作者

如果你需要：

加上「Google Place API 版本」

加上「美食評價 / 平均消費」

加上「行車時間（OSRM）」
都可以告訴我，我可以幫你升級。