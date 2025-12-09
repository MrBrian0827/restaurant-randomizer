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

// ----- 隨機抽選 top 3 並避免重複 -----
function getRandomTop3(arr){
  // 先排除已經顯示過的餐廳
  const copy = arr.filter(r=>{
    const key = (r.tags.name||"") + "|" + (r.tags["addr:street"]||"") + "|" + (r.tags["addr:housenumber"]||"");
    return !shownRestaurantsKeys.has(key);
  });

  // 如果剩下不夠 3 間，就直接回傳全部，並加入已顯示 Set
  if(copy.length <= 3){
    copy.forEach(r=>{
      const key = (r.tags.name||"") + "|" + (r.tags["addr:street"]||"") + "|" + (r.tags["addr:housenumber"]||"");
      shownRestaurantsKeys.add(key);
    });
    return copy;
  }

  // 隨機抽 3 間
  const selected = [];
  while(selected.length < 3){
    const idx = Math.floor(Math.random() * copy.length);
    const r = copy[idx];
    selected.push(r);
    copy.splice(idx, 1);
    const key = (r.tags.name||"") + "|" + (r.tags["addr:street"]||"") + "|" + (r.tags["addr:housenumber"]||"");
    shownRestaurantsKeys.add(key);
  }
  return selected;
}

// ----- reshuffle top 3 -----
reshuffleBtn.addEventListener('click', ()=>{ 
  if(!allRestaurants || allRestaurants.length===0) return;
  renderResults(getRandomTop3(allRestaurants));
});

// ----- searchBtn -----
searchBtn.addEventListener('click', async ()=>{
  const city = citySelect.value;
  const district = districtSelect.value;
  const street = streetInput.value.trim();
  const type = typeSelect.value;
  const radius = parseInt(radiusInput.value,10) || 1000;

  let queryStr = city + " " + district + (street ? " "+street : "");

  showLoading(); setBusy(true); searchInfoEl.textContent='';

  try{
    shownRestaurantsKeys.clear(); // <-- 每次新搜尋清空已顯示 Set

    const geo = await geocode(queryStr);
    if(!geo){ alert("找不到位置"); return; }
    lastSearchCenter = geo;

    allRestaurants = shuffleArray(await findRestaurants(geo.lat, geo.lon, radius, type)); // 先隨機化
    renderResults(getRandomTop3(allRestaurants)); // <-- 使用 getRandomTop3
    searchInfoEl.textContent=`找到 ${allRestaurants.length} 間餐廳`;
    reshuffleBtn.disabled = allRestaurants.length<=3;
    map.setView([geo.lat,geo.lon],16);
  }catch(e){ console.error(e); alert("搜尋失敗"); }
  finally{ hideLoading(); setBusy(false); }
});

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

// ----- open URL 智能打開 -----
async function openUrlSmart(url){
  if(await ensureNetwork()){
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if(win) win.focus();
    pendingOpenUrl = null;
  }else{
    if(!pendingOpenUrl){
      alert("網路似乎有問題，無法開啟 Google Maps，請檢查網路連線。");
      pendingOpenUrl = url;
      const retryInterval = setInterval(async ()=>{
        if(pendingOpenUrl && await ensureNetwork()){
          const win = window.open(pendingOpenUrl, "_blank", "noopener,noreferrer");
          if(win) win.focus();
          pendingOpenUrl = null;
          clearInterval(retryInterval);
        }
      }, 5000);
    }
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

// ----- findRestaurants -----
async function findRestaurants(lat, lon, radius=1000, type=''){
  const filters = [];
  const arr = type ? (mapping[type] || mapping["restaurant"]) : mapping["restaurant"];
  arr.forEach(s=>filters.push(`${s}(around:${radius},${lat},${lon});`));
  const q = `[out:json];(${filters.join('')});out center tags;`;
  const data = await overpassQuery(q);
  const elements = data.elements || [];

  const seen = new Set();
  return elements.filter(e=>{
    const t = e.tags || {};
    if(t.disused || t.abandoned || t["disused:amenity"] || t["abandoned:amenity"]) return false;
    if(t.shop === "vacant") return false;
    if(t.closed || t["contact:status"] === "closed") return false;
    if(t.opening_hours && /closed|off|休業|歇業|永久/i.test(t.opening_hours)) return false;
    if(t.name && /歇業|停業|永久|結束營業|closed/i.test(t.name)) return false;
    const key = (t.name||"") + "|" + (t["addr:street"]||"") + "|" + (t["addr:housenumber"]||"");
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

// ----- renderResults -----
function renderResults(restaurants){
  clearMarkers();
  resultsPanel.innerHTML = "";
  if(!restaurants || restaurants.length===0){
    resultsPanel.innerHTML = `<div class="small">找不到符合的餐廳。</div>`;
    return;
  }

  const top = restaurants.slice(0,3);
  lastRestaurants = top;

  top.forEach(item=>{
    const lat = item.lat || item.center?.lat;
    const lon = item.lon || item.center?.lon;
    const tags = item.tags || {};
    const name = tags.name || "未提供名稱";
    const address = (tags["addr:full"] || tags["addr:street"] || tags["addr:housenumber"] || "").toString();
    const hours = tags.opening_hours || "";
    const phone = tags.phone || tags["contact:phone"] || "";
    const rating = tags.rating || tags['aggregate_rating'] || null;

    const marker = L.marker([lat,lon]).addTo(map);
    marker.bindPopup(`<b>${name}</b><br>${address || ''}<br>${hours ? '營業時間：'+hours : ''}${phone?'<br>電話：'+phone:''}${rating?'<br>評價：'+rating+' (OSM)': ''}`);
    currentMarkers.push(marker);

    const card = document.createElement("div"); card.className = "card";
    const left = document.createElement("div"); left.className = "card-left";
    left.innerHTML = `<p class="card-title">${name}</p>
                      <p class="card-sub">${address || '<span style="color:#999">地址未提供</span>'}</p>
                      <p class="card-sub">${hours ? '營業時間：'+hours : ''}${phone ? ' • 電話：'+phone : ''}</p>
                      ${rating ? `<p class="card-sub">評價：${rating} (OSM)</p>` : ''}`;
    const right = document.createElement("div"); right.className = "card-actions";

    const btnView = document.createElement("button");
btnView.textContent = "顯示在地圖";
btnView.onclick = ()=>{
  map.setView([lat, lon], 17);
  marker.openPopup();
};

const btnMaps = document.createElement("button");
btnMaps.textContent = "在 Google Maps 開啟";
btnMaps.onclick = ()=>{
  openUrlSmart(`https://www.google.com/maps/search/?api=1&query=${lat},${lon}`);
};


const btnNav = document.createElement("button");
btnNav.textContent = "導航";
btnNav.onclick = ()=>{
  openUrlSmart(`https://www.google.com/maps/search/?api=1&query=${lat},${lon}`);
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

// ----- radius slider -----
radiusInput.addEventListener('input', ()=>{ radiusLabel.textContent = radiusInput.value; });
