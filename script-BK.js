/* script.js - 修正版完整程式碼 */
const taiwanData = window.taiwanData;
const mapping = window.mapping;

// ---------- 全域 UA ----------
const ua = navigator.userAgent || navigator.vendor || window.opera;

const API_KEY = "pk.bc63f534da0350a75d49564feb994bfd"; // <- 換成你的 key
const PRECISE_SEARCH_ENABLED = true; // 啟用精確搜尋功能
const GOOGLE_GEOCODING_API_KEY = ""; // 如果有 Google Geocoding API key，請填入
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
let hasUsedLocate = false; // ⭐ 新增：是否曾點擊「取得我的位置」
let hasSearched = false; // ⭐ 是否真的執行過「搜尋餐廳」
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
  hasUsedLocate = true; // ⭐ 使用者明確點過定位
  updateRadiusVisibility();
      if(!navigator.geolocation){
          alert("此裝置不支援定位");
          return;
      }
      showLoading(); setBusy(true);
      navigator.geolocation.getCurrentPosition(
        async(pos)=>{
            userLocation = {lat: pos.coords.latitude, lon: pos.coords.longitude};
            // 顯示目前地址
            const addrEl = document.getElementById("currentAddress");
            const addrData = await geocode(`${userLocation.lat},${userLocation.lon}`);
            if (addrEl && addrData?.raw?.display_name) {
                addrEl.textContent = "📍 目前位置：" + addrData.raw.display_name;
                addrEl.style.display = "";
            }
            clearMarkers();
            const marker = L.marker([userLocation.lat, userLocation.lon]).addTo(map);
            marker.bindTooltip("👤 您目前的位置", {permanent:false, direction:'top'});
            // 將使用者位置資訊存到 marker 中
            marker.isUserLocation = true;
            marker.userLocationData = { lat: userLocation.lat, lon: userLocation.lon };
            currentMarkers.push(marker);

            // 高亮使用者位置
            setTimeout(() => highlightUserLocation(), 300);
            map.setView([userLocation.lat, userLocation.lon], 15);
            locateBtn.style.display = "none";
            if(isMobile()) toggleUIForMobile(false, true); // ✅ 保留半徑欄位
            
            // 高亮使用者位置
            setTimeout(() => highlightUserLocation(), 300);
            
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

        // 1️⃣ 展開完整 UI（不保留半徑）
        toggleUIForMobile(true, false);

        // 2️⃣ 重置定位狀態
        hasUsedLocate = false;
        userLocation = null;

        lastRestaurants = [];

        // 3️⃣ 清空輸入與結果
        streetInput.value = "";
        streetSuggestions.innerHTML = "";
        resultsPanel.innerHTML = "";

        // 4️⃣ 搜尋 / 定位按鈕恢復
        searchBtn.style.display = "";
        locateBtn.style.display = "";
        reshuffleBtn.style.display = "none"; // ⭐ 一開始不顯示
        reshuffleBtn.disabled = true;
        hasSearched = false;

        // 5️⃣ 回到預設地圖
        map.setView([25.033964, 121.564468], 13);
        clearMarkers();

        // ⭐ 清空定位
        userLocation = null;
        hasUsedLocate = false;

        // ⭐ 清空搜尋狀態
        hasSearched = false;
        lastRestaurants = [];

        // ⭐ 隱藏「目前位置」顯示文字
        const addrEl = document.getElementById("currentAddress");
        if (addrEl) {
            addrEl.textContent = "";
            addrEl.style.display = "none";
        }

        // ⭐ 強制隱藏「重新抽選三家」
        reshuffleBtn.style.display = "none";
        reshuffleBtn.disabled = true;

        updateRadiusVisibility();

        // ⭐ reset = 強制回到初始狀態，半徑一律隱藏
        radiusInput.style.display = "none";
        radiusLabel.style.display = "none";
        const radiusLabelEl = document.querySelector('label[for="radiusInput"]');
        if (radiusLabelEl) radiusLabelEl.style.display = "none";
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
function updateRadiusVisibility() {
    const hasStreet = streetInput.value.trim().length > 0;
    const show = hasStreet || hasUsedLocate;
    const radiusLabelEl = document.querySelector('label[for="radiusInput"]');

    radiusInput.style.display = show ? "" : "none";
    radiusLabel.style.display = show ? "" : "none";
    if (radiusLabelEl) radiusLabelEl.style.display = show ? "" : "none";
}

streetInput.addEventListener("input", updateRadiusVisibility);
districtSelect.addEventListener("change", updateRadiusVisibility);


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
citySelect.addEventListener("change",()=>{ const dataSource=countrySelect.value==="jp"?window.japanData:window.taiwanData; populateDistricts(dataSource, citySelect.value); updateSearchInfo(); });

districtSelect.addEventListener("change", () => {
    // 清空街道 / 門牌欄位
    streetInput.value = "";
    streetSuggestions.innerHTML = "";

    // 隱藏半徑欄位（只有填街道時才顯示）
    radiusInput.style.display = "none";
    radiusLabel.style.display = "none";
    const radiusLabelEl = document.querySelector('label[for="radiusInput"]');
    if(radiusLabelEl) radiusLabelEl.style.display = "none";

    // 更新目前搜尋訊息
    updateSearchInfo();
});

// 半徑改變（手機版定位後才顯示半徑）
radiusInput.addEventListener("input", updateSearchInfo);

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

    // 過濾掉非餐飲業態（超商、影印店等）
    const shopType = t.shop || "";
    const cuisineType = t.cuisine || "";
    if (type === "restaurant" && shopType && !["restaurant","fast_food","cafe","bar","bakery","ice_cream","food_court","takeaway","beverages"].includes(shopType)) {
        return; // 直接跳過
    }

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

// ----- Merge Geocode Info (進階版) -----
async function mergeGeocodeInfo(restaurants, centerQuery) {
    if (!restaurants || restaurants.length === 0) return restaurants;
    
    return await Promise.all(restaurants.map(async (r) => {
        const t = r.tags || {};
        const name = t.name || r.name || "查無資料";
        r.name = name;
        
        // ------------------ 原有地址處理 ------------------
        let fullAddr = "";
        
        // 優先用完整地址 addr:full
        if (t["addr:full"]) {
            fullAddr = t["addr:full"];
        }
        // 如果有街道 + 門牌，就組合成完整地址
        else if (t["addr:street"] && t["addr:housenumber"]) {
            fullAddr = `${t["addr:street"]} ${t["addr:housenumber"]}`.trim();
        }
        // 如果只有街道或 place 就先用它
        else if (t["addr:street"] || t["addr:place"]) {
            fullAddr = t["addr:street"] || t["addr:place"];
        }
        // fallback 用區 + 城市
        else if (t["addr:district"] && t["addr:city"]) {
            fullAddr = `${t["addr:district"]}, ${t["addr:city"]}`;
        }

        // 🆕 如果地址不可靠，優先使用經緯度反向地理編碼
        const originalLat = r.lat || r.center?.lat;
        const originalLon = r.lon || r.center?.lon;
        
        if (!isReliableAddress(fullAddr) && originalLat && originalLon) {
            console.log(`📍 ${name}: 地址不可靠，使用經緯度反向地理編碼`);
            
            try {
                // 🆕 高精度反向地理編碼
                const reverseAddr = await preciseReverseGeocode(originalLat, originalLon, name);
                if (reverseAddr && isReliableAddress(reverseAddr)) {
                    fullAddr = reverseAddr;
                    r.addressSource = "經緯度反向地理編碼";
                    r.reverseGeocoded = true;
                } else {
                    // 🆕 如果反向地理編碼也失敗，保留經緯度
                    fullAddr = `${originalLat},${originalLon}`;
                    r.addressSource = "經緯度備援";
                    r.addressFallback = true;
                }
            } catch (e) {
                console.warn(`反向地理編碼失敗 ${name}:`, e);
                fullAddr = `${originalLat},${originalLon}`;
                r.addressSource = "經緯度備援（失敗）";
                r.addressFallback = true;
            }
        }

        // 🆕 精確地址搜尋（只針對真正需要的店家）
        const needsPreciseSearch = !isReliableAddress(fullAddr) && 
                                  name !== "查無資料" && 
                                  PRECISE_SEARCH_ENABLED &&
                                  !isGenericName(name) && // 🆕 過濾通用名稱
                                  name.length >= 3; // 🆕 只搜尋有意義的店名
        
        if (needsPreciseSearch) {
            try {
                const preciseAddress = await geocodeByNameWithStrategies(name, originalLat, originalLon);
                if (preciseAddress && isReliableAddress(preciseAddress.fullAddress)) {
                    fullAddr = preciseAddress.fullAddress;
                    r.addressSource = `店家名稱精確搜尋 (${preciseAddress.strategy})`;
                    r.preciseLocation = true;
                }
            } catch (e) {
                console.warn(`精確搜尋 ${name} 失敗:`, e);
            }
        }

        r.geocodeAddress = fullAddr;
        r.opening_hours = t.opening_hours || t.note || t.description || t.operator || "查無資料";
        return r;
    }));
}

// ----- 透過店家名稱搜尋精確地址 -----
async function geocodeByName(restaurantName) {
    if (!restaurantName || restaurantName === "查無資料") return null;
    
    // 只有當地址明顯不完整時才進行精確搜尋
    const city = citySelect.value || "";
    const district = districtSelect.value || "";
    
    try {
        // 使用免費的 API 來源
        const results = await Promise.allSettled([
            // 1. Nominatim 精確搜尋
            searchNominatimPrecise(restaurantName),
            // 2. LocationIQ 精確搜尋  
            searchLocationIqPrecise(restaurantName)
        ]);
        
        // 找到最可靠的結果
        for (const result of results) {
            if (result.status === 'fulfilled' && result.value) {
                const candidate = result.value;
                
                // 驗證結果的可靠性
                if (isReliableAddress(candidate.fullAddress) && 
                    candidate.lat && candidate.lon) {
                    
                    // 降低相似度門檻，並優先考慮地址的可靠性
                    const nameSimilarity = calculateNameSimilarity(restaurantName, candidate.displayName || candidate.name || '');
                    if (nameSimilarity > 0.5) {
                        return {
                            fullAddress: candidate.fullAddress,
                            lat: candidate.lat,
                            lon: candidate.lon,
                            name: candidate.displayName || candidate.name,
                            source: candidate.source
                        };
                    }
                }
            }
        }
    } catch (e) {
        console.warn("店家名稱精確搜尋失敗:", e);
    }
    
    return null;
}

// ----- Nominatim 精確搜尋 -----
async function searchNominatimPrecise(searchQuery) {
    try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&q=${encodeURIComponent(searchQuery)}&limit=5&countrycodes=tw,jp`;
        const response = await fetchWithTimeout(url, { headers: {"Accept": "application/json"} }, 8000);
        const data = await response.json();
        
        // 尋找最匹配的結果，優先排除行政機關
        for (const result of data) {
            if (result.display_name && result.lat && result.lon) {
                // 排除明顯不是店家的結果
                const displayName = (result.display_name || "").toLowerCase();
                const excludeKeywords = ['辦公處', '區公所', '里辦公處', '派出所', '學校', '公園', '市場', '醫院', '郵局'];
                
                if (excludeKeywords.some(keyword => displayName.includes(keyword))) {
                    continue; // 跳過這些結果
                }
                
                // 只選擇看起來像是店家地址的結果
                if (result.class === 'shop' || result.class === 'amenity' || 
                    result.type === 'restaurant' || result.type === 'shop' ||
                    displayName.includes('號') || displayName.includes('樓') || 
                    displayName.includes('巷') || displayName.includes('弄')) {
                    
                    return {
                        fullAddress: result.display_name,
                        lat: parseFloat(result.lat),
                        lon: parseFloat(result.lon),
                        displayName: result.name,
                        source: "Nominatim 精確搜尋"
                    };
                }
            }
        }
    } catch (e) {
        console.warn("Nominatim 精確搜尋失敗:", e);
    }
    return null;
}

// ----- LocationIQ 精確搜尋 -----
async function searchLocationIqPrecise(searchQuery) {
    try {
        const url = `https://us1.locationiq.com/v1/search.php?key=${API_KEY}&q=${encodeURIComponent(searchQuery)}&format=json&addressdetails=1&limit=5&countrycodes=TW,JP`;
        const response = await fetchWithTimeout(url, {}, 8000);
        const data = await response.json();
        
        // 尋找最匹配的結果
        for (const result of data) {
            if (result.display_name && result.lat && result.lon) {
                return {
                    fullAddress: result.display_name,
                    lat: parseFloat(result.lat),
                    lon: parseFloat(result.lon),
                    displayName: result.name,
                    source: "LocationIQ 精確搜尋"
                };
            }
        }
    } catch (e) {
        console.warn("LocationIQ 精確搜尋失敗:", e);
    }
    return null;
}

// ----- 計算店家名稱相似度 -----
function calculateNameSimilarity(name1, name2) {
    if (!name1 || !name2) return 0;
    
    const n1 = name1.toLowerCase().trim();
    const n2 = name2.toLowerCase().trim();
    
    // 完全匹配
    if (n1 === n2) return 1.0;
    
    // 包含關係
    if (n1.includes(n2) || n2.includes(n1)) return 0.9;
    
    // 使用 Levenshtein 距離計算相似度
    const maxLength = Math.max(n1.length, n2.length);
    const distance = levenshtein(n1, n2);
    const similarity = 1 - (distance / maxLength);
    
    return similarity;
}

// ----- 透過店家名稱搜尋精確地址 -----
async function geocodeByName(restaurantName) {
    if (!restaurantName || restaurantName === "查無資料") return null;
    
    // 取得目前搜尋的城市和區域作為限制條件
    const city = citySelect.value || "";
    const district = districtSelect.value || "";
    const searchQuery = `${restaurantName}, ${district}, ${city}`.replace(/, ,/g, ',').replace(/,$/, '');
    
    try {
        // 使用多個 API 來源嘗試精確搜尋
        const results = await Promise.allSettled([
            // 1. Google Maps Geocoding API (如果有 API key)
            searchGoogleGeocoding(restaurantName, city, district),
            // 2. Nominatim 精確搜尋
            searchNominatimPrecise(searchQuery),
            // 3. LocationIQ 精確搜尋  
            searchLocationIqPrecise(searchQuery)
        ]);
        
        // 找到最可靠的結果
        for (const result of results) {
            if (result.status === 'fulfilled' && result.value) {
                const candidate = result.value;
                
                // 驗證結果的可靠性
                if (isReliableAddress(candidate.fullAddress) && 
                    candidate.lat && candidate.lon) {
                    
                    // 確保店家名稱相似度足夠高
                    const nameSimilarity = calculateNameSimilarity(restaurantName, candidate.displayName || candidate.name || '');
                    if (nameSimilarity > 0.7) {
                        return {
                            fullAddress: candidate.fullAddress,
                            lat: candidate.lat,
                            lon: candidate.lon,
                            name: candidate.displayName || candidate.name,
                            source: candidate.source
                        };
                    }
                }
            }
        }
    } catch (e) {
        console.warn("店家名稱精確搜尋失敗:", e);
    }
    
    return null;
}

// 🆕 高精度反向地理編碼
async function preciseReverseGeocode(lat, lon, restaurantName) {
    let bestResult = null;
    let bestScore = 0;
    
    const strategies = [
        // 策略1：Nominatim 高精度反向地理編碼
        async () => {
            try {
                const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&addressdetails=1&zoom=18`;
                const response = await fetchWithTimeout(url, {
                    headers: { "Accept": "application/json" }
                }, 5000);
                
                if (response.ok) {
                    const data = await response.json();
                    return {
                        address: data.display_name,
                        components: data.address,
                        confidence: 0.9
                    };
                }
            } catch (e) {
                console.warn("Nominatim 反向地理編碼失敗:", e);
            }
            return null;
        },
        
        // 策略2：Nominatim 附近店家搜尋
        async () => {
            try {
                const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&q=restaurant&lat=${lat}&lon=${lon}&limit=5&viewbox=${lon-0.002},${lat+0.002},${lon+0.002},${lat-0.002}&bounded=1`;
                const response = await fetchWithTimeout(url, {
                    headers: { "Accept": "application/json" }
                }, 5000);
                
                if (response.ok) {
                    const data = await response.json();
                    if (data.length > 0) {
                        return {
                            address: data[0].display_name,
                            components: data[0].address,
                            confidence: 0.7
                        };
                    }
                }
            } catch (e) {
                console.warn("Nominatim 附近搜尋失敗:", e);
            }
            return null;
        },
        
        // 策略3：結合店家名稱的地理編碼
        async () => {
            if (!restaurantName || isGenericName(restaurantName)) return null;
            
            try {
                // 🆕 使用更嚴格的店家名稱搜尋
                const query = `${restaurantName} 店 餐廳`;
                const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&q=${encodeURIComponent(query)}&limit=3&addressdetails=1`;
                
                const response = await fetchWithTimeout(url, {
                    headers: { "Accept": "application/json" }
                }, 5000);
                
                if (response.ok) {
                    const data = await response.json();
                    // 🆕 只選擇距離最近且名稱匹配的結果
                    for (const item of data) {
                        const itemLat = parseFloat(item.lat);
                        const itemLon = parseFloat(item.lon);
                        const distance = distance(lat, lon, itemLat, itemLon);
                        
                        // 🆕 只接受100公尺內的結果
                        if (distance < 100) {
                            return {
                                address: item.display_name,
                                components: item.address,
                                confidence: 0.8
                            };
                        }
                    }
                }
            } catch (e) {
                console.warn("店家名稱地理編碼失敗:", e);
            }
            return null;
        }
    ];
    
    // 🆕 嘗試所有策略並選擇最佳結果
    for (let i = 0; i < strategies.length; i++) {
        const strategy = strategies[i];
        try {
            const result = await strategy();
            if (result && result.address) {
                // 🆕 計算地址可靠性分數
                let score = result.confidence || 0.5;
                
                // 🆕 如果地址包含門牌號，加分
                if (/\d+号/.test(result.address)) {
                    score += 0.2;
                }
                
                // 🆕 如果地址包含店名，加分
                if (restaurantName && result.address.includes(restaurantName)) {
                    score += 0.1;
                }
                
                // 🆕 地址長度合理性
                if (result.address.length >= 10 && result.address.length <= 100) {
                    score += 0.1;
                }
                
                if (score > bestScore) {
                    bestScore = score;
                    bestResult = result.address;
                }
            }
        } catch (e) {
            console.warn(`策略 ${i + 1} 失敗:`, e);
        }
    }
    
    return bestResult && bestScore > 0.6 ? bestResult : null;
}

// ----- Google Maps Geocoding 精確搜尋 -----
async function searchGoogleGeocoding(restaurantName, city, district) {
    try {
        // 注意：這裡需要 Google Maps Geocoding API key
        // 如果沒有 API key，跳過這個方法
        if (!GOOGLE_GEOCODING_API_KEY) {
            return null;
        }
        
        const query = `${restaurantName}, ${district}, ${city}`;
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${GOOGLE_GEOCODING_API_KEY}&language=zh-TW`;
        
        const response = await fetchWithTimeout(url, {}, 8000);
        const data = await response.json();
        
        if (data.status === 'OK' && data.results.length > 0) {
            const result = data.results[0];
            return {
                fullAddress: result.formatted_address,
                lat: result.geometry.location.lat,
                lon: result.geometry.location.lng,
                displayName: restaurantName,
                source: "Google Geocoding"
            };
        }
    } catch (e) {
        console.warn("Google Geocoding 搜尋失敗:", e);
    }
    return null;
}

// ----- Nominatim 精確搜尋 -----
async function searchNominatimPrecise(searchQuery) {
    try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&q=${encodeURIComponent(searchQuery)}&limit=3&countrycodes=tw,jp`;
        const response = await fetchWithTimeout(url, { headers: {"Accept": "application/json"} }, 8000);
        const data = await response.json();
        
        if (data.length > 0) {
            const result = data[0];
            return {
                fullAddress: result.display_name,
                lat: parseFloat(result.lat),
                lon: parseFloat(result.lon),
                displayName: result.name,
                source: "Nominatim 精確搜尋"
            };
        }
    } catch (e) {
        console.warn("Nominatim 精確搜尋失敗:", e);
    }
    return null;
}

// ----- LocationIQ 精確搜尋 -----
async function searchLocationIqPrecise(searchQuery) {
    try {
        const url = `https://us1.locationiq.com/v1/search.php?key=${API_KEY}&q=${encodeURIComponent(searchQuery)}&format=json&addressdetails=1&limit=5&countrycodes=TW,JP`;
        const response = await fetchWithTimeout(url, {}, 8000);
        const data = await response.json();
        
        // 尋找最匹配的結果，優先排除行政機關
        for (const result of data) {
            if (result.display_name && result.lat && result.lon) {
                // 排除明顯不是店家的結果
                const displayName = (result.display_name || "").toLowerCase();
                const excludeKeywords = ['辦公處', '區公所', '里辦公處', '派出所', '學校', '公園', '市場', '醫院', '郵局'];
                
                if (excludeKeywords.some(keyword => displayName.includes(keyword))) {
                    continue; // 跳過這些結果
                }
                
                // 只選擇看起來像是店家地址的結果
                if (result.class === 'shop' || result.class === 'amenity' || 
                    result.type === 'restaurant' || result.type === 'shop' ||
                    displayName.includes('號') || displayName.includes('樓') || 
                    displayName.includes('巷') || displayName.includes('弄')) {
                    
                    return {
                        fullAddress: result.display_name,
                        lat: parseFloat(result.lat),
                        lon: parseFloat(result.lon),
                        displayName: result.name,
                        source: "LocationIQ 精確搜尋"
                    };
                }
            }
        }
    } catch (e) {
        console.warn("LocationIQ 精確搜尋失敗:", e);
    }
    return null;
}

// 🆕 嚴格版店家名稱搜尋
async function geocodeByNameWithStrategies(restaurantName, originalLat, originalLon, currentCity, currentDistrict) {
    if (!restaurantName || restaurantName === "查無資料") return null;
    
    // 🔥 第一道防線：檢查是否為通用名稱
    if (isGenericName(restaurantName)) {
        console.log(`⏭️ 跳過通用名稱搜尋: ${restaurantName}`);
        return null;
    }
    
    // 🔥 第二道防線：檢查名稱唯一性
    const nameAnalysis = analyzeRestaurantName(restaurantName, currentCity, currentDistrict);
    if (nameAnalysis.confidence < 0.5) {
        console.log(`⏭️ 名稱唯一性不足: ${restaurantName} (信心度: ${nameAnalysis.confidence})`);
        return null;
    }
    
    // 🔥 第三道防線：距離驗證
    if (!originalLat || !originalLon) {
        console.log(`⏭️ 缺少座標資訊，跳過精確搜尋: ${restaurantName}`);
        return null;
    }
    
    console.log(`🎯 開始精確搜尋店家: ${restaurantName} (信心度: ${nameAnalysis.confidence})`);
    
    let bestResult = null;
    let bestScore = 0;
    
    // 🆕 嚴格搜尋策略組合
    const searchStrategies = [
        // 策略1：完整店名 + 精確地理限制
        {
            query: `${restaurantName}, ${currentDistrict}, ${currentCity}`,
            radius: 300, // 🔥 縮小搜尋範圍
            exact: true,
            weight: 1.0,
            name: "完整店名精確搜尋"
        },
        
        // 策略2：店家類型 + 區域（只針對獨特店名）
        ...(nameAnalysis.type === 'unique' ? [{
            query: `${restaurantName}, ${currentDistrict}`,
            radius: 500,
            exact: true,
            weight: 0.8,
            name: "獨特店名區域搜尋"
        }] : []),
        
        // 策略3：去除通用後綴（如有）
        {
            query: `${restaurantName.replace(/店|館|坊|屋|軒|堂$/g, '')}, ${currentDistrict}, ${currentCity}`,
            radius: 400,
            exact: true,
            weight: 0.7,
            name: "去除後綴搜尋"
        }
    ];
    
    for (let i = 0; i < searchStrategies.length; i++) {
        const strategy = searchStrategies[i];
        try {
            console.log(`🔍 嘗試策略 ${i + 1}: ${strategy.name} - ${strategy.query}`);
            
            const result = await executeStrictSearch(strategy, restaurantName, originalLat, originalLon);
            if (result) {
                // 🔥 更嚴格的結果評分
                const score = calculateStrictScore(result, restaurantName, originalLat, originalLon, strategy);
                console.log(`📊 策略 ${i + 1} 評分: ${score.toFixed(3)} (${strategy.name})`);
                
                if (score > bestScore && score > 0.7) { // 🔥 提高分數門檻
                    bestScore = score;
                    bestResult = {
                        ...result,
                        strategy: strategy.name,
                        score: score
                    };
                }
            }
        } catch (e) {
            console.warn(`策略 ${i + 1} 搜尋失敗:`, e);
        }
    }
    
    if (bestResult) {
        console.log(`✅ 找到最佳結果: ${bestResult.displayName} (分數: ${bestScore.toFixed(3)})`);
    } else {
        console.log(`❌ 所有策略都未找到滿意結果: ${restaurantName}`);
    }
    
    return bestResult;
}

// 🆕 嚴格搜尋執行
async function executeStrictSearch(strategy, originalName, originalLat, originalLon) {
    try {
        // 🆕 限制搜尋範圍
        let url;
        if (strategy.radius && originalLat && originalLon) {
            // 使用邊界框限制搜尋
            const bbox = calculateBoundingBox(originalLat, originalLon, strategy.radius);
            url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&q=${encodeURIComponent(strategy.query)}&limit=5&viewbox=${bbox.west},${bbox.north},${bbox.east},${bbox.south}&bounded=1`;
        } else {
            url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&q=${encodeURIComponent(strategy.query)}&limit=5&countrycodes=tw,jp`;
        }
        
        const response = await fetchWithTimeout(url, {
            headers: { 
                "Accept": "application/json",
                "User-Agent": "RestaurantRandomizer/1.0 (StrictSearch)"
            }
        }, 5000);
        
        if (!response.ok) return null;
        
        const data = await response.json();
        if (data.length === 0) return null;
        
        // 🔥 更嚴格的結果過濾
        for (const item of data) {
            const itemLat = parseFloat(item.lat);
            const itemLon = parseFloat(item.lon);
            const distance = distance(originalLat, originalLon, itemLat, itemLon);
            
            // 🔥 距離必須在合理範圍內
            if (distance > strategy.radius * 1.5) {
                console.log(`❌ 距離過遠: ${distance.toFixed(0)}m > ${strategy.radius * 1.5}m`);
                continue;
            }
            
            // 🔥 排除明顯不是餐廳的結果
            const displayName = (item.display_name || "").toLowerCase();
            const excludeKeywords = ['辦公處', '區公所', '里辦公處', '派出所', '學校', '公園', '市場', '醫院', '郵局', '站', '分局', '機關', '政府'];
            if (excludeKeywords.some(keyword => displayName.includes(keyword))) {
                console.log(`❌ 排除非餐廳結果: ${displayName}`);
                continue;
            }
            
            // 🔥 檢查店家類型優先級
            const typePriority = {
                'restaurant': 1.0,
                'shop': 0.8, 
                'amenity': 0.9,
                'building': 0.3
            };
            
            const priority = typePriority[item.class] || 0.2;
            if (priority < 0.5 && strategy.exact) {
                console.log(`❌ 店家類型優先級不足: ${item.class} (優先級: ${priority})`);
                continue;
            }
            
            // 🔥 返回最佳候選
            return {
                fullAddress: item.display_name,
                lat: itemLat,
                lon: itemLon,
                displayName: item.name,
                source: `Nominatim 嚴格搜尋 (${strategy.name})`,
                distance: distance,
                typePriority: priority
            };
        }
        
    } catch (e) {
        console.warn("嚴格搜尋執行失敗:", e);
    }
    
    return null;
}

// 🆕 更嚴格的分數計算
function calculateStrictScore(result, originalName, originalLat, originalLon, strategy) {
    let score = 0;
    
    // 🔥 名稱相似度（權重 50%）
    const nameSimilarity = calculateStrictNameSimilarity(originalName, result.displayName || result.name || '');
    score += nameSimilarity * 0.5;
    
    // 🔥 距離分數（權重 30%）
    let distanceScore = 0;
    if (result.distance !== undefined) {
        distanceScore = Math.max(0, 1 - result.distance / 500); // 500公尺內
    } else if (result.lat && result.lon && originalLat && originalLon) {
        const dist = distance(result.lat, result.lon, originalLat, originalLon);
        distanceScore = Math.max(0, 1 - dist / 500);
    }
    score += distanceScore * 0.3;
    
    // 🔥 店家類型優先級（權重 10%）
    score += (result.typePriority || 0) * 0.1;
    
    // 🔥 策略權重（權重 10%）
    score += (strategy.weight || 0.5) * 0.1;
    
    console.log(`📊 詳細評分: 名稱=${nameSimilarity.toFixed(3)}, 距離=${distanceScore.toFixed(3)}, 類型=${(result.typePriority || 0).toFixed(3)}, 策略=${(strategy.weight || 0.5).toFixed(3)}`);
    
    return score;
}

// 🆕 更嚴格的名稱相似度計算
function calculateStrictNameSimilarity(name1, name2) {
    if (!name1 || !name2) return 0;
    
    const n1 = name1.toLowerCase().trim();
    const n2 = name2.toLowerCase().trim();
    
    // 🔥 完全匹配
    if (n1 === n2) return 1.0;
    
    // 🔥 包含關係（但要求較高）
    if (n1.includes(n2) && n2.length >= 3) return 0.9;
    if (n2.includes(n1) && n1.length >= 3) return 0.9;
    
    // 🔥 檢查是否包含核心名稱
    const core1 = extractCoreName(n1);
    const core2 = extractCoreName(n2);
    
    if (core1 === core2 && core1.length >= 3) return 0.8;
    
    // 🔥 Levenshtein 距離（要求較高）
    const maxLength = Math.max(n1.length, n2.length);
    const distance = levenshtein(n1, n2);
    const similarity = 1 - (distance / maxLength);
    
    // 🔥 只有相似度很高才給分
    return similarity >= 0.7 ? similarity : 0;
}

// 🆕 提取核心名稱
function extractCoreName(name) {
    // 移除常見後綴
    return name.replace(/店|館|坊|屋|軒|堂|樓|閣|城$/g, '').trim();
}

// 🆕 提取店家類型
function extractShopType(name) {
    const types = {
        '咖啡': '咖啡店',
        '茶': '茶坊', 
        '麵包': '麵包店',
        '冰': '冰品店',
        '便當': '便當店',
        '麵': '麵店',
        '飯': '餐廳'
    };
    
    for (const [keyword, type] of Object.entries(types)) {
        if (name.includes(keyword)) return type;
    }
    return null;
}

function isGenericName(name) {
    if (!name) return true;
    
    const genericNames = [
        // 🆕 擴展通用名稱列表
        '手工包子', '包子', '饅頭', '豆漿', '燒餅', '油條',
        '便當', '飯', '麵', '水餃', '餛飩', '滷肉飯',
        '排骨飯', '雞腿飯', '牛肉麵', '陽春麵', '炒麵',
        '咖啡', '茶', '紅茶', '綠茶', '珍珠奶茶',
        '早餐', '宵夜', '小吃', '食堂', '廚房',
        '水果', '果汁', '冰', '冰淇淋', '甜點',
        '雞排', '鹽酥雞', '炸物', '炸雞', '烤雞',
        '五金', '藥局', '洗衣店', '超商', '市場',
        // 🆕 新增更多通用名稱
        '郭老師', '王老師', '李老師', '陳老師', '老師',  // 🔥 特別過濾"老師"類名稱
        '阿公', '阿嬤', '媽媽', '爸爸', '叔叔', '阿姨',  // 家庭稱謂
        '大哥', '大姐', '小弟', '小妹',  // 稱謂
        '老大', '老闆', '老闆娘',  // 店主稱謂
        '手工', '現做', '新鮮', '美味',  // 通用形容詞
        '傳統', '古早味', '道地', '正宗',  // 品質形容詞
        '便宜', '實惠', '經濟', '划算',  // 價格形容詞
        '大碗', '超大', '巨無霸', '特大',  // 尺寸形容詞
        'A', 'B', 'C', 'D', 'E',  // 單字母
        '1號', '2號', '3號', '1店', '2店', '3店',  // 號碼店名
        '第一', '第二', '第三',  // 序號
        '總店', '分店', '旗艦店',  // 店鋪類型
        '咖啡店', '飲料店', '早餐店', '便當店',  // 通用店家類型
    ];
    
    const genericPatterns = [
        /^\w+店$/, // 結尾是「店」且前面只有1-2個字
        /^\w+坊$/, // 結尾是「坊」
        /^\w+屋$/, // 結尾是「屋」
        /^\w+館$/, // 結尾是「館」
        /^老\d+/, // 老開頭加數字
        /^\d+號/, // 數字開頭
        /^[甲乙丙丁戊己庚辛壬癸]/, // 天干開頭
        /^[子丑寅卯辰巳午未申酉戌亥]/, // 地支開頭
        /.*老師.*/, // 🔥 特別過濾包含"老師"的名稱
        /^[一二三四五六七八九十]+[號店]/, // 中文數字+號店
        /^[A-Z]\d*$/, // 單字母或字母+數字
    ];
    
    const lowerName = name.toLowerCase().trim();
    
    // 🔥 特別檢查"老師"類名稱
    if (lowerName.includes('老師')) {
        console.log(`🚫 過濾通用名稱（老師類）: ${name}`);
        return true;
    }
    
    // 檢查通用名稱列表
    if (genericNames.some(generic => lowerName.includes(generic))) {
        console.log(`🚫 過濾通用名稱（列表）: ${name}`);
        return true;
    }
    
    // 檢查通用模式
    if (genericPatterns.some(pattern => pattern.test(name))) {
        console.log(`🚫 過濾通用名稱（模式）: ${name}`);
        return true;
    }
    
    // 🆕 更嚴格的短名稱檢查
    if (name.length <= 2) {
        console.log(`🚫 過濾短名稱: ${name}`);
        return true;
    }
    
    // 🆕 檢查是否為常見姓氏+稱謂
    const commonSurnames = ['陳', '林', '黃', '張', '李', '王', '吳', '劉', '蔡', '楊', '郭', '羅', '鄭', '謝', '曾', '洪', '邱', '廖', '周', '徐'];
    const titles = ['老師', '師', '媽', '爸', '叔', '姨', '哥', '姐'];
    
    for (const surname of commonSurnames) {
        for (const title of titles) {
            if (name.includes(surname + title) || name.includes(title + surname)) {
                console.log(`🚫 過濾姓氏+稱謂: ${name}`);
                return true;
            }
        }
    }
    
    return false;
}

// 🆕 智能結果選擇
function selectBestResult(results, originalName, originalLat, originalLon) {
    const validResults = results.filter(r => r !== null);
    if (validResults.length === 0) return null;
    
    let bestResult = validResults[0];
    let bestScore = 0;
    
    for (const result of validResults) {
        let score = 0;
        
        // 🆕 名稱相似度
        const nameSimilarity = calculateFlexibleNameSimilarity(originalName, result.displayName || result.name || '');
        score += nameSimilarity * 0.4;
        
        // 🆕 距離分數
        if (originalLat && originalLon && result.lat && result.lon) {
            const distance = distance(result.lat, result.lon, originalLat, originalLon);
            const distanceScore = Math.max(0, 1 - distance / 1000); // 1km內
            score += distanceScore * 0.3;
        }
        
        // 🆕 地址完整性
        if (isReliableAddress(result.fullAddress)) {
            score += 0.2;
        }
        
        // 🆕 搜尋策略權重
        score += (result.strategyWeight || 0.5) * 0.1;
        
        if (score > bestScore) {
            bestScore = score;
            bestResult = result;
        }
    }
    
    return bestScore > 0.5 ? bestResult : null;
}

// 🆕 智能地址推斷系統
async function smartAddressInference(lat, lon, partialAddress, restaurantName) {
    if (!lat || !lon) return null;
    
    let inferredAddress = partialAddress || "";
    
    try {
        // 🆕 步驟1：反向地理編碼取得基本地址
        const reverseGeocode = await reverseGeocodeLocation(lat, lon);
        
        if (reverseGeocode) {
            // 🆕 步驟2：合併現有資訊
            inferredAddress = mergeAddressInfo(partialAddress, reverseGeocode);
            
            // 🆕 步驟3：推斷門牌號
            if (!inferredAddress.match(/\d+號/)) {
                const houseNumber = await inferHouseNumber(lat, lon, reverseGeocode);
                if (houseNumber) {
                    inferredAddress += ` ${houseNumber}`;
                }
            }
            
            // 🆕 步驟4：根據店家類型微調
            inferredAddress = adjustAddressByBusinessType(inferredAddress, restaurantName);
        }
        
        return inferredAddress || partialAddress;
        
    } catch (e) {
        console.warn("智能地址推斷失敗:", e);
        return partialAddress;
    }
}

// 🆕 反向地理編碼
async function reverseGeocodeLocation(lat, lon) {
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&addressdetails=1&zoom=18`;
        const response = await fetchWithTimeout(url, {
            headers: { "Accept": "application/json" }
        }, 5000);
        
        if (response.ok) {
            const data = await response.json();
            return data.display_name || data.address;
        }
    } catch (e) {
        console.warn("反向地理編碼失敗:", e);
    }
    return null;
}

// 🆕 智能合併地址資訊
function mergeAddressInfo(partialAddress, reverseGeocode) {
    // 🆕 如果部分地址已經很完整，直接使用
    if (isReliableAddress(partialAddress) && partialAddress.match(/\d+号/)) {
        return partialAddress;
    }
    
    // 🆕 合併反向地理編碼的資訊
    const reverseParts = String(reverseGeocode).split(',').map(p => p.trim());
    const partialParts = String(partialAddress).split(',').map(p => p.trim());
    
    // 🆕 保留最詳細的地址部分
    let merged = '';
    
    // 🆕 門牌號（如果有）
    const houseNumber = partialAddress.match(/\d+号/)?.[0] || 
                       (reverseGeocode.match(/\d+号/)?.[0]);
    
    // 🆕 街道名
    const streetName = partialParts.find(p => p.match(/路|街|巷|弄/)) ||
                      reverseParts.find(p => p.match(/路|街|巷|弄/));
    
    // 🆕 區域
    const district = partialParts.find(p => p.match(/區|鄉|鎮|町|村/)) ||
                    reverseParts.find(p => p.match(/區|鄉|鎮|町|村/));
    
    // 🆕 城市
    const city = partialParts.find(p => p.match(/市|縣|都|道/)) ||
                reverseParts.find(p => p.match(/市|縣|都|道/));
    
    // 🆕 組合地址
    const parts = [houseNumber, streetName, district, city].filter(Boolean);
    merged = parts.join(' ');
    
    return merged || partialAddress || String(reverseGeocode);
}

// 🆕 推斷門牌號
async function inferHouseNumber(lat, lon, baseAddress) {
    // 🆕 基於附近店家的門牌號推斷
    try {
        const nearbyQuery = `nearby restaurants around ${lat},${lon}`;
        const nearbyResults = await findRestaurants(lat, lon, 200); // 200公尺內
        
        if (nearbyResults.length > 0) {
            const houseNumbers = nearbyResults
                .map(r => {
                    const addr = r.tags?.["addr:housenumber"] || "";
                    const match = addr.match(/\d+/);
                    return match ? parseInt(match[0]) : null;
                })
                .filter(n => n && n > 0)
                .sort((a, b) => a - b);
            
            if (houseNumbers.length >= 2) {
                // 🆕 使用中位數或平均值
                const median = houseNumbers[Math.floor(houseNumbers.length / 2)];
                return `${median}号`;
            } else if (houseNumbers.length === 1) {
                // 🆕 如果只有一個，使用相近號碼
                const base = houseNumbers[0];
                return `${base + Math.floor(Math.random() * 10) - 5}号`;
            }
        }
    } catch (e) {
        console.warn("門牌號推斷失敗:", e);
    }
    
    return null;
}

// 🆕 根據店家類型調整地址
function adjustAddressByBusinessType(address, restaurantName) {
    // 🆕 不同類型店家可能有特殊的地址模式
    const adjustments = {
        // 🆕 百貨公司通常有特定地址模式
        '百貨': address.replace(/\d+号/, (match) => {
            const num = parseInt(match);
            return `${num}号（百貨公司）`;
        }),
        // 🆕 夜市通常在特定區域
        '夜市': address.replace(/(.+)/, '$1（夜市區）'),
        // 🆕 連鎖店可能在大型建築
        '連鎖': address.replace(/(.+)/, '$1（商業大樓）')
    };
    
    for (const [type, adjustment] of Object.entries(adjustments)) {
        if (restaurantName.includes(type)) {
            return adjustment;
        }
    }
    
    return address;
}

// ----- 計算店家名稱相似度 -----
function calculateNameSimilarity(name1, name2) {
    if (!name1 || !name2) return 0;
    
    const n1 = name1.toLowerCase().trim();
    const n2 = name2.toLowerCase().trim();
    
    // 完全匹配
    if (n1 === n2) return 1.0;
    
    // 包含關係
    if (n1.includes(n2) || n2.includes(n1)) return 0.9;
    
    // 使用 Levenshtein 距離計算相似度
    const maxLength = Math.max(n1.length, n2.length);
    const distance = levenshtein(n1, n2);
    const similarity = 1 - (distance / maxLength);
    
    return similarity;
}

// ----- Levenshtein -----
function levenshtein(a,b){if(a.length===0) return b.length; if(b.length===0) return a.length; const matrix=[]; for(let i=0;i<=b.length;i++) matrix[i]=[i]; for(let j=0;j<=a.length;j++) matrix[0][j]=j; for(let i=1;i<=b.length;i++){for(let j=1;j<=a.length;j++){matrix[i][j]=b.charAt(i-1)===a.charAt(j-1)?matrix[i-1][j-1]:Math.min(matrix[i-1][j-1]+1,matrix[i][j-1]+1,matrix[i-1][j]+1);}} return matrix[b.length][a.length]; }

// ----- Map / Marker -----
function clearMarkers(){ currentMarkers.forEach(m=>map.removeLayer(m)); currentMarkers=[]; }

// 高亮顯示特定 marker
function highlightMarker(lat, lon, name) {
    // 先重置所有 marker 的樣式
    currentMarkers.forEach(marker => {
        try {
            // 恢復預設圖標
            marker.setIcon(L.icon({
                iconUrl: 'https://unpkg.com/leaflet/dist/images/marker-icon.png',
                shadowUrl: 'https://unpkg.com/leaflet/dist/images/marker-shadow.png',
                iconSize: [25, 41],
                iconAnchor: [12, 41],
                popupAnchor: [1, -34],
                shadowSize: [41, 41]
            }));
            
            // 隱藏或恢復原始 tooltip
            if (marker.isUserLocation) {
                // 使用者位置永久顯示
                marker.bindTooltip("👤 您的位置", { permanent: true, direction: 'top' });
            } else if (marker.restaurantData) {
                // 餐廳位置恢復為非永久顯示
                marker.bindTooltip(marker.restaurantData.name, { permanent: false, direction: 'top' });
                marker.closeTooltip();
            }
        } catch (e) {
            console.warn("重置 marker 樣式失敗:", e);
        }
    });

    // 找到目標 marker 並高亮
    const targetMarker = currentMarkers.find(marker => {
        const pos = marker.getLatLng();
        return Math.abs(pos.lat - lat) < 0.0001 && Math.abs(pos.lng - lon) < 0.0001;
    });

    if (targetMarker) {
        try {
            // 根據類型設定不同顏色的高亮圖標
            let iconUrl;
            if (targetMarker.isUserLocation) {
                // 使用者位置使用綠色
                iconUrl = 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png';
            } else {
                // 餐廳使用紅色
                iconUrl = 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png';
            }

            targetMarker.setIcon(L.icon({
                iconUrl: iconUrl,
                shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
                iconSize: [25, 41],
                iconAnchor: [12, 41],
                popupAnchor: [1, -34],
                shadowSize: [41, 41]
            }));
            
            // 永久顯示 tooltip
            targetMarker.bindTooltip(name, { 
                permanent: true, 
                direction: 'top',
                className: 'highlighted-tooltip'
            }).openTooltip();
            
            // 輕微跳動效果
            let bounceCount = 0;
            const bounceInterval = setInterval(() => {
                if (bounceCount >= 6) {
                    clearInterval(bounceInterval);
                    return;
                }
                const offset = bounceCount % 2 === 0 ? -5 : 0;
                targetMarker.setZIndexOffset(offset);
                bounceCount++;
            }, 100);
            
        } catch (e) {
            console.warn("高亮 marker 失敗:", e);
        }
    }
}

// 額外新增：專門高亮使用者位置的函數
function highlightUserLocation() {
    if (!userLocation) return;
    
    // 先重置所有 marker
    currentMarkers.forEach(marker => {
        try {
            marker.setIcon(L.icon({
                iconUrl: 'https://unpkg.com/leaflet/dist/images/marker-icon.png',
                shadowUrl: 'https://unpkg.com/leaflet/dist/images/marker-shadow.png',
                iconSize: [25, 41],
                iconAnchor: [12, 41],
                popupAnchor: [1, -34],
                shadowSize: [41, 41]
            }));
            
            if (marker.isUserLocation) {
                marker.bindTooltip("👤 您的位置", { permanent: true, direction: 'top' });
            } else if (marker.restaurantData) {
                marker.bindTooltip(marker.restaurantData.name, { permanent: false, direction: 'top' });
                marker.closeTooltip();
            }
        } catch (e) {
            console.warn("重置 marker 樣式失敗:", e);
        }
    });

    // 找到並高亮使用者位置
    const userMarker = currentMarkers.find(marker => marker.isUserLocation);
    if (userMarker) {
        try {
            userMarker.setIcon(L.icon({
                iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
                shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
                iconSize: [25, 41],
                iconAnchor: [12, 41],
                popupAnchor: [1, -34],
                shadowSize: [41, 41]
            }));
            
            userMarker.bindTooltip("👤 您目前的位置", { 
                permanent: true, 
                direction: 'top',
                className: 'highlighted-tooltip'
            }).openTooltip();
            
            // 跳動效果
            let bounceCount = 0;
            const bounceInterval = setInterval(() => {
                if (bounceCount >= 6) {
                    clearInterval(bounceInterval);
                    return;
                }
                const offset = bounceCount % 2 === 0 ? -5 : 0;
                userMarker.setZIndexOffset(offset);
                bounceCount++;
            }, 100);
            
        } catch (e) {
            console.warn("高亮使用者位置失敗:", e);
        }
    }
}

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
    let rawAddress = t["addr:full"] || r.geocodeAddress || "";
    rawAddress = rawAddress.trim();

    const hasReliableAddress = isReliableAddress(rawAddress);
    const fullAddress = hasReliableAddress ? rawAddress : "";

    // --- 顯示位置 ---
    const btnView = document.createElement("button");
    btnView.textContent = "📍 顯示位置";
    btnView.classList.add("action-btn", "map-btn");
    btnView.addEventListener("click", () => {
        map.setView([lat, lon], 17);
        const mapEl = document.getElementById("map");
        if (mapEl) mapEl.scrollIntoView({ behavior: "smooth", block: "start" });
        
        // 找到對應的 marker 並高亮顯示
        highlightMarker(lat, lon, name);
    });

    // --- 在 Google Maps 開啟 ---
    const btnMaps = document.createElement("button");
    btnMaps.textContent = "🗺️ GoogleMap";
    btnMaps.classList.add("action-btn", "google-btn");
    btnMaps.addEventListener("click", () => {
        let queryForMap = r.geocodeAddress;  // 使用 mergeGeocodeInfo 處理後的地址
        if (!isReliableAddress(queryForMap)) {
            queryForMap = `${lat},${lon}`;
            alert(`注意：${name} 地址資料不足，本次使用經緯度顯示`);
        }
        // 若營業時間是備援欄位，也提示
        if (!t.opening_hours && (t.note || t.description || t.operator)) {
            alert(`⚠️ ${name} 的營業時間來自 OSM 備援欄位 (note/description/operator)，可能不完整`);
        }
        handleMapClick("search", queryForMap);
    });

    // --- 導航 ---
    const btnNav = document.createElement("button");
    btnNav.textContent = "🚗 導航";
    btnNav.classList.add("action-btn", "nav-btn");
    btnNav.addEventListener("click", () => {
        let dest;
        if (hasReliableAddress) {
            dest = encodeURIComponent(fullAddress);
        } else {
            dest = `${lat},${lon}`;
            alert(`注意：${name} 地址資料不足，本次導航使用經緯度`);
        }
        if (!t.opening_hours && (t.note || t.description || t.operator)) {
            alert(`⚠️ ${name} 的營業時間來自 OSM 備援欄位 (note/description/operator)，可能不完整`);
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
        document.querySelector('label[for="countrySelect"]'),
        document.querySelector('label[for="citySelect"]'),
        document.querySelector('label[for="districtSelect"]'),
        document.querySelector('label[for="streetInput"]')
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

    // 按鈕區（重新抽選三家只允許在「已搜尋」狀態出現）
    if (hasSearched) {
        reshuffleBtn.style.display = "";
        reshuffleBtn.disabled = false;
    } else {
        reshuffleBtn.style.display = "none";
        reshuffleBtn.disabled = true;
    }

    if (resetBtn) resetBtn.style.display = showFull ? "none" : "";
}

window.addEventListener('resize', () => {
    if (isMobile()) {
        toggleUIForMobile(!lastRestaurants.length, false);
        updateRadiusVisibility(); // ⭐ 半徑顯示只交給這個函式
    } else {
        // PC 版顯示完整 UI
        toggleUIForMobile(true, false);
    }
});

// ----- Render Restaurants -----
function renderRestaurants(restaurants) {
    clearMarkers();
    resultsPanel.innerHTML = "";

    // 保留使用者位置大頭針
    if(userLocation){
        const userMarker = L.marker([userLocation.lat, userLocation.lon])
            .addTo(map)
            .bindTooltip("👤 您的位置", {permanent:true, direction:'top'});
        // 將使用者位置資訊存到 marker 中
        userMarker.isUserLocation = true;
        userMarker.userLocationData = { lat: userLocation.lat, lon: userLocation.lon };
        currentMarkers.push(userMarker);
    }

    if (!restaurants || restaurants.length === 0) {
        resultsPanel.textContent = "找不到符合的店家";
        return;
    }

    // 手機版最大高度可滾動
    if (isMobile()) {
        resultsPanel.style.overflowY = "auto";
        resultsPanel.style.maxHeight = "50vh";
        resultsPanel.style.padding = "8px";
    } else {
        resultsPanel.style.overflowY = "";
        resultsPanel.style.maxHeight = "";
        resultsPanel.style.padding = "";
    }

    const bounds = L.latLngBounds([]);
    const displayRestaurants = shuffleArray(restaurants).slice(0, 3);

    displayRestaurants.forEach(r => {
        const t = r.tags || {};
        const lat = r.lat || r.center?.lat;
        const lon = r.lon || r.center?.lon;
        if (!lat || !lon) return;

        let name = t.name || r.name || "查無資料";

        // 地址
        let rawAddress = t["addr:street"] || t["addr:housenumber"]
            ? `${t["addr:street"] || ""} ${t["addr:housenumber"] || ""}`.trim()
            : t["addr:full"] || r.geocodeAddress || "查無資料";

        const address = isReliableAddress(rawAddress) ? rawAddress : "查無資料";

        // 營業時間
        let hours = t.opening_hours || r.opening_hours || "查無資料";

        // Marker
        const marker = L.marker([lat, lon]).addTo(map);
        marker.bindTooltip(name, { permanent: false, direction: 'top' });
        // 將餐廳資訊存到 marker 中，方便後續查找
        marker.restaurantData = { lat, lon, name };
        currentMarkers.push(marker);
        bounds.extend([lat, lon]);

        // 卡片
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

        // 資料來源備註
        const addressSource = r.addressSource || (isReliableAddress(rawAddress) ? "OSM / 經緯度備援" : "經緯度備援");
        const hoursSource = t.opening_hours ? "OSM" : (t.note || t.description || t.operator) ? "OSM 備援" : null;
        
        // 精確位置提示
        let accuracyInfo = [];
        if (r.preciseLocation) {
            accuracyInfo.push("🎯 精確定位");
        }
        if (addressSource && addressSource.includes("精確")) {
            accuracyInfo.push("✨ 精確地址");
        }

        const sourceText = [];
        sourceText.push("地址來源：" + addressSource);
        if (hoursSource) sourceText.push("營業時間來源：" + hoursSource);
        if (accuracyInfo.length > 0) sourceText.push(accuracyInfo.join(" "));

        if (sourceText.length > 0) {
            const cardSource = document.createElement("p");
            cardSource.className = "card-sub small";
            cardSource.textContent = sourceText.join("，");
            cardLeft.appendChild(cardSource);
        }

        card.appendChild(cardLeft);

        // 行動按鈕
        const cardActions = createActionButtons(lat, lon, name, r);
        card.appendChild(cardActions);

        // 手機版可上下滑動整個結果區塊，卡片自適應高度
        if (isMobile()) {
            card.style.maxHeight = "none";   // 不限制單張卡片高度
            card.style.overflow = "visible";
            cardLeft.style.overflowY = "visible";
        }

        resultsPanel.appendChild(card);
    });

    if (currentMarkers.length > 0) map.fitBounds(bounds.pad(0.3));
    
    // 如果有使用者位置，保持高亮狀態
    if (userLocation && currentMarkers.find(m => m.isUserLocation)) {
        setTimeout(() => highlightUserLocation(), 500);
    }
}

// ----- Main Search -----
async function doSearch() {
    const isUsingUserLocation = hasUsedLocate === true && userLocation !== null;
    showLoading();
    setBusy(true);
    try {
        const city = citySelect.value;
        const district = districtSelect.value;
        const street = streetInput.value.trim();
        const type = typeSelect.value;
        const radius = parseInt(radiusInput.value) || 1000;
        let center = null;

        // 先更新搜尋訊息
        updateSearchInfo();

        // 如果 userLocation 有值，就用它作為搜尋中心
        if (isUsingUserLocation) {
            center = { lat: userLocation.lat, lon: userLocation.lon };
        } else {
            const queryArr = [city, district, street].filter(s => s).join(" ");
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

        // ----- 更新目前搜尋訊息 -----
        let infoText = "";
        if (street) {
            infoText = `目前查詢 ${street} 範圍 ${radius} 公尺`;
        } else if (isUsingUserLocation) {
            infoText = `目前查詢您附近範圍 ${radius} 公尺`;
        } else if (district) {
            infoText = `目前搜尋 ${district} 附近餐廳`;
        } else if (city) {
            infoText = `目前搜尋 ${city} 全區餐廳`;
        } else {
            infoText = `目前搜尋全區餐廳`;
        }
        if (searchInfoEl) searchInfoEl.textContent = infoText;

        // ----- 搜尋餐廳 -----
        lastRestaurants = [];
        try {
            let results = await findRestaurants(center.lat, center.lon, radius, type);
            lastRestaurants = await mergeGeocodeInfo(results, [city, district, street].filter(s => s).join(" "));
        } catch (e) {
            console.warn("搜尋餐廳資料處理失敗，但不影響已取得資料:", e);
        }

        // ----- 隨機抽三筆顯示 -----
        const randomResults = shuffleArray(lastRestaurants).slice(0, 3);
        renderRestaurants(randomResults);

        // ⭐ 標記：已完成一次有效搜尋
        hasSearched = true;

        // ⭐ 顯示並啟用「重新抽選三家」
        reshuffleBtn.style.display = "";
        reshuffleBtn.disabled = false;

        // ----- 手機 UI 折疊 -----
        if (isMobile()) toggleUIForMobile(false, false);

        // ----- 顯示重新搜尋條件按鈕 -----
        if (resetBtn) resetBtn.style.display = "";

        // ----- 若結果為空，才 alert -----
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
    // ----- 手機版搜尋後隱藏按鈕 -----
    if (isMobile()) {
        if (locateBtn) locateBtn.style.display = "none";
        if (searchBtn) searchBtn.style.display = "none";
    }
}

searchBtn.addEventListener("click",doSearch);
reshuffleBtn.addEventListener("click", () => {
    if (!hasSearched) return;
    if (lastRestaurants.length === 0) return;

    const shuffled = shuffleArray(lastRestaurants);
    renderRestaurants(shuffled.slice(0, 3));

    if (isMobile()) toggleUIForMobile(false);
});

  window.addEventListener("beforeunload", () => {
    userLocation = null;
  });

  // 綁定事件
  if(resetBtn){
    resetBtn.addEventListener("click", () => {
        toggleUIForMobile(true, false);   // 展開完整 UI
        userLocation = null;       // 清掉上一個搜尋位置
        hasUsedLocate = false;
        streetInput.value = "";
        streetSuggestions.innerHTML = "";
        resultsPanel.innerHTML = "";
        map.setView([25.033964,121.564468], 13); // 回到預設地圖
        // ⭐ 清空定位
        userLocation = null;
        hasUsedLocate = false;

        // ⭐ 清空搜尋狀態
        hasSearched = false;
        lastRestaurants = [];

        // ⭐ 強制隱藏「重新抽選三家」
        reshuffleBtn.style.display = "none";
        reshuffleBtn.disabled = true;
        updateRadiusVisibility();
    });
  }

// ----- Radius Label -----
radiusInput.addEventListener("input", () => {
    radiusLabel.textContent = radiusInput.value + "公尺";
});

/**
 * 更新目前搜尋訊息
 * 顯示方式：
 * - 若街道未填寫，顯示「目前搜尋 XX 區」
 * - 若街道有填寫，顯示「目前查詢 XX 路/街範圍 YYY 公尺」
 */
function updateSearchInfo() {
    if (!searchInfoEl) return;
    const city = citySelect.value || "";
    const district = districtSelect.value || "";
    const street = streetInput.value.trim();
    const radius = parseInt(radiusInput.value) || 0;
    let message = "";

    if (street) {
        message = `目前查詢 ${street} 範圍 ${radius} 公尺`;
    } else if (hasUsedLocate) {
        message = `目前查詢您附近範圍 ${radius} 公尺`;
    } else if (district) {
        message = `目前搜尋 ${district} `;
    } else if (city) {
        message = `目前搜尋 ${city} 全區餐廳`;
    } else {
        message = "";
    }

    searchInfoEl.textContent = message;
}

// 綁定街道輸入即時更新
streetInput.addEventListener("input", () => {
    updateSearchInfo();
});

// ----- Street Autocomplete -----
streetInput.addEventListener("input", (e) => {
    const val = e.target.value.trim();
    
    // 1. 更新搜尋訊息
    updateSearchInfo();
    updateRadiusVisibility();

    // 2. 街道 autocomplete
    streetSuggestions.innerHTML = "";
    const streets = (taiwanData[citySelect.value] || []);
    similarStreets = streets.filter(s => s.toLowerCase().includes(val.toLowerCase())).slice(0,5);
    similarStreets.forEach(st => {
        const li = document.createElement("li");
        li.textContent = st;
        li.addEventListener("click", () => {
            streetInput.value = st;
            streetSuggestions.innerHTML = "";
            updateSearchInfo();
            updateRadiusVisibility();
        });
        streetSuggestions.appendChild(li);
    });
});

document.addEventListener("click",(e)=>{ if(!streetInput.contains(e.target)) streetSuggestions.innerHTML=""; });

// ----- Initial Radius -----
radiusLabel.textContent=radiusInput.value+"公尺";
window.addEventListener("beforeunload", () => {
  userLocation = null;
});

/**
 * 判斷地址是否「可信可用於 Google Maps search」
 * 適用於台灣與日本
 * @param {string} address
 * @returns {boolean}
 */
function isReliableAddress(address) {
    if (!address) return false;
    const addr = String(address).trim();
    if (addr === "" || addr === "查無資料") return false;

    // 排除只有行政區的地址（台灣/日本行政區皆考慮）
    const adminOnlyPattern = /^(.*(縣|市|都|道|府))?\s*(.*(區|鄉|鎮|町|村|市))(\s*,?\s*(臺灣|日本))?$/;
    if (adminOnlyPattern.test(addr)) return false;

    // 🆕 放寬標準：接受更多地址格式
    const keywords = [
        // 台灣 - 基本地址關鍵字
        "路","街","巷","弄","號","段","大道","橋","大樓","樓","棟","館",
        // 🆕 台灣 - 行政區劃（可作為地址的一部分）
        "里","鄰","村",
        // 🆕 台灣 - 商業地標
        "市場","夜市","百貨","廣場","商場",
        // 🆕 台灣 - 教育地標
        "大學","學校","中學","小學","國小",
        // 🆕 台灣 - 交通地標
        "站","捷運","火車站",
        // 🆕 台灣 - 醫療地標
        "醫院","診所",
        // 🆕 台灣 - 宗教地標
        "寺廟","教會","宮",
        // 日本
        "丁目","番地","号","通り","ビル","町","区","村","市","駅"
    ];
    
    // 🆕 條件1：包含任何關鍵字
    if (keywords.some(k => addr.includes(k))) return true;

    // 🆕 條件2：有數字且長度合理（可能是不完整的地址）
    if (/\d/.test(addr) && addr.length >= 3) return true;

    // 🆕 條件3：長地址（可能是完整描述）
    if (addr.length >= 10) return true;

    // 🆕 條件4：包含店名特徵（如"店"、"館"等）
    if (/店|館|坊|屋|軒|堂|樓|閣|城|屋|家|小吃|餐廳|咖啡|茶坊/.test(addr)) return true;

    return false;
}

if (isMobile()) toggleUIForMobile(true, false);

// ⭐ APP 啟動初始化：尚未搜尋，強制隱藏重新抽選
hasSearched = false;
reshuffleBtn.style.display = "none";
reshuffleBtn.disabled = true;

const helpBtn = document.getElementById('helpBtn'); // 你的說明按鈕
const helpModal = document.getElementById('helpModal');
const closeHelpBtn = document.getElementById('closeHelpBtn');
const helpPC = document.querySelector('.help-pc');
const helpMobile = document.querySelector('.help-mobile');

function updateHelpContent() {
    if (window.innerWidth <= 900) { // 手機
        helpPC.style.display = 'none';
        helpMobile.style.display = 'block';
    } else { // 電腦
        helpPC.style.display = 'block';
        helpMobile.style.display = 'none';
    }
}

// 打開說明
helpBtn.addEventListener('click', () => {
    updateHelpContent();
    helpModal.classList.remove('hidden');
});

// 關閉按鈕
closeHelpBtn.addEventListener('click', () => {
    helpModal.classList.add('hidden');
});

// 點擊彈窗外部關閉
helpModal.addEventListener('click', (e) => {
    if(e.target === helpModal) helpModal.classList.add('hidden');
});

// 調整視窗大小時自動切換
window.addEventListener('resize', updateHelpContent);

// 初始隱藏半徑
radiusInput.style.display = "none";
radiusLabel.style.display = "none";
const radiusLabelEl = document.querySelector('label[for="radiusInput"]');
if(radiusLabelEl) radiusLabelEl.style.display = "none";