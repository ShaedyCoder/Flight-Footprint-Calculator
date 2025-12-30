// =============================
// Flight Footprint Calculator
// =============================
console.log("APP.JS VERSION:", "2025-12-30 23:45");

const AIRPORTS_CSV = "airports_iata_latlon.csv";
const STORAGE_KEY = "flight_history_v1";

// ---- Google Sheets Web App (Apps Script /exec) ----
const SHEETS_WEBAPP_URL =
  "https://script.google.com/macros/s/AKfycby8HHBCTBhhi32ZudeUJOFTm1xRWRELVciEyGuqYIg1h14cwd4A-hgUBdEbpHLukvTu/exec";

// =============================
// DOM
// =============================
const form = document.getElementById("flightForm");
const employeeNameEl = document.getElementById("employeeName");
const fromEl = document.getElementById("from");
const toEl = document.getElementById("to");
const flightDateEl = document.getElementById("flightDate");
const tripTypeEl = document.getElementById("tripType");
const passengersEl = document.getElementById("passengers");
const cabinClassEl = document.getElementById("cabinClass");

const fromSuggest = document.getElementById("fromSuggest");
const toSuggest = document.getElementById("toSuggest");

const resetBtn = document.getElementById("resetBtn");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const exportCsvBtn = document.getElementById("exportCsvBtn");

const resultMain = document.getElementById("resultMain");
const resultSub = document.getElementById("resultSub");
const dbStatus = document.getElementById("dbStatus");

const historyTbody = document.querySelector("#historyTable tbody");
const emptyState = document.getElementById("emptyState");

// =============================
// State
// =============================
let airportsReady = false;
/** Map<IATA, {lat:number, lon:number, name?:string, city?:string, country?:string}> */
let airportIndex = new Map();
/** Fast search array: [{ iata, name, city, country, hay }] */
let airportSearch = [];

// =============================
// Init defaults
// =============================
flightDateEl.valueAsDate = new Date();

// Disable From/To until loaded
fromEl.disabled = true;
toEl.disabled = true;
fromEl.placeholder = "Loading airports…";
toEl.placeholder = "Loading airports…";

// =============================
// Helpers
// =============================
function extractIata(input) {
  const s = String(input ?? "").toUpperCase();
  const m = s.match(/[A-Z0-9]{3}/);
  return m ? m[0] : "";
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function nowSgt() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const get = (t) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}-${get("month")}-${get("year")} ${get("hour")}:${get(
    "minute"
  )} SGT`;
}

function formatDdMmYyyy(isoDateStr) {
  if (!isoDateStr) return "";
  const [y, m, d] = isoDateStr.split("-");
  if (!y || !m || !d) return isoDateStr;
  return `${pad2(d)}-${pad2(m)}-${y}`;
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function cabinMult(c) {
  if (c === "premium") return 1.2;
  if (c === "business") return 1.5;
  if (c === "first") return 2.0;
  return 1.0;
}

function tripMult(t) {
  return t === "round-trip" ? 2 : 1;
}

function prettyCabin(v) {
  if (v === "premium") return "Premium Economy";
  if (v === "business") return "Business Class";
  if (v === "first") return "First Class";
  return "Economy";
}

function prettyTrip(v) {
  return v === "round-trip" ? "Round Trip" : "One Way";
}

function nowForFilename() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const min = pad2(d.getMinutes());
  return `${yyyy}-${mm}-${dd}_${hh}${min}`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function placeLabelFromAirport(code) {
  const a = airportIndex.get(code);
  if (!a) return code;
  const city = (a.city || "").trim();
  const country = (a.country || "").trim();
  const name = (a.name || "").trim();
  return city || country || name || code;
}

function routeName(codeA, codeB) {
  return `${placeLabelFromAirport(codeA)} – ${placeLabelFromAirport(codeB)}`;
}

function routeIata(codeA, codeB) {
  return `${codeA} – ${codeB}`;
}

// =============================
// localStorage
// =============================
function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? [];
  } catch {
    return [];
  }
}

function saveHistory(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function renderHistory() {
  const items = loadHistory();
  historyTbody.innerHTML = "";
  emptyState.style.display = items.length ? "none" : "block";

  for (const it of items) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(it.employeeName)}</td>
      <td>${escapeHtml(it.submittedSgt)}</td>
      <td>${escapeHtml(it.from)} → ${escapeHtml(it.to)}</td>
      <td>${escapeHtml(prettyCabin(it.cabinClass))} · ${escapeHtml(
      prettyTrip(it.tripType)
    )} · ${escapeHtml(it.passengers)} pax</td>
      <td class="right">${Number(it.emissionsKg).toFixed(1)}</td>
    `;
    historyTbody.appendChild(tr);
  }
}

