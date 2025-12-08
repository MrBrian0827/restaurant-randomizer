const API_KEY = "pk.bc63f534da0350a75d49564feb994bfd"; // <- 換成你的 key
const LOCATIONIQ_RETRY = 2;
const NOMINATIM_RETRY = 2;
const OVERPASS_RETRY = 3;
const OVERPASS_SERVERS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter"
];

/* ----- 台灣縣市區完整清單 ----- */
const taiwanData = {"台北市":["中正區","大同區","中山區","松山區","大安區","萬華區","信義區","士林區","北投區","內湖區","南港區","文山區"],
  "新北市":["萬里區","金山區","板橋區","汐止區","深坑區","石碇區","瑞芳區","平溪區","雙溪區","貢寮區","新店區","坪林區","烏來區","永和區","中和區","土城區","三峽區","樹林區","鶯歌區","三重區","新莊區","泰山區","林口區","蘆洲區","五股區","八里區","淡水區","三芝區","石門區"],
  "基隆市":["仁愛區","中正區","信義區","中山區","安樂區","暖暖區","七堵區"],
  "桃園市":["中壢區","平鎮區","龍潭區","楊梅區","新屋區","觀音區","桃園區","龜山區","八德區","大溪區","復興區","大園區","蘆竹區"],
  "新竹市":["東區","北區","香山區"],
  "新竹縣":["竹北市","湖口鄉","新豐鄉","新埔鎮","關西鎮","芎林鄉","寶山鄉","竹東鎮","五峰鄉","橫山鄉","尖石鄉","北埔鄉","峨眉鄉"],
  "苗栗縣":["苗栗市","苑裡鎮","通霄鎮","竹南鎮","頭份市","後龍鎮","卓蘭鎮","大湖鄉","公館鄉","銅鑼鄉","南庄鄉","頭屋鄉","三義鄉","西湖鄉","造橋鄉","三灣鄉","獅潭鄉","泰安鄉"],
  "台中市":["中區","東區","南區","西區","北區","北屯區","西屯區","南屯區","太平區","大里區","霧峰區","烏日區","豐原區","后里區","石岡區","東勢區","和平區","新社區","潭子區","大雅區","神岡區","大肚區","沙鹿區","龍井區","梧棲區","清水區","大甲區","外埔區","大安區"],
  "彰化縣":["彰化市","芬園鄉","花壇鄉","秀水鄉","鹿港鎮","福興鄉","線西鄉","和美鎮","伸港鄉","員林市","社頭鄉","永靖鄉","埔心鄉","溪湖鎮","大村鄉","埔鹽鄉","田中鎮","北斗鎮","田尾鄉","埤頭鄉","溪州鄉","竹塘鄉","二林鎮","大城鄉","芳苑鄉","二水鄉"],
  "南投縣":["南投市","中寮鄉","草屯鎮","國姓鄉","埔里鎮","仁愛鄉","名間鄉","集集鎮","水里鄉","魚池鄉","信義鄉","竹山鎮","鹿谷鄉"],
  "雲林縣":["斗六市","斗南鎮","虎尾鎮","西螺鎮","土庫鎮","北港鎮","古坑鄉","大埤鄉","莿桐鄉","林內鄉","二崙鄉","崙背鄉","麥寮鄉","東勢鄉","褒忠鄉","臺西鄉","元長鄉","四湖鄉","口湖鄉","水林鄉"],
  "嘉義市":["東區","西區"],
  "嘉義縣":["太保市","朴子市","布袋鎮","大林鎮","民雄鄉","溪口鄉","新港鄉","六腳鄉","東石鄉","義竹鄉","鹿草鄉","水上鄉","中埔鄉","竹崎鄉","梅山鄉","番路鄉","大埔鄉","阿里山鄉"],
  "台南市":["中西區","東區","南區","北區","安平區","安南區","永康區","歸仁區","新化區","左鎮區","玉井區","楠西區","南化區","仁德區","關廟區","龍崎區","官田區","麻豆區","佳里區","西港區","七股區","將軍區","學甲區","北門區","新營區","後壁區","白河區","東山區","六甲區","下營區","柳營區","鹽水區","善化區","大內區","山上區","新市區","安定區"],
  "高雄市":["新興區","前金區","苓雅區","鹽埕區","鼓山區","旗津區","前鎮區","三民區","楠梓區","小港區","左營區","仁武區","大社區","岡山區","路竹區","阿蓮區","田寮區","燕巢區","橋頭區","梓官區","彌陀區","永安區","湖內區","鳳山區","大寮區","林園區","鳥松區","大樹區","旗山區","美濃區","六龜區","內門區","杉林區","甲仙區","桃源區","那瑪夏區","茂林區","茄萣區"],
  "屏東縣":["屏東市","潮州鎮","東港鎮","恆春鎮","萬丹鄉","長治鄉","麟洛鄉","九如鄉","里港鄉","鹽埔鄉","高樹鄉","萬巒鄉","內埔鄉","竹田鄉","新埤鄉","枋寮鄉","新園鄉","崁頂鄉","林邊鄉","南州鄉","佳冬鄉","琉球鄉","車城鄉","滿州鄉","枋山鄉"],
  "宜蘭縣":["宜蘭市","頭城鎮","礁溪鄉","壯圍鄉","員山鄉","羅東鎮","三星鄉","大同鄉","五結鄉","冬山鄉","蘇澳鎮","南澳鄉"],
  "花蓮縣":["花蓮市","新城鄉","秀林鄉","吉安鄉","壽豐鄉","鳳林鎮","光復鄉","豐濱鄉","瑞穗鄉","萬榮鄉","玉里鎮","富里鄉","卓溪鄉"],
  "台東縣":["台東市","成功鎮","關山鎮","卑南鄉","鹿野鄉","池上鄉","東河鄉","長濱鄉","太麻里鄉","金峰鄉","大武鄉","達仁鄉","綠島鄉","蘭嶼鄉","延平鄉","海端鄉"],
  "澎湖縣":["馬公市","湖西鄉","白沙鄉","西嶼鄉","望安鄉","七美鄉"],
  "金門縣":["金城鎮","金湖鎮","金沙鎮","金寧鄉","烈嶼鄉","烏坵鄉"],
  "連江縣":["南竿鄉","北竿鄉","莒光鄉","東引鄉"]
};

