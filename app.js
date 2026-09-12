const COLORS = ["#7dd3fc", "#34d399", "#c084fc", "#fbbf24"];
const CITIES = ["Centennial", "Littleton", "Greenwood Village"];
const CITY_CENTER = {
  Centennial: [39.5807, -104.8772],
  Littleton: [39.6133, -105.0166],
  "Greenwood Village": [39.6172, -104.9508]
};
const PINS = [
  { num: "5901", street: "quebec", lat: 39.6095, lon: -104.9596 },
  { num: "2410", street: "arapahoe", lat: 39.5953, lon: -104.9588 },
  { num: "12022", street: "arapahoe", lat: 39.5945, lon: -104.847 },
  { num: "6556", street: "broadway", lat: 39.5994, lon: -104.9879 },
  { num: "5898", street: "broadway", lat: 39.6102, lon: -104.9879 },
  { num: "8250", street: "holly", lat: 39.5672, lon: -104.9223 },
  { num: "6515", street: "dayton", lat: 39.599, lon: -104.9879 },
  { num: "11005", street: "briarwood", lat: 39.5938, lon: -104.858 },
  { num: "7425", street: "arapahoe", lat: 39.595, lon: -104.897 },
  { num: "8263", street: "county", lat: 39.5718, lon: -104.904 },
  { num: "6200", street: "santa fe", lat: 39.604, lon: -105.022 },
  { num: "5890", street: "santa fe", lat: 39.608, lon: -105.022 },
  { num: "11901", street: "arapahoe", lat: 39.5954, lon: -104.85 },
  { num: "8755", street: "yosemite", lat: 39.5951, lon: -104.8818 },
  { num: "250", street: "dry creek", lat: 39.5802, lon: -104.985 },
  { num: "181", street: "littleton", lat: 39.6138, lon: -104.9965 },
  { num: "2338", street: "prince", lat: 39.6244, lon: -105.0148 },
  { num: "8020", street: "broadway", lat: 39.5715, lon: -104.9879 },
  { num: "5595", street: "broadway", lat: 39.6165, lon: -104.9879 },
  { num: "5171", street: "arapahoe", lat: 39.5952, lon: -104.926 },
  { num: "10553", street: "easter", lat: 39.594, lon: -104.862 },
  { num: "10210", street: "arapahoe", lat: 39.5953, lon: -104.868 },
  { num: "7799", street: "arapahoe", lat: 39.5952, lon: -104.893 },
  { num: "8787", street: "yosemite", lat: 39.5848, lon: -104.887 },
  { num: "7450", street: "colorado", lat: 39.5818, lon: -104.9408 },
  { num: "100", street: "littleton", lat: 39.6135, lon: -104.996 },
  { num: "7801", street: "arapahoe", lat: 39.5954, lon: -104.887 },
  { num: "7500", street: "broadway", lat: 39.5803, lon: -104.9879 },
  { num: "8080", street: "broadway", lat: 39.5682, lon: -104.9879 }
];
const FALLBACK = { observations: [] };
const KEYS = { hist: "wazegas-hist", coach: "wazegas-coach", lastTap: "wazegas-last" };
const STALE_MS = 24 * 60 * 60 * 1000;
const GO_SVG = '<svg class="btn-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>';

let grade = "regular",
  hist = FALLBACK,
  here = null,
  selectedId = null,
  loadState = "loading",
  chartDays = [],
  chartBy = {},
  chartList = [];