// =============================
// CSV Export
// =============================
function toCsv(items) {
  const headers = [
    "Employee",
    "Submitted (SGT)",
    "Flight Date (dd-mm-yyyy)",
    "From – To",
    "From – To (IATA)",
    "Trip Type (× Multiplier)",
    "Cabin Class (× Multiplier)",
    "Passengers",
    "Great-circle Distance (km)",
    "Uplifted Distance (km) (×1.08)",
    "Haul & Base Factor (kg CO₂e / passenger-km)",
    "Total Emissions (kg CO₂e)",
  ];

  const lines = [headers.join(",")];

  for (const i of items) {
    const fromCode = i.from;
    const toCode = i.to;
    const flightDate = formatDdMmYyyy(i.flightDateISO);

    const fromToName = routeName(fromCode, toCode);
    const fromToIata = routeIata(fromCode, toCode);

    const tripLabel = `${prettyTrip(i.tripType)} (×${i.tripMultiplier})`;
    const cabinLabel = `${prettyCabin(i.cabinClass)} (×${Number(
      i.cabinMultiplier
    ).toFixed(1)})`;

    const haulFactor = `${i.haul} (${Number(i.baseFactor).toFixed(2)})`;

    const row = [
      i.employeeName,
      i.submittedSgt,
      flightDate,
      fromToName,
      fromToIata,
      tripLabel,
      cabinLabel,
      i.passengers,
      Number(i.greatCircleKm).toFixed(2),
      Number(i.upliftedOneWayKm).toFixed(2),
      haulFactor,
      Number(i.emissionsKg).toFixed(3),
    ]
      .map((v) => {
        const s = String(v ?? "");
        return s.includes(",") || s.includes('"') || s.includes("\n")
          ? `"${s.replaceAll('"', '""')}"`
          : s;
      })
      .join(",");

    lines.push(row);
  }

  return lines.join("\n");
}

function downloadCsv(filename, text) {
  const BOM = "\uFEFF"; // Excel UTF-8 BOM
  const blob = new Blob([BOM + text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

// =============================
// CSV Parser + Load Airports
// =============================
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        const next = text[i + 1];
        if (next === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (ch !== "\r") {
        field += ch;
      }
    }
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

async function loadAirports() {
  dbStatus.textContent = "Loading airport database…";

  const res = await fetch(`${AIRPORTS_CSV}?v=${Date.now()}`);
  if (!res.ok) {
    throw new Error(
      `Cannot load ${AIRPORTS_CSV}. Ensure it's beside index.html on GitHub Pages.`
    );
  }

  const text = await res.text();
  const rows = parseCsv(text);

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name) => header.indexOf(name);

  const iIata = idx("iata");
  const iLat = idx("lat");
  const iLon = idx("lon");
  const iName = idx("name");
  const iCity = idx("city");
  const iCountry = idx("country");

  if (iIata === -1 || iLat === -1 || iLon === -1) {
    throw new Error(
      "CSV must include columns: iata, lat, lon (optional: name, city, country)."
    );
  }

  const map = new Map();
  const search = [];

  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r];

    const code = String(cols[iIata] ?? "").trim().toUpperCase();
    const lat = Number(cols[iLat]);
    const lon = Number(cols[iLon]);

    if (!code || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (map.has(code)) continue;

    const name = iName >= 0 ? String(cols[iName] ?? "").trim() : "";
    const city = iCity >= 0 ? String(cols[iCity] ?? "").trim() : "";
    const country = iCountry >= 0 ? String(cols[iCountry] ?? "").trim() : "";

    map.set(code, { lat, lon, name, city, country });

    search.push({
      iata: code,
      name,
      city,
      country,
      hay: `${code} ${name} ${city} ${country}`.toUpperCase(),
    });
  }

  search.sort((a, b) => a.iata.localeCompare(b.iata));

  airportIndex = map;
  airportSearch = search;
  airportsReady = true;

  fromEl.disabled = false;
  toEl.disabled = false;
  fromEl.placeholder = "Origin (city/code)";
  toEl.placeholder = "Destination (city/code)";

  dbStatus.textContent = `Airport database loaded: ${airportIndex.size.toLocaleString()} airports.`;
}

// =============================
// Suggestions (FAST)
// =============================
function buildSuggestions(query) {
  const q = query.trim().toUpperCase();
  if (!q) return [];

  const out = [];
  for (let i = 0; i < airportSearch.length; i++) {
    const a = airportSearch[i];
    if (a.iata.startsWith(q) || a.hay.includes(q)) {
      out.push(a);
      if (out.length >= 12) break;
    }
  }

  out.sort((a, b) => {
    const ap = a.iata.startsWith(q) ? 0 : 1;
    const bp = b.iata.startsWith(q) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return a.iata.localeCompare(b.iata);
  });

  return out.slice(0, 12);
}

function hideSuggest(box) {
  box.style.display = "none";
  box.innerHTML = "";
}

function showSuggest(box, items, onPick) {
  if (!items.length) {
    hideSuggest(box);
    return;
  }

  box.innerHTML = items
    .map((it, idx) => {
      const sub = `${it.city || ""}${it.city && it.country ? ", " : ""}${
        it.country || ""
      }`.trim();

      const label = `${it.iata} - ${it.city || it.name || it.iata}`;

      return `
        <div class="item" role="option" data-label="${escapeHtml(
          label
        )}" data-idx="${idx}">
          <div class="top">
            <span class="code">${escapeHtml(it.iata)}</span>
            <span class="name">${escapeHtml(it.name || "Unknown Airport")}</span>
          </div>
          <div class="sub">${escapeHtml(sub || "—")}</div>
        </div>
      `;
    })
    .join("");

  box.style.display = "block";

  box.querySelectorAll(".item").forEach((el) => {
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const label = el.getAttribute("data-label") || "";
      onPick(label);
      hideSuggest(box);
    });
  });
}

