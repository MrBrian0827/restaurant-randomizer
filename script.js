/* script.js - 修正版完整程式碼 */
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
const resetBtn = document.getElementById("resetSearchBtn");
const loadingEl = document.getElementById("loading");
const searchInfoEl = document.getElementById("searchInfo");
const countrySelect = document.getElementById("countrySelect"); // 新增國家選擇

// ----- Leaflet map -----
let currentMapping = mapping; // 預設台灣
let currentCountry = countrySelect.value; // "tw" 或 "jp"
let map = L.map("map", { zoomControl: true }).setView([25.033964,121.564468], 13);
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
let streetSelectionConfirmed = false; 
let streetInputDebounceTimeout = null; 
const NETWORK_TTL_OK = 15000;
const NETWORK_TTL_FAIL = 60000;

if (locateBtn) {
  locateBtn.addEventListener("click", async () => {
  userLocation = null;  // 強制清空位置，每次都重新嘗試
      if(!navigator.geolocation){
          alert("此裝置不支援定位");
          return;
      }
      showLoading(); setBusy(true);
      navigator.geolocation.getCurrentPosition(
        async(pos)=>{
            userLocation = {lat: pos.coords.latitude, lon: pos.coords.longitude};
            clearMarkers();
            const marker = L.marker([userLocation.lat, userLocation.lon]).addTo(map);
            marker.bindTooltip("您目前的位置", {permanent:false, direction:'top'});
            currentMarkers.push(marker);
            map.setView([userLocation.lat, userLocation.lon], 15);
            if (isMobile()) toggleUIForMobile(false, true); // ✅ 保留半徑欄位
            hideLoading(); setBusy(false);
        }, 
        (err)=>{
            alert("無法取得定位，請確認瀏覽器允許定位權限，或重新整理頁面再嘗試");
            hideLoading(); setBusy(false);
        }
      );
  });
}

// 「重新搜尋條件」按鈕
if (resetBtn) {
    resetBtn.addEventListener("click", () => {
        // 展開完整 UI
        toggleUIForMobile(true, false);
        // 清除使用者位置
        userLocation = null;
        // 清空輸入與結果
        streetInput.value = "";
        streetSuggestions.innerHTML = "";
        resultsPanel.innerHTML = "";
        // 回到預設地圖
        map.setView([25.033964, 121.564468], 13);
        // 移除地圖上的大頭針
        clearMarkers();
    });
}

if(!isMobile() && locateBtn){
    locateBtn.style.display = "none";
}

