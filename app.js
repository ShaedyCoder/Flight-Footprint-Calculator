// =============================
// Flight Footprint Calculator
// =============================
console.log("APP.JS VERSION:", "2025-12-30 22:30");

const AIRPORTS_CSV = "airports_iata_latlon.csv";
const STORAGE_KEY = "flight_history_v1";

// ---- Google Sheets Web App ----
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
let airportIndex = new Map();   // IATA -> {lat, lon, name, city, country}
let airportSearch = [];        // fast search array

// =============================
// Init defaults
// =============================
flightDateEl.valueAsDate = new Date();
fromEl.disabled = true;
toEl.disabled = true;
fromEl.placeholder = "Loading airports…";
toEl.placeholder = "Loading airports…";

// =============================
// Helpers
// =============================
const pad2 = (n) => String(n).padStart(2, "0");

function extractIata(v) {
  const m = String(v || "").toUpperCase().match(/[A-Z0-9]{3}/);
  return m ? m[0] : "";
}

function nowSgt() {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const g = (t) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("day")}-${g("month")}-${g("year")} ${g("hour")}:${g("minute")} SGT`;
}

function formatDdMmYyyy(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${pad2(d)}-${pad2(m)}-${y}`;
}

const toRad = (d) => (d * Math.PI) / 180;
function haversineKm(a, b) {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) *
      Math.cos(toRad(b.lat)) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

const cabinMult = (c) =>
  ({ premium: 1.2, business: 1.5, first: 2.0 }[c] || 1.0);

const tripMult = (t) => (t === "round-trip" ? 2 : 1);

const prettyCabin = (c) =>
  ({
    premium: "Premium Economy",
    business: "Business Class",
    first: "First Class",
  }[c] || "Economy");

const prettyTrip = (t) => (t === "round-trip" ? "Round Trip" : "One Way");

const escapeHtml = (s) =>
  String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

// =============================
// Local storage
// =============================
const loadHistory = () =>
  JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");

const saveHistory = (v) =>
  localStorage.setItem(STORAGE_KEY, JSON.stringify(v));

