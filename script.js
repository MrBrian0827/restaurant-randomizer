/* script.js - 使用 constants.js 拆分的完整版 */
const taiwanData = window.taiwanData;
const mapping = window.mapping;
const SEARCH_MODE = {
  CITY: 'city',
  STREET: 'street',
  CURRENT: 'current'
};
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
let currentData = window.taiwanData;
let usingMyLocation = false; // 是否正在使用「我取得我的位置」
const NETWORK_TTL_OK = 15000;
const NETWORK_TTL_FAIL = 60000;

function showRedoButton(text="切換回手動搜尋", callback){
  let redoBtn = document.getElementById("redoBtn");
  if(!redoBtn){
    usingMyLocation = false;
    userLocation = null;
    redoBtn = document.createElement("button");
    redoBtn.id = "redoBtn";
    redoBtn.style.marginLeft = "10px";
    redoBtn.style.display = "inline-block";
    const controlsPanel = document.getElementById("controlsPanel");
    controlsPanel.appendChild(redoBtn);
  }
  redoBtn.textContent = text;
  redoBtn.onclick = callback;
  redoBtn.style.display = "inline-block";
}

// ----- 搜尋模式與提示文字 -----
// 判斷目前搜尋模式
function getCurrentSearchMode() {
  if(usingMyLocation) return SEARCH_MODE.CURRENT;  // ← 改成用 usingMyLocation
  if(streetInput.value.trim()) return SEARCH_MODE.STREET;
  return SEARCH_MODE.CITY;
}

// 取得說明文字
function generateSearchInfoText() {
  const mode = getCurrentSearchMode();
  const radius = radiusInput.value;
  const typeLabel = typeSelect.selectedOptions[0]?.textContent || '所有餐廳類型';
  let text = '🔎 目前搜尋：';

  switch(mode){
    case SEARCH_MODE.CITY:
      text += `${citySelect.value} ${districtSelect.value}，${typeLabel}`;
      break;
    case SEARCH_MODE.STREET:
      text += `${streetInput.value}，半徑 ${radius} 公尺，${typeLabel}`;
      break;
    case SEARCH_MODE.CURRENT:
      text += `以你的位置為中心，半徑 ${radius} 公尺，${typeLabel}`;
      break;
  }
  return text;
}

function updateSearchHint() {
  const mode = getCurrentSearchMode();
  if(searchInfoEl && !searchHintEl.parentNode){
    searchInfoEl.parentNode.insertBefore(searchHintEl, searchInfoEl);
  }
  switch(mode){
    case SEARCH_MODE.CITY:
      searchHintEl.textContent = '將搜尋所選區域內所有餐廳類型';
      break;
    case SEARCH_MODE.STREET:
      searchHintEl.textContent = '以街道為中心，可設定搜尋半徑';
      break;
    case SEARCH_MODE.CURRENT:
      searchHintEl.textContent = '以你的位置為中心，可設定搜尋半徑';
      break;
  }
}

function collapseSearchPanel() {
  citySelect.parentElement.style.display = "none";
  districtSelect.parentElement.style.display = "none";
  streetInput.parentElement.style.display = "none";
  typeSelect.style.display = "none";
  radiusInput.style.display = "none";
  searchBtn.style.display = "none";
}

function showSearchPanel(show = true) {
  const display = show ? "" : "none";
  citySelect.parentElement.style.display = display;
  districtSelect.parentElement.style.display = display;
  streetInput.style.display = display;
  typeSelect.style.display = display;
  radiusInput.style.display = display;
  searchBtn.style.display = display;
}

function expandSearchPanel() { showSearchPanel(true); }

function showRedoButtonForMode(mode) {
  if(!isMobile()) return;
  
  let redoText = '';
  switch(mode){
    case SEARCH_MODE.CURRENT: redoText = '切換回地址搜尋模式'; break;
    default: redoText = '重新設定搜尋條件'; break;
  }

  showRedoButton(redoText, () => {
    usingMyLocation = false;
    userLocation = null;
    expandSearchPanel();
    resultsPanel.innerHTML = "";
    lastRestaurants = [];
  });
}

// 更新 searchInfo 元素
function updateSearchInfo() {
  if(searchInfoEl) searchInfoEl.textContent = generateSearchInfoText();
}

// 表單提示文字
const searchHintEl = document.createElement('div');
searchHintEl.className = 'small';
searchHintEl.style.marginBottom = '6px';
searchInfoEl.parentNode.insertBefore(searchHintEl, searchInfoEl);

