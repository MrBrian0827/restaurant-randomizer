/* script.js - 使用 constants.js 拆分的完整版 */
const taiwanData = window.taiwanData;
const mapping = window.mapping;

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

// ----- Leaflet map -----
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
const NETWORK_TTL_OK = 15000;
const NETWORK_TTL_FAIL = 60000;

function getRandomTop3(arr){
  if(!arr || arr.length === 0) return [];

  // 優先完整資料（有 name 和 address）
  const fullInfo = arr.filter(r => r.tags?.name && (r.tags["addr:full"] || r.tags["addr:street"] || r.tags["addr:housenumber"]));
  const partialInfo = arr.filter(r => !r.tags?.name || !(r.tags["addr:full"] || r.tags["addr:street"] || r.tags["addr:housenumber"]));

  const copy = shuffleArray(fullInfo.concat(partialInfo));

  const selected = [];
  const usedKeys = new Set();

  // 判斷是否為邊界餐廳
  function isBoundary(r){
    const addrDistrict = (r.tags["addr:district"] || r.tags["addr:suburb"] || r.tags["addr:village"] || "").trim();
    const polygonGeo = lastSearchCenter.raw.geojson;
    const inPolygon = polygonGeo ? pointInPolygon([r.lon || r.center?.lon, r.lat || r.center?.lat], polygonGeo) : true;
    return addrDistrict !== districtSelect.value || !inPolygon;
  }

  // 先放非邊界餐廳
  for(const r of copy){
    if(selected.length >= 3) break;
    if(isBoundary(r)) continue;
    const t = r.tags || {};
    const typeTag = t.amenity || t.shop || t.leisure || "restaurant";
    const key = (t.name || "") + "|" + typeTag;
    if(usedKeys.has(key)) continue;
    selected.push(r);
    usedKeys.add(key);
  }

  // 不夠再補邊界餐廳
  if(selected.length < 3){
    for(const r of copy){
      if(selected.length >= 3) break;
      if(!isBoundary(r)) continue;
      const t = r.tags || {};
      const typeTag = t.amenity || t.shop || t.leisure || "restaurant";
      const key = (t.name || "") + "|" + typeTag;
      if(usedKeys.has(key)) continue;
      selected.push(r);
      usedKeys.add(key);
    }
  }

  return selected;
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
  renderResults(getRandomTop3(allRestaurants));
});

searchBtn.addEventListener('click', async () => {
  const city = citySelect.value;
  const district = districtSelect.value;
  const street = streetInput.value.trim();
  const type = typeSelect.value;

  showLoading();
  setBusy(true);
  searchInfoEl.textContent = '';

  try {
    shownRestaurantsKeys.clear(); // 每次新搜尋清空 Set

    if (!city || !district) {
      alert("請選擇縣市與區域");
      return;
    }

    let geo = null;
    const hasStreet = street.length > 0;
    const queryStr = city + " " + district + (hasStreet ? " " + street : "");

    geo = await geocode(queryStr);
    if (!geo) {
      alert("找不到位置，請確認輸入的地址是否正確。");
      return;
    }

    map.setView([geo.lat, geo.lon], hasStreet ? 16 : 12);

    // ----- 地址比對提示（有街道才檢查） -----
    if (hasStreet) {
      const addr = geo.raw.address || {};
      let mismatch = false;

      const cityMatch = city.includes(addr.city || addr.town || addr.county || "");
      const districtMatch = district.includes(addr.suburb || addr.village || addr.district || "");
      const geoStreet = addr.road || "";
      const distance = levenshtein(street.replace(/\s/g, ''), geoStreet.replace(/\s/g, ''));
      const streetMatch = distance <= Math.floor(Math.max(street.length, geoStreet.length) * 0.3);

      if (!cityMatch || !districtMatch || !streetMatch) mismatch = true;

      if (mismatch) {
        const proceed = confirm(
          "查到的位置與輸入地址可能不一致，建議確認後再搜尋。\n\n" +
          `輸入: ${queryStr}\n查到: ${(addr.road || "")}, ${(addr.suburb || addr.district || "")}, ${(addr.city || addr.town || addr.county || "")}`
        );
        if (!proceed) {
          hideLoading();
          setBusy(false);
          return;
        }
      }
    }

    // ----- 設定查詢半徑 -----
    const radius = hasStreet ? 2000 : 0; // 街道級別使用 2km, 行政區使用 0 表示全區查詢

    lastSearchCenter = geo;
    allRestaurants = shuffleArray(await findRestaurants(geo.lat, geo.lon, radius, type));
    renderResults(getRandomTop3(allRestaurants));
    searchInfoEl.textContent = `找到 ${allRestaurants.length} 間餐廳`;
    reshuffleBtn.disabled = allRestaurants.length <= 3;

  } catch (e) {
    console.error(e);
    alert("搜尋失敗");
  } finally {
    hideLoading();
    setBusy(false);
  }
});