// =============================
// Render history
// =============================
function renderHistory() {
  const items = loadHistory();
  historyTbody.innerHTML = "";
  emptyState.style.display = items.length ? "none" : "block";

  items.forEach((i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(i.employeeName)}</td>
      <td>${escapeHtml(i.submittedSgt)}</td>
      <td>${escapeHtml(i.from)} → ${escapeHtml(i.to)}</td>
      <td>${prettyCabin(i.cabinClass)} · ${prettyTrip(i.tripType)} · ${i.passengers} pax</td>
      <td class="right">${i.emissionsKg.toFixed(1)}</td>
    `;
    historyTbody.appendChild(tr);
  });
}

// =============================
// CSV export
// =============================
function exportCsv() {
  const items = loadHistory();
  if (!items.length) return alert("No entries to export.");

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

  const rows = items.map((i) => [
    i.employeeName,
    i.submittedSgt,
    formatDdMmYyyy(i.flightDateISO),
    `${i.from} – ${i.to}`,
    `${i.from} – ${i.to}`,
    `${prettyTrip(i.tripType)} (×${i.tripMultiplier})`,
    `${prettyCabin(i.cabinClass)} (×${i.cabinMultiplier})`,
    i.passengers,
    i.greatCircleKm,
    i.upliftedOneWayKm,
    `${i.haul} (${i.baseFactor})`,
    i.emissionsKg,
  ]);

  const csv =
    "\uFEFF" +
    [headers, ...rows]
      .map((r) =>
        r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",")
      )
      .join("\n");

  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `flight-footprint-${Date.now()}.csv`;
  a.click();
}

// =============================
// Airport loading
// =============================
async function loadAirports() {
  dbStatus.textContent = "Loading airport database…";
  const res = await fetch(`${AIRPORTS_CSV}?v=${Date.now()}`);
  if (!res.ok) throw new Error("Airport CSV not found.");

  const text = await res.text();
  const lines = text.split("\n").slice(1);

  lines.forEach((l) => {
    const [iata, lat, lon, name, city, country] = l.split(",");
    if (!iata || !lat || !lon) return;

    airportIndex.set(iata, {
      lat: +lat,
      lon: +lon,
      name,
      city,
      country,
    });

    airportSearch.push({
      iata,
      hay: `${iata} ${name} ${city} ${country}`.toUpperCase(),
    });
  });

  airportsReady = true;
  fromEl.disabled = false;
  toEl.disabled = false;
  fromEl.placeholder = "Origin (city or IATA)";
  toEl.placeholder = "Destination (city or IATA)";
  dbStatus.textContent = `Loaded ${airportIndex.size} airports`;
}

// =============================
// Suggestions
// =============================
function wireSuggest(input, box) {
  input.addEventListener("input", () => {
    const q = input.value.toUpperCase().trim();
    if (!q) return (box.innerHTML = "");

    box.innerHTML = airportSearch
      .filter((a) => a.hay.includes(q))
      .slice(0, 10)
      .map(
        (a) => `<div class="item" data-iata="${a.iata}">${a.iata}</div>`
      )
      .join("");

    box.querySelectorAll(".item").forEach((el) => {
      el.onclick = () => {
        input.value = el.dataset.iata;
        box.innerHTML = "";
      };
    });
  });

  input.addEventListener("blur", () =>
    setTimeout(() => (box.innerHTML = ""), 150)
  );
}

// =============================
// Google Sheets logging
// =============================
function logToSheets(payload) {
  try {
    const body = JSON.stringify(payload);

    // best-effort (doesn't block page)
    const ok = navigator.sendBeacon(
      SHEETS_WEBAPP_URL,
      new Blob([body], { type: "text/plain;charset=UTF-8" })
    );

    // fallback
    if (!ok) {
      fetch(SHEETS_WEBAPP_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  } catch (e) {
    console.warn("Sheets logging failed:", e);
  }
}

// =============================
// Submit
// =============================
form.addEventListener("submit", (e) => {
  e.preventDefault();

  const from = extractIata(fromEl.value);
  const to = extractIata(toEl.value);

  if (!airportIndex.has(from) || !airportIndex.has(to))
    return alert("Invalid airport code.");

  const A = airportIndex.get(from);
  const B = airportIndex.get(to);

  const great = haversineKm(A, B);
  const uplifted = great * 1.08;
  const haul = uplifted < 3700 ? "Short-haul" : "Long-haul";
  const baseFactor = haul === "Short-haul" ? 0.15 : 0.11;

  const cabinMultiplier = cabinMult(cabinClassEl.value);
  const tripMultiplier = tripMult(tripTypeEl.value);

  const total =
    uplifted *
    baseFactor *
    cabinMultiplier *
    tripMultiplier *
    passengersEl.value;

  resultMain.textContent = `${total.toFixed(1)} kg CO₂e`;
  resultSub.textContent = `${uplifted.toFixed(
    0
  )} km · ${haul} · ${prettyCabin(cabinClassEl.value)}`;

  const history = loadHistory();
  history.unshift({
    employeeName: employeeNameEl.value,
    submittedSgt: nowSgt(),
    flightDateISO: flightDateEl.value,
    from,
    to,
    passengers: +passengersEl.value,
    tripType: tripTypeEl.value,
    cabinClass: cabinClassEl.value,
    greatCircleKm: +great.toFixed(2),
    upliftedOneWayKm: +uplifted.toFixed(2),
    haul,
    baseFactor,
    cabinMultiplier,
    tripMultiplier,
    emissionsKg: +total.toFixed(3),
  });

  saveHistory(history);
  renderHistory();
  const payload = {
  secret: "flight-carbon-emission-tracker",
  employee: employeeNameEl.value.trim(),
  submittedSgt: nowSgt(),
  flightDate: formatDdMmYyyy(flightDateEl.value),
  fromToName: `${from} – ${to}`,       // or swap to city names if you prefer
  fromToIata: `${from} – ${to}`,
  tripTypeLabel: `${prettyTrip(tripTypeEl.value)} (x${tripMultiplier})`,
  cabinClassLabel: `${prettyCabin(cabinClassEl.value)} (x${cabinMultiplier.toFixed(1)})`,
  passengers: Number(passengersEl.value),
  greatCircleKm: Number(great.toFixed(2)),
  upliftedDistanceKm: Number(uplifted.toFixed(2)),
  haulBaseFactor: `${haul} (${baseFactor.toFixed(2)})`,
  totalEmissionsKg: Number(total.toFixed(3)),
};

logToSheets(payload);

});

// =============================
// Buttons
// =============================
resetBtn.onclick = () => form.reset();
clearHistoryBtn.onclick = () => {
  if (confirm("Clear all history?")) {
    saveHistory([]);
    renderHistory();
  }
};
exportCsvBtn.onclick = exportCsv;

// =============================
// Init
// =============================
renderHistory();
wireSuggest(fromEl, fromSuggest);
wireSuggest(toEl, toSuggest);
loadAirports().catch((e) => {
  console.error(e);
  alert(e.message);
});
