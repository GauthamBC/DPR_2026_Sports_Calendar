const HIGHLIGHTS = document.getElementById("highlights");
const MONTH_TITLE = document.getElementById("monthTitle");

/**
 * Google Sheet published URL you shared:
 * https://docs.google.com/spreadsheets/d/e/2PACX-1vSTuRExRSKpKiorPUADig1yYm5_ye3jLG-5TcQ4Uhz07qgx-1mIkkhtEsFky9FpRd0QczIl2xEBYEd8/pubhtml
 */
const SHEET_PUBHTML_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSTuRExRSKpKiorPUADig1yYm5_ye3jLG-5TcQ4Uhz07qgx-1mIkkhtEsFky9FpRd0QczIl2xEBYEd8/pubhtml";

/**
 * IMPORTANT: set this to your F1_race tab gid.
 * Example: const F1_RACE_GID = "123456789";
 * If left null, Google may return the default published tab.
 */
const F1_RACE_GID = null;

let allEvents = [];
let calendar = null;
let f1Groups = [];

/* -------------------- utils -------------------- */
function normalizeKey(s) {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function startOfDay(input) {
  const d = new Date(input);
  d.setHours(0, 0, 0, 0);
  return d;
}

function monthKeyFromDate(d) {
  return `${d.getFullYear()}-${d.getMonth()}`; // 0-based month
}

function titleCase(s) {
  return (s || "")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function formatRange(start, end) {
  const s = new Date(start);
  const e = new Date(end);

  const sameDay = s.toDateString() === e.toDateString();
  const sameMonthYear =
    s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();

  const monthDay = { month: "short", day: "numeric" };
  const yearOnly = { year: "numeric" };

  const sTxt = s.toLocaleDateString(undefined, monthDay);
  const eTxt = e.toLocaleDateString(undefined, monthDay);
  const yTxt = s.toLocaleDateString(undefined, yearOnly);

  if (sameDay) return `${sTxt}, ${yTxt}`;
  if (sameMonthYear) return `${sTxt}–${e.getDate()}, ${yTxt}`;
  return `${sTxt} – ${eTxt}, ${yTxt}`;
}

/* -------------------- google sheets url -------------------- */
function buildCsvUrlFromPubhtml(pubhtmlUrl, gid = null) {
  // convert /pubhtml => /pub
  const base = pubhtmlUrl.replace(/\/pubhtml(\?.*)?$/i, "/pub");
  const u = new URL(base);

  u.searchParams.set("output", "csv");
  u.searchParams.set("single", "true");
  if (gid !== null && gid !== undefined && String(gid).trim() !== "") {
    u.searchParams.set("gid", String(gid).trim());
  }
  // cache-bust
  u.searchParams.set("t", Date.now().toString());

  return u.toString();
}

/* -------------------- csv parser -------------------- */
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
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\r") {
      i += 1;
      continue;
    }

    field += ch;
    i += 1;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (!rows.length) return [];

  const headers = rows[0].map((h) => h.trim());

  return rows
    .slice(1)
    .filter((r) => r.some((x) => String(x ?? "").trim() !== ""))
    .map((r) => {
      const obj = {};
      headers.forEach((h, idx) => {
        obj[h] = (r[idx] ?? "").trim();
      });
      return obj;
    });
}

/* -------------------- F1 session / naming -------------------- */
function getSessionKind(title) {
  const t = normalizeKey(title);

  if (t.includes("sprint qualification") || t.includes("sprint qualifying")) {
    return "sprint qualifying";
  }
  if (t.includes("sprint race")) return "sprint race";
  if (t.includes("sprint")) return "sprint";
  if (t.includes("qualifying")) return "qualifying";
  if (/\brace\b/.test(t)) return "race";
  if (t.includes("practice") || /\bfp\s*\d+\b/.test(t)) return "practice";
  return "other";
}