function toast(t) {
  const el = document.getElementById("toast");
  el.textContent = t;
  el.style.display = "block";
  setTimeout(() => { el.style.display = "none"; }, 2200);
}
function isKroger(s) {
  const n = (s.name || "").toLowerCase();
  return n.indexOf("king soopers") !== -1 || n.indexOf("kroger") !== -1;
}
function rawPrice(s) {
  const v = s[grade];
  return v == null || v === "" ? null : +v;
}
function priceOf(s) {
  const v = rawPrice(s);
  if (v == null || !isFinite(v)) return null;
  return isKroger(s) ? +(v - 0.03).toFixed(2) : v;
}
function haversine(a, b) {
  const R = 3958.8, toR = (d) => d * Math.PI / 180;
  const dLat = toR(b[0] - a[0]), dLon = toR(b[1] - a[1]);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a[0])) * Math.cos(toR(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function pin(s) {
  if (typeof s.lat === "number" && typeof s.lon === "number") return [s.lat, s.lon];
  const addr = (s.addr || "").toLowerCase();
  const m = addr.match(/(\d+)/);
  if (m) {
    const hits = PINS.filter((p) => p.num === m[1] && addr.indexOf(p.street) !== -1);
    if (hits.length === 1) return [hits[0].lat, hits[0].lon];
  }
  return CITY_CENTER[s.city] || null;
}
function miles(s) {
  if (!here) return null;
  const p = pin(s);
  if (!p) return null;
  return haversine(here, p);
}
function latest() { return (hist.observations || [])[(hist.observations || []).length - 1]; }
function areaStations() {
  const o = latest();
  if (!o) return [];
  return (o.stations || []).filter((s) => CITIES.indexOf(s.city) !== -1);
}
function pricedList() {
  return areaStations().filter((s) => priceOf(s) != null).slice().sort((a, b) => priceOf(a) - priceOf(b)).slice(0, 4);
}
function ageLabel(iso) {
  if (!iso) return "Updated time unknown";
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.max(0, Math.round(ms / 3600000));
  if (h < 1) return "Updated just now";
  if (h < 24) return "Updated " + h + "h ago";
  return "Updated " + Math.round(h / 24) + "d ago";
}
function isStale(iso) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return isFinite(t) && Date.now() - t > STALE_MS;
}
function last10() {
  const out = [], end = new Date();
  for (let i = 9; i >= 0; i--) {
    const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i);
    out.push(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"));
  }
  return out;
}
function priceHtml(n) {
  const parts = n.toFixed(2).split(".");
  return '<span class="price-face"><span class="price-sym">$</span><span class="price-bucks">' + parts[0] + '</span><span class="price-cents">.' + parts[1] + "</span></span>";
}
function installHint() {
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  if (isIOS) return "Tap Share, then Add to Home Screen.";
  if (isAndroid) return "Open the browser menu, then Add to Home screen / Install app.";
  return "Use your browser menu, then Add to Home Screen or Install app.";
}
function emptyMessage(listLen, status) {
  if (loadState === "fail" && listLen === 0) return "Could not load prices. Pull to refresh, or check back after the next crawl.";
  if (loadState === "cached" && listLen === 0) return "Could not reach the latest crawl, and there is no saved list on this device.";
  if (listLen) return "";
  const extra = status === "blocked" ? " The latest crawl was blocked." : status === "partial" ? " The latest crawl was only partial." : "";
  return "No " + grade + " prices in the latest crawl." + extra;
}
function openWaze(s) {
  selectedId = s.id;
  localStorage.setItem(KEYS.lastTap, s.id);
  const q = encodeURIComponent((s.addr || "") + " " + (s.city || "") + " CO");
  const native = "waze://?q=" + q + "&navigate=yes";
  const web = "https://waze.com/ul?q=" + q + "&utm_source=mattsgas";
  let cancelled = false;
  const cancel = () => { if (document.hidden) cancelled = true; };
  document.addEventListener("visibilitychange", cancel);
  window.addEventListener("pagehide", cancel);
  setTimeout(() => {
    document.removeEventListener("visibilitychange", cancel);
    window.removeEventListener("pagehide", cancel);
    if (!cancelled && !document.hidden) location.href = web;
  }, 700);
  location.href = native;
  render();
}
function hideTip() {
  const tip = document.getElementById("chartTip");
  const hint = document.getElementById("chartHint");
  tip.hidden = true;
  hint.hidden = false;
}
function showTip(day, rows, cssX) {
  const tip = document.getElementById("chartTip");
  const hint = document.getElementById("chartHint");
  if (!rows.length) { hideTip(); return; }
  tip.innerHTML = '<div class="chart-tip-day">' + day.slice(5) + "</div>" + rows.map((r) =>
    '<div class="chart-tip-row"><i class="sw" style="background:' + r.color + '"></i><span></span><b>$' + r.v.toFixed(2) + "</b></div>"
  ).join("");
  const spans = tip.querySelectorAll(".chart-tip-row span");
  rows.forEach((r, i) => { spans[i].textContent = r.name; });
  tip.style.left = Math.min(Math.max(cssX, 16), 220) + "px";
  tip.hidden = false;
  hint.hidden = true;
}
function drawChart(list) {
  chartList = list;
  const ids = list.slice(0, 4).map((s) => s.id);
  const obs = (hist.observations || []).slice().sort((a, b) => (a.crawled_at || a.date).localeCompare(b.crawled_at || b.date));
  chartBy = {};
  obs.forEach((o) => { chartBy[o.date] = o; });
  chartDays = last10();
  const canvas = document.getElementById("chart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const vals = [];
  chartDays.forEach((d) => {
    const o = chartBy[d];
    if (!o) return;
    (o.stations || []).forEach((s) => {
      if (ids.indexOf(s.id) === -1) return;
      const v = priceOf(s);
      if (v != null) vals.push(v);
    });
  });
  const min = (vals.length ? Math.min.apply(null, vals) : 3.5) - 0.08;
  const max = (vals.length ? Math.max.apply(null, vals) : 5.2) + 0.08;
  const padL = 64, padR = 16, padT = 14, padB = 34;
  const x = (i) => padL + i * (w - padL - padR) / Math.max(chartDays.length - 1, 1);
  const y = (v) => padT + (1 - (v - min) / (max - min)) * (h - padT - padB);
  ctx.strokeStyle = "#2a3650"; ctx.fillStyle = "#9aa8bd"; ctx.font = "20px -apple-system,sans-serif"; ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const v = min + (max - min) * i / 3;
    ctx.beginPath(); ctx.moveTo(padL, y(v)); ctx.lineTo(w - padR, y(v)); ctx.stroke();
    ctx.fillText("$" + v.toFixed(2), 8, y(v) + 6);
  }
  chartDays.forEach((d, i) => { if (i % 2 === 0 || i === chartDays.length - 1) ctx.fillText(d.slice(5), x(i) - 20, h - 8); });
  list.forEach((s, idx) => {
    const color = COLORS[idx % COLORS.length];
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2.5;
    let started = false; ctx.beginPath();
    chartDays.forEach((d, i) => {
      const o = chartBy[d];
      const hit = o && (o.stations || []).find((r) => r.id === s.id);
      const v = hit ? priceOf(hit) : null;
      if (v == null) { started = false; return; }
      if (!started) { ctx.moveTo(x(i), y(v)); started = true; }
      else ctx.lineTo(x(i), y(v));
    });
    ctx.stroke();
    chartDays.forEach((d, i) => {
      const o = chartBy[d];
      const hit = o && (o.stations || []).find((r) => r.id === s.id);
      const v = hit ? priceOf(hit) : null;
      if (v == null) return;
      ctx.beginPath(); ctx.arc(x(i), y(v), 3.5, 0, Math.PI * 2); ctx.fill();
    });
  });
  document.getElementById("legend").innerHTML = list.map((s, i) =>
    '<span><i class="sw" style="background:' + COLORS[i % COLORS.length] + '"></i></span>'
  ).join("");
  document.getElementById("legend").querySelectorAll("span").forEach((el, i) => {
    el.appendChild(document.createTextNode(list[i].name));
  });
}
function onChartPointer(ev) {
  const canvas = document.getElementById("chart");
  const rect = canvas.getBoundingClientRect();
  const px = (ev.clientX - rect.left) / rect.width * canvas.width;
  const padL = 64, padR = 16;
  const xAt = (i) => padL + i * (canvas.width - padL - padR) / Math.max(chartDays.length - 1, 1);
  let best = 0, bestD = Infinity;
  chartDays.forEach((_, i) => {
    const dx = Math.abs(xAt(i) - px);
    if (dx < bestD) { bestD = dx; best = i; }
  });
  const day = chartDays[best];
  const o = chartBy[day];
  const rows = chartList.map((s, idx) => {
    const hit = o && (o.stations || []).find((r) => r.id === s.id);
    const v = hit ? priceOf(hit) : null;
    return v == null ? null : { name: s.name, v, color: COLORS[idx % COLORS.length] };
  }).filter(Boolean);
  showTip(day, rows, ev.clientX - rect.left);
  const ctx = canvas.getContext("2d");
  drawChart(chartList);
  if (rows.length) {
    ctx.strokeStyle = "rgba(51,204,255,0.45)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(xAt(best), 14); ctx.lineTo(xAt(best), canvas.height - 34); ctx.stroke();
  }
}
function render() {
  const list = pricedList();
  const o = latest();
  const stale = isStale(o && o.crawled_at);
  const stamp = ageLabel(o && o.crawled_at)
    + (loadState === "cached" ? " · saved copy" : "")
    + (stale ? " · prices may be old" : "");
  document.getElementById("stamp").textContent = stamp;
  const note = document.getElementById("statusNote");
  if (o && o.status === "blocked") { note.hidden = false; note.textContent = "Latest crawl was blocked — prices may be missing."; }
  else if (o && o.status === "partial") { note.hidden = false; note.textContent = "Latest crawl was partial — some grades may be missing."; }
  else { note.hidden = true; note.textContent = ""; }
  document.getElementById("emptyNote").textContent = emptyMessage(list.length, o && o.status);
  const selected = list.find((s) => s.id === selectedId) || null;
  document.getElementById("chartTitle").textContent = selected ? "10-day · " + selected.name : "10-day · cheapest 4";
  const allBtn = document.getElementById("chartAll");
  if (allBtn) {
    allBtn.hidden = !selected;
    allBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); selectedId = null; render(); };
  }
  const root = document.getElementById("stations");
  const paint = () => {
    root.innerHTML = "";
    list.forEach((s, i) => {
      const el = document.createElement("div");
      el.className = "station" + (i === 0 ? " best" : "") + (stale ? " stale" : "") + (s.id === selectedId ? " selected" : "") + (i === list.length - 1 && list.length > 2 ? " high" : "");
      el.style.viewTransitionName = "st-" + s.id;
      el.setAttribute("role", "button");
      el.tabIndex = 0;
      const copy = document.createElement("div");
      const name = document.createElement("strong");
      const dot = document.createElement("i");
      dot.className = "sw";
      dot.style.background = COLORS[i % COLORS.length];
      name.appendChild(dot);
      name.appendChild(document.createTextNode(s.name));
      const addr = document.createElement("div");
      addr.className = "addr";
      const mi = miles(s);
      addr.textContent = s.addr + " · " + s.city + (mi != null ? " · " + mi.toFixed(1) + " mi" : "");
      copy.appendChild(name);
      copy.appendChild(addr);
      if (s.id === selectedId) {
        const go = document.createElement("button");
        go.type = "button";
        go.className = "go-btn";
        go.innerHTML = GO_SVG + " Take me there";
        go.addEventListener("click", (e) => { e.stopPropagation(); openWaze(s); });
        copy.appendChild(go);
      }
      const right = document.createElement("div");
      right.className = "station-right";
      if (s.conflict) {
        const pr = document.createElement("div");
        pr.className = "price-face";
        pr.textContent = s.conflict;
        right.appendChild(pr);
      } else {
        const wrap = document.createElement("div");
        wrap.innerHTML = priceHtml(priceOf(s));
        right.appendChild(wrap.firstChild);
      }
      if (isKroger(s) && rawPrice(s) != null) {
        const b = document.createElement("span");
        b.className = "board";
        b.textContent = "board $" + rawPrice(s).toFixed(2) + ", with card −3¢";
        right.appendChild(b);
      }
      el.appendChild(copy);
      el.appendChild(right);
      const toggle = () => {
        selectedId = selectedId === s.id ? null : s.id;
        render();
      };
      el.addEventListener("click", toggle);
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
      });
      root.appendChild(el);
    });
    drawChart(selected ? [selected] : list);
    hideTip();
  };
  if (document.startViewTransition) document.startViewTransition(paint);
  else paint();
}
function askLocation(quiet) {
  if (!navigator.geolocation) { if (!quiet) toast("Location not available"); return; }
  navigator.geolocation.getCurrentPosition(
    (p) => { here = [p.coords.latitude, p.coords.longitude]; render(); },
    (err) => { if (!quiet) toast(err && err.code === 1 ? "Allow location in Settings" : "Location failed"); },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
  );
}
function setGrade(next) {
  grade = next;
  const seg = document.getElementById("seg");
  seg.dataset.grade = next;
  document.getElementById("btnReg").classList.toggle("on", next === "regular");
  document.getElementById("btnPrem").classList.toggle("on", next === "premium");
  document.getElementById("btnReg").setAttribute("aria-pressed", next === "regular" ? "true" : "false");
  document.getElementById("btnPrem").setAttribute("aria-pressed", next === "premium" ? "true" : "false");
  render();
}
document.getElementById("btnReg").onclick = () => setGrade("regular");
document.getElementById("btnPrem").onclick = () => setGrade("premium");
document.getElementById("locBtn").onclick = () => askLocation(false);
document.getElementById("coachOk").onclick = () => {
  localStorage.setItem(KEYS.coach, "1");
  document.getElementById("coach").classList.remove("on");
};
document.getElementById("coachHint").textContent = installHint();
const standalone = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
if (!localStorage.getItem(KEYS.coach) && !standalone) document.getElementById("coach").classList.add("on");

