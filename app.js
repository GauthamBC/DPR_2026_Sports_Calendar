/* app.js — DPR 2026 Sports Calendar (multi-tab, Google Sheets published CSV per sport) */

/* ========= CONFIG =========
   Put your published CSV URL for each sport tab.
   If a URL is blank, that tab is hidden automatically.
*/
const SPORT_SHEETS = [
  {
    key: "f1",
    label: "F1",
    csvUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSTuRExRSKpKiorPUADig1yYm5_ye3jLG-5TcQ4Uhz07qgx-1mIkkhtEsFky9FpRd0QczIl2xEBYEd8/pub?output=csv&gid=0",
    columns: {
      title: ["title", "event", "race", "name"],
      start: ["start", "start_date", "date", "start time", "start_datetime", "datetime"],
      end:   ["end", "end_date", "end time", "end_datetime", "finish"],
      location: ["location", "venue", "country", "city"]
    }
  },
  { key: "nascar", label: "NASCAR", csvUrl: "", columns: { title:["title","event","race","name","matchup"], start:["start","date","start_date","datetime","kickoff"], end:["end","end_date","end_datetime"], location:["location","venue","track","city"] } },
  { key: "nfl",    label: "NFL",    csvUrl: "", columns: { title:["title","event","game","matchup","name"], start:["start","date","kickoff","start_date","datetime"], end:["end","end_date","end_datetime"], location:["location","venue","stadium","city"] } },
  { key: "nhl",    label: "NHL",    csvUrl: "", columns: { title:["title","event","game","matchup","name"], start:["start","date","puck drop","start_date","datetime"], end:["end","end_date","end_datetime"], location:["location","venue","arena","city"] } },
  { key: "nba",    label: "NBA",    csvUrl: "", columns: { title:["title","event","game","matchup","name"], start:["start","date","tipoff","start_date","datetime"], end:["end","end_date","end_datetime"], location:["location","venue","arena","city"] } },
  { key: "mlb",    label: "MLB",    csvUrl: "", columns: { title:["title","event","game","matchup","name"], start:["start","date","first pitch","start_date","datetime"], end:["end","end_date","end_datetime"], location:["location","venue","ballpark","city"] } },
  { key: "other",  label: "Other",  csvUrl: "", columns: { title:["title","event","name"], start:["start","date","start_date","datetime"], end:["end","end_date","end_datetime"], location:["location","venue","city"] } }
];

const SPORT_ORDER = ["f1", "nascar", "nfl", "nhl", "nba", "mlb", "other"];
const SPORT_LABELS = {
  f1: "F1", nascar: "NASCAR", nfl: "NFL", nhl: "NHL", nba: "NBA", mlb: "MLB", other: "Other"
};

/* ========= DOM ========= */
const HIGHLIGHTS = document.getElementById("highlights");
const MONTH_TITLE = document.getElementById("monthTitle");
const APP_TITLE = document.getElementById("appTitle");
const SPORT_TABS = document.getElementById("sportTabs");

/* ========= STATE ========= */
let allEvents = [];
let groupedBySport = {};
let selectedSport = "f1";
let calendar = null;