/* ----- Restaurant types mapping ----- */
const mapping = {"restaurant":[
    `node["amenity"="restaurant"]`, `way["amenity"="restaurant"]`, `relation["amenity"="restaurant"]`,
    `node["cuisine"]`, `way["cuisine"]`, `relation["cuisine"]`
  ],
  "fast_food":[
    `node["amenity"="fast_food"]`, `way["amenity"="fast_food"]`, `relation["amenity"="fast_food"]`,
    `node["shop"="fast_food"]`, `way["shop"="fast_food"]`, `relation["shop"="fast_food"]`,
    `node["cuisine"="burger"]`, `node["cuisine"="pizza"]`, `node["cuisine"="sandwich"]`,
    `way["cuisine"="burger"]`, `way["cuisine"="pizza"]`, `way["cuisine"="sandwich"]`,
    `relation["cuisine"="burger"]`, `relation["cuisine"="pizza"]`, `relation["cuisine"="sandwich"]`
  ],
  "cafe":[
    `node["amenity"="cafe"]`, `way["amenity"="cafe"]`, `relation["amenity"="cafe"]`,
    `node["shop"="coffee"]`, `way["shop"="coffee"]`, `relation["shop"="coffee"]`,
    `node["cuisine"="coffee"]`, `way["cuisine"="coffee"]`, `relation["cuisine"="coffee"]`
  ],
  "bar":[
    `node["amenity"="bar"]`, `way["amenity"="bar"]`, `relation["amenity"="bar"]`,
    `node["shop"="wine"]`, `way["shop"="wine"]`, `relation["shop"="wine"]`,
    `node["cuisine"="beer"]`, `way["cuisine"="beer"]`, `relation["cuisine"="beer"]`
  ],
  "bakery":[
    `node["shop"="bakery"]`, `way["shop"="bakery"]`, `relation["shop"="bakery"]`,
    `node["cuisine"="bread"]`, `way["cuisine"="bread"]`, `relation["cuisine"="bread"]`
  ],
  "ice_cream":[
    `node["shop"="ice_cream"]`, `way["shop"="ice_cream"]`, `relation["shop"="ice_cream"]`,
    `node["cuisine"="ice_cream"]`, `way["cuisine"="ice_cream"]`, `relation["cuisine"="ice_cream"]`
  ],
  "food_court":[
    `node["amenity"="food_court"]`, `way["amenity"="food_court"]`, `relation["amenity"="food_court"]`,
    `node["shop"="food_court"]`, `way["shop"="food_court"]`, `relation["shop"="food_court"]`
  ],
  "takeaway":[
    `node["shop"="takeaway"]`, `way["shop"="takeaway"]`, `relation["shop"="takeaway"]`,
    `node["amenity"="takeaway"]`, `way["amenity"="takeaway"]`, `relation["amenity"="takeaway"]`
  ],
  "beverages":[
    `node["shop"="beverages"]`, `way["shop"="beverages"]`, `relation["shop"="beverages"]`,
    `node["shop"="coffee"]`, `way["shop"="coffee"]`, `relation["shop"="coffee"]`,
    `node["amenity"="cafe"]`, `way["amenity"="cafe"]`, `relation["amenity"="cafe"]`,
    `node["amenity"="bar"]`, `way["amenity"="bar"]`, `relation["amenity"="bar"]`,
    `node["cuisine"="juice"]`, `way["cuisine"="juice"]`, `relation["cuisine"="juice"]`,
    `node["cuisine"="tea"]`, `way["cuisine"="tea"]`, `relation["cuisine"="tea"]`,
    `node["cuisine"="bubble_tea"]`, `way["cuisine"="bubble_tea"]`, `relation["cuisine"="bubble_tea"]`
  ],
  "night_snack":[
    `node["amenity"="fast_food"]`, `way["amenity"="fast_food"]`, `relation["amenity"="fast_food"]`,
    `node["shop"="food_court"]`, `way["shop"="food_court"]`, `relation["shop"="food_court"]`,
    `node["shop"="takeaway"]`, `way["shop"="takeaway"]`, `relation["shop"="takeaway"]`
  ],
  "dessert":[
    `node["shop"="ice_cream"]`, `way["shop"="ice_cream"]`, `relation["shop"="ice_cream"]`,
    `node["shop"="patisserie"]`, `way["shop"="patisserie"]`, `relation["shop"="patisserie"]`,
    `node["cuisine"="dessert"]`, `way["cuisine"="dessert"]`, `relation["cuisine"="dessert"]`
  ],
  "hotpot":[
    `node["cuisine"="hotpot"]`, `way["cuisine"="hotpot"]`, `relation["cuisine"="hotpot"]`,
    `node["amenity"="restaurant"]["cuisine"="hotpot"]`,
    `way["amenity"="restaurant"]["cuisine"="hotpot"]`,
    `relation["amenity"="restaurant"]["cuisine"="hotpot"]`
  ]
};