// ----- Levenshtein 距離函數 -----
function levenshtein(a, b) {
  if(a.length===0) return b.length;
  if(b.length===0) return a.length;
  const matrix = [];
  for(let i=0;i<=b.length;i++){ matrix[i] = [i]; }
  for(let j=0;j<=a.length;j++){ matrix[0][j] = j; }

  for(let i=1;i<=b.length;i++){
    for(let j=1;j<=a.length;j++){
      if(b.charAt(i-1)===a.charAt(j-1)){
        matrix[i][j] = matrix[i-1][j-1];
      }else{
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

// ----- Helpers -----
function showLoading(){ loadingEl.style.display = "flex"; }
function hideLoading(){ loadingEl.style.display = "none"; }
function setBusy(val){
  searchBtn.disabled = val;
  reshuffleBtn.disabled = val;
  citySelect.disabled = val;
  districtSelect.disabled = val;
  streetInput.disabled = val;
  typeSelect.disabled = val;
  locateBtn.disabled = val;
}
async function fetchWithTimeout(url, opts={}, timeout=10000){
  const controller = new AbortController();
  const id = setTimeout(()=>controller.abort(), timeout);
  try{
    const r = await fetch(url, { signal: controller.signal, ...opts });
    clearTimeout(id);
    return r;
  }catch(e){
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

// ----- Populate city/district -----
(function initCityDistrict(){
  Object.keys(taiwanData).forEach(city=>{
    const o = document.createElement("option"); o.value = city; o.textContent = city;
    citySelect.appendChild(o);
  });
  citySelect.addEventListener("change", ()=>{
    const city = citySelect.value;
    districtSelect.innerHTML = "";
    (taiwanData[city] || []).forEach(d => {
      const o = document.createElement("option"); o.value = d; o.textContent = d;
      districtSelect.appendChild(o);
    });
  });
  citySelect.selectedIndex = 0;
  citySelect.dispatchEvent(new Event("change"));
})();

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
async function geocode(query){
  let geo = null;
  for(let attempt=0; attempt<=LOCATIONIQ_RETRY; attempt++){
    try{
      let url = `https://us1.locationiq.com/v1/search.php?key=${encodeURIComponent(API_KEY)}&q=${encodeURIComponent(query)}&format=json&addressdetails=1&countrycodes=TW&limit=3`;
      const r = await fetchWithTimeout(url, {}, 8000);
      if(!r.ok) throw new Error('LocationIQ bad response');
      const j = await r.json();
      if(Array.isArray(j) && j.length>0){
        geo = { lat: parseFloat(j[0].lat), lon: parseFloat(j[0].lon), raw: j[0] };
        break;
      }
    }catch(e){
      if(attempt < LOCATIONIQ_RETRY) await new Promise(res=>setTimeout(res, 400*(attempt+1)));
    }
  }
  if(!geo){
    for(let attempt=0; attempt<=NOMINATIM_RETRY; attempt++){
      try{
        const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=TW&limit=3&q=${encodeURIComponent(query)}`;
        const r = await fetchWithTimeout(url, { headers: { "Accept": "application/json" } }, 8000);
        if(!r.ok) throw new Error('Nominatim bad response');
        const j = await r.json();
        if(Array.isArray(j) && j.length>0){
          geo = { lat: parseFloat(j[0].lat), lon: parseFloat(j[0].lon), raw: j[0] };
          break;
        }
      }catch(e){
        if(attempt < NOMINATIM_RETRY) await new Promise(res=>setTimeout(res, 400*(attempt+1)));
      }
    }
  }
  if(!geo) return null;
  const hasNumber = /\d/.test(query);
  const geocodedHasHouseNumber = geo.raw && geo.raw.address && (geo.raw.address.house_number || geo.raw.address.housenumber || geo.raw.address.house_no);
  if(hasNumber && !geocodedHasHouseNumber) geo.fallbackToStreet = true;
  return geo;
}

// ----- Overpass query -----
async function overpassQuery(query){
  let lastErr = null;
  for(const endpoint of OVERPASS_SERVERS){
    for(let attempt=0; attempt<OVERPASS_RETRY; attempt++){
      try{
        const r = await fetchWithTimeout(endpoint, { method:'POST', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: query }, 15000);
        if(!r.ok){ lastErr = new Error(`Overpass ${endpoint} status ${r.status}`); await new Promise(res=>setTimeout(res,500*(attempt+1))); continue; }
        const txt = await r.text();
        if(typeof txt === 'string' && txt.trim().startsWith('<')){ lastErr = new Error('Overpass returned HTML error'); await new Promise(res=>setTimeout(res,300*(attempt+1))); continue; }
        return JSON.parse(txt);
      }catch(e){
        lastErr = e;
        await new Promise(res=>setTimeout(res,300*(attempt+1)));
      }
    }
  }
  throw lastErr || new Error('All overpass failed');
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
  const arr = type ? (mapping[type] || mapping["restaurant"]) : mapping["restaurant"];

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
    if (polygonGeo && !pointInPolygon([eLon, eLat], polygonGeo)) return;

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
  const city = citySelect.value;
  const district = districtSelect.value;
  const street = streetInput.value.trim();
  const type = typeSelect.value;
  const radius = parseInt(radiusInput.value,10) || 1000;
  if(!city || !district) { alert("請選擇縣市與區域"); return; }

  const queryStr = city + " " + district + (street ? " " + street : "");
  showLoading(); setBusy(true); searchInfoEl.textContent='';

  try {
    const geoResults = await geocode(queryStr);
    if(!geoResults || geoResults.length===0){ alert("找不到位置"); return; }

    // 如果有多筆候選，顯示選擇
    let geo = geoResults[0];
    if(geoResults.length > 1){
      const choice = prompt(
        "找到多筆地址，請輸入選擇編號:\n" +
        geoResults.map((g,i)=>`${i+1}. ${g.display_name}`).join("\n")
      );
      const idx = parseInt(choice,10)-1;
      if(idx>=0 && idx<geoResults.length) geo = geoResults[idx];
    }

    lastSearchCenter = geo;
    allRestaurants = shuffleArray(await findRestaurants(geo.lat, geo.lon, radius, type));
    renderResults(getRandomTop3(allRestaurants));
    searchInfoEl.textContent=`找到 ${allRestaurants.length} 間餐廳`;
    reshuffleBtn.disabled = allRestaurants.length<=3;
    map.setView([geo.lat,geo.lon],16);
  } catch(e){
    console.error(e); alert("搜尋失敗"); 
  } finally { hideLoading(); setBusy(false); }
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
  if(lastSearchCenter?.raw?.geojson){
    if(window.currentPolygon) map.removeLayer(window.currentPolygon); // 移除舊 polygon
    window.currentPolygon = L.geoJSON(lastSearchCenter.raw.geojson, {
      style: { color: "#f39c12", weight: 2, fillOpacity: 0.0 }
    }).addTo(map);
    map.fitBounds(window.currentPolygon.getBounds()); // 縮放地圖到區域
  }

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

    // ----- 判斷是否邊界餐廳 -----
    let boundaryNote = "";
    const addrDistrict = (tags["addr:district"] || tags["addr:suburb"] || tags["addr:village"] || "").trim();
    const polygonGeo = lastSearchCenter?.raw?.geojson;
    const inPolygon = polygonGeo ? pointInPolygon([lon, lat], polygonGeo) : true;
    const isBoundary = addrDistrict !== districtSelect.value || !inPolygon;
    if (isBoundary) {
      boundaryNote = "<br><span style='color:#f39c12'>⚠️ 這間可能在邊界附近，座標可能不完全在本區</span>";
    }

    // ----- 使用原本 Leaflet 預設藍色 marker -----
    const marker = L.marker([lat,lon]).addTo(map);
    currentMarkers.push(marker);

    marker.bindPopup(
      `<b>${name}</b><br>${address || ''}<br>` +
      `${hours ? '營業時間：'+hours : ''}${phone ? '<br>電話：'+phone : ''}${rating ? '<br>評價：'+rating+' (OSM)' : ''}` +
      `${boundaryNote}`
    );

    const card = document.createElement("div"); card.className = "card";
    const left = document.createElement("div"); left.className = "card-left";
    left.innerHTML = `<p class="card-title">${name}</p>
                      <p class="card-sub">${address || '<span style="color:#999">地址未提供</span>'}</p>
                      <p class="card-sub">${hours ? '營業時間：'+hours : ''}${phone ? ' • 電話：'+phone : ''}</p>
                      ${rating ? `<p class="card-sub">評價：${rating} (OSM)</p>` : ''}
                      ${boundaryNote}`;

    const right = document.createElement("div"); right.className = "card-actions";

    // ----- 顯示在地圖 -----
    const btnView = document.createElement("button");
    btnView.textContent = "顯示在地圖";
    btnView.onclick = ()=>{ map.setView([lat, lon], 17); marker.openPopup(); };

    // ----- Google Maps -----
    const btnMaps = document.createElement("button");
    btnMaps.textContent = "在 Google Maps 開啟";
    btnMaps.onclick = ()=>{
      let query = address ? encodeURIComponent(name + " " + address) : `${lat},${lon}`;
      if(!address) alert("注意：此店家名稱可能無法顯示，將使用經緯度定位");
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      if(isMobile && isIOS()){
        window.location.href = `comgooglemaps://?q=${query}&zoom=16`;
      } else if(isMobile && isAndroid()){
        window.location.href = `intent://maps.google.com/maps?q=${query}#Intent;scheme=https;package=com.google.android.apps.maps;end`;
      } else {
        window.open(`https://www.google.com/maps/search/?api=1&query=${query}`,"_blank");
      }
    };

    // ----- 導航 -----
    const btnNav = document.createElement("button");
    btnNav.textContent = "導航";
    btnNav.onclick = ()=>{
      let dest = address ? `${address}, ${districtSelect.value}, ${citySelect.value}` : `${lat},${lon}`;
      if(!address) alert("注意：此店家名稱可能無法顯示，將使用經緯度導航");
      dest = encodeURIComponent(dest.trim());
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      if(isMobile && isIOS()){
        window.location.href = `comgooglemaps://?daddr=${dest}&directionsmode=driving`;
      } else if(isMobile && isAndroid()){
        window.location.href = `intent://maps.google.com/maps?daddr=${dest}&directionsmode=driving#Intent;scheme=https;package=com.google.android.apps.maps;end`;
      } else {
        window.open(`https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`,"_blank");
      }
    };

    right.appendChild(btnView); right.appendChild(btnMaps); right.appendChild(btnNav);
    card.appendChild(left); card.appendChild(right);
    resultsPanel.appendChild(card);
  });
}

// ----- Street autocomplete -----
let selectedSuggestionIndex = -1;
let suggestionItems = [];

streetInput.addEventListener('input', async ()=>{
  const city = citySelect.value;
  const district = districtSelect.value;
  const q = streetInput.value.trim();
  if(!q){ streetSuggestions.innerHTML=''; suggestionItems=[]; selectedSuggestionIndex=-1; return; }

  try{
    let url = `https://us1.locationiq.com/v1/search.php?key=${encodeURIComponent(API_KEY)}&q=${encodeURIComponent(city+' '+district+' '+q)}&format=json&addressdetails=1&countrycodes=TW&limit=6`;
    const r = await fetchWithTimeout(url);
    const j = r.ok ? await r.json() : [];
    streetSuggestions.innerHTML=''; suggestionItems=[];
    j.forEach(item=>{
      const display = item.display_name; if(!display) return;
      const div = document.createElement('div'); div.className='suggestion-item'; div.textContent=display;
      div.addEventListener('click', ()=>{
        streetInput.value=display; streetSuggestions.innerHTML=''; suggestionItems=[]; selectedSuggestionIndex=-1;
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

// ----- 智能定位 -----
locateBtn.addEventListener('click', ()=>{
  if(navigator.geolocation){
    navigator.geolocation.getCurrentPosition(pos=>{ userLocation={lat:pos.coords.latitude, lon:pos.coords.longitude}; map.setView([userLocation.lat,userLocation.lon],16); }, err=>alert("定位失敗: "+err.message));
  }else{ alert("瀏覽器不支援定位"); }
});

// ----- searchBtn -----

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

// ----- radius slider -----
radiusInput.addEventListener('input', ()=>{ radiusLabel.textContent = radiusInput.value; });
