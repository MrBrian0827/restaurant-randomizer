/* index.js
   完整前端版本，整合你的原始碼並依照使用者需求修改：
   - 移除取得我的位置按鈕與相關永遠開啟的地理定位功能（需求1）
   - 導航時才詢問是否使用當前位置（需求2）
   - 搜尋時提示正在查詢哪個區或哪條街（需求3）
   - 搜尋結果更隨機、避免重複（需求4）
   - 嘗試從 OpenStreetMap/Overpass tags 讀取可能的評分欄位並顯示（需求5，純開源免費方法）
   - 擴大類型 mapping，以提高像「夜市小吃」「小吃」等類型的命中率（需求6）
*/

/* ---------- CONFIG ---------- */
const API_KEY = "pk.bc63f534da0350a75d49564feb994bfd"; // <- 換成你的 key
const LOCATIONIQ_RETRY = 2;
const NOMINATIM_RETRY = 2;
const OVERPASS_RETRY = 3;
const OVERPASS_SERVERS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter"
];

/* ---------- 台灣縣市區清單 (原封) ---------- */
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
  "連江縣":["南竿鄉","北竿鄉","莒光鄉","東引鄉"]};
/* 注意：實際使用時請把你原本完整 taiwanData 物件貼回來 */

// ---------- DOM ----------
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
const loadingEl = document.getElementById("loading");
const searchInfo = document.getElementById("searchInfo");

let map = L.map("map", { zoomControl: true }).setView([25.033964, 121.564468], 13);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);

let currentMarkers = [];
let lastRestaurants = [];
let lastSearchCenter = null;

/* sessionSeen 用於儘量避免重複在不同查詢中出現相同店家 */
const sessionSeenKeys = new Set();

/* ----- populate city/district ----- */
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

/* ----- 類型選單: 對應 mapping 的 key (修正值以符合 mapping) ----- */
const typeOptions = [
  { label: "全部", value: "all" },
  { label: "餐廳", value: "restaurant" },
  { label: "速食", value: "fast_food" },
  { label: "咖啡店", value: "cafe" },
  { label: "酒吧", value: "bar" },
  { label: "麵包/烘焙", value: "bakery" },
  { label: "甜點/冰品", value: "ice_cream" },
  { label: "小吃 / 夜市", value: "night_snack" },
  { label: "路邊便當/外帶", value: "takeaway" },
  { label: "飲料 / 手搖", value: "beverages" },
  { label: "火鍋", value: "hotpot" }
];
typeOptions.forEach(opt=>{
  const o = document.createElement("option"); o.value = opt.value; o.textContent = opt.label;
  typeSelect.appendChild(o);
});

/* ----- Helpers: loading / busy ----- */
function showLoading(){ loadingEl.style.display = "flex"; }
function hideLoading(){ loadingEl.style.display = "none"; }
function setBusy(val){
  searchBtn.disabled = val;
  reshuffleBtn.disabled = val;
  citySelect.disabled = val;
  districtSelect.disabled = val;
  streetInput.disabled = val;
  typeSelect.disabled = val;
}

/* fetchWithTimeout */
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

/* ----- geocode: LocationIQ + Nominatim fallback ----- */
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

