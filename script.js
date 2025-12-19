/* script.js - 使用 constants.js 拆分的完整版 */
const taiwanData = window.taiwanData;
const mapping = window.mapping;
// ---------- 全域 UA ----------
const ua = navigator.userAgent || navigator.vendor || window.opera;

const API_KEY = "pk.bc63f534da0350a75d49564feb994bfd"; // <- 換成你的 key
const LOCATIONIQ_RETRY = 2;
const NOMINATIM_RETRY = 2;
const OVERPASS_RETRY = 3;
const OVERPASS_SERVERS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter"
];

// ----- DOM -----
const citySelect = document.getElementById("citySelect");
const districtSelect = document.getElementById("districtSelect");
const streetInput = document.getElementById("streetInput");
const streetSuggestions = document.getElementById("streetSuggestions");
const typeSelect = document.getElementById("typeSelect");
const radiusInput = document.getElementById("radiusInput");
const radiusLabel = document.getElementById("radiusLabel");
const searchBtn = document.getElementById("searchBtn");
const reshuffleBtn = document.getElementById("reshuffleBtn");
const resultsPanel = document.getElementById("resultsPanel");
const locateBtn = document.getElementById("locateBtn");
const loadingEl = document.getElementById("loading");
const searchInfoEl = document.getElementById("searchInfo");
const countrySelect = document.getElementById("countrySelect"); // 新增國家選擇

// ----- Leaflet map -----
let currentMapping = mapping; // 預設台灣
let currentCountry = countrySelect.value; // "tw" 或 "jp"
let map = L.map("map", { zoomControl:true }).setView([25.033964,121.564468], 13);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom:19, attribution:'&copy; OpenStreetMap contributors' }).addTo(map);

let currentMarkers = [];
let lastRestaurants = [];
let userLocation = null;
let lastSearchCenter = null;
let allRestaurants = [];
let networkOnlineCache = null;
let networkLastCheck = 0;
let pendingOpenUrl = null;
let shownRestaurantsKeys = new Set();
let similarStreets = [];
let selectedStreetName = null;
let streetInputTimeout;
let streetSelectionConfirmed = false; // 使用者是否確認要直接搜尋
let streetInputDebounceTimeout = null; // debounce 防止輸入太快
const NETWORK_TTL_OK = 15000;
const NETWORK_TTL_FAIL = 60000;

function getRandomTop3(arr, excludeKeys = new Set()){
  const available = arr.filter(r => {
    const key = (r.tags?.name||"") + "|" + (r.tags?.["addr:street"]||"") + "|" + (r.tags?.["addr:housenumber"]||"");
    return !excludeKeys.has(key);
  });
  const shuffled = shuffleArray(available);
  const top3 = shuffled.slice(0,3);
  top3.forEach(r => {
    const polygonGeo = lastSearchCenter?.raw?.geojson;
    const lat = r.lat || r.center?.lat;
    const lon = r.lon || r.center?.lon;
    r.isBoundary = polygonGeo && lat != null && lon != null ? !pointInPolygon([lon,lat], polygonGeo) : false;
  });
  return top3;
}

const themeToggleBtn = document.getElementById("themeToggle");
// 初始化文字
function updateThemeButtonText() {
  if (document.body.classList.contains("dark-mode")) {
    themeToggleBtn.textContent = "切換光亮模式";
  } else {
    themeToggleBtn.textContent = "切換黑暗模式";
  }
}

// 讀取使用者偏好
const savedTheme = localStorage.getItem("theme");
if (savedTheme === "dark") document.body.classList.add("dark-mode");
updateThemeButtonText();

// ---------- 初始頁面載入時更新半徑 ----------
userLocation = null;   
updateRadiusVisibility();

// 切換模式
themeToggleBtn.addEventListener("click", () => {
  document.body.classList.toggle("dark-mode");
  const isDark = document.body.classList.contains("dark-mode");
  localStorage.setItem("theme", isDark ? "dark" : "light");
  updateThemeButtonText();
});

// ----- reshuffle top 3 -----
reshuffleBtn.addEventListener('click', ()=>{ 
  if(!allRestaurants || allRestaurants.length===0) return;
  // 僅過濾本輪 top3，忽略全局 shownRestaurantsKeys
  const top3 = getRandomTop3(allRestaurants, new Set());
  renderResults(top3);
});

// 重新查詢按鈕（手機版）
const redoBtn = document.getElementById("redoBtn");
if(redoBtn){
  redoBtn.addEventListener("click", ()=>{
    expandSearchControls();
    userLocation = null;
    resultsPanel.innerHTML = "";
    // 清空同輪餐廳，重置真正隨機
    if(allRestaurants && allRestaurants.length > 0){
      const top3 = getRandomTop3(allRestaurants, new Set());
      renderResults(top3);
    }
    // 重新顯示 redoBtn（手機版用）
    redoBtn.style.display = "none";
  });
}

searchBtn.addEventListener('click', handleSearch);