/* ----- DOM ----- */
const citySelectEl = document.getElementById("citySelect");
const districtSelectEl = document.getElementById("districtSelect");
const streetInputEl = document.getElementById("streetInput");
const streetSuggestionsEl = document.getElementById("streetSuggestions");
const typeSelectEl = document.getElementById("typeSelect");
const radiusInputEl = document.getElementById("radiusInput");
const radiusLabelEl = document.getElementById("radiusLabel");
const searchBtnEl = document.getElementById("searchBtn");
const reshuffleBtnEl = document.getElementById("reshuffleBtn");
const resultsPanelEl = document.getElementById("resultsPanel");
const loadingEl = document.getElementById("loading");

/* ----- 地圖、狀態變數 ----- */
let currentMarkers = [];
let lastRestaurants = [];
let userLocation = null;
let lastSearchCenter = null;

/* ----- 初始化縣市區下拉選單 ----- */
(function initCityDistrict(){
  Object.keys(taiwanData).forEach(city=>{
    const o = document.createElement("option"); o.value = city; o.textContent = city;
    citySelectEl.appendChild(o);
  });
  citySelectEl.addEventListener("change", ()=>{
    const city = citySelectEl.value;
    districtSelectEl.innerHTML = "";
    (taiwanData[city] || []).forEach(d => {
      const o = document.createElement("option"); o.value = d; o.textContent = d;
      districtSelectEl.appendChild(o);
    });
  });
  citySelectEl.selectedIndex = 0;
  citySelectEl.dispatchEvent(new Event("change"));
})();