// ----- Helpers -----
function showLoading() { if(loadingEl) loadingEl.classList.add('show'); }
function hideLoading() { if(loadingEl) loadingEl.classList.remove('show'); }
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
  const controller = opts.signal ? null : new AbortController();
  const signal = opts.signal || controller.signal;
  const id = setTimeout(()=>controller?.abort(), timeout);
  try { const r = await fetch(url, { ...opts, signal }); clearTimeout(id); return r; } 
  catch(e) { clearTimeout(id); throw e; }
}
async function fetchWithRetry(fetchFn, retries = 2, delay = 500){
  let lastError;
  for(let i=0;i<=retries;i++){
    try { return await fetchFn(); } 
    catch(e){ lastError=e; if(i<retries) await new Promise(r=>setTimeout(r,delay)); }
  }
  throw lastError;
}
function shuffleArray(arr){ const a=arr.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function distance(lat1,lon1,lat2,lon2){const R=6371000; const toRad=Math.PI/180; const φ1=lat1*toRad, φ2=lat2*toRad; const Δφ=(lat2-lat1)*toRad, Δλ=(lon2-lon1)*toRad; return R*2*Math.atan2(Math.sqrt(Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2),Math.sqrt(1-(Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2))); }
function isMobile(){ return /android/i.test(ua) || /iPad|iPhone|iPod/.test(ua); }
function isIOS(){ return /iPad|iPhone|iPod/.test(ua); }
function isAndroid(){ return /android/i.test(ua); }

// ----- Theme -----
const themeToggleBtn = document.getElementById("themeToggle");
function updateThemeButtonText(){ themeToggleBtn.textContent = document.body.classList.contains("dark-mode")?"切換光亮模式":"切換黑暗模式"; }
const savedTheme = localStorage.getItem("theme"); if(savedTheme==="dark") document.body.classList.add("dark-mode"); updateThemeButtonText();
themeToggleBtn.addEventListener("click",()=>{ document.body.classList.toggle("dark-mode"); localStorage.setItem("theme",document.body.classList.contains("dark-mode")?"dark":"light"); updateThemeButtonText(); });

// ----- Populate Cities/Districts -----
function populateDistricts(dataSource, city){
  districtSelect.innerHTML="";
  const districts=dataSource[city];
  if(!districts || districts.length===0){ const o=document.createElement("option"); o.value=city; o.textContent=city; districtSelect.appendChild(o); }
  else { districts.forEach(d=>{ const o=document.createElement("option"); o.value=d; o.textContent=d; districtSelect.appendChild(o); }); }
}
function populateCitiesAndDistricts(){
  const country=countrySelect.value;
  const dataSource=country==="jp"?window.japanData:window.taiwanData;
  citySelect.innerHTML="";
  Object.keys(dataSource).forEach(city=>{ const o=document.createElement("option"); o.value=city;o.textContent=city; citySelect.appendChild(o); });
  citySelect.selectedIndex=0; populateDistricts(dataSource, citySelect.value);
}
populateCitiesAndDistricts();
countrySelect.addEventListener("change",()=>{
  currentCountry=countrySelect.value;
  populateCitiesAndDistricts();
  if(currentCountry==="jp") alert("⚠️ 日本地區資料可能不完整，部分城市或餐廳資訊缺失");
  const titleEl=document.querySelector(".header h1"); if(titleEl) titleEl.textContent=currentCountry==="tw"?"台灣餐廳隨機推薦器":"日本餐廳隨機推薦器";
  streetInput.value=""; streetSuggestions.innerHTML=""; resultsPanel.innerHTML=""; map.setView([25.033964,121.564468],13);
});
citySelect.addEventListener("change",()=>{ const dataSource=countrySelect.value==="jp"?window.japanData:window.taiwanData; populateDistricts(dataSource, citySelect.value); });

// ----- Restaurant Types -----
const typeOptions=[
  {label:"全部",value:""},
  {label:"餐廳 (restaurant)",value:"restaurant"},
  {label:"速食 (fast_food)",value:"fast_food"},
  {label:"咖啡店 (cafe)",value:"cafe"},
  {label:"酒吧 (bar)",value:"bar"},
  {label:"麵包/烘焙 (bakery)",value:"bakery"},
  {label:"甜點 (ice_cream/patisserie)",value:"ice_cream"},
  {label:"小吃/速食 (food_court)",value:"food_court"},
  {label:"夜市小吃 (takeaway)",value:"takeaway"},
  {label:"飲料/手搖 (beverages)",value:"beverages"}
];
typeOptions.forEach(opt=>{ const o=document.createElement("option"); o.value=opt.value;o.textContent=opt.label; typeSelect.appendChild(o); });

// ----- Overpass -----
async function overpassQuery(query){
  for(const endpoint of OVERPASS_SERVERS){
    try{
      return await fetchWithRetry(async()=>{
        const r=await fetchWithTimeout(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:query},15000);
        const text=await r.text(); if(text.trim().startsWith('<')) throw new Error("HTML error, skip"); return JSON.parse(text);
      }, OVERPASS_RETRY);
    }catch(e){ console.warn(`Overpass attempt failed for ${endpoint}:`,e); }
  }
  console.warn("All Overpass servers failed"); return {elements:[]};
}