/* ----- mapping: 擴充更多 tag 以提高「夜市、小吃」命中 (需求6) ----- */
const mapping = {
  "restaurant":[
    `node["amenity"="restaurant"]`, `way["amenity"="restaurant"]`, `relation["amenity"="restaurant"]`,
    `node["cuisine"]`, `way["cuisine"]`, `relation["cuisine"]`
  ],
  "fast_food":[
    `node["amenity"="fast_food"]`, `way["amenity"="fast_food"]`, `relation["amenity"="fast_food"]`,
    `node["shop"="fast_food"]`, `way["shop"="fast_food"]`, `relation["shop"="fast_food"]`,
    `node["cuisine"="burger"]`, `node["cuisine"="pizza"]`, `node["cuisine"="sandwich"]`,
    `way["cuisine"="burger"]`, `way["cuisine"="pizza"]`, `way["cuisine"="sandwich"]`
  ],
  "cafe":[
    `node["amenity"="cafe"]`, `way["amenity"="cafe"]`, `relation["amenity"="cafe"]`,
    `node["shop"="coffee"]`, `way["shop"="coffee"]`, `relation["shop"="coffee"]`,
    `node["cuisine"="coffee"]`, `way["cuisine"="coffee"]`, `relation["cuisine"="coffee"]`
  ],
  "bar":[
    `node["amenity"="bar"]`, `way["amenity"="bar"]`, `relation["amenity"="bar"]`,
    `node["shop"="wine"]`, `way["shop"="wine"]`, `relation["shop"="wine"]`
  ],
  "bakery":[
    `node["shop"="bakery"]`, `way["shop"="bakery"]`, `relation["shop"="bakery"]`,
    `node["cuisine"="bread"]`, `way["cuisine"="bread"]`, `relation["cuisine"="bread"]`
  ],
  "ice_cream":[
    `node["shop"="ice_cream"]`, `way["shop"="ice_cream"]`, `relation["shop"="ice_cream"]`,
    `node["cuisine"="ice_cream"]`, `way["cuisine"="ice_cream"]`, `relation["cuisine"="ice_cream"]`,
    `node["shop"="patisserie"]`, `way["shop"="patisserie"]`, `relation["shop"="patisserie"]`
  ],
  "food_court":[
    `node["amenity"="food_court"]`, `way["amenity"="food_court"]`, `relation["amenity"="food_court"]`,
    `node["shop"="food_court"]`, `way["shop"="food_court"]`, `relation["shop"="food_court"]`
  ],
  "takeaway":[
    `node["shop"="takeaway"]`, `way["shop"="takeaway"]`, `relation["shop"="takeaway"]`,
    `node["amenity"="takeaway"]`, `way["amenity"="takeaway"]`, `relation["amenity"="takeaway"]`,
    `node["shop"="kiosk"]`, `way["shop"="kiosk"]`, `relation["shop"="kiosk"]`
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
  // 致力提高夜市 / 小吃命中
  "night_snack":[
    `node["tourism"="night_market"]`, `way["tourism"="night_market"]`, `relation["tourism"="night_market"]`,
    `node["amenity"="marketplace"]`, `way["amenity"="marketplace"]`, `relation["amenity"="marketplace"]`,
    `node["shop"="street_vendor"]`, `way["shop"="street_vendor"]`, `relation["shop"="street_vendor"]`,
    `node["shop"="kiosk"]`, `node["shop"="stall"]`,
    `node["amenity"="fast_food"]`, `node["shop"="food_court"]`, `node["shop"="takeaway"]`
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

/* ----- findRestaurants: build multi-type overpass query, 除錯、去重 ----- */
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
    arr.forEach(s=>{
      // 使用 around filter
      filters.push(`${s}(around:${radius},${lat},${lon});`);
    });
  });

  // 組合 query
  const q = `[out:json][timeout:25];(${filters.join('')});out center tags;`;
  const data = await overpassQuery(q);
  const elements = data.elements || [];

  /* 進一步過濾、去重，並排除已在 sessionSeenKeys 裡優先 */
  const seen = new Set();
  const cleaned = elements.filter(e=>{
    const t = e.tags || {};
    if(t.disused || t.abandoned || t["disused:amenity"] || t["abandoned:amenity"]) return false;
    if(t.shop === "vacant") return false;
    if(t.closed || t["contact:status"] === "closed") return false;
    if(t.opening_hours && /closed|off|歇業|休業|暫停/i.test(t.opening_hours)) return false;
    if(t.name && /歇業|停業|永久|結束營業|closed/i.test(t.name)) return false;
    // 建立唯一 key (盡量包含 OSMid)
    const key = (e.id ? e.type+':'+e.id : (t.name||"")+"|"+(t["addr:street"]||"")+"|"+(t["addr:housenumber"]||""));
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return cleaned;
}

/* ----- clearMarkers & distance ----- */
function clearMarkers(){ currentMarkers.forEach(m=>map.removeLayer(m)); currentMarkers = []; }
function distance(lat1,lon1,lat2,lon2){ const R=6371000; const toRad=Math.PI/180; const φ1=lat1*toRad, φ2=lat2*toRad; const Δφ=(lat2-lat1)*toRad, Δλ=(lon2-lon1)*toRad; const a=Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2; const c=2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)); return R*c; }