// ----- Helpers -----
// 顯示 loading 遮罩
function showLoading() {
  if(loadingEl) loadingEl.classList.add('show');
}
// 隱藏 loading 遮罩
function hideLoading() {
  if(loadingEl) loadingEl.classList.remove('show');
}
// 設定搜尋或 reshuffle 等操作忙碌狀態
function setBusy(val){
  searchBtn.disabled = val;
  reshuffleBtn.disabled = val;
  citySelect.disabled = val;
  districtSelect.disabled = val;
  streetInput.disabled = val;
  typeSelect.disabled = val;
  locateBtn.disabled = val;
}
// fetch 包裝，避免超時
async function fetchWithTimeout(url, opts={}, timeout=10000){
  const controller = new AbortController();
  const id = setTimeout(()=>controller.abort(), timeout);
  try {
    const r = await fetch(url, { signal: controller.signal, ...opts });
    clearTimeout(id);
    return r;
  } catch(e) {
    clearTimeout(id);
    throw e;
  }
}

// ----- Network check with TTL -----
async function ensureNetwork(){
  if(location.protocol === "file:") return true;
  const now = Date.now();
  let needCheck = false;
  if(networkOnlineCache === null) needCheck = true;
  else if(networkOnlineCache && now - networkLastCheck > NETWORK_TTL_OK) needCheck = true;
  else if(!networkOnlineCache && now - networkLastCheck > NETWORK_TTL_FAIL) needCheck = true;

  if(needCheck){
    try{
      const resp = await fetch("https://www.google.com/favicon.ico", { method: "HEAD", cache: "no-cache" });
      networkOnlineCache = resp.ok;
    }catch{
      networkOnlineCache = false;
    }
    networkLastCheck = now;
  }
  return networkOnlineCache;
}

async function openUrlSmart(url) {
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  // -------------------------
  // Desktop: 直接開網頁即可，不再額外檢查網路
  // -------------------------
  if (!isMobile) {
    window.open(url, "_blank");
    return;
  }

  // -------------------------
  // Mobile: 使用 App 優先 → 失敗才 fallback
  // -------------------------
  if (isIOS()) {
    // 先嘗試 Google Maps App
    window.location.href = url.replace("https://www.google.com/maps", "comgooglemaps://");

    // fallback
    setTimeout(() => {
      window.location.href = url;
    }, 800);

    return;
  }

  if (isAndroid()) {
    // Android 用 intent 方式
    const intentUrl =
      `intent://maps.google.com/maps?q=${encodeURIComponent(url)}#Intent;scheme=https;package=com.google.android.apps.maps;end`;

    window.location.href = intentUrl;

    // fallback
    setTimeout(() => {
      window.location.href = url;
    }, 800);

    return;
  }
}

function populateCitiesAndDistricts(){
  const country = countrySelect.value; // tw / jp
  const dataSource = country === "jp" ? window.japanData : window.taiwanData;

  // 清空 citySelect
  citySelect.innerHTML = "";
  Object.keys(dataSource).forEach(city=>{
    const o = document.createElement("option");
    o.value = city; o.textContent = city;
    citySelect.appendChild(o);
  });

  // 選擇第一個城市
  citySelect.selectedIndex = 0;
  populateDistricts(dataSource, citySelect.value);
}

// 一開始桌機版隱藏
if(!isMobile()) {
  locateBtn.style.display = 'none';
  locateBtn.disabled = true;
}

// 折疊搜尋欄位（手機版）
function collapseSearchControls(showRadius=false) {
  setSearchControlsVisible(false);

  // radius 只在需要時顯示
  radiusInput.parentElement.style.display = showRadius ? "" : "none";

  // 隱藏搜尋按鈕
  searchBtn.style.display = "none";

  // reshuffle 按鈕保持可見
  reshuffleBtn.style.display = "inline-block";
  if(!isMobile()){
    locateBtn.style.display = 'none';
    locateBtn.disabled = true;
  }

  // 重新查詢按鈕
  let redoBtn = document.getElementById("redoBtn");
  if(!redoBtn){
    redoBtn = document.createElement("button");
    redoBtn.id = "redoBtn";
    redoBtn.textContent = "重新查詢";
    resultsPanel.parentElement.insertBefore(redoBtn, resultsPanel);
    redoBtn.addEventListener("click", ()=>{
      expandSearchControls();
      if(userLocation) userLocation = null; // 重置定位
      resultsPanel.innerHTML = "";
      redoBtn.style.display = "none";
    });
  } else {
    redoBtn.style.display = "inline-block";
  }
}

// 展開搜尋欄位（手機版）
function expandSearchControls() {
  setSearchControlsVisible(true);
  updateRadiusVisibility();
  
  // 顯示搜尋按鈕
  searchBtn.style.display = "inline-block";
}

function populateDistricts(dataSource, city){
  districtSelect.innerHTML = "";

  const districts = dataSource[city];
  if(!districts || districts.length===0){
    const o = document.createElement("option");
    o.value = city;
    o.textContent = city;
    districtSelect.appendChild(o);
  } else {
    districts.forEach(d=>{
      const o = document.createElement("option");
      o.value = d; o.textContent = d;
      districtSelect.appendChild(o);
    });
  }
}