// ----- Geocode -----
async function geocode(query){
  try{
    return await fetchWithRetry(async()=>{
      const url=`https://us1.locationiq.com/v1/search.php?key=${API_KEY}&q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=3`;
      const r=await fetchWithTimeout(url,{},8000); if(!r.ok) throw new Error("LocationIQ failed");
      const j=await r.json(); if(j.length===0) throw new Error("No results from LocationIQ"); return {lat:parseFloat(j[0].lat),lon:parseFloat(j[0].lon),raw:j[0]};
    }, LOCATIONIQ_RETRY);
  }catch(e){ console.warn("LocationIQ failed, fallback to Nominatim"); }
  try{
    return await fetchWithRetry(async()=>{
      const url=`https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&q=${encodeURIComponent(query)}&limit=3`;
      const r=await fetchWithTimeout(url,{headers:{"Accept":"application/json"}},8000); if(!r.ok) throw new Error("Nominatim failed");
      const j=await r.json(); if(j.length===0) throw new Error("No results from Nominatim"); return {lat:parseFloat(j[0].lat),lon:parseFloat(j[0].lon),raw:j[0]};
    }, NOMINATIM_RETRY);
  }catch(e){ console.warn("Nominatim failed:",e); }
  return null;
}

// ----- Find Restaurants -----
async function findRestaurants(lat,lon,radius=1000,type=''){
  const arr=type?currentMapping[type]||currentMapping["restaurant"]:currentMapping["restaurant"];
  let bboxFilter=null; let polygonGeo=null;
  if(radius===0 && lastSearchCenter?.raw?.boundingbox){
    const bb=lastSearchCenter.raw.boundingbox.map(parseFloat); bboxFilter=bb; polygonGeo=lastSearchCenter.raw.geojson||null;
  }
  function buildOverpassFilter(tag,lat,lon,radius,bbox){ return radius===0 && bbox?`${tag}(${bbox[0]},${bbox[2]},${bbox[1]},${bbox[3]});`:`${tag}(around:${radius},${lat},${lon});`; }
  const filters=arr.map(s=>buildOverpassFilter(s,lat,lon,radius,bboxFilter));
  const q=`[out:json];(${filters.join('')});out center tags;`;
  const data=await overpassQuery(q);
  const elements=data.elements||[];
  const seen=new Set();
  const targetCity=citySelect.value; const targetDistrict=districtSelect.value;
  const exactMatch=[]; const fuzzyMatch=[];
  elements.forEach(e=>{
    const t = e.tags || {};
    const closedText = `
      ${t.name || ""}
      ${t.opening_hours || ""}
      ${t.description || ""}
      ${t.note || ""}
    `.toLowerCase();

    if (
      t.disused ||
      t.abandoned ||
      t["disused:amenity"] ||
      t["abandoned:amenity"] ||
      t.closed ||
      t["contact:status"] === "closed" ||
      t.shop === "vacant" ||
      /歇業|停業|永久|結束營業|已關閉|closed|permanently|no longer/i.test(closedText)
    ) {
      return; // ← 直接踢掉，不進結果
    }
    const key=(t.name||"")+"|"+(t["addr:street"]||"")+"|"+(t["addr:housenumber"]||"");
    if(seen.has(key)) return; seen.add(key);
    const eLat=e.lat||e.center?.lat; const eLon=e.lon||e.center?.lon; if(!eLat||!eLon) return;
    const isBoundary=!isWithinBounds(eLat,eLon,bboxFilter,polygonGeo);
    const addrCity=(t["addr:city"]||t["addr:county"]||t["addr:state"]||t["addr:town"]||"").trim();
    const addrDistrict=(t["addr:district"]||t["addr:suburb"]||t["addr:village"]||"").trim();
    const maxDistCity=Math.floor(Math.max(addrCity.length,targetCity.length)*0.3);
    const maxDistDistrict=Math.floor(Math.max(addrDistrict.length,targetDistrict.length)*0.3);
    const cityMatch=!addrCity||levenshtein(addrCity,targetCity)<=maxDistCity;
    const districtMatch=!addrDistrict||levenshtein(addrDistrict,targetDistrict)<=maxDistDistrict;
    if(addrDistrict&&addrDistrict===targetDistrict&&districtMatch&&cityMatch) exactMatch.push(e);
    else if(districtMatch&&cityMatch) fuzzyMatch.push(e);
  });
  return exactMatch.concat(fuzzyMatch);
}