/* ----- rating extraction (從 OSM tags 嘗試找 rating-like tags; 完全免費來源) ----- */
function extractRatingFromTags(tags){
  if(!tags) return null;
  const keys = ["rating","stars","review:rating","google:rating","yelp:rating","aggregate_rating","rating:average"];
  for(const k of keys){
    if(tags[k]){
      const v = parseFloat(String(tags[k]).replace(',','.'));
      if(!isNaN(v)) return v;
    }
  }
  // 有些 OSM 節點會把 rating 放在 `wikidata` 或 `wikipedia`，但無法直接拿到分數，故不處理
  return null;
}

/* ----- renderResults: 更隨機 & 盡量避免重複 (需求4) ----- */
function renderResults(restaurants){
  clearMarkers();
  resultsPanel.innerHTML = "";
  if(!restaurants || restaurants.length===0){ resultsPanel.innerHTML = `<div class="small">找不到符合的餐廳。</div>`; return; }

  // 優先把未在 sessionSeenKeys 的項目挑到前面
  const withKeys = restaurants.map(r => {
    const key = r.id ? r.type+':'+r.id : ((r.tags && r.tags.name)||"")+"|"+(r.tags && r.tags["addr:street"]||"");
    return { r, key, seen: sessionSeenKeys.has(key) };
  });

  // 先拿未看過的，如果不夠再補已看過的
  const unseen = withKeys.filter(x=>!x.seen).map(x=>x.r);
  const seen = withKeys.filter(x=>x.seen).map(x=>x.r);

  // 隨機打亂 (Fisher-Yates)
  function shuffle(arr){ for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]];} return arr; }
  const pool = shuffle(unseen).concat(shuffle(seen));

  // 選前 6 個作為候選（若總數少則全部選取）
  const candidateCount = Math.min(6, pool.length);
  const candidates = pool.slice(0, candidateCount);

  // 若仍不足，就使用全部並隨機排序
  if(candidates.length===0){
    lastRestaurants = shuffle(restaurants.slice());
  } else {
    lastRestaurants = shuffle(candidates.concat(pool.slice(candidateCount)));
  }

  // 把會顯示的那幾個標為已看過，sessionSeenKeys 用來避免未來重複出現（儘量）
  lastRestaurants.slice(0,6).forEach(item=>{
    const key = item.id ? item.type+':'+item.id : ((item.tags && item.tags.name)||"")+"|"+(item.tags && item.tags["addr:street"]||"");
    sessionSeenKeys.add(key);
  });

  // 渲染最多 6 張卡片（視畫面大小）
  const toShow = lastRestaurants.slice(0,6);
  toShow.forEach(item=>{
    const lat = item.lat || item.center?.lat;
    const lon = item.lon || item.center?.lon;
    if(!lat || !lon) return;
    const tags = item.tags || {};
    const name = tags.name || "未提供名稱";
    const address = (tags["addr:full"] || (tags["addr:street"] ? tags["addr:street"] + (tags["addr:housenumber"] ? ' ' + tags["addr:housenumber"] : '') : '') ) || '';
    const hours = tags.opening_hours || "";
    const phone = tags.phone || tags["contact:phone"] || "";
    const rating = extractRatingFromTags(tags);

    // marker
    const marker = L.marker([lat,lon]).addTo(map);
    marker.bindPopup(`<b>${name}</b><br>${address || ''}<br>${hours ? '營業時間：'+hours : ''}${phone?'<br>電話：'+phone:''}${rating?'<br>評分：'+rating:''}`);
    currentMarkers.push(marker);

    // card
    const card = document.createElement("div"); card.className = "card";
    const left = document.createElement("div"); left.className = "card-left";
    left.innerHTML = `<p class="card-title">${name}</p>
                      <p class="card-sub">${address || '<span class="muted">地址未提供</span>'}</p>
                      <p class="card-sub">${hours ? '營業時間：'+hours : ''}${phone ? ' • 電話：'+phone : ''}</p>`;

    // 顯示評分（若有）
    const ratingHtml = rating ? `<div class="rating">評分：${rating} / 5</div>` : `<div class="rating muted">評分：無</div>`;
    left.insertAdjacentHTML('beforeend', ratingHtml);

    const right = document.createElement("div"); right.className = "card-actions";
    const btnView = document.createElement("button"); btnView.textContent = "顯示在地圖"; btnView.onclick = ()=>{ map.setView([lat,lon],17); marker.openPopup(); };
    const btnMaps = document.createElement("button"); btnMaps.textContent = "在 Google Maps 開啟"; btnMaps.onclick = ()=> { const mapsQuery = encodeURIComponent(name + (address ? ' ' + address : '')); window.open(`https://www.google.com/maps/search/?api=1&query=${mapsQuery}`,"_blank"); };
    const btnNav = document.createElement("button"); btnNav.textContent = "導航"; btnNav.onclick = ()=> {
      // 需求2：在導航時才詢問是否要使用當前位置
      const useOrigin = confirm("導航：是否使用你當前的位置作為起點？按「取消」則僅顯示目的地。");
      if(useOrigin){
        if(!navigator.geolocation){
          alert("裝置不支援定位");
          const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(lat+','+lon)}&travelmode=driving`;
          window.open(url,"_blank");
          return;
        }
        showLoading(); setBusy(true);
        navigator.geolocation.getCurrentPosition(pos=>{
          hideLoading(); setBusy(false);
          const sLat = pos.coords.latitude, sLon = pos.coords.longitude;
          const url = `https://www.google.com/maps/dir/?api=1&origin=${sLat},${sLon}&destination=${encodeURIComponent(lat+','+lon)}&travelmode=driving`;
          window.open(url,"_blank");
        }, err=>{
          hideLoading(); setBusy(false);
          alert("無法取得位置: "+err.message);
          const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(lat+','+lon)}&travelmode=driving`;
          window.open(url,"_blank");
        }, { enableHighAccuracy:true, timeout:10000 });
      } else {
        const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(lat+','+lon)}&travelmode=driving`;
        window.open(url,"_blank");
      }
    };

    right.appendChild(btnView); right.appendChild(btnMaps); right.appendChild(btnNav);
    card.appendChild(left); card.appendChild(right);
    resultsPanel.appendChild(card);
  });

  // Map 重新聚焦到中心 (lastSearchCenter)
  if(lastSearchCenter) map.setView([lastSearchCenter.lat, lastSearchCenter.lon], radiusInput.value <= 1000 ? 15 : 13);
}