function getRandomTop3(arr){
  if(!arr || arr.length === 0) return [];

  // 先隨機打亂陣列
  const shuffled = shuffleArray(arr);

  // 取前三
  const top3 = shuffled.slice(0, 3);

  // 如果有 polygon，判斷每個是否在 polygon 內
  const polygonGeo = lastSearchCenter?.raw?.geojson;
  top3.forEach(r => {
    const lat = r.lat || r.center?.lat;
    const lon = r.lon || r.center?.lon;
    r.isBoundary = polygonGeo && lat != null && lon != null
      ? !pointInPolygon([lon, lat], polygonGeo)
      : false;
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

  // 重新隨機取三間
  const top3 = getRandomTop3(allRestaurants);

  // 手機版特殊處理：維持隱藏搜尋欄位
  if(isMobile()){
    // 只渲染地圖與三個餐廳，不改變搜尋欄狀態
    renderResults(top3);

    // 搜尋欄位保持隱藏
    handleMobilePanelAfterRender();

    // 重新查詢按鈕維持顯示
    let redoBtn = document.getElementById("redoBtn");
    if(redoBtn) redoBtn.style.display = "inline-block";

    // reshuffle 按鈕保持可見
    reshuffleBtn.style.display = "inline-block";
  } else {
    // 桌機版直接渲染，不做任何隱藏
    renderResults(top3);
  }
});

searchBtn.addEventListener('click', ()=> {
  usingMyLocation = false;
  userLocation = null;
  const mode = getCurrentSearchMode();
  updateSearchInfo();
  updateSearchHint();
  handleSearch();
  let msg = '';
  if(mode === 'city'){
    msg = `你正在搜尋 ${citySelect.value} ${districtSelect.value} 的所有餐廳類型`;
  } else if(mode === 'street'){
    msg = `你正在以 ${streetInput.value} 為中心，半徑 ${radiusInput.value} 公尺，搜尋餐廳`;
  } else if(mode === 'current'){
    msg = `你正在以你的位置為中心，半徑 ${radiusInput.value} 公尺，搜尋餐廳`;
  }

  console.log(msg); // 可改成 alert() 或 toast
});

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
  updateSearchInfo();
  updateSearchHint();
  const country = countrySelect.value; // tw / jp
  const dataSource = currentData;

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

// 初始化
populateCitiesAndDistricts();

// 當使用者切換國家
const appTitle = document.getElementById("appTitle");

countrySelect.addEventListener("change", () => {
  const newCountry = countrySelect.value;
  const country = countrySelect.value;
    if(newCountry === 'tw'){
      currentData = window.taiwanData;
      currentMapping = window.mapping;
    } else if(newCountry === 'jp'){
      currentData = window.japanData;
      currentMapping = window.japanMapping;
    }
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
  map.setView(country === "tw" ? [25.033964,121.564468] : [35.6895,139.6917], 13);
});

// 當使用者切換城市
citySelect.addEventListener("change", ()=>{
  const country = countrySelect.value;
  populateDistricts(currentData, citySelect.value);
  updateSearchInfo(); 
  updateSearchHint(); 
});

districtSelect.addEventListener('change', ()=>{ 
  updateSearchInfo(); 
  updateSearchHint(); 
});

streetInput.addEventListener('input', ()=>{ 
  updateSearchInfo(); 
  updateSearchHint(); 
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

// ----- Geocode -----
async function geocode(query) {
  try {
    // 使用 LocationIQ
    const url = `https://us1.locationiq.com/v1/search.php?key=${API_KEY}&q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=3`;
    const r = await fetchWithTimeout(url, {}, 8000);
    if(r.ok){
      const j = await r.json();
      if(j.length>0) return { lat: parseFloat(j[0].lat), lon: parseFloat(j[0].lon), raw: j[0] };
    }
  } catch(e){ console.warn("LocationIQ failed, fallback to Nominatim"); }

  try {
    // 使用 Nominatim fallback
    const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&q=${encodeURIComponent(query)}&limit=3`;
    const r = await fetchWithTimeout(url, { headers: {"Accept":"application/json"} }, 8000);
    if(r.ok){
      const j = await r.json();
      if(j.length>0) return { lat: parseFloat(j[0].lat), lon: parseFloat(j[0].lon), raw: j[0] };
    }
  } catch(e){ console.warn("Nominatim failed:", e); }

  return null; // 都失敗就回 null
}

// ----- Overpass query -----
async function overpassQuery(query){
  for(const endpoint of OVERPASS_SERVERS){
    try {
      const r = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: query
      }, 15000);

      const text = await r.text();
      if(text.trim().startsWith('<')) continue; // HTML error, skip
      return JSON.parse(text);
    } catch(e){ console.warn("Overpass attempt failed:", e); }
  }
  console.warn("All Overpass servers failed");
  return { elements: [] }; // 不再 throw
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

  // 行政區 bounding box (radius=0 表示整個行政區)
  let bboxFilter = null;
  let polygonGeo = null;
  if (radius === 0 && lastSearchCenter?.raw?.boundingbox) {
    const bb = lastSearchCenter.raw.boundingbox.map(parseFloat); // [south, north, west, east]
    bboxFilter = bb;
    if (lastSearchCenter.raw.geojson) polygonGeo = lastSearchCenter.raw.geojson;
  }

  // Overpass filters
  const filters = arr.map(s => {
    if (radius === 0 && bboxFilter) {
      return `${s}(${bboxFilter[0]},${bboxFilter[2]},${bboxFilter[1]},${bboxFilter[3]});`;
    } else {
      return `${s}(around:${radius},${lat},${lon});`;
    }
  });

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

    // bounding box 過濾
    if (bboxFilter) {
      const [south, north, west, east] = bboxFilter;
      if (eLat < south || eLat > north || eLon < west || eLon > east) return;
    }

    // Polygon 過濾
    let inPolygon = true;
    if(polygonGeo) inPolygon = pointInPolygon([eLon, eLat], polygonGeo);
    const isBoundary = !inPolygon; // 邊界餐廳
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

// ----- 搜尋與候選地址選擇 -----
async function handleSearch() {
  showLoading(); setBusy(true);

  try {
    let geo = null;

    if(usingMyLocation && userLocation){
      // 使用「我取得我的位置」的座標
      geo = { lat: userLocation.lat, lon: userLocation.lon, raw: null };
    } else {
      // 使用地址或行政區模式
      const queryStr = citySelect.value + " " + districtSelect.value + " " + streetInput.value;
      geo = await geocode(queryStr);
      if(!geo){
        alert("找不到位置");
        return;
      }
    }

    lastSearchCenter = geo;
    const restaurants = await findRestaurants(
      geo.lat,
      geo.lon,
      parseInt(radiusInput.value)||1000,
      typeSelect.value
    );

    if(restaurants.length===0){
      resultsPanel.innerHTML = "<div class='small'>找不到符合的餐廳，但可能在附近。</div>";
    } else {
      allRestaurants = shuffleArray(restaurants);
    }

    // 設定地圖中心
    map.setView([geo.lat, geo.lon], 16);

  } catch(e){
    console.error(e);
    alert("搜尋失敗");
  } finally {
    hideLoading(); 
    setBusy(false);
  }
}

function handleMobilePanelAfterRender() {
  collapseSearchPanel();       // 折疊搜尋欄位
  reshuffleBtn.style.display = "inline-block";

  if(usingMyLocation){
    showRedoButton("切換回地址搜尋模式", ()=>{
      usingMyLocation = false;
      userLocation = null;
      showSearchPanel(true);
      resultsPanel.innerHTML = "";
      lastRestaurants = [];
    });
  } else {
    showRedoButton("重新設定搜尋條件", ()=>{
      showSearchPanel(true);
      resultsPanel.innerHTML = "";
      lastRestaurants = [];
    });
  }
}

// ----- renderResults -----
function renderResults(restaurants){
  clearMarkers();
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

  // 取得 top3，已包含 isBoundary
  const top = getRandomTop3(restaurants);
  lastRestaurants = top;

  top.forEach(item=>{
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
    const card = document.createElement("div"); card.className = "card";
    const left = document.createElement("div"); left.className = "card-left";
    left.innerHTML = `<p class="card-title">${name}</p>
                      <p class="card-sub">${address || '<span style="color:#999">地址未提供</span>'}</p>
                      <p class="card-sub">${hours ? '營業時間：'+hours : ''}${phone ? ' • 電話：'+phone : ''}</p>
                      ${rating ? `<p class="card-sub">評價：${rating} (OSM)</p>` : ''}${boundaryNote}`;

    const right = document.createElement("div"); right.className = "card-actions";

    // ----- 顯示在地圖 -----
    const btnView = document.createElement("button");
    btnView.textContent = "🗺️ 顯示在地圖";
    btnView.className = "btn-map";
    btnView.onclick = ()=>{
      map.setView([lat, lon], 17);
      marker.openPopup();
      if(isMobile()){
        const mapEl = document.getElementById("map");
        if(mapEl){
          setTimeout(()=>{
            const topOffset = 20;
            const rect = mapEl.getBoundingClientRect();
            const scrollTop = window.scrollY || window.pageYOffset;
            const targetY = rect.top + scrollTop - topOffset;
            window.scrollTo({ top: targetY, behavior: "smooth" });
          }, 100);
        }
      }
    };

    // ----- Google Maps -----
    const btnMaps = document.createElement("button");
    btnMaps.textContent = "🌍 Google Maps 開啟";
    btnMaps.className = "btn-google";
    btnMaps.onclick = ()=>{
      let query = address ? encodeURIComponent(name + " " + address) : `${lat},${lon}`;
      if(!address) alert("注意：此店家名稱可能無法顯示，將使用經緯度定位");
      if(isMobile() && isIOS()){
        window.location.href = `comgooglemaps://?q=${query}&zoom=16`;
      } else if(isMobile() && isAndroid()){
        window.location.href = `intent://maps.google.com/maps?q=${query}#Intent;scheme=https;package=com.google.android.apps.maps;end`;
      } else {
        window.open(`https://www.google.com/maps/search/?api=1&query=${query}`,"_blank");
      }
    };

    // ----- 導航 -----
    const btnNav = document.createElement("button");
    btnNav.textContent = "🧭 導航";
    btnNav.className = "btn-nav";
    btnNav.onclick = ()=>{
      let dest = address ? `${address}, ${districtSelect.value}, ${citySelect.value}` : `${lat},${lon}`;
      if(!address) alert("注意：此店家名稱可能無法顯示，將使用經緯度導航");
      dest = encodeURIComponent(dest.trim());
      if(isMobile() && isIOS()){
        window.location.href = `comgooglemaps://?daddr=${dest}&directionsmode=driving`;
      } else if(isMobile() && isAndroid()){
        window.location.href = `intent://maps.google.com/maps?daddr=${dest}&directionsmode=driving#Intent;scheme=https;package=com.google.android.apps.maps;end`;
      } else {
        window.open(`https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`,"_blank");
      }
    };

    right.appendChild(btnView); right.appendChild(btnMaps); right.appendChild(btnNav);
    card.appendChild(left); card.appendChild(right);
    resultsPanel.appendChild(card);
  });

  // ----- 手機版額外處理 -----
if(isMobile()) handleMobilePanelAfterRender();
}