function clearStreetSuggestions() {
  streetSuggestions.innerHTML = '';
  suggestionItems = [];
  selectedSuggestionIndex = -1;
  // 不清空 similarStreets，保留多段選擇資料
}

// 初始化
populateCitiesAndDistricts();

// 當使用者切換國家
const appTitle = document.getElementById("appTitle");

countrySelect.addEventListener("change", () => {
  const newCountry = countrySelect.value;
  currentCountry = newCountry;

  populateCitiesAndDistricts(); // 重新載入城市資料

  // 如果切換到日本，提醒使用者
  if (newCountry === "jp") {
    alert("⚠️ 日本地區資料可能不完整，部分城市或餐廳資訊缺失");
  }

  // 更新頁面標題
  const titleEl = document.querySelector(".header h1");
  if(titleEl){
    titleEl.textContent = newCountry === "tw" ? "台灣餐廳隨機推薦器" : "日本餐廳隨機推薦器";
  }

  // 清空搜尋欄與結果
  streetInput.value = "";
  streetSuggestions.innerHTML = "";
  resultsPanel.innerHTML = "";

  // 重置地圖視角
  map.setView([25.033964, 121.564468], 13); // 預設台灣台北
});

// 當使用者切換城市
citySelect.addEventListener("change", ()=>{
  const country = countrySelect.value;
  const dataSource = country === "jp" ? window.japanData : window.taiwanData;
  populateDistricts(dataSource, citySelect.value);
});

// ----- Restaurant types dropdown -----
const typeOptions = [
  { label: "全部", value: "" },
  { label: "餐廳 (restaurant)", value: "restaurant" },
  { label: "速食 (fast_food)", value: "fast_food" },
  { label: "咖啡店 (cafe)", value: "cafe" },
  { label: "酒吧 (bar)", value: "bar" },
  { label: "麵包/烘焙 (bakery)", value: "bakery" },
  { label: "甜點 (ice_cream/patisserie)", value: "ice_cream" },
  { label: "小吃/速食 (food_court)", value: "food_court" },
  { label: "夜市小吃 (takeaway)", value: "takeaway" },
  { label: "飲料/手搖 (beverages)", value: "beverages" }
];
typeOptions.forEach(opt=>{
  const o = document.createElement("option"); o.value = opt.value; o.textContent = opt.label;
  typeSelect.appendChild(o);
});

// ----------- 三個來源抓街道候選 -----------

async function fetchLocationIQ(q, city, district, country) {
  try {
    const url = `https://us1.locationiq.com/v1/search.php?key=${API_KEY}&q=${encodeURIComponent(city + ' ' + district + ' ' + q)}&format=json&addressdetails=1&countrycodes=${country}&limit=6`;
    const r = await fetchWithTimeout(url);
    const j = r.ok ? await r.json() : [];
    return j.map(item => ({ road: item.address?.road || item.display_name, lat: parseFloat(item.lat), lon: parseFloat(item.lon) }));
  } catch { return []; }
}