function canonicalGpNameFromLocation(location, title) {
  const loc = normalizeKey(location);
  const t = normalizeKey(title);

  if (!t) return null;
  if (t.includes("in your calendar")) return null;
  if (t.includes("testing")) return "Testing";

  // location-first mapping
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

  // title fallback
  if (t.includes("monaco")) return "Monaco Grand Prix";
  if (t.includes("italia") || t.includes("italian") || t.includes("monza")) {
    return "Italian Grand Prix";
  }
  if (t.includes("espana") || t.includes("españa") || t.includes("barcelona") || t.includes("spanish")) {
    return "Spanish Grand Prix";
  }
  if (t.includes("azerbaijan") || t.includes("baku")) return "Azerbaijan Grand Prix";
  if (t.includes("qatar")) return "Qatar Grand Prix";

  // generic fallback: extract "... Grand Prix"
  if (t.includes("grand prix")) {
    const cleaned = (title || "").replace(/[🏎🏁⏱️]/g, "").trim();
    const m = cleaned.match(/([A-Za-zÀ-ÿ'’\-\s]+)\s+grand\s+prix/i);
    if (m && m[1]) return `${titleCase(m[1].trim())} Grand Prix`;
  }

  return null;
}

/* -------------------- grouping (fixed for repeated GP names) -------------------- */
function buildF1Groups(events) {
  const rows = [];

  for (const e of events) {
    if (normalizeKey(e.sport) !== "f1") continue;
    if (/in your calendar/i.test(e.title || "")) continue;

    const gpName = canonicalGpNameFromLocation(e.location, e.title);
    if (!gpName) continue;

    const day = startOfDay(e.start);
    if (Number.isNaN(day.getTime())) continue;

    rows.push({
      ...e,
      _gpName: gpName,
      _gpKey: normalizeKey(gpName),
      _day: day,
      _kind: getSessionKind(e.title)
    });
  }

  // sort by GP key then date
  rows.sort((a, b) => {
    if (a._gpKey < b._gpKey) return -1;
    if (a._gpKey > b._gpKey) return 1;
    return a._day - b._day;
  });

  // split repeated GP names into separate race-weekend clusters
  const GAP_DAYS = 10;
  const groups = [];
  let current = null;

  function newGroup(r) {
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
      current = newGroup(r);
    } else {
      const last = current.items[current.items.length - 1];
      const sameGp = current.gpKey === r._gpKey;
      const lastDay = startOfDay(last.start);
      const gapDays = (r._day - lastDay) / (1000 * 60 * 60 * 24);

      if (!sameGp || gapDays > GAP_DAYS) {
        groups.push(current);
        current = newGroup(r);
      }
    }

    // dedupe per day/session/title
    const dedupeKey = `${r._day.toISOString().slice(0, 10)}|${r._kind}|${normalizeKey(r.title)}`;
    if (current._dedupe.has(dedupeKey)) continue;
    current._dedupe.add(dedupeKey);

    current.items.push(r);
    if (r._day < current.start) current.start = r._day;
    if (r._day > current.end) current.end = r._day;

    if (r._kind === "race") current._hasRace = true;
    if (r._kind === "qualifying" || r._kind === "sprint qualifying") current._hasQuali = true;
    if (r._kind.includes("sprint")) current._hasSprint = true;
  }

  if (current) groups.push(current);

  // month anchor = race date (if exists), else earliest group date
  const finalized = groups.map((g) => {
    const raceDates = g.items
      .filter((x) => getSessionKind(x.title) === "race")
      .map((x) => startOfDay(x.start))
      .filter((d) => !Number.isNaN(d.getTime()))
      .sort((a, b) => a - b);

    const anchor = raceDates.length ? raceDates[0] : g.start;
    g.anchorDate = anchor;
    g.primaryMonth = monthKeyFromDate(anchor);

    delete g._dedupe;
    delete g.gpKey;
    return g;
  });

  // chronological order
  finalized.sort((a, b) => a.anchorDate - b.anchorDate);
  return finalized;
}

/* -------------------- rendering -------------------- */
function renderHighlights(currentMonthStart) {
  HIGHLIGHTS.innerHTML = "";

  const monthLabel = currentMonthStart.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric"
  });
  MONTH_TITLE.textContent = `Monthly highlights — ${monthLabel}`;

  const mk = monthKeyFromDate(currentMonthStart);

  const groups = f1Groups
    .filter((g) => g.primaryMonth === mk)
    .slice(0, 12);

  if (!groups.length) {
    HIGHLIGHTS.innerHTML = `
      <div class="card">
        <div class="title">No highlights found</div>
        <div class="meta"><span class="pill">Try another month.</span></div>
      </div>
    `;
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

/* -------------------- load + calendar -------------------- */
async function loadEvents() {
  try {
    const csvUrl = buildCsvUrlFromPubhtml(SHEET_PUBHTML_URL, F1_RACE_GID);
    const res = await fetch(csvUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`CSV fetch failed (${res.status})`);

    const csvText = await res.text();
    const records = parseCSV(csvText);

    allEvents = records
      .map((r) => ({
        title: r.title || "",
        start: r.start || "",
        end: r.end || "",
        sport: r.sport || "",
        source: r.source || "",
        location: r.location || ""
      }))
      .filter((e) => e.title && e.start)
      .filter((e) => normalizeKey(e.sport) === "f1");

    f1Groups = buildF1Groups(allEvents);

    // Optional debug: uncomment to inspect grouped highlights
    // console.table(f1Groups.map(g => ({
    //   title: g.title,
    //   start: g.start.toISOString().slice(0,10),
    //   end: g.end.toISOString().slice(0,10),
    //   primaryMonth: g.primaryMonth
    // })));

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
}

function initCalendar() {
  const el = document.getElementById("calendar");

  if (!el) {
    console.error('Missing #calendar container in index.html');
    return;
  }

  calendar = new FullCalendar.Calendar(el, {
    initialView: "dayGridMonth",
    height: "auto",
    displayEventTime: false,
    dayMaxEvents: true,
    showNonCurrentDates: false,
    fixedWeekCount: false,

    events: allEvents.map((e) => ({
      title: e.title,
      start: e.start,
      end: e.end || null,
      extendedProps: {
        sport: e.sport,
        source: e.source,
        location: e.location
      }
    })),

    datesSet(info) {
      renderHighlights(info.view.currentStart);
    },

    eventDidMount(info) {
      const sport = normalizeKey(info.event.extendedProps?.sport || "");
      if (sport === "f1") {
        info.el.style.borderColor = "#e10600";
      }
    }
  });

  calendar.render();
}

loadEvents();