function wireSuggest(inputEl, box) {
  let activeIndex = -1;

  inputEl.addEventListener("input", () => {
    if (!airportsReady) return;
    activeIndex = -1;
    const items = buildSuggestions(inputEl.value);
    showSuggest(box, items, (label) => (inputEl.value = label));
  });

  inputEl.addEventListener("focus", () => {
    if (!airportsReady) return;
    activeIndex = -1;
    const items = buildSuggestions(inputEl.value);
    showSuggest(box, items, (label) => (inputEl.value = label));
  });

  inputEl.addEventListener("blur", () => {
    setTimeout(() => hideSuggest(box), 120);
  });

  inputEl.addEventListener("keydown", (e) => {
    const items = Array.from(box.querySelectorAll(".item"));
    if (box.style.display !== "block" || !items.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
      items.forEach((i) => i.classList.remove("active"));
      items[activeIndex]?.classList.add("active");
      items[activeIndex]?.scrollIntoView({ block: "nearest" });
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      items.forEach((i) => i.classList.remove("active"));
      items[activeIndex]?.classList.add("active");
      items[activeIndex]?.scrollIntoView({ block: "nearest" });
    }

    if (e.key === "Enter") {
      const chosen = items[activeIndex];
      if (chosen) {
        e.preventDefault();
        const label = chosen.getAttribute("data-label") || "";
        inputEl.value = label;
        hideSuggest(box);
      }
    }

    if (e.key === "Escape") hideSuggest(box);
  });
}

// =============================
// Google Sheets logging (client)
// =============================
async function logToGoogleSheets(payload) {
  try {
    const body = JSON.stringify(payload);

    const ok = navigator.sendBeacon(
      SHEETS_WEBAPP_URL,
      new Blob([body], { type: "text/plain;charset=UTF-8" })
    );

    if (!ok) {
      await fetch(SHEETS_WEBAPP_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body,
        keepalive: true,
      });
    }
  } catch (err) {
    console.warn("Google Sheets logging failed:", err);
  }
}

// =============================
// Calculation
// =============================
function calculate({ fromCode, toCode, passengers, tripType, cabinClass }) {
  const A = airportIndex.get(fromCode);
  const B = airportIndex.get(toCode);

  if (!A || !B) return { error: "Airport code not found in database." };

  const greatCircleKm = haversineKm(A.lat, A.lon, B.lat, B.lon);
  const upliftedOneWayKm = greatCircleKm * 1.08;

  const haul = upliftedOneWayKm < 3700 ? "Short-haul" : "Long-haul";
  const baseFactor = haul === "Short-haul" ? 0.15 : 0.11;

  const cabinMultiplier = cabinMult(cabinClass);
  const adjustedFactor = baseFactor * cabinMultiplier;

  const tripMultiplier = tripMult(tripType);

  const totalEmissionsKg =
    upliftedOneWayKm * adjustedFactor * passengers * tripMultiplier;

  return {
    greatCircleKm,
    upliftedOneWayKm,
    haul,
    baseFactor,
    cabinMultiplier,
    adjustedFactor,
    tripMultiplier,
    totalEmissionsKg,
  };
}