// ----- Street autocomplete -----
let selectedSuggestionIndex = -1;
let suggestionItems = [];
usingMyLocation = false;
userLocation = null;

streetInput.addEventListener('input', async ()=>{
  const city = citySelect.value;
  const district = districtSelect.value;
  const q = streetInput.value.trim();
  if(!q){ streetSuggestions.innerHTML=''; suggestionItems=[]; selectedSuggestionIndex=-1; return; }

  try{
    const country = countrySelect.value; // tw / jp
    let url = `https://us1.locationiq.com/v1/search.php?key=${encodeURIComponent(API_KEY)}&q=${encodeURIComponent(city+' '+district+' '+q)}&format=json&addressdetails=1&countrycodes=${country.toUpperCase()}&limit=6`;
    const r = await fetchWithTimeout(url);
    const j = r.ok ? await r.json() : [];
    streetSuggestions.innerHTML=''; suggestionItems=[];
    j.forEach(item=>{
      const display = item.display_name; if(!display) return;
      const div = document.createElement('div'); div.className='suggestion-item'; div.textContent=display;
      div.addEventListener('click', ()=>{
        usingMyLocation = false;
        userLocation = null; streetInput.value=display; streetSuggestions.innerHTML=''; suggestionItems=[]; selectedSuggestionIndex=-1;
        searchBtn.click();
      });
      streetSuggestions.appendChild(div); suggestionItems.push(div);
    });
    selectedSuggestionIndex=-1;
  }catch(e){ streetSuggestions.innerHTML=''; suggestionItems=[]; selectedSuggestionIndex=-1; }
});