/* ========= HELPERS ========= */
function normalizeKey(s) {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function cleanHeader(s) { return normalizeKey(String(s || "")); }
function monthKeyFromDate(d) { return `${d.getFullYear()}-${d.getMonth()}`; }
function startOfDay(input) { const d = new Date(input); d.setHours(0, 0, 0, 0); return d; }
function prettySport(k) { return SPORT_LABELS[k] || "Other"; }
function iconForSport(k) {
  return { f1:"🏎️", nascar:"🏁", nfl:"🏈", nhl:"🏒", nba:"🏀", mlb:"⚾", other:"🎯" }[k] || "🎯";
}
function formatRange(start, end) {
  const s = new Date(start);
  const e = end ? new Date(end) : new Date(start);
  const sameDay = s.toDateString() === e.toDateString();
  const sameMonthYear = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
  const sTxt = s.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const eTxt = e.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const yTxt = s.toLocaleDateString(undefined, { year: "numeric" });

  if (sameDay) return `${sTxt}, ${yTxt}`;
  if (sameMonthYear) return `${sTxt}–${e.getDate()}, ${yTxt}`;
  return `${sTxt} – ${eTxt}, ${yTxt}`;
}

function parseDateFlexible(v) {
  if (!v) return null;
  const raw = String(v).trim();
  if (!raw) return null;

  // ISO / RFC
  const d1 = new Date(raw);
  if (!Number.isNaN(d1.getTime())) return d1;

  // DD/MM/YYYY, MM/DD/YYYY (+ optional HH:mm)
  const m = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (m) {
    let a = parseInt(m[1], 10), b = parseInt(m[2], 10), y = parseInt(m[3], 10);
    if (y < 100) y += 2000;
    const hh = m[4] ? parseInt(m[4], 10) : 0;
    const mm = m[5] ? parseInt(m[5], 10) : 0;

    let month = a, day = b;
    if (a > 12) { day = a; month = b; } // interpret as DD/MM

    const d2 = new Date(y, month - 1, day, hh, mm);
    if (!Number.isNaN(d2.getTime())) return d2;
  }

  return null;
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let i = 0;
  let inQuotes = false;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }

    field += ch;
    i++;
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  if (!rows.length) return [];

  const headers = rows[0].map((h) => String(h || "").trim());
  return rows.slice(1)
    .filter((r) => r.some((x) => String(x ?? "").trim() !== ""))
    .map((r) => {
      const obj = {};
      headers.forEach((h, idx) => obj[h] = (r[idx] ?? "").trim());
      return obj;
    });
}

function findColumnKey(record, aliases) {
  const keys = Object.keys(record || {});
  const cleaned = keys.map((k) => cleanHeader(k));
  for (const alias of aliases || []) {
    const a = cleanHeader(alias);
    const idx = cleaned.indexOf(a);
    if (idx >= 0) return keys[idx];
  }
  return null;
}

/* ========= GROUPING ========= */
function getSessionKind(title) {
  const t = normalizeKey(title);
  if (t.includes("sprint qualification") || t.includes("sprint qualifying")) return "sprint qualifying";
  if (t.includes("sprint race")) return "sprint race";
  if (t.includes("sprint")) return "sprint";
  if (t.includes("qualifying")) return "qualifying";
  if (/\brace\b/.test(t)) return "race";
  if (t.includes("practice") || /\bfp\s*\d+\b/.test(t)) return "practice";
  return "other";
}

