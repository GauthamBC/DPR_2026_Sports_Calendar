const HIGHLIGHTS = document.getElementById("highlights");
const MONTH_TITLE = document.getElementById("monthTitle");

/**
 * Your published URL:
 * https://docs.google.com/spreadsheets/d/e/2PACX-1vSTuRExRSKpKiorPUADig1yYm5_ye3jLG-5TcQ4Uhz07qgx-1mIkkhtEsFky9FpRd0QczIl2xEBYEd8/pubhtml
 *
 * IMPORTANT:
 * - Set F1_RACE_GID to the gid of your "F1_race" tab.
 * - If you leave it null, Google may default to first published tab.
 */
const SHEET_PUBHTML_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSTuRExRSKpKiorPUADig1yYm5_ye3jLG-5TcQ4Uhz07qgx-1mIkkhtEsFky9FpRd0QczIl2xEBYEd8/pubhtml";

// <-- put the F1_race tab gid here (number as string), e.g. "123456789"
const F1_RACE_GID = null;

let allEvents = [];
let calendar;
let f1Groups = [];

// ---------- tiny utils ----------
function toDate(d) { return new Date(d); }

function startOfDay(dt){
  const d = new Date(dt);
  d.setHours(0,0,0,0);
  return d;
}

function yyyymm(d){
  return `${d.getFullYear()}-${d.getMonth()}`; // month is 0-based
}

function normalizeKey(s){
  return (s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(s){
  return (s || "")
    .split(" ")
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function formatRange(start, end) {
  const s = new Date(start);
  const e = new Date(end);

  const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
  const opts = { month: "short", day: "numeric" };
  const optsY = { year: "numeric" };

  const sTxt = s.toLocaleDateString(undefined, opts);
  const eTxt = e.toLocaleDateString(undefined, opts);
  const yearTxt = s.toLocaleDateString(undefined, optsY);

  if (s.toDateString() === e.toDateString()) return `${sTxt}, ${yearTxt}`;
  if (sameMonth) return `${sTxt}–${e.getDate()}, ${yearTxt}`;
  return `${sTxt} – ${eTxt}, ${yearTxt}`;
}

// ---------- Google Sheets CSV URL ----------
function buildCsvUrlFromPubhtml(pubhtmlUrl, gid = null) {
  // Convert .../pubhtml -> .../pub
  const base = pubhtmlUrl.replace(/\/pubhtml(\?.*)?$/i, "/pub");
  const u = new URL(base);

  u.searchParams.set("output", "csv");
  u.searchParams.set("single", "true");
  if (gid !== null && gid !== undefined && String(gid).trim() !== "") {
    u.searchParams.set("gid", String(gid).trim());
  }
  // cache bust
  u.searchParams.set("t", String(Date.now()));

  return u.toString();
}

// ---------- CSV parser ----------
function parseCSV(text) {
  const rows = [];
  let i = 0, field = "", row = [], inQuotes = false;

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }

    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }

    field += c; i++;
  }

  if (field.length || row.length) { row.push(field); rows.push(row); }

  if (!rows.length) return [];
  const headers = rows[0].map(h => h.trim());

  return rows.slice(1)
    .filter(r => r.some(x => String(x ?? "").trim() !== ""))
    .map(r => {
      const obj = {};
      headers.forEach((h, idx) => obj[h] = (r[idx] ?? "").trim());
      return obj;
    });
}

// ---------- F1 logic ----------
function getSessionKind(title){
  const t = normalizeKey(title);
  if (t.includes("sprint qualification") || t.includes("sprint qualifying")) return "sprint qualifying";
  if (t.includes("sprint race")) return "sprint race";
  if (t.includes("sprint")) return "sprint";
  if (t.includes("qualifying")) return "qualifying";
  if (/\brace\b/.test(t)) return "race";
  if (t.includes("practice") || /\bfp\s*\d+\b/.test(t)) return "practice";
  return "other";
}