/* ----- 店家類型 dropdown initialize ----- */
typeOptions.forEach(opt=>{
  const o = document.createElement("option");
  o.value = opt.value;
  o.textContent = opt.label;
  typeSelectEl.appendChild(o);
});

/* ----- 工具函式 ----- */
function showLoading(){ loadingEl.style.display = "flex"; }
function hideLoading(){ loadingEl.style.display = "none"; }
function setBusy(val){
  searchBtnEl.disabled = val;
  reshuffleBtnEl.disabled = val;
  citySelectEl.disabled = val;
  districtSelectEl.disabled = val;
  streetInputEl.disabled = val;
  typeSelectEl.disabled = val;
}
async function fetchWithTimeout(url, opts={}, timeout=10000){
  const controller = new AbortController();
  const id = setTimeout(()=>controller.abort(), timeout);
  try{
    const r = await fetch(url, { signal: controller.signal, ...opts });
    clearTimeout(id);
    return r;
  }catch(e){ clearTimeout(id); throw e; }
}

/* ----- geocode: LocationIQ + Nominatim fallback ----- */
async function geocode(query){
  let geo = null;
  for(let attempt = 0; attempt <= LOCATIONIQ_RETRY; attempt++){
    try{
      const url = `https://us1.locationiq.com/v1/search.php?key=${encodeURIComponent(API_KEY)}&q=${encodeURIComponent(query)}&format=json&addressdetails=1&countrycodes=TW&limit=3`;
      const r = await fetchWithTimeout(url, {}, 8000);
      if(!r.ok) throw new Error('LocationIQ bad response');
      const j = await r.json();
      if(Array.isArray(j) && j.length>0){
        geo = { lat: parseFloat(j[0].lat), lon: parseFloat(j[0].lon), raw: j[0] };
        break;
      }
    }catch(e){
      if(attempt < LOCATIONIQ_RETRY) await new Promise(res => setTimeout(res, 400*(attempt+1)));
    }
  }
  if(!geo){
    for(let attempt = 0; attempt <= NOMINATIM_RETRY; attempt++){
      try{
        const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=TW&limit=3&q=${encodeURIComponent(query)}`;
        const r = await fetchWithTimeout(url, { headers:{ "Accept":"application/json" } }, 8000);
        if(!r.ok) throw new Error('Nominatim bad response');
        const j = await r.json();
        if(Array.isArray(j) && j.length>0){
          geo = { lat: parseFloat(j[0].lat), lon: parseFloat(j[0].lon), raw: j[0] };
          break;
        }
      }catch(e){
        if(attempt < NOMINATIM_RETRY) await new Promise(res => setTimeout(res, 400*(attempt+1)));
      }
    }
  }
  if(!geo) return null;
  const hasNumber = /\d/.test(query);
  const geocodedHasHouseNumber = geo.raw && geo.raw.address && (geo.raw.address.house_number || geo.raw.address.housenumber || geo.raw.address.house_no);
  if(hasNumber && !geocodedHasHouseNumber) geo.fallbackToStreet = true;
  return geo;
}

/* ----- Overpass query with retries ----- */
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

/* ----- findRestaurants with filters, dedup, randomized ----- */
async function findRestaurants(lat, lon, radius = 1000, type = ''){
  const filters = [];
  let typesToSearch = [];
  if(type === "all"){
    typesToSearch = Object.keys(mapping);
  } else {
    typesToSearch = [type];
  }
  typesToSearch.forEach(t=>{
    const arr = mapping[t] || mapping["restaurant"];
    arr.forEach(s => filters.push(`${s}(around:${radius},${lat},${lon});`));
  });
  const q = `[out:json];(${filters.join('')});out center tags;`;
  const data = await overpassQuery(q);
  const elements = data.elements || [];
  const seen = new Set();
  const filtered = elements.filter(e=>{
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
  return shuffleArray(filtered);
}

/* ----- Clear & utility funcs ----- */
function clearMarkers(){ currentMarkers.forEach(m => map.removeLayer(m)); currentMarkers = []; }

function distance(lat1,lon1,lat2,lon2){
  const R = 6371000; const toRad = Math.PI/180;
  const φ1 = lat1*toRad, φ2 = lat2*toRad;
  const Δφ = (lat2-lat1)*toRad, Δλ = (lon2-lon1)*toRad;
  const a = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  const c = 2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R*c;
}

function shuffleArray(arr){
  for(let i=arr.length-1; i>0; i--){
    const j = Math.floor(Math.random()*(i+1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ----- renderResults ----- */
function renderResults(restaurants){
  clearMarkers();
  resultsPanelEl.innerHTML = "";
  if(!restaurants || restaurants.length === 0){
    resultsPanelEl.innerHTML = `<div class="small">找不到符合的餐廳。</div>`;
    return;
  }

  const ref = lastSearchCenter || null;
  let sorted = restaurants.slice();
  if(ref){
    sorted.sort((a,b)=>{
      const aLat = a.lat || a.center?.lat, aLon = a.lon || a.center?.lon;
      const bLat = b.lat || b.center?.lat, bLon = b.lon || b.center?.lon;
      return distance(ref.lat,ref.lon,aLat,aLon) - distance(ref.lat,ref.lon,bLat,bLon);
    });
  }
  lastRestaurants = sorted;

  const top = sorted.slice(0,3);
  top.forEach(item=>{
    const lat = item.lat || item.center?.lat;
    const lon = item.lon || item.center?.lon;
    const tags = item.tags || {};
    const name = tags.name || "未提供名稱";
    const address = (tags["addr:full"] || tags["addr:street"] || tags["addr:housenumber"] || "").toString();
    const hours = tags.opening_hours || "";
    const phone = tags.phone || tags["contact:phone"] || "";

    const marker = L.marker([lat,lon]).addTo(map);
    marker.bindPopup(`<b>${name}</b><br>${address||''}<br>${hours ? '營業時間：'+hours : ''}${phone ? '<br>電話：'+phone : ''}`);
    currentMarkers.push(marker);

    const card = document.createElement("div"); card.className="card";
    const left = document.createElement("div"); left.className="card-left";
    left.innerHTML = `<p class="card-title">${name}</p>
      <p class="card-sub">${address || '<span style="color:#999">地址未提供</span>'}</p>
      <p class="card-sub">${hours ? '營業時間：'+hours : ''}${phone ? ' • 電話：'+phone : ''}</p>`;
    const right = document.createElement("div"); right.className="card-actions";

    const btnView = document.createElement("button"); btnView.textContent = "顯示在地圖";
    btnView.onclick = ()=>{ map.setView([lat,lon],17); marker.openPopup(); };

    const btnMaps = document.createElement("button"); btnMaps.textContent = "在 Google Maps 開啟";
    btnMaps.onclick = ()=>{
      const mapsQuery = encodeURIComponent(name + (address ? ' ' + address : ''));
      window.open(`https://www.google.com/maps/search/?api=1&query=${mapsQuery}`, "_blank");
    };

    const btnNav = document.createElement("button"); btnNav.textContent = "導航";
    btnNav.onclick = ()=>{
      const useOrigin = confirm("是否使用你當前的位置作為起點？（按「取消」則僅顯示目的地）");
      if(useOrigin){
        if(!navigator.geolocation){ alert("裝置不支援定位"); return; }
        navigator.geolocation.getCurrentPosition(pos=>{
          const sLat = pos.coords.latitude, sLon = pos.coords.longitude;
          const url = `https://www.google.com/maps/dir/?api=1&origin=${sLat},${sLon}&destination=${encodeURIComponent(lat+','+lon)}&travelmode=driving`;
          window.open(url, "_blank");
        }, err=>{ alert("無法取得位置: "+err.message); }, { enableHighAccuracy:true, timeout:10000 });
      } else {
        const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(lat+','+lon)}&travelmode=driving`;
        window.open(url, "_blank");
      }
    };

    right.appendChild(btnView);
    right.appendChild(btnMaps);
    right.appendChild(btnNav);
    card.appendChild(left);
    card.appendChild(right);
    resultsPanelEl.appendChild(card);
  });

  // 避免手機返回空白問題
  setTimeout(()=>{ map.invalidateSize(); }, 200);
}

/* ----- 街道 autocomplete ----- */
let selectedSuggestionIndex = -1;
let suggestionItems = [];
streetInputEl.addEventListener('input', async ()=>{
  const city = citySelectEl.value;
  const district = districtSelectEl.value;
  const q = streetInputEl.value.trim();
  if(!q){ streetSuggestionsEl.innerHTML = ''; suggestionItems = []; selectedSuggestionIndex = -1; return; }
  try{
    let url = `https://us1.locationiq.com/v1/search.php?key=${encodeURIComponent(API_KEY)}&q=${encodeURIComponent(city + ' ' + district + ' ' + q)}&format=json&addressdetails=1&countrycodes=TW&limit=6`;
    const r = await fetchWithTimeout(url, {}, 8000);
    if(!r.ok) throw new Error('LocationIQ suggestion error');
    const j = await r.json();
    streetSuggestionsEl.innerHTML = '';
    suggestionItems = [];
    j.forEach(item=>{
      const display = item.display_name;
      if(!display) return;
      const div = document.createElement('div'); div.className = 'suggestion-item'; div.textContent = display;
      div.addEventListener('click', ()=>{ streetInputEl.value = display; streetSuggestionsEl.innerHTML = ''; suggestionItems = []; selectedSuggestionIndex = -1; });
      streetSuggestionsEl.appendChild(div);
      suggestionItems.push(div);
    });
    selectedSuggestionIndex = -1;
  }catch(e){
    streetSuggestionsEl.innerHTML = '';
    suggestionItems = [];
    selectedSuggestionIndex = -1;
  }
});
streetInputEl.addEventListener('keydown', e=>{
  if(!suggestionItems.length) return;
  if(e.key==='ArrowDown'){ e.preventDefault(); selectedSuggestionIndex = (selectedSuggestionIndex + 1) % suggestionItems.length; updateSuggestionHighlight(); }
  else if(e.key==='ArrowUp'){ e.preventDefault(); selectedSuggestionIndex = (selectedSuggestionIndex - 1 + suggestionItems.length) % suggestionItems.length; updateSuggestionHighlight(); }
  else if(e.key==='Enter'){ if(selectedSuggestionIndex >= 0){ e.preventDefault(); streetInputEl.value = suggestionItems[selectedSuggestionIndex].textContent; streetSuggestionsEl.innerHTML=''; suggestionItems=[]; selectedSuggestionIndex=-1; } }
});
function updateSuggestionHighlight(){
  suggestionItems.forEach((it,idx)=>{ it.style.background = (idx===selectedSuggestionIndex)? '#e0f7fa' : ''; });
}
document.addEventListener('click', e=>{ if(!streetInputEl.contains(e.target)) streetSuggestionsEl.innerHTML = ''; });

/* ----- 搜尋流程 ----- */
radiusInputEl.addEventListener('input', ()=>{ radiusLabelEl.textContent = radiusInputEl.value; });
searchBtnEl.addEventListener('click', async ()=>{
  const city = citySelectEl.value;
  const district = districtSelectEl.value;
  const street = streetInputEl.value.trim();
  if(!city || !district){ alert("請先選擇縣市與區"); return; }
  const query = `${city} ${district}${street ? ' ' + street : ''}`;
  showLoading(); setBusy(true);
  if(!street) alert(`僅輸入到區，將搜尋整個 ${district}`);
  else alert(`輸入街道/門牌，將搜尋附近 ${radiusInputEl.value} 公尺範圍`);
  const geo = await geocode(query);
  if(!geo){ hideLoading(); setBusy(false); alert("找不到該地址，請檢查門牌或改成街道搜尋。"); return; }
  if(geo.fallbackToStreet) alert("找不到精準門牌，將使用街道中心搜尋附近餐廳。");
  lastSearchCenter = { lat: geo.lat, lon: geo.lon };
  const radiusVal = parseInt(radiusInputEl.value, 10);
  const radius = radiusVal === 0 ? 5000 : radiusVal;
  try{
    const restaurants = await findRestaurants(geo.lat, geo.lon, radius, typeSelectEl.value);
    renderResults(restaurants);
    map.setView([geo.lat, geo.lon], radius <= 1000 ? 15 : 13);
  }catch(e){
    console.error(e);
    alert("查詢失敗，請稍後再試");
  }
  hideLoading(); setBusy(false);
});

/* ----- 重新抽選功能 ----- */
reshuffleBtnEl.addEventListener('click', ()=>{
  if(!lastRestaurants.length){ alert("尚未有搜尋結果"); return; }
  const shuffled = shuffleArray([...lastRestaurants]);
  renderResults(shuffled.slice(0,3));
});