// =============================
// Events
// =============================
form.addEventListener("submit", (e) => {
  e.preventDefault();

  if (!airportsReady) {
    alert("Airport database still loading. Try again in a moment.");
    return;
  }

  const employeeName = employeeNameEl.value.trim();
  const fromCode = extractIata(fromEl.value);
  const toCode = extractIata(toEl.value);
  const flightDateISO = flightDateEl.value;

  const passengers = Number(passengersEl.value);
  const tripType = tripTypeEl.value;
  const cabinClass = cabinClassEl.value;

  if (
    !employeeName ||
    !fromCode ||
    !toCode ||
    !flightDateISO ||
    !Number.isFinite(passengers) ||
    passengers < 1
  ) {
    alert("Fill in all fields. Use IATA codes like SIN, NRT, KUL.");
    return;
  }

  if (fromCode === toCode) {
    alert("Origin and destination cannot be the same.");
    return;
  }

  const r = calculate({ fromCode, toCode, passengers, tripType, cabinClass });
  if (r.error) {
    alert(r.error);
    return;
  }

  // Result display (story style)
  resultMain.textContent = `${r.totalEmissionsKg.toFixed(1)} kg CO₂e`;
  resultSub.textContent = `Uplifted distance ${r.upliftedOneWayKm.toFixed(
    0
  )} km · ${r.haul} factor ${r.baseFactor.toFixed(
    2
  )} × Cabin (×${r.cabinMultiplier.toFixed(1)}) × ${passengers} passenger${
    passengers > 1 ? "s" : ""
  } × ${prettyTrip(tripType)} (×${r.tripMultiplier})`;

  // Store local history
  const submittedSgt = nowSgt();
  const items = loadHistory();

  items.unshift({
    employeeName,
    submittedSgt,
    flightDateISO,
    from: fromCode,
    to: toCode,
    tripType,
    cabinClass,
    passengers,
    greatCircleKm: Number(r.greatCircleKm.toFixed(2)),
    upliftedOneWayKm: Number(r.upliftedOneWayKm.toFixed(2)),
    haul: r.haul,
    baseFactor: Number(r.baseFactor.toFixed(2)),
    cabinMultiplier: Number(r.cabinMultiplier.toFixed(1)),
    adjustedFactor: Number(r.adjustedFactor.toFixed(3)),
    tripMultiplier: r.tripMultiplier,
    emissionsKg: Number(r.totalEmissionsKg.toFixed(3)),
  });

  saveHistory(items);
  renderHistory();

  // Log to Google Sheets (payload fields EXACTLY as your Apps Script expects)
  const payload = {
    secret: "flight-carbon-emission-tracker",
    employee: employeeName,
    submittedSgt,
    flightDate: formatDdMmYyyy(flightDateISO),
    fromToName: routeName(fromCode, toCode),
    fromToIata: routeIata(fromCode, toCode),
    tripTypeLabel: `${prettyTrip(tripType)} (x${r.tripMultiplier})`,
    cabinClassLabel: `${prettyCabin(cabinClass)} (x${Number(
      r.cabinMultiplier
    ).toFixed(1)})`,
    passengers,
    greatCircleKm: Number(r.greatCircleKm.toFixed(2)),
    upliftedDistanceKm: Number(r.upliftedOneWayKm.toFixed(2)),
    haulBaseFactor: `${r.haul} (${Number(r.baseFactor).toFixed(2)})`,
    totalEmissionsKg: Number(r.totalEmissionsKg.toFixed(3)),
  };

  logToGoogleSheets(payload);

  hideSuggest(fromSuggest);
  hideSuggest(toSuggest);
});

resetBtn.addEventListener("click", () => {
  form.reset();
  flightDateEl.valueAsDate = new Date();
  resultMain.textContent = "Ready to calculate";
  resultSub.textContent = "Enter IATA codes to estimate emissions.";
  hideSuggest(fromSuggest);
  hideSuggest(toSuggest);
});

clearHistoryBtn.addEventListener("click", () => {
  if (!confirm("Clear all history entries?")) return;
  saveHistory([]);
  renderHistory();
});

exportCsvBtn.addEventListener("click", () => {
  const items = loadHistory();
  if (!items.length) {
    alert("No entries to export yet.");
    return;
  }
  const filename = `flight-footprint-${nowForFilename()}.csv`;
  downloadCsv(filename, toCsv(items));
});

// =============================
// Init
// =============================
renderHistory();
wireSuggest(fromEl, fromSuggest);
wireSuggest(toEl, toSuggest);

loadAirports().catch((err) => {
  console.error(err);
  dbStatus.textContent = "Airport database failed to load.";
  alert(err.message);
});