streetInput.addEventListener('keydown', (e)=>{
  if(!suggestionItems.length) return;
  if(e.key==='ArrowDown'){ e.preventDefault(); selectedSuggestionIndex=(selectedSuggestionIndex+1)%suggestionItems.length; updateSuggestionHighlight(); }
  else if(e.key==='ArrowUp'){ e.preventDefault(); selectedSuggestionIndex=(selectedSuggestionIndex-1+suggestionItems.length)%suggestionItems.length; updateSuggestionHighlight(); }
  else if(e.key==='Enter'){ if(selectedSuggestionIndex>=0){ e.preventDefault(); streetInput.value=suggestionItems[selectedSuggestionIndex].textContent; streetSuggestions.innerHTML=''; suggestionItems=[]; selectedSuggestionIndex=-1; searchBtn.click(); } }
});

document.addEventListener('click', (e)=>{ if(!streetInput.contains(e.target)) streetSuggestions.innerHTML=''; });
function updateSuggestionHighlight(){ suggestionItems.forEach((el,i)=>{ if(i===selectedSuggestionIndex){ el.classList.add('highlight'); el.scrollIntoView({block:'nearest'}); }else{ el.classList.remove('highlight'); } }); }

// ----- 智能定位（僅手機可用） -----
if(isMobile() && locateBtn) {
  locateBtn.style.display = "inline-block"; // 手機顯示按鈕

  // 建立誤差提示元素
  let accuracyEl = document.getElementById("accuracyInfo");
  if(!accuracyEl){
    accuracyEl = document.createElement("div");
    accuracyEl.id = "accuracyInfo";
    accuracyEl.className = "small";
    accuracyEl.style.marginTop = "4px";
    locateBtn.parentElement.appendChild(accuracyEl);
  }

  locateBtn.addEventListener('click', () => {
  /* ========= 是否支援定位 ========= */
  if (!navigator.geolocation) {
    alert("此瀏覽器不支援定位功能");
    return;
  }

  showLoading();

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      hideLoading();

      const { latitude, longitude, accuracy } = pos.coords;

      console.log(
        "📍 取得我的位置",
        latitude,
        longitude,
        "誤差",
        accuracy,
        "m"
      );

      // 誤差過大僅提醒，不阻止
      if (accuracy > 500) {
        alert(
          `定位誤差約 ${Math.round(accuracy)} 公尺，\n` +
          `建議移動到戶外或開啟 GPS 以提高精準度`
        );
      }

      /* ========= 啟用「使用我的位置」模式 ========= */
      usingMyLocation = true;
      userLocation = {
        lat: latitude,
        lon: longitude
      };

      /* ========= 清空地址搜尋條件 ========= */
      streetInput.value = "";

      /* ========= 地圖移動 ========= */
      map.setView([latitude, longitude], 16);

      searchInfoEl.textContent = "📍 使用目前位置搜尋（可調整搜尋半徑）";

      handleSearch();
    },

    (err) => {
      hideLoading();

      console.error("定位失敗", err);

      let msg = "定位失敗";
      if (err.code === 1) msg = "使用者拒絕定位權限";
      if (err.code === 2) msg = "無法取得定位資訊";
      if (err.code === 3) msg = "定位逾時，請重試";

      alert(msg);

      // ❗失敗時不進入定位模式
      usingMyLocation = false;
      userLocation = null;
    },

    {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0
    }
  );
});
} else if(locateBtn) {
  locateBtn.style.display = "none"; // 桌機隱藏按鈕
}

// ----- 半徑 slider -----
// 手機定位後也可操作
const handleRadiusChange = debounce(() => {
  const mode = getCurrentSearchMode();
  if(mode === "current") handleSearch();
}, 300);  // 300ms 延遲

radiusInput.addEventListener('input', () => {
  radiusLabel.textContent = radiusInput.value;
  updateSearchInfo();
  updateSearchHint();
  handleRadiusChange();
});

function debounce(func, wait){
  let timeout;
  return function(...args){
    clearTimeout(timeout);
    timeout = setTimeout(()=>func.apply(this,args), wait);
  };
}

function shuffleArray(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

// ----- 手機 / 作業系統偵測 -----
function isMobile() {
  const ua = navigator.userAgent || navigator.vendor || window.opera;
  return /android/i.test(ua) || /iPad|iPhone|iPod/.test(ua);
}
function isIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent || navigator.vendor || window.opera); }
function isAndroid() { return /android/i.test(navigator.userAgent || navigator.vendor || window.opera); }

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

typeSelect.addEventListener('change', ()=>{
  updateSearchInfo();
  updateSearchHint();
});