function canonicalGpNameFromLocation(location, title){
  const loc = normalizeKey(location);
  const t = normalizeKey(title);

  if (t.includes("testing")) return "Testing";
  if (t.includes("in your calendar")) return null;

  // location-first mapping (most reliable)
  if (loc.includes("australia")) return "Australian Grand Prix";
  if (loc.includes("china")) return "Chinese Grand Prix";
  if (loc.includes("japan")) return "Japanese Grand Prix";
  if (loc.includes("bahrain")) return "Bahrain Grand Prix";
  if (loc.includes("saudi")) return "Saudi Arabian Grand Prix";
  if (loc.includes("canada")) return "Canadian Grand Prix";
  if (loc.includes("monaco")) return "Monaco Grand Prix";
  if (loc.includes("spain")) return "Spanish Grand Prix";
  if (loc.includes("austria")) return "Austrian Grand Prix";
  if (loc.includes("united kingdom")) return "British Grand Prix";
  if (loc.includes("belgium")) return "Belgian Grand Prix";
  if (loc.includes("hungary")) return "Hungarian Grand Prix";
  if (loc.includes("netherlands")) return "Dutch Grand Prix";
  if (loc.includes("italy")) return "Italian Grand Prix";
  if (loc.includes("azerbaijan")) return "Azerbaijan Grand Prix";
  if (loc.includes("singapore")) return "Singapore Grand Prix";
  if (loc.includes("mexico")) return "Mexico City Grand Prix";
  if (loc.includes("brazil")) return "São Paulo Grand Prix";
  if (loc.includes("qatar")) return "Qatar Grand Prix";
  if (loc.includes("united arab emirates")) return "Abu Dhabi Grand Prix";

  if (loc.includes("united states")) {
    if (t.includes("miami")) return "Miami Grand Prix";
    if (t.includes("las vegas")) return "Las Vegas Grand Prix";
    return "United States Grand Prix";
  }

  // title fallback (handles missing location)
  if (t.includes("monaco")) return "Monaco Grand Prix";
  if (t.includes("italia") || t.includes("italian") || t.includes("italy") || t.includes("monza")) return "Italian Grand Prix";
  if (t.includes("espana") || t.includes("españa") || t.includes("barcelona") || t.includes("spain") || t.includes("spanish")) return "Spanish Grand Prix";
  if (t.includes("azerbaijan") || t.includes("baku")) return "Azerbaijan Grand Prix";
  if (t.includes("grand prix")) {
    const cleaned = title.replace(/[🏎🏁⏱️]/g, "");
    const m = cleaned.match(/([A-Za-zÀ-ÿ'’\-\s]+)\s+grand\s+prix/i);
    if (m) return `${titleCase(m[1].trim())} Grand Prix`;
  }

  return null;
}

function buildF1Groups(events){
  // 1) collect normalized F1 rows first
  const rows = [];

  for (const e of events) {
    if (normalizeKey(e.sport) !== "f1") continue;
    if (/in your calendar/i.test(e.title || "")) continue;

    const gpName = canonicalGpNameFromLocation(e.location, e.title);
    if (!gpName) continue;

    const day = startOfDay(new Date(e.start));
    if (isNaN(day)) continue;

    rows.push({
      ...e,
      _gpName: gpName,
      _gpKey: normalizeKey(gpName),
      _day: day,
      _kind: getSessionKind(e.title)
    });
  }

  // 2) sort by gp name then date
  rows.sort((a, b) => {
    if (a._gpKey < b._gpKey) return -1;
    if (a._gpKey > b._gpKey) return 1;
    return a._day - b._day;
  });

  // 3) split into temporal clusters per gp key (gap > 10 days => new weekend group)
  const GAP_DAYS = 10;
  const groups = [];
  let current = null;

  function startGroup(r){
    return {
      sport: "F1",
      title: r._gpName,
      gpKey: r._gpKey,
      items: [],
      start: r._day,
      end: r._day,
      _hasRace: false,
      _hasQuali: false,
      _hasSprint: false,
      _dedupe: new Set()
    };
  }

  for (const r of rows) {
    if (!current) {
      current = startGroup(r);
    } else {
      const lastItem = current.items[current.items.length - 1];
      const sameGp = current.gpKey === r._gpKey;
      const gapMs = r._day - startOfDay(new Date(lastItem.start));
      const gapDays = gapMs / (1000 * 60 * 60 * 24);

      if (!sameGp || gapDays > GAP_DAYS) {
        groups.push(current);
        current = startGroup(r);
      }
    }

    const dedupeKey = `${r._day.toISOString().slice(0,10)}||${r._kind}||${normalizeKey(r.title)}`;
    if (!current._dedupe.has(dedupeKey)) {
      current._dedupe.add(dedupeKey);
      current.items.push(r);

      if (r._day < current.start) current.start = r._day;
      if (r._day > current.end) current.end = r._day;

      if (r._kind === "race") current._hasRace = true;
      if (r._kind === "qualifying" || r._kind === "sprint qualifying") current._hasQuali = true;
      if (r._kind.includes("sprint")) current._hasSprint = true;
    }
  }
  if (current) groups.push(current);

  // 4) anchor month by race date (or earliest date if no race)
  const finalized = groups.map(g => {
    const raceDates = g.items
      .filter(x => getSessionKind(x.title) === "race")
      .map(x => startOfDay(new Date(x.start)))
      .sort((a,b) => a - b);

    const anchor = raceDates.length ? raceDates[0] : g.start;
    g.anchorDate = anchor;
    g.primaryMonth = `${anchor.getFullYear()}-${anchor.getMonth()}`;
    delete g._dedupe;
    delete g.gpKey;
    return g;
  });

  // 5) sort timeline
  finalized.sort((a,b) => a.anchorDate - b.anchorDate);
  return finalized;
}

// ---------- render ----------
function renderHighlights(monthStart) {
  HIGHLIGHTS.innerHTML = "";
  const monthName = monthStart.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  MONTH_TITLE.textContent = `Monthly highlights — ${monthName}`;

  const monthKey = yyyymm(monthStart);

  const groups = f1Groups
    .filter(g => g.primaryMonth === monthKey)
    .slice(0, 8);

  if (!groups.length) {
    HIGHLIGHTS.innerHTML = `<div class="card"><div class="title">No highlights found</div><div class="meta">Try another month.</div></div>`;
    return;
  }

  for (const g of groups) {
    const flags = [];
    if (g._hasRace) flags.push("Race");
    if (g._hasQuali) flags.push("Quali");
    if (g._hasSprint) flags.push("Sprint");

    const safeTitle = String(g.title || "").replace(/^[🏁🏎️⏱️\s]+/g, "");

    const card = document.createElement("div");
    card.className = "card f1";
    card.innerHTML = `
      <div class="title">🏎️ ${safeTitle}</div>
      <div class="meta">
        <span class="pill-date pill-f1">📅 ${formatRange(g.start, g.end)}</span>
        <span class="pill">🔥 F1${flags.length ? ` • ${flags.join(" / ")}` : ""}</span>
      </div>
    `;
    HIGHLIGHTS.appendChild(card);
  }
}

// ---------- load ----------
async function loadEvents() {
  try {
    const csvUrl = buildCsvUrlFromPubhtml(SHEET_PUBHTML_URL, F1_RACE_GID);
    const res = await fetch(csvUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`CSV fetch failed (${res.status})`);

    const csvText = await res.text();
    const records = parseCSV(csvText);

    allEvents = records
      .map(r => ({
        title: r.title || "",
        start: r.start || "",
        end: r.end || "",
        sport: r.sport || "",
        source: r.source || "",
        location: r.location || ""
      }))
      .filter(e => e.title && e.start)
      .filter(e => normalizeKey(e.sport) === "f1"); // enforce F1 only

    f1Groups = buildF1Groups(allEvents);
    initCalendar();
  } catch (err) {
    console.error(err);
    HIGHLIGHTS.innerHTML = `<div class="card"><div class="title">Error loading data</div><div class="meta">${String(err.message || err)}</div></div>`;
  }
}

function initCalendar() {
  const el = document.getElementById("calendar");
  calendar = new FullCalendar.Calendar(el, {
    initialView: "dayGridMonth",
    height: "auto",
    displayEventTime: false,
    dayMaxEvents: true,
    showNonCurrentDates: false,
    fixedWeekCount: false,

    events: allEvents.map(e => ({
      title: e.title,
      start: e.start,
      end: e.end || null,
      extendedProps: { sport: e.sport, source: e.source, location: e.location }
    })),

    datesSet(info) {
      renderHighlights(info.view.currentStart);
    },

    eventDidMount(info) {
      const sport = info.event.extendedProps.sport;
      if (normalizeKey(sport) === "f1") info.el.style.borderColor = "#e10600";
    }
  });

  calendar.render();
}

loadEvents();