let startY = null;
document.getElementById("scroller").addEventListener("touchstart", (e) => {
  if (window.scrollY <= 0) startY = e.touches[0].clientY;
}, { passive: true });
document.getElementById("scroller").addEventListener("touchmove", (e) => {
  if (startY == null) return;
  if (e.touches[0].clientY - startY > 56) document.getElementById("pullMsg").classList.add("on");
}, { passive: true });
document.getElementById("scroller").addEventListener("touchend", () => {
  if (document.getElementById("pullMsg").classList.contains("on")) load(true);
  startY = null;
  document.getElementById("pullMsg").classList.remove("on");
});

const canvas = document.getElementById("chart");
canvas.addEventListener("pointerdown", onChartPointer);
canvas.addEventListener("pointermove", onChartPointer);
canvas.addEventListener("pointerleave", () => { hideTip(); drawChart(chartList); });

function apply(j, how) {
  if (j && j.observations) {
    hist = j;
    try { localStorage.setItem(KEYS.hist, JSON.stringify(j)); } catch (e) { /* quota */ }
    loadState = how;
  } else loadState = "fail";
  render();
}
function load(toastOn) {
  fetch("gas-history.json?t=" + Date.now(), { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then((j) => {
    if (j && j.observations) apply(j, "live");
    else {
      const cached = localStorage.getItem(KEYS.hist);
      apply(cached ? JSON.parse(cached) : FALLBACK, cached ? "cached" : "fail");
    }
    if (toastOn) toast(j && j.observations ? "Updated" : "Showing last saved list");
    askLocation(true);
  }).catch(() => {
    const cached = localStorage.getItem(KEYS.hist);
    apply(cached ? JSON.parse(cached) : FALLBACK, cached ? "cached" : "fail");
    if (toastOn) toast("Showing last saved list");
  });
}
load(false);