async function fetchNominatim(q, city, district, country) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&q=${encodeURIComponent(city + ' ' + district + ' ' + q)}&countrycodes=${country}&limit=6`;
    const r = await fetchWithTimeout(url, { headers: { "Accept": "application/json" } });
    const j = r.ok ? await r.json() : [];
    return j.map(item => ({ road: item.address?.road || item.display_name, lat: parseFloat(item.lat), lon: parseFloat(item.lon) }));
  } catch { return []; }
}

async function fetchOverpassStreet(q, district) {
  try {
    const query = `[out:json][timeout:5];area["name"="${district}"]->.a;(way(area.a)[highway~".*"];);out center;`;
    const data = await overpassQuery(query);
    if(!data || !data.elements) return [];
    return data.elements.map(el => ({
      road: el.tags?.name,
      lat: el.lat || el.center?.lat,
      lon: el.lon || el.center?.lon
    })).filter(e => e.road);
  } catch { return []; }
}

async function searchPreciseStreet(query, city, district, country){
  const mainRoad = extractMainRoad(query);
  const candidates = [];

  // ---- LocationIQ ----
  try {
    const url1 = `https://us1.locationiq.com/v1/search.php?key=${API_KEY}&q=${encodeURIComponent(city+' '+district+' '+query)}&format=json&addressdetails=1&countrycodes=${country.toUpperCase()}&limit=6`;
    const r1 = await fetchWithTimeout(url1, {}, 8000);
    if(r1.ok) {
      const j1 = await r1.json();
      candidates.push(...j1);
    }
  } catch(e){ console.warn("LocationIQ fail:", e); }

  // ---- Nominatim fallback ----
  try {
    const url2 = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&q=${encodeURIComponent(city+' '+district+' '+query)}&limit=6`;
    const r2 = await fetchWithTimeout(url2, { headers: { "Accept":"application/json" } }, 8000);
    if(r2.ok){
      const j2 = await r2.json();
      candidates.push(...j2);
    }
  } catch(e){ console.warn("Nominatim fail:", e); }

  // ---- Overpass (抓道路) ----
  try {
    const overpassQueryStr = `[out:json];way["highway"]["name"~"${mainRoad}"](area);out center;`; 
    // 注意：area 可以視需求指定行政區，如果沒有 area，可能抓到全區
    const overpassData = await overpassQuery(overpassQueryStr);
    if(overpassData.elements) candidates.push(...overpassData.elements);
  } catch(e){ console.warn("Overpass fail:", e); }

  // ---- 過濾候選，至少包含主要路名 ----
  const filtered = candidates.filter(c => c.lat || (c.center && c.center.lat))
    .filter(c => {
      const nameToCheck = ((c.address?.road) || c.display_name || c.tags?.name || "").toLowerCase();
      return nameToCheck.includes(mainRoad.toLowerCase());
    });

  // ---- 排序：距離 query 越近越前面（Levenshtein） ----
  filtered.sort((a,b)=>{
    const aName = (a.address?.road) || a.display_name || a.tags?.name || "";
    const bName = (b.address?.road) || b.display_name || b.tags?.name || "";
    return levenshtein(aName, query) - levenshtein(bName, query);
  });

  return filtered;
}

function updateStreetSuggestions(list){
  streetSuggestions.innerHTML = '';
  suggestionItems = [];
  list.forEach(item => {
    const div = document.createElement('div');
    div.className = 'suggestion-item';
    div.textContent = item; // 可以改成顯示完整 display_name
    div.addEventListener('click', ()=>{
      streetInput.value = item;
      streetSelectionConfirmed = true;
      clearStreetSuggestions();
      searchBtn.click();
    });
    streetSuggestions.appendChild(div);
    suggestionItems.push(div);
  });
}

function extractMainRoad(query){
  // 假設使用者輸入可能包含門牌號碼或段數，只取路/街/巷部分
  const match = query.match(/[\u4e00-\u9fa5]+(路|街|巷)(?:\d*段)?/);
  return match ? match[0] : query;
}

// ----- Geocode -----
async function geocode(query) {
  // LocationIQ
  try {
    return await fetchWithRetry(async () => {
      const url = `https://us1.locationiq.com/v1/search.php?key=${API_KEY}&q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=3`;
      const r = await fetchWithTimeout(url, {}, 8000);
      if (!r.ok) throw new Error("LocationIQ failed");
      const j = await r.json();
      if (j.length === 0) throw new Error("No results from LocationIQ");
      return { lat: parseFloat(j[0].lat), lon: parseFloat(j[0].lon), raw: j[0] };
    }, LOCATIONIQ_RETRY);
  } catch(e) {
    console.warn("LocationIQ failed, fallback to Nominatim");
  }

  // Nominatim fallback
  try {
    return await fetchWithRetry(async () => {
      const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&q=${encodeURIComponent(query)}&limit=3`;
      const r = await fetchWithTimeout(url, { headers: {"Accept":"application/json"} }, 8000);
      if (!r.ok) throw new Error("Nominatim failed");
      const j = await r.json();
      if (j.length === 0) throw new Error("No results from Nominatim");
      return { lat: parseFloat(j[0].lat), lon: parseFloat(j[0].lon), raw: j[0] };
    }, NOMINATIM_RETRY);
  } catch(e) {
    console.warn("Nominatim failed:", e);
  }

  return null;
}

// ----- Overpass query -----
async function overpassQuery(query) {
  for (const endpoint of OVERPASS_SERVERS) {
    try {
      return await fetchWithRetry(async () => {
        const r = await fetchWithTimeout(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: query
        }, 15000);

        const text = await r.text();
        if (text.trim().startsWith('<')) throw new Error("HTML error, skip");
        return JSON.parse(text);
      }, OVERPASS_RETRY);
    } catch (e) {
      console.warn(`Overpass attempt failed for ${endpoint}:`, e);
    }
  }
  console.warn("All Overpass servers failed");
  return { elements: [] };
}

// ----- 判斷點是否在多邊形 Polygon 內 (ray-casting) -----
function pointInPolygon(point, polygon) {
  const x = point[0], y = point[1];
  let inside = false;

  const coords = polygon.type === "Polygon" ? polygon.coordinates : polygon.coordinates[0];
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    const xi = coords[i][0], yi = coords[i][1];
    const xj = coords[j][0], yj = coords[j][1];

    const intersect = ((yi > y) !== (yj > y)) &&
                      (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// ----- Levenshtein 距離 -----
function levenshtein(a, b) {
  if(a.length === 0) return b.length;
  if(b.length === 0) return a.length;
  const matrix = [];
  for(let i = 0; i <= b.length; i++) matrix[i] = [i];
  for(let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for(let i = 1; i <= b.length; i++){
    for(let j = 1; j <= a.length; j++){
      if(b.charAt(i-1) === a.charAt(j-1)){
        matrix[i][j] = matrix[i-1][j-1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i-1][j-1]+1,
          matrix[i][j-1]+1,
          matrix[i-1][j]+1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

async function findRestaurants(lat, lon, radius=1000, type='') {
  const arr = type ? (currentMapping[type] || currentMapping["restaurant"]) : currentMapping["restaurant"];
  // 行政區 bounding box (只在 radius = 0 表示整個行政區)
    let bboxFilter = null;
    let polygonGeo = null;
    // 只在 radius = 0 時才套用行政區邊界
    if (radius === 0 && lastSearchCenter?.raw?.boundingbox) {
      const bb = lastSearchCenter.raw.boundingbox.map(parseFloat); // [south, north, west, east]
      bboxFilter = bb;
      polygonGeo = lastSearchCenter.raw.geojson || null;
    } else {
      bboxFilter = null;
      polygonGeo = null;
    }

  // Overpass filters
  function buildOverpassFilter(tag, lat, lon, radius, bbox) {
    if (radius === 0 && bbox) {
      return `${tag}(${bbox[0]},${bbox[2]},${bbox[1]},${bbox[3]});`;
    } else {
      return `${tag}(around:${radius},${lat},${lon});`;
    }
  }
  const filters = arr.map(s => buildOverpassFilter(s, lat, lon, radius, bboxFilter));
  const q = `[out:json];(${filters.join('')});out center tags;`;
  const data = await overpassQuery(q);
  const elements = data.elements || [];

  const seen = new Set();
  const targetCity = citySelect.value;
  const targetDistrict = districtSelect.value;

  const exactMatch = [];
  const fuzzyMatch = [];

  elements.forEach(e => {
    const t = e.tags || {};

    // 過濾歇業、停業或已廢棄
    if (t.disused || t.abandoned || t["disused:amenity"] || t["abandoned:amenity"]) return;
    if (t.shop === "vacant") return;
    if (t.closed || t["contact:status"] === "closed") return;
    if (t.opening_hours && /closed|off|休業|歇業|永久/i.test(t.opening_hours)) return;
    if (t.name && /歇業|停業|永久|結束營業|closed/i.test(t.name)) return;

    // 過濾重複餐廳
    const key = (t.name||"") + "|" + (t["addr:street"]||"") + "|" + (t["addr:housenumber"]||"");
    if (seen.has(key)) return;
    seen.add(key);

    const eLat = e.lat || e.center?.lat;
    const eLon = e.lon || e.center?.lon;
    if (!eLat || !eLon) return;

    // 判斷是否在範圍內
    const isBoundary = !isWithinBounds(eLat, eLon, bboxFilter, polygonGeo);

    // 仍加入結果，但標註「可能在邊界」

    // 行政區文字比對 + Levenshtein 容錯
    const addrCity = (t["addr:city"] || t["addr:county"] || t["addr:state"] || t["addr:town"] || "").trim();
    const addrDistrict = (t["addr:district"] || t["addr:suburb"] || t["addr:village"] || "").trim();

    const maxDistCity = Math.floor(Math.max(addrCity.length, targetCity.length) * 0.3);
    const maxDistDistrict = Math.floor(Math.max(addrDistrict.length, targetDistrict.length) * 0.3);

    const cityMatch = !addrCity || levenshtein(addrCity, targetCity) <= maxDistCity;
    const districtMatch = !addrDistrict || levenshtein(addrDistrict, targetDistrict) <= maxDistDistrict;

    // 優先完全匹配
    if (addrDistrict && addrDistrict === targetDistrict && districtMatch && cityMatch) {
      exactMatch.push(e);
    } else if (districtMatch && cityMatch) {
      fuzzyMatch.push(e); // 邊界餐廳
    }
  });

  // 最終結果：先 exactMatch，再 fuzzyMatch
  return exactMatch.concat(fuzzyMatch);
}

// ----- clearMarkers & distance -----
function clearMarkers(){ currentMarkers.forEach(m=>map.removeLayer(m)); currentMarkers = []; }
function distance(lat1,lon1,lat2,lon2){const R=6371000; const toRad=Math.PI/180;
  const φ1=lat1*toRad, φ2=lat2*toRad;
  const Δφ=(lat2-lat1)*toRad, Δλ=(lon2-lon1)*toRad;
  const a=Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  const c=2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
  return R*c;
}

// 點擊其他地方時收起下拉選單
document.addEventListener('click', (e) => {
  if (!streetInput.contains(e.target) && !streetSuggestions.contains(e.target)) {
    clearStreetSuggestions();  // 清掉 autocomplete
    // 保留 full street 提示
    handleStreetDisambiguation();
  }
});

// 修改 handleSearch
async function handleSearch() {
  const streetQuery = streetInput.value.trim();
  // 如果下拉選單還有建議，但使用者還沒確認
  if(suggestionItems.length > 0 && !streetSelectionConfirmed){
    const confirmResult = confirm("偵測到多個相似街道，是否要使用目前輸入的文字進行搜尋？");
    if(!confirmResult) {
      hideLoading();
      setBusy(false);
      return; // 停止搜尋，讓使用者選
    }
    streetSelectionConfirmed = true; // 使用者確認要直接搜尋
  }
  
  handleStreetDisambiguation(); // 保證即使直接按搜尋也會檢查多條路
  showLoading(); setBusy(true);
  try {
    const streetQuery = streetInput.value.trim();

    // 如果下拉選單存在，提示使用者確認
    if (suggestionItems.length > 0 && !streetSelectionConfirmed) {
      const confirmResult = confirm("偵測到多個相似街道，是否要使用目前輸入的文字進行搜尋？");
      if (!confirmResult) return; // 停止搜尋，讓使用者選
      streetSelectionConfirmed = true; // 使用者確定要直接搜尋
    }

    const queryStr = citySelect.value + " " + districtSelect.value + " " + streetQuery;
    const results = await searchPreciseStreet(streetQuery, citySelect.value, districtSelect.value, countrySelect.value);
    if(!results || !results.length){
      alert("找不到位置");
      return;
    }
    const geo = {
      lat: parseFloat(results[0].lat || results[0].center?.lat),
      lon: parseFloat(results[0].lon || results[0].center?.lon),
      raw: results[0]
    };
    lastSearchCenter = geo;

    const radius = parseInt(radiusInput.value) || 1000;
    const restaurants = await findRestaurants(geo.lat, geo.lon, radius, typeSelect.value);
    if(restaurants.length===0){
      resultsPanel.innerHTML = "<div class='small'>找不到符合的餐廳，但可能在附近。</div>";
    } else {
      allRestaurants = restaurants; // 全部餐廳
      const top3 = getRandomTop3(allRestaurants); // 隨機取前三
      renderResults(top3);
    }
    map.setView([geo.lat, geo.lon], 16);
  } catch(e){ console.error(e); alert("搜尋失敗"); }
  finally { hideLoading(); setBusy(false); }
}

// 判斷使用者輸入是否完整街道名稱
function isStreetInputComplete(input){
  // 假設完整名稱至少包含「路」「街」「巷」等
  return /路|街|巷/.test(input);
}

function handleMapClick(type, query) {
  const fallbackUrl = `https://www.google.com/maps/${type === 'nav' ? 'dir' : 'search'}/?api=1&${type === 'nav' ? 'destination' : 'query'}=${query}&travelmode=driving`;
  
  if (isIOS()) {
    const iosUrl = type === 'nav' 
      ? `comgooglemaps://?daddr=${query}&directionsmode=driving`
      : `comgooglemaps://?q=${query}&zoom=16`;
    window.location.href = iosUrl;
    setTimeout(() => window.open(fallbackUrl, "_blank"), 500);
  } else if (isAndroid()) {
    const androidUrl = type === 'nav'
      ? `intent://maps.google.com/maps?daddr=${query}&directionsmode=driving#Intent;scheme=https;package=com.google.android.apps.maps;end`
      : `intent://maps.google.com/maps?q=${query}#Intent;scheme=https;package=com.google.android.apps.maps;end`;
    window.location.href = androidUrl;
    setTimeout(() => window.open(fallbackUrl, "_blank"), 500);
  } else {
    window.open(fallbackUrl, "_blank");
  }
}

async function fetchWithRetry(fetchFn, retries = 2, delay = 500) {
  let lastError;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fetchFn();
    } catch (e) {
      lastError = e;
      if (i < retries) await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}

// 判斷點是否在範圍內（bounding box + polygon）
function isWithinBounds(lat, lon, bbox, polygonGeo) {
  if (bbox) {
    const [south, north, west, east] = bbox;
    if (lat < south || lat > north || lon < west || lon > east) return false;
  }

  if (polygonGeo) {
    if (!pointInPolygon([lon, lat], polygonGeo)) return false;
  }

  return true;
}

function createActionButtons(lat, lon, name, address) {
  const container = document.createElement("div");
  container.className = "card-actions";

  // 顯示在地圖
  const btnView = document.createElement("button");
  btnView.textContent = "📍 顯示在地圖";
  btnView.classList.add("action-btn", "map-btn");
  btnView.onclick = () => {
    map.setView([lat, lon], 17);
    currentMarkers.forEach(m => {
      if (m.getLatLng().lat === lat && m.getLatLng().lng === lon) m.openPopup();
    });
    if (isMobile()) {
      const mapEl = document.getElementById("map");
      if (mapEl) {
        setTimeout(() => {
          const rect = mapEl.getBoundingClientRect();
          const scrollTop = window.scrollY || window.pageYOffset;
          window.scrollTo({ top: rect.top + scrollTop - 20, behavior: "smooth" });
        }, 100);
      }
    }
  };
  container.appendChild(btnView);

  // Google Maps 開啟
  const btnMaps = document.createElement("button");
  btnMaps.textContent = "🗺️ 在 Google Maps 開啟";
  btnMaps.classList.add("action-btn", "google-btn");
  btnMaps.onclick = () => {
    const query = address ? encodeURIComponent(name + " " + address) : `${lat},${lon}`;
    if (!address) alert("注意：此店家名稱可能無法顯示，將使用經緯度定位");
    handleMapClick('search', query);
  };
  container.appendChild(btnMaps);

  // 導航
  const btnNav = document.createElement("button");
  btnNav.textContent = "🚗 導航";
  btnNav.classList.add("action-btn", "nav-btn");
  btnNav.onclick = () => {
    let dest = address ? `${address}, ${districtSelect.value}, ${citySelect.value}` : `${lat},${lon}`;
    if (!address) alert("注意：此店家名稱可能無法顯示，將使用經緯度導航");
    dest = encodeURIComponent(dest.trim());
    handleMapClick('nav', dest);
  };
  container.appendChild(btnNav);

  return container;
}

function handleStreetDisambiguation() {
  const hintEl = document.getElementById("streetDisambiguation");
  if (!hintEl) return;

  const unique = [...new Set(similarStreets)];

  // 如果想完全不顯示提示
  hintEl.style.display = "none";

  // 或者想保留簡單提示（可選）
  /*
  if (unique.length > 1) {
    hintEl.textContent = "多條相似街道，請從下拉選單選擇";
    hintEl.style.display = "block";
  } else {
    hintEl.style.display = "none";
  }
  */
}

// ----- renderResults -----
function renderResults(restaurants){
  // 先清除舊的 marker
  clearMarkers();

  // 清空結果面板
  resultsPanel.innerHTML = "";
  if(!restaurants || restaurants.length===0){
    resultsPanel.innerHTML = `<div class="small">找不到符合的餐廳。</div>`;
    return;
  }

  // ----- 畫行政區 polygon -----
  const polygonGeo = lastSearchCenter?.raw?.geojson;
  if(polygonGeo){
    if(window.currentPolygon) map.removeLayer(window.currentPolygon); // 移除舊 polygon
    window.currentPolygon = L.geoJSON(polygonGeo, {
      style: { color: "#f39c12", weight: 2, fillOpacity: 0.0 }
    }).addTo(map);
    map.fitBounds(window.currentPolygon.getBounds());
  }

  lastRestaurants = restaurants; // 紀錄目前顯示的餐廳
  restaurants.forEach(item=>{
    const lat = item.lat || item.center?.lat;
    const lon = item.lon || item.center?.lon;
    const tags = item.tags || {};
    const name = tags.name || "未提供名稱";
    const address = (tags["addr:full"] || tags["addr:street"] || tags["addr:housenumber"] || "").trim();
    const hours = tags.opening_hours || "";
    const phone = tags.phone || tags["contact:phone"] || "";
    const rating = tags.rating || tags['aggregate_rating'] || null;

    // ----- 邊界標註 -----
    const boundaryNote = item.isBoundary ? "<br><span style='color:#f39c12'>⚠️ 這間可能在邊界附近，座標可能不完全在本區</span>" : "";

    // ----- Leaflet marker -----
    const marker = L.marker([lat,lon]).addTo(map);
    currentMarkers.push(marker);
    marker.bindPopup(
      `<b>${name}</b><br>${address || ''}<br>` +
      `${hours ? '營業時間：'+hours : ''}${phone ? '<br>電話：'+phone : ''}${rating ? '<br>評價：'+rating+' (OSM)' : ''}` +
      `${boundaryNote}`
    );

    // ----- 建立資訊卡 -----
    const card = document.createElement("div");
    card.className = "card";

    // 左邊資訊
    const left = document.createElement("div");
    left.className = "card-left";
    left.innerHTML = `
      <p class="card-title">${name}</p>
      <p class="card-sub">${address || '<span style="color:#999">地址未提供</span>'}</p>
      <p class="card-sub">${hours ? '營業時間：'+hours : ''}${phone ? ' • 電話：'+phone : ''}</p>
      ${rating ? `<p class="card-sub">評價：${rating} (OSM)</p>` : ''}
      ${item.isBoundary ? "<br><span style='color:#f39c12'>⚠️ 可能在邊界附近</span>" : ""}
    `;
      // 右邊按鈕 (只呼叫一次)
      const right = createActionButtons(lat, lon, name, address);
      // 組合 card
      card.appendChild(left);
      card.appendChild(right);
      // append 到結果面板
      resultsPanel.appendChild(card);
  });

  // ----- 手機版額外處理 -----
  if(isMobile()){
    const showRadius = !!userLocation || streetInput.value.trim() !== "";
    collapseSearchControls(showRadius);
  }
}

// ----- Street autocomplete -----
let selectedSuggestionIndex = -1;
let suggestionItems = [];

streetInput.addEventListener('input', () => {
    streetSelectionConfirmed = false; // 每次輸入都需要重新確認
    if(streetInputDebounceTimeout) clearTimeout(streetInputDebounceTimeout);
    streetInputDebounceTimeout = setTimeout(async () => {
        const q = streetInput.value.trim();
        if(!q){ 
            clearStreetSuggestions(); 
            return; 
        }
        streetSuggestions.innerHTML = '<div class="small">搜尋建議中…</div>';
        updateRadiusVisibility();
        // ⭐ 每次輸入清空候選街道
        similarStreets = [];
        try {
            const country = countrySelect.value;
            const city = citySelect.value;
            const district = districtSelect.value;
            // 使用混合搜尋 (LocationIQ + Nominatim + Overpass)
            const results = await searchPreciseStreet(q, city, district, country);
            if(!results.length){
                streetSuggestions.innerHTML = '<div class="small">找不到建議路名</div>';
                suggestionItems = [];
                return;
            }
            // 更新下拉選單
            streetSuggestions.innerHTML = '';
            suggestionItems = [];
            results.forEach(item => {
                // 路名
                let road = item.address?.road || item.tags?.name || item.display_name || '';
                if(!road) return;
                // 區
                let subDistrict = item.address?.suburb || item.address?.village || item.address?.district || '';
                // 移除 city / country
                const removeParts = [city];
                if(country.toLowerCase() === 'tw') removeParts.push('台灣');
                if(country.toLowerCase() === 'jp') removeParts.push('日本');
                removeParts.forEach(p => { if(p) road = road.replace(p, ''); });
                road = road.trim();
                subDistrict = subDistrict.trim();
                const display = subDistrict ? `${road}, ${subDistrict}` : road;
                const div = document.createElement('div');
                div.className = 'suggestion-item';
                div.textContent = display;
                div.addEventListener('click', () => {
                    streetInput.value = display;
                    streetSelectionConfirmed = true;
                    clearStreetSuggestions();
                    searchBtn.click();
                });
                // ⭐ 儲存候選街道名稱（不重複）
                if(item.address?.road && !similarStreets.includes(item.address.road)) similarStreets.push(item.address.road);
                streetSuggestions.appendChild(div);
                suggestionItems.push(div);
            });
        } catch(e){
            console.error(e);
            streetSuggestions.innerHTML = '';
            suggestionItems = [];
        }
    }, 300); // debounce
});

// 讓點回輸入框時，autocomplete 再顯示
streetInput.addEventListener('focus', () => {
  if(streetInput.value.trim() !== "") {
    // 觸發 input 事件，重新取得下拉建議
    streetInput.dispatchEvent(new Event('input'));
  }
});

streetInput.addEventListener('keydown', (e)=>{
  if(!suggestionItems.length) return;
  if(e.key==='ArrowDown'){ e.preventDefault(); selectedSuggestionIndex=(selectedSuggestionIndex+1)%suggestionItems.length; updateSuggestionHighlight(); }
  else if(e.key==='ArrowUp'){ e.preventDefault(); selectedSuggestionIndex=(selectedSuggestionIndex-1+suggestionItems.length)%suggestionItems.length; updateSuggestionHighlight(); }
  else if(e.key==='Enter'){ if(selectedSuggestionIndex>=0){ e.preventDefault(); streetInput.value=suggestionItems[selectedSuggestionIndex].textContent; streetSuggestions.innerHTML=''; suggestionItems=[]; selectedSuggestionIndex=-1; searchBtn.click(); } }
});

function updateSuggestionHighlight() {
  suggestionItems.forEach((el,i)=>{
    if(i===selectedSuggestionIndex){
      el.classList.add('highlight');
      el.scrollIntoView({block:'nearest'});
    }else{
      el.classList.remove('highlight');
    }
  });
}

// ----- 智能定位 -----
locateBtn.addEventListener('click', ()=>{
  if(navigator.geolocation){
    navigator.geolocation.getCurrentPosition(pos=>{
       userLocation={lat:pos.coords.latitude, lon:pos.coords.longitude}; 
       map.setView([userLocation.lat,userLocation.lon],16); 
       updateRadiusVisibility(); // <- 新增這行
      }, err=>alert("定位失敗: "+err.message));
  }else{ alert("瀏覽器不支援定位"); }
});

function shuffleArray(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

function updateRadiusVisibility() {
  const streetFilled = streetInput.value.trim() !== "";
  const radiusCol = radiusInput.parentElement; // 包含 label 與 slider

  if(streetFilled || userLocation){  // 街道有填或已定位
    radiusCol.style.display = "block";
  } else {  // 只有區，或沒定位
    radiusCol.style.display = "none";
  }
}

// ----- 手機 / 作業系統偵測 -----
function isMobile() {
  return /android/i.test(ua) || /iPad|iPhone|iPod/.test(ua);
}
function isIOS() {
  return /iPad|iPhone|iPod/.test(ua);
}
function isAndroid() {
  return /android/i.test(ua);
}

// ----- 開啟 Google Maps App 或 fallback -----
function openMapsApp(query) {
  const fallbackUrl = `https://www.google.com/maps/search/?api=1&query=${query}`;

  if (isIOS()) {
    window.location.href = `comgooglemaps://?q=${query}&zoom=16`;
    setTimeout(() => window.open(fallbackUrl, "_blank"), 500);
  } else if (isAndroid()) {
    window.location.href = `intent://maps.google.com/maps?q=${query}#Intent;scheme=https;package=com.google.android.apps.maps;end`;
    setTimeout(() => window.open(fallbackUrl, "_blank"), 500);
  } else {
    window.open(fallbackUrl, "_blank");
  }
}

// ----- radius slider -----
radiusInput.addEventListener('input', () => { 
  radiusLabel.textContent = radiusInput.value; 
});
