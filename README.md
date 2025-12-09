# 台灣餐廳隨機推薦系統 🍽️

這是一個使用 OpenStreetMap / Overpass API 與 LocationIQ / Nominatim 的網頁系統，可以在台灣範圍內：

- 查詢指定縣市、鄉鎮街道的餐廳
- 隨機推薦 3 間餐廳
- 在地圖上顯示餐廳位置
- 開啟 Google Maps 精準搜尋或導航
- 支援光模式與暗模式切換

---

## 功能特色

- **隨機推薦**：每次搜尋會隨機顯示 3 間餐廳，且不會重複顯示相同名稱與類型的餐廳。
- **地圖顯示**：整合 Leaflet.js，可直接在地圖上查看餐廳位置，點擊卡片可聚焦餐廳。
- **Google Maps 支援**：
  - 精準搜尋完整地址的餐廳
  - 導航到餐廳位置（使用經緯度或地址）
  - 提示使用者若餐廳未提供名稱或地址
- **光/暗模式**：使用者可切換介面模式。
- **街道自動完成**：輸入街道名稱會提供即時建議。
- **智能網路檢查**：若網路異常，系統會提示，並自動嘗試重試開啟 Google Maps。

---

## 技術棧

- **前端**：HTML / CSS / JavaScript
- **地圖與定位**：
  - [Leaflet.js](https://leafletjs.com/)
  - OpenStreetMap tiles
- **API**：
  - [Overpass API](https://overpass-api.de/) - 查詢餐廳資料
  - [LocationIQ](https://locationiq.com/) / [Nominatim](https://nominatim.openstreetmap.org/) - 地址地理編碼
- **樣式**：
  - CSS Variables 控制光模式 / 暗模式

---

## 安裝與使用
```bash
1. 將專案 clone 或下載到本地：

2. 將 script.js 中的 LocationIQ API key 改成你的： 
const API_KEY = "你的 LocationIQ Key";

3. 開啟 index.html 即可在瀏覽器使用。
建議使用 Chrome / Edge / Firefox 等現代瀏覽器。
```

## 使用說明
1. 選擇縣市與鄉鎮
    下拉選單選擇縣市 → 鄉鎮會自動更新。

2. 輸入街道（可選）
    輸入街道名稱會提供自動完成建議。

3. 選擇餐廳類型（可選）
    可選擇餐廳、速食、咖啡店、甜點等。

4. 設定搜尋半徑（公尺）
    調整 radius slider 決定搜尋範圍。

5. 點擊搜尋按鈕
    系統會顯示隨機 3 間餐廳。

6. 操作餐廳卡片：

    「顯示在地圖」：聚焦該餐廳在地圖上的位置

    「在 Google Maps 開啟」：開啟 Google Maps 精準搜尋

    「導航」：開啟 Google Maps 導航到餐廳

7. 切換光/暗模式
    點擊頁面上的模式切換按鈕即可。

### 注意事項
    若餐廳未提供名稱或完整地址，Google Maps 可能只會顯示座標。

    系統使用公開 API，如大量查詢可能會受到限制。

    定位功能需使用者授權瀏覽器提供地理位置。

    若網路異常，系統會提示並自動嘗試重試開啟 Google Maps。

### 改進建議
    可加入更多餐廳類型 mapping

    支援更多地理編碼服務或 fallback

    優化手機版顯示介面

    加入收藏餐廳功能

### 授權
    MIT License

### 作者
    布萊恩