/* ----- 街道 autocomplete (保留原本行為) ----- */
let selectedSuggestionIndex = -1;
let suggestionItems = [];
streetInput.addEventListener('input', async ()=>{
  const city = citySelect.value;
  const district = districtSelect.value;
  const q = streetInput.value.trim();
  if(!q){ streetSuggestions.innerHTML = ''; suggestionItems = []; selectedSuggestionIndex=-1; return; }
  try{
    let url = `https://us1.locationiq.com/v1/search.php?key=${encodeURIComponent(API_KEY)}&q=${encodeURIComponent(city+' '+district+' '+q)}&format=json&addressdetails=1&countrycodes=TW&limit=6`;
    const r = await fetchWithTimeout(url);
    if(!r.ok) throw new Error('LocationIQ suggestion error');
    const j = await r.json();
    streetSuggestions.innerHTML = '';
    suggestionItems = [];
    j.forEach(item=>{
      const display = item.display_name;
      if(!display) return;
      const div = document.createElement('div'); div.className = 'suggestion-item'; div.textContent = display;
      div.addEventListener('click', ()=>{ streetInput.value = display; streetSuggestions.innerHTML = ''; suggestionItems = []; selectedSuggestionIndex = -1; });
      streetSuggestions.appendChild(div); suggestionItems.push(div);
    });
    selectedSuggestionIndex = -1;
  }catch(e){ streetSuggestions.innerHTML = ''; suggestionItems = []; selectedSuggestionIndex=-1; }
});
streetInput.addEventListener('keydown', (e)=>{
  if(!suggestionItems.length) return;
  if(e.key==='ArrowDown'){ e.preventDefault(); selectedSuggestionIndex = (selectedSuggestionIndex + 1) % suggestionItems.length; updateSuggestionHighlight(); } 
  else if(e.key==='ArrowUp'){ e.preventDefault(); selectedSuggestionIndex = (selectedSuggestionIndex - 1 + suggestionItems.length) % suggestionItems.length; updateSuggestionHighlight(); } 
  else if(e.key==='Enter'){ if(selectedSuggestionIndex >=0){ e.preventDefault(); streetInput.value = suggestionItems[selectedSuggestionIndex].textContent; streetSuggestions.innerHTML=''; suggestionItems=[]; selectedSuggestionIndex=-1; } }
});
function updateSuggestionHighlight(){ suggestionItems.forEach((it,idx)=>{ it.style.background=(idx===selectedSuggestionIndex)?'#e0f7fa':''; }); }
document.addEventListener('click',(e)=>{ if(!streetInput.contains(e.target)) streetSuggestions.innerHTML=''; });