function canonicalF1Name(location, title) {
  const loc = normalizeKey(location);
  const t = normalizeKey(title);

  if (!title) return null;
  if (t.includes("in your calendar")) return null;
  if (t.includes("testing")) return "Testing";

  const map = [
    ["australia","Australian Grand Prix"], ["china","Chinese Grand Prix"], ["japan","Japanese Grand Prix"],
    ["bahrain","Bahrain Grand Prix"], ["saudi","Saudi Arabian Grand Prix"], ["canada","Canadian Grand Prix"],
    ["monaco","Monaco Grand Prix"], ["spain","Spanish Grand Prix"], ["austria","Austrian Grand Prix"],
    ["united kingdom","British Grand Prix"], ["belgium","Belgian Grand Prix"], ["hungary","Hungarian Grand Prix"],
    ["netherlands","Dutch Grand Prix"], ["italy","Italian Grand Prix"], ["azerbaijan","Azerbaijan Grand Prix"],
    ["singapore","Singapore Grand Prix"], ["mexico","Mexico City Grand Prix"], ["brazil","São Paulo Grand Prix"],
    ["qatar","Qatar Grand Prix"], ["united arab emirates","Abu Dhabi Grand Prix"]
  ];
  for (const [needle, out] of map) if (loc.includes(needle)) return out;

  if (loc.includes("united states")) {
    if (t.includes("miami")) return "Miami Grand Prix";
    if (t.includes("las vegas")) return "Las Vegas Grand Prix";
    return "United States Grand Prix";
  }

  if (t.includes("grand prix")) {
    const cleaned = (title || "").replace(/[🏎🏁⏱️]/g, "").trim();
    const m = cleaned.match(/([A-Za-zÀ-ÿ'’\-\s]+)\s+grand\s+prix/i);
    if (m?.[1]) return `${m[1].trim()} Grand Prix`;
  }

  return title || "F1 Event";
}

function genericSeriesName(e) {
  const t = (e.title || "").replace(/[🏎🏁⏱️🏈🏒🏀⚾]/g, "").trim();
  return t || `${prettySport(e.sportKey)} Event`;
}

function buildGroupedHighlights(events) {
  const bySport = {};
  for (const k of SPORT_ORDER) bySport[k] = [];

  // F1: group sessions into one race weekend card
  const f1Rows = events
    .filter((e) => e.sportKey === "f1")
    .map((e) => ({
      ...e,
      _name: canonicalF1Name(e.location, e.title),
      _key: normalizeKey(canonicalF1Name(e.location, e.title)),
      _day: startOfDay(e.start),
      _kind: getSessionKind(e.title)
    }))
    .filter((x) => x._name && !Number.isNaN(x._day.getTime()))
    .sort((a, b) => (a._key < b._key ? -1 : a._key > b._key ? 1 : a._day - b._day));

  const GAP_DAYS = 10;
  const f1Groups = [];
  let g = null;

  const newGroup = (r) => ({
    sportKey: "f1",
    title: r._name,
    start: r._day,
    end: r._day,
    items: [],
    _key: r._key,
    _hasRace: false,
    _hasQuali: false,
    _hasSprint: false,
    _dedupe: new Set()
  });

  for (const r of f1Rows) {
    if (!g) g = newGroup(r);
    else {
      const last = g.items[g.items.length - 1];
      const gap = (r._day - startOfDay(last.start)) / 86400000;
      if (g._key !== r._key || gap > GAP_DAYS) {
        f1Groups.push(g);
        g = newGroup(r);
      }
    }

    const dedupe = `${r._day.toISOString().slice(0,10)}|${r._kind}|${normalizeKey(r.title)}`;
    if (g._dedupe.has(dedupe)) continue;
    g._dedupe.add(dedupe);

    g.items.push(r);
    if (r._day < g.start) g.start = r._day;
    if (r._day > g.end) g.end = r._day;
    if (r._kind === "race") g._hasRace = true;
    if (r._kind === "qualifying" || r._kind === "sprint qualifying") g._hasQuali = true;
    if (r._kind.includes("sprint")) g._hasSprint = true;
  }
  if (g) f1Groups.push(g);

  bySport.f1 = f1Groups
    .map((x) => {
      const raceDates = x.items
        .filter((i) => getSessionKind(i.title) === "race")
        .map((i) => startOfDay(i.start))
        .sort((a, b) => a - b);
      const anchor = raceDates.length ? raceDates[0] : x.start;

      return {
        sportKey: "f1",
        title: x.title,
        start: x.start,
        end: x.end,
        anchorDate: anchor,
        primaryMonth: monthKeyFromDate(anchor),
        flags: [
          x._hasRace ? "Race" : null,
          x._hasQuali ? "Quali" : null,
          x._hasSprint ? "Sprint" : null
        ].filter(Boolean)
      };
    })
    .sort((a, b) => a.anchorDate - b.anchorDate);

  // Other sports: generic grouping by similar name + proximity
  const others = events.filter((e) => e.sportKey !== "f1");
  const by = {};
  for (const e of others) {
    if (!by[e.sportKey]) by[e.sportKey] = [];
    by[e.sportKey].push({
      ...e,
      _name: genericSeriesName(e),
      _key: normalizeKey(genericSeriesName(e)),
      _day: startOfDay(e.start)
    });
  }

  for (const [sport, arr] of Object.entries(by)) {
    arr.sort((a, b) => (a._key < b._key ? -1 : a._key > b._key ? 1 : a._day - b._day));

    const groups = [];
    let cg = null;
    for (const r of arr) {
      if (!cg) {
        cg = { sportKey: sport, title: r._name, start: r._day, end: r._day, items: [r], _key: r._key };
      } else {
        const last = cg.items[cg.items.length - 1];
        const gap = (r._day - startOfDay(last.start)) / 86400000;
        if (cg._key !== r._key || gap > 14) {
          groups.push(cg);
          cg = { sportKey: sport, title: r._name, start: r._day, end: r._day, items: [r], _key: r._key };
        } else {
          cg.items.push(r);
          if (r._day < cg.start) cg.start = r._day;
          if (r._day > cg.end) cg.end = r._day;
        }
      }
    }
    if (cg) groups.push(cg);

    bySport[sport] = groups
      .map((x) => ({
        sportKey: sport,
        title: x.title,
        start: x.start,
        end: x.end,
        anchorDate: x.start,
        primaryMonth: monthKeyFromDate(x.start),
        flags: []
      }))
      .sort((a, b) => a.anchorDate - b.anchorDate);
  }

  return bySport;
}

/* ========= LOADER ========= */
async function fetchSportSheet(cfg) {
  if (!cfg.csvUrl) return [];

  const url = cfg.csvUrl + (cfg.csvUrl.includes("?") ? "&" : "?") + "t=" + Date.now();
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${cfg.label}: CSV fetch failed (${res.status})`);

  const rows = parseCSV(await res.text());
  if (!rows.length) return [];

  const sample = rows[0];
  const titleKey = findColumnKey(sample, cfg.columns.title);
  const startKey = findColumnKey(sample, cfg.columns.start);
  const endKey = findColumnKey(sample, cfg.columns.end);
  const locationKey = findColumnKey(sample, cfg.columns.location);

  if (!titleKey || !startKey) {
    console.warn(`${cfg.label}: missing required columns (title/start).`);
    return [];
  }

  const out = [];
  for (const r of rows) {
    const title = String(r[titleKey] || "").trim();
    const startRaw = String(r[startKey] || "").trim();
    const endRaw = endKey ? String(r[endKey] || "").trim() : "";
    const location = locationKey ? String(r[locationKey] || "").trim() : "";

    if (!title || !startRaw) continue;
    const sDate = parseDateFlexible(startRaw);
    if (!sDate) continue;
    const eDate = endRaw ? parseDateFlexible(endRaw) : null;

    out.push({
      title,
      start: sDate.toISOString(),
      end: eDate ? eDate.toISOString() : "",
      location,
      sport: cfg.label,
      sportKey: cfg.key,
      source: "Google Sheet"
    });
  }

  return out;
}

async function loadAllSports() {
  const batches = await Promise.all(
    SPORT_SHEETS.map(async (cfg) => {
      try {
        return await fetchSportSheet(cfg);
      } catch (err) {
        console.error(`${cfg.label} load error:`, err);
        return [];
      }
    })
  );
  return batches.flat();
}

/* ========= UI ========= */
function buildSportTabs() {
  SPORT_TABS.innerHTML = "";

  const tabsToShow = SPORT_ORDER.filter((k) => {
    const cfg = SPORT_SHEETS.find((s) => s.key === k);
    const hasUrl = !!cfg?.csvUrl;
    const hasData = (groupedBySport[k] || []).length > 0;
    return hasUrl || hasData;
  });

  for (const key of tabsToShow) {
    const btn = document.createElement("button");
    btn.className = "sport-tab" + (key === selectedSport ? " active" : "");
    btn.type = "button";
    btn.textContent = prettySport(key);

    btn.addEventListener("click", () => {
      selectedSport = key;
      APP_TITLE.textContent = `${prettySport(key)} Event Calendar`;
      [...SPORT_TABS.children].forEach((x) => x.classList.remove("active"));
      btn.classList.add("active");
      rerenderCalendar();
    });

    SPORT_TABS.appendChild(btn);
  }

  if (!(groupedBySport[selectedSport] || []).length) {
    const firstWithData = tabsToShow.find((k) => (groupedBySport[k] || []).length > 0) || tabsToShow[0] || "f1";
    selectedSport = firstWithData;
    APP_TITLE.textContent = `${prettySport(firstWithData)} Event Calendar`;
    [...SPORT_TABS.children].forEach((x) => {
      x.classList.toggle("active", normalizeKey(x.textContent) === normalizeKey(prettySport(firstWithData)));
    });
  }
}

function renderHighlights(currentMonthStart) {
  HIGHLIGHTS.innerHTML = "";
  const label = currentMonthStart.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  MONTH_TITLE.textContent = `Monthly highlights — ${label}`;

  const mk = monthKeyFromDate(currentMonthStart);
  const groups = (groupedBySport[selectedSport] || []).filter((g) => g.primaryMonth === mk);

  if (!groups.length) {
    HIGHLIGHTS.innerHTML = `<div class="card"><div class="title">No highlights found</div></div>`;
    return;
  }

  for (const g of groups) {
    const card = document.createElement("div");
    const icon = iconForSport(g.sportKey);
    const flags = g.flags?.length ? ` • ${g.flags.join(" / ")}` : "";

    card.className = "card";
    card.innerHTML = `
      <div class="title">${icon} ${g.title}</div>
      <div class="meta">
        <span class="pill-date">📅 ${formatRange(g.start, g.end)}</span>
        <span class="pill">🔥 ${prettySport(g.sportKey)}${flags}</span>
      </div>
    `;
    HIGHLIGHTS.appendChild(card);
  }
}

function getEventsForSelectedSport() {
  return allEvents.filter((e) => e.sportKey === selectedSport);
}

function rerenderCalendar() {
  if (!calendar) return;
  calendar.removeAllEvents();
  calendar.addEventSource(
    getEventsForSelectedSport().map((e) => ({
      title: e.title,
      start: e.start,
      end: e.end || null,
      extendedProps: {
        sportKey: e.sportKey,
        location: e.location,
        source: e.source
      }
    }))
  );
  renderHighlights(calendar.view.currentStart);
}

function initCalendar() {
  calendar = new FullCalendar.Calendar(document.getElementById("calendar"), {
    initialView: "dayGridMonth",
    height: "auto",
    displayEventTime: false,
    dayMaxEvents: true,
    showNonCurrentDates: false,
    fixedWeekCount: false,

    events: getEventsForSelectedSport().map((e) => ({
      title: e.title,
      start: e.start,
      end: e.end || null,
      extendedProps: {
        sportKey: e.sportKey,
        location: e.location,
        source: e.source
      }
    })),

    datesSet(info) {
      renderHighlights(info.view.currentStart);
    },

    eventDidMount(info) {
      const s = info.event.extendedProps?.sportKey;
      const border = {
        f1: "#e10600",
        nascar: "#ffd54a",
        nfl: "#44c0ff",
        nhl: "#8ee08e",
        nba: "#ff9a5a",
        mlb: "#c6a6ff",
        other: "#7aa2ff"
      }[s] || "#7aa2ff";
      info.el.style.borderColor = border;
    }
  });

  calendar.render();
}

/* ========= BOOT ========= */
(async function boot() {
  try {
    allEvents = await loadAllSports();
    groupedBySport = buildGroupedHighlights(allEvents);

    APP_TITLE.textContent = `${prettySport(selectedSport)} Event Calendar`;
    buildSportTabs();
    initCalendar();
  } catch (err) {
    console.error(err);
    HIGHLIGHTS.innerHTML = `
      <div class="card">
        <div class="title">Error loading data</div>
        <div class="meta"><span class="pill">${String(err.message || err)}</span></div>
      </div>
    `;
  }
})();