// ----- Merge Geocode Info -----
async function mergeGeocodeInfo(restaurants) {
    if (!restaurants || restaurants.length === 0) return restaurants;

    for (const r of restaurants) {
        const t = r.tags || {};
        const name = t.name;
        if (!name) continue;

        // 已有可靠地址就不補
        if (isReliableAddress(t["addr:full"])) {
            r.geocodeAddress = t["addr:full"];
            continue;
        }

        // 用「店名 + 城市 + 區」再查一次
        const query = `${name} ${citySelect.value} ${districtSelect.value}`;

        try {
            const geo = await geocode(query);
            if (geo?.raw?.display_name && isReliableAddress(geo.raw.display_name)) {
                r.geocodeAddress = geo.raw.display_name;
            }
        } catch (e) {
            console.warn("店家補地址失敗:", name);
        }
    }

    return restaurants;
}

// ----- Levenshtein -----
function levenshtein(a,b){if(a.length===0) return b.length; if(b.length===0) return a.length; const matrix=[]; for(let i=0;i<=b.length;i++) matrix[i]=[i]; for(let j=0;j<=a.length;j++) matrix[0][j]=j; for(let i=1;i<=b.length;i++){for(let j=1;j<=a.length;j++){matrix[i][j]=b.charAt(i-1)===a.charAt(j-1)?matrix[i-1][j-1]:Math.min(matrix[i-1][j-1]+1,matrix[i][j-1]+1,matrix[i-1][j]+1);}} return matrix[b.length][a.length]; }

// ----- Map / Marker -----
function clearMarkers(){ currentMarkers.forEach(m=>map.removeLayer(m)); currentMarkers=[]; }
function isWithinBounds(lat,lon,bbox,polygonGeo){
  if(bbox){ const [south,north,west,east]=bbox; if(lat<south||lat>north||lon<west||lon>east) return false; }
  if(polygonGeo && !pointInPolygon([lon,lat],polygonGeo)) return false;
  return true;
}
function pointInPolygon(point,polygon){
  const x=point[0],y=point[1]; let inside=false;
  const coords=polygon.type==="Polygon"?polygon.coordinates:polygon.coordinates[0];
  for(let i=0,j=coords.length-1;i<coords.length;j=i++){ const xi=coords[i][0],yi=coords[i][1],xj=coords[j][0],yj=coords[j][1]; const intersect=((yi>y)!==(yj>y))&&(x<((xj-xi)*(y-yi))/(yj-yi)+xi); if(intersect) inside=!inside; }
  return inside;
}