/* ----- search flow ----- */
radiusInput.addEventListener('input', ()=>{ radiusLabel.textContent = radiusInput.value; });
searchBtn.addEventListener('click', async ()=>{
  const city = citySelect.value;
  const district = districtSelect.value;
  const street = streetInput.value.trim();
  if(!city || !district){ alert("請先選擇縣市與區"); return; }

  // 顯示目前搜尋資訊 (要求3)
  if(!street){
    searchInfo.textContent = `正在搜尋：${city} ${district}（整個區域）`;
  } else {
    const radiusKm = (parseInt(radiusInput.value,10) || 1000) / 1000;
    searchInfo.textContent = `正在搜尋：${city} ${district} — 街道/門牌：${street}（搜尋範圍約 ${radiusKm.toFixed(1)} 公里）`;
  }

  showLoading(); setBusy(true);
  const query = `${city} ${district}${street ? ' ' + street : ''}`;
  const geo = await geocode(query);
  if(!geo){ hideLoading(); setBusy(false); alert("找不到該地址，請檢查門牌或改成街道搜尋。"); return; }
  if(geo.fallbackToStreet) alert("找不到精準門牌，將使用街道中心搜尋附近餐廳。");
  lastSearchCenter = { lat: geo.lat, lon: geo.lon };
  const radiusVal = parseInt(radiusInput.value,10); const radius = radiusVal===0?5000:radiusVal;
  try{
    const restaurants = await findRestaurants(geo.lat, geo.lon, radius, typeSelect.value);
    if(!restaurants || restaurants.length===0){
      resultsPanel.innerHTML = `<div class="small">查無餐廳 (嘗試放大半徑或選擇「全部」類型)。</div>`;
    } else {
      renderResults(restaurants);
    }
    map.setView([geo.lat, geo.lon], radius <= 1000 ? 15 : 13);
  }catch(e){
    console.error(e); alert("查詢失敗，請稍後再試");
  }
  hideLoading(); setBusy(false);
});

/* ----- reshuffle ----- */
reshuffleBtn.addEventListener('click', ()=>{
  if(!lastRestaurants.length){ alert("尚未有搜尋結果"); return; }
  // 重新打亂 lastRestaurants 並 render
  lastRestaurants = lastRestaurants.sort(()=>Math.random()-0.5);
  renderResults(lastRestaurants);
});

/* ----- 初始 UI 狀態 ----- */
radiusLabel.textContent = radiusInput.value;
searchInfo.textContent = "請選擇縣市與區，輸入街道可縮小搜尋範圍。";

/* ----- 注意: 移除全域定位按鈕邏輯 (需求1) ----- */
/* 已將只有在導航時才詢問位置 (見上方 btnNav onclick) */

