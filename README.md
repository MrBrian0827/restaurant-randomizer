# Taiwan & Japan Restaurants Randomizer

一個網頁應用，利用 **OpenStreetMap + LocationIQ/Nominatim/Overpass API**，隨機推薦台灣或日本的餐廳，並在地圖上標示。

---

## 功能

- **國家選擇**：可切換台灣或日本。  
  - 切換到日本時會提示「⚠️ 日本地區資料可能不完整」。
- **城市/行政區選擇**：自動載入該國的城市與行政區資料。
- **街道搜尋建議**：輸入街道名稱會提供自動完成功能 (autocomplete)。
- **餐廳類型篩選**：
  - 全部、餐廳、速食、咖啡店、酒吧、麵包/烘焙、甜點、小吃/速食、夜市小吃、飲料/手搖
- **隨機推薦 Top3**：每次搜尋或按「重新抽選」按鈕，隨機推薦三間餐廳。
- **地圖顯示**：
  - Leaflet 地圖標示餐廳位置與行政區邊界
  - 點擊餐廳資訊卡可放大地圖、開啟 Google Maps 或導航
- **智能定位**：可定位使用者當前位置並在地圖顯示
- **暗黑模式 / 光亮模式切換**
- **手機版友善 UI**：搜尋欄可自動隱藏，保留地圖與隨機推薦功能

---

## 安裝與設定

1. 將整個專案下載到本地或部署到伺服器
2. 在 `constants.js` 中設定資料：
   ```javascript
   window.taiwanData // 台灣城市與行政區資料
   window.japanData  // 日本城市與行政區資料 (資料可能不完整)
   window.mapping    // 餐廳類型對應 OSM query
3. 取得 LocationIQ API Key，並在 script.js 中設定：
   javascript
   複製程式碼
   const API_KEY = "你的 LocationIQ API Key";
4. 開啟 index.html 即可使用

---

## 使用方式
    1. 選擇國家（台灣 / 日本）
    2. 選擇城市、行政區
    3. 可輸入街道名稱搜尋，或直接按「搜尋」
    4. 可使用「重新抽選」隨機換三間餐廳
    5. 點擊資訊卡按鈕可：
    - 顯示在地圖
    - 在 Google Maps 開啟
    - 導航（手機優先啟動 App）

---

## 注意事項
    - 日本地區資料目前不完整：
    --某些城市或行政區缺少邊界資訊
    --部分餐廳可能無法正確分類或顯示地址
    -暫停營業或已歇業的店家會自動過濾
    -「這間可能在邊界附近」提示，由 OSM 行政區邊界與餐廳座標比對得出，僅供參考
    -搜尋或 Overpass API 可能因網路或限額問題而失敗，請稍後再試

---

## 技術細節
    -地圖與標記：Leaflet.js
    -地理編碼 (Geocoding)：LocationIQ + Nominatim fallback
    -餐廳資料：OpenStreetMap Overpass API
    -前端：純 HTML / CSS / JS（無後端）
    -隨機推薦邏輯：
    1. 搜尋範圍內找到餐廳清單
    2. 過濾重複 / 歇業 / 不符合行政區的店家
    3. 隨機抽取 Top3
    4. 標記邊界附近餐廳（提示 ⚠️）

---

## 開發者備註
    -可自行擴充 mapping 支援更多餐廳類型或國家
    -若 Overpass API 失敗，可替換為其他公共伺服器
    -建議使用 HTTPS 網頁環境，否則定位與網路檢測功能可能受限