// ----- Create Action Buttons -----
function createActionButtons(lat, lon, name, r) {
    const container = document.createElement("div");
    container.className = "card-actions";

    const t = r.tags || {};
    // 優先使用 addr:full, 然後 mergeGeocodeInfo 產生的 geocodeAddress
    let rawAddress = t["addr:full"] || r.geocodeAddress || "";
    rawAddress = rawAddress.trim();

    // 判斷地址是否可靠
    const hasReliableAddress = isReliableAddress(rawAddress);
    const fullAddress = hasReliableAddress ? rawAddress : "";

    // 顯示在地圖
    const btnView = document.createElement("button");
    btnView.textContent = "📍 顯示在地圖";
    btnView.classList.add("action-btn", "map-btn");
    btnView.addEventListener("click", () => {
    map.setView([lat, lon], 17);
    // 手機上自動滾動到地圖
    const mapEl = document.getElementById("map");
    if(mapEl){
        mapEl.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    });


    // 在 Google Maps 開啟
    const btnMaps = document.createElement("button");
    btnMaps.textContent = "🗺️ 在 Google Maps 開啟";
    btnMaps.classList.add("action-btn", "google-btn");
    btnMaps.addEventListener("click", () => {
        let query;
        if (hasReliableAddress) {
            // 有完整地址就直接用地址
            query = encodeURIComponent(fullAddress);
        } else {
            // 沒有地址 fallback 經緯度，並提醒使用者
            query = `${lat},${lon}`;
            alert(`注意：${name} 無詳細地址，本次使用經緯度顯示`);
        }
        handleMapClick("search", query);
    });

    // 導航
    const btnNav = document.createElement("button");
    btnNav.textContent = "🚗 導航";
    btnNav.classList.add("action-btn", "nav-btn");
    btnNav.addEventListener("click", () => {
        let dest;
        if (hasReliableAddress) {
            dest = encodeURIComponent(fullAddress);
        } else {
            dest = `${lat},${lon}`;
            alert(`注意：${name} 無詳細地址，本次導航使用經緯度`);
        }
        handleMapClick("nav", dest);
    });

    container.appendChild(btnView);
    container.appendChild(btnMaps);
    container.appendChild(btnNav);
    return container;
}

// ----- Map Click Handler -----
function handleMapClick(type, query){
    const fallbackUrl=`https://www.google.com/maps/${type==='nav'?'dir':'search'}/?api=1&${type==='nav'?'destination':'query'}=${query}&travelmode=driving`;
    // 顯示地圖區域
    const mapEl = document.getElementById("map");
    if(mapEl){
        mapEl.scrollIntoView({behavior:"smooth"});
    }
    if(isIOS()){
        const iosUrl = type==='nav' ? `comgooglemaps://?daddr=${query}&directionsmode=driving` : `comgooglemaps://?q=${query}&zoom=16`;
        window.location.href=iosUrl; 
        setTimeout(()=>window.open(fallbackUrl,"_blank"),500);
    } else if(isAndroid()){
        const androidUrl = type==='nav' ? `intent://maps.google.com/maps?daddr=${query}&directionsmode=driving#Intent;scheme=https;package=com.google.android.apps.maps;end` : `intent://maps.google.com/maps?q=${query}#Intent;scheme=https;package=com.google.android.apps.maps;end`;
        window.location.href = androidUrl;
        setTimeout(()=>window.open(fallbackUrl,"_blank"),500);
    } else window.open(fallbackUrl,"_blank");
}

/**
 * 切換手機版 UI
 * @param {boolean} showFull - true 顯示完整 UI，false 折疊
 * @param {boolean} keepRadius - 折疊時是否保留「搜尋半徑整組」
 */
function toggleUIForMobile(showFull = true, keepRadius = false) {
    const radiusGroup = [
        radiusInput,
        radiusLabel,
        document.querySelector('label[for="radiusInput"]'),
        document.querySelector('.controls .small')
    ];
    const normalControls = [
        countrySelect,
        citySelect,
        districtSelect,
        streetInput,
        streetSuggestions,
        typeSelect,
        document.querySelector('label[for="countrySelect"]'),
        document.querySelector('label[for="citySelect"]'),
        document.querySelector('label[for="districtSelect"]'),
        document.querySelector('label[for="streetInput"]'),
        document.querySelector('label[for="typeSelect"]')
    ];
    // 一般欄位
    normalControls.forEach(el => {
        if (el) el.style.display = showFull ? "" : "none";
    });
    // 搜尋半徑（整組處理）
    radiusGroup.forEach(el => {
        if (!el) return;
        if (showFull) {
            el.style.display = "";
        } else {
            el.style.display = keepRadius ? "" : "none";
        }
    });
    // 按鈕區
    reshuffleBtn.style.display = "";
    if (resetBtn) resetBtn.style.display = showFull ? "none" : "";
}

// ----- Render Restaurants -----
function renderRestaurants(restaurants) {
    clearMarkers();
    resultsPanel.innerHTML = "";
    if (!restaurants || restaurants.length === 0) {
        resultsPanel.textContent = "找不到符合的店家";
        return;
    }
    const bounds = L.latLngBounds([]);
    // 隨機抽三筆
    const displayRestaurants = shuffleArray(restaurants).slice(0, 3);
    displayRestaurants.forEach(r => {
        const t = r.tags || {};
        const lat = r.lat || r.center?.lat;
        const lon = r.lon || r.center?.lon;
        if (!lat || !lon) return;
        // --- Name ---
        let name = t.name || r.name || "查無資料";
        // --- Address ---
        let rawAddress = "";
        if (t["addr:street"] || t["addr:housenumber"]) {
            rawAddress = ((t["addr:street"] || "") + " " + (t["addr:housenumber"] || "")).trim();
        } else if (t["addr:full"]) {
            rawAddress = t["addr:full"];
        } else if (r.geocodeAddress) {
            rawAddress = r.geocodeAddress;
        }
        let address = isReliableAddress(rawAddress) ? rawAddress : "查無資料";
        // --- Opening Hours ---
        let hours = t.opening_hours || r.opening_hours || "查無資料";
        // --- Popup Content ---
        const popupContent = document.createElement("div");
        const titleEl = document.createElement("h3");
        titleEl.textContent = name;
        titleEl.className = "card-title";
        popupContent.appendChild(titleEl);
        const addrEl = document.createElement("p");
        addrEl.textContent = "店家地址: " + address;
        addrEl.className = "card-sub";
        popupContent.appendChild(addrEl);
        const hoursEl = document.createElement("p");
        hoursEl.textContent = "店家營業時間: " + hours;
        hoursEl.className = "card-sub";
        popupContent.appendChild(hoursEl);
        const btnContainer = createActionButtons(lat, lon, name, r);
        popupContent.appendChild(btnContainer);
        // --- Leaflet Marker ---
        const marker = L.marker([lat, lon]).addTo(map);
        marker.bindTooltip(name, {permanent: false, direction: 'top'});
        currentMarkers.push(marker);
        bounds.extend([lat, lon]);
        // --- Card in Results Panel ---
        const card = document.createElement("div");
        card.className = "card";
        const cardLeft = document.createElement("div");
        cardLeft.className = "card-left";
        const cardTitle = document.createElement("h3");
        cardTitle.textContent = name;
        cardTitle.className = "card-title";
        cardLeft.appendChild(cardTitle);
        const cardAddr = document.createElement("p");
        cardAddr.textContent = "店家地址: " + address;
        cardAddr.className = "card-sub";
        cardLeft.appendChild(cardAddr);
        const cardHours = document.createElement("p");
        cardHours.textContent = "店家營業時間: " + hours;
        cardHours.className = "card-sub";
        cardLeft.appendChild(cardHours);
        card.appendChild(cardLeft);
        // ✅ 生成新的按鈕，保證事件處理器有效
        const cardActions = createActionButtons(lat, lon, name, r);
        card.appendChild(cardActions);
        resultsPanel.appendChild(card);
    });
    if (currentMarkers.length > 0) map.fitBounds(bounds.pad(0.3));
}

// ----- Main Search -----
async function doSearch() {
    // 每次搜尋前清除先前使用者位置（除非是點取得位置）
    const isUsingUserLocation = !!userLocation;
    showLoading();
    setBusy(true);
    try {
        const city = citySelect.value;
        const district = districtSelect.value;
        const street = streetInput.value.trim();
        const type = typeSelect.value;
        const radius = parseInt(radiusInput.value);
        let center = null;
        // 如果 userLocation 有值，就用它作為搜尋中心
        if (isUsingUserLocation) {
            center = { lat: userLocation.lat, lon: userLocation.lon };
        } else {
            const queryArr = [city, district, street].filter(s => s).join(" ");
            // Geocode 嘗試
            try {
                center = await geocode(queryArr);
                if (!center) throw new Error("找不到該地址位置");
            } catch (e) {
                console.error("Geocode 失敗:", e);
                alert("找不到該地址位置");
                return;
            }
        }
        lastSearchCenter = center;
        // 搜尋餐廳
        lastRestaurants = [];
        try {
            let results = await findRestaurants(center.lat, center.lon, radius, type);
            lastRestaurants = await mergeGeocodeInfo(results, [city, district, street].filter(s => s).join(" "));
        } catch (e) {
            console.warn("搜尋餐廳資料處理失敗，但不影響已取得資料:", e);
        }
        // 隨機抽三筆
        const randomResults = shuffleArray(lastRestaurants).slice(0, 3);
        renderRestaurants(randomResults);
        // 手機 UI 折疊
        if (isMobile()) toggleUIForMobile(false, false); // false → 不隱藏半徑欄位
        // 顯示重新搜尋條件按鈕
        if (resetBtn) resetBtn.style.display = "";
        // 若結果為空，才 alert
        if (!lastRestaurants || lastRestaurants.length === 0) {
            alert("找不到符合的店家，請稍後再試");
        }
    } catch (e) {
        console.error("整體搜尋失敗:", e);
        if (!lastRestaurants || lastRestaurants.length === 0) {
            alert("搜尋失敗，請稍後再試");
        }
    } finally {
        hideLoading();
        setBusy(false);
    }
}

searchBtn.addEventListener("click",doSearch);
reshuffleBtn.addEventListener("click", ()=>{
    if(lastRestaurants.length > 0){
        const shuffled = shuffleArray(lastRestaurants);
        renderRestaurants(shuffled.slice(0,3));
    }
    if(isMobile()) toggleUIForMobile(false);
  });

  window.addEventListener("beforeunload", () => {
    userLocation = null;
  });

  // 綁定事件
  if(resetBtn){
    resetBtn.addEventListener("click", () => {
        toggleUIForMobile(true, false);   // 展開完整 UI
        userLocation = null;       // 清掉上一個搜尋位置
        streetInput.value = "";
        streetSuggestions.innerHTML = "";
        resultsPanel.innerHTML = "";
        map.setView([25.033964,121.564468], 13); // 回到預設地圖
    });
  }

// ----- Radius Label -----
radiusInput.addEventListener("input", () => {
    radiusLabel.textContent = radiusInput.value + "公尺";
});

// ----- Street Autocomplete -----
streetInput.addEventListener("input",(e)=>{
  if(streetInputDebounceTimeout) clearTimeout(streetInputDebounceTimeout);
  streetInputDebounceTimeout=setTimeout(()=>{
    const val=e.target.value.trim().toLowerCase(); streetSuggestions.innerHTML=""; if(!val) return;
    const streets=taiwanData[citySelect.value]||[]; similarStreets=streets.filter(s=>s.toLowerCase().includes(val)).slice(0,5);
    similarStreets.forEach(st=>{
      const li=document.createElement("li"); li.textContent=st; li.addEventListener("click",()=>{ streetInput.value=st; streetSuggestions.innerHTML=""; }); streetSuggestions.appendChild(li);
    });
  },300);
});
document.addEventListener("click",(e)=>{ if(!streetInput.contains(e.target)) streetSuggestions.innerHTML=""; });

// ----- Initial Radius -----
radiusLabel.textContent=radiusInput.value+"公尺";
window.addEventListener("beforeunload", () => {
  userLocation = null;
});

/**
 * 判斷地址是否「可信可用於 Google Maps search」
 * @param {string} address
 * @returns {boolean}
 */
function isReliableAddress(address) {
    if (!address) return false;
    const addr = String(address).trim();
    if (addr === "" || addr === "查無資料") return false;
    // 排除只有行政區的地址
    const adminOnlyPattern = /^(.*(縣|市))?\s*(.*(區|鄉|鎮|市))(\s*,?\s*臺灣)?$/;
    if (adminOnlyPattern.test(addr)) return false;
    // 台灣常見地址關鍵字
    const keywords = ["路","街","巷","弄","號","段","大道","橋","大樓"];
    if (!keywords.some(k => addr.includes(k))) return false;
    // 防呆：只要有數字就算，允許中文逗號
    if (!/\d/.test(addr)) return false;
    return true;
}

if (isMobile()) toggleUIForMobile(true, false);