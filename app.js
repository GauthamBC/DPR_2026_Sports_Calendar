/* app.js */
(() => {
  "use strict";

  /* =========================
     1) CONFIG
     ========================= */
  const SHEET_ID = "2PACX-1vSTuRExRSKpKiorPUADig1yYm5_ye3jLG-5TcQ4Uhz07qgx-1mIkkhtEsFky9FpRd0QczIl2xEBYEd8";
  const DEFAULT_SHEET_NAME = "F1_race"; // your working tab name

  // Add other sport tabs later when you have sheet names ready
  const SPORTS = [
    { key: "f1", label: "F1", sheetName: "F1_race", enabled: true },
    { key: "nascar", label: "NASCAR", sheetName: "", enabled: false },
    { key: "nfl", label: "NFL", sheetName: "", enabled: false },
    { key: "nhl", label: "NHL", sheetName: "", enabled: false },
    { key: "nba", label: "NBA", sheetName: "", enabled: false },
    { key: "mlb", label: "MLB", sheetName: "", enabled: false },
    { key: "other", label: "Other", sheetName: "", enabled: false }
  ];

  const ICON = {
    f1: "🏎️",
    nascar: "🏁",
    nfl: "🏈",
    nhl: "🏒",
    nba: "🏀",
    mlb: "⚾",
    other: "🎯"
  };

  /* =========================
     2) DOM + STATE
     ========================= */
  const appTitleEl = document.getElementById("appTitle");
  const monthTitleEl = document.getElementById("monthTitle");
  const highlightsEl = document.getElementById("highlights");
  const tabsEl = document.getElementById("sportTabs");
  const calendarEl = document.getElementById("calendar");

  let selectedSport = "f1";
  let calendar = null;

  // Cache parsed events per sport
  const eventsBySport = {};

  /* =========================
     3) UTIL
     ========================= */
  function normalizeKey(s) {
    return (s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
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

    const headers = rows[0].map(h => String(h || "").trim());
    const out = [];
    for (let r = 1; r < rows.length; r++) {
      const rowData = rows[r];
      if (!rowData || !rowData.some(v => String(v || "").trim() !== "")) continue;
      const obj = {};
      headers.forEach((h, idx) => {
        obj[h] = String(rowData[idx] ?? "").trim();
      });
      out.push(obj);
    }
    return out;
  }

  function findColumn(record, aliases) {
    const keys = Object.keys(record || {});
    const cleaned = keys.map(k => normalizeKey(k));
    for (const alias of aliases) {
      const idx = cleaned.indexOf(normalizeKey(alias));
      if (idx >= 0) return keys[idx];
    }
    return null;
  }

  function parseDateFlexible(v) {
    if (!v) return null;
    const raw = String(v).trim();
    if (!raw) return null;

    const dIso = new Date(raw);
    if (!Number.isNaN(dIso.getTime())) return dIso;

    // dd/mm/yyyy or mm/dd/yyyy [hh:mm]
    const m = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?$/);
    if (m) {
      const a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      let y = parseInt(m[3], 10);
      const hh = m[4] ? parseInt(m[4], 10) : 0;
      const mm = m[5] ? parseInt(m[5], 10) : 0;
      if (y < 100) y += 2000;

      // guess day/month
      let month = a;
      let day = b;
      if (a > 12) { day = a; month = b; }

      const d = new Date(y, month - 1, day, hh, mm);
      if (!Number.isNaN(d.getTime())) return d;
    }

    return null;
  }

  function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  function monthKey(d) {
    return `${d.getFullYear()}-${d.getMonth()}`;
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

  function sessionKind(title) {
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
    if (t.includes("in your calendar")) return null; // remove noisy row

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
    for (const [needle, out] of map) {
      if (loc.includes(needle)) return out;
    }

    if (loc.includes("united states")) {
      if (t.includes("miami")) return "Miami Grand Prix";
      if (t.includes("las vegas")) return "Las Vegas Grand Prix";
      return "United States Grand Prix";
    }

    // fallback from title
    const cleaned = (title || "").replace(/[🏎🏁⏱️]/g, "").trim();
    const m = cleaned.match(/([A-Za-zÀ-ÿ'’\-\s]+)\s+grand\s+prix/i);
    if (m?.[1]) return `${m[1].trim()} Grand Prix`;

    return "Grand Prix";
  }

  function prettySport(k) {
    return (SPORTS.find(s => s.key === k)?.label) || "Other";
  }

  function eventColorBySport(sportKey) {
    const map = {
      f1: "#e10600",
      nascar: "#ffd54a",
      nfl: "#44c0ff",
      nhl: "#8ee08e",
      nba: "#ff9a5a",
      mlb: "#c6a6ff",
      other: "#7aa2ff"
    };
    return map[sportKey] || "#7aa2ff";
  }

  function safeCsvUrl(sheetName) {
    // Most reliable for published sheets:
    // https://docs.google.com/spreadsheets/d/e/<PUB_ID>/pub?output=csv&sheet=<TAB_NAME>
    const base = `https://docs.google.com/spreadsheets/d/e/${SHEET_ID}/pub?output=csv`;
    const qs = `sheet=${encodeURIComponent(sheetName)}&t=${Date.now()}`;
    return `${base}&${qs}`;
  }

  /* =========================
     4) DATA LOAD
     ========================= */
  async function fetchSportEvents(sportKey) {
    const cfg = SPORTS.find(s => s.key === sportKey);
    if (!cfg) return [];
    if (!cfg.enabled || !cfg.sheetName) return [];

    const url = safeCsvUrl(cfg.sheetName);
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`${cfg.label} CSV fetch failed (${res.status})`);
    }

    const rows = parseCSV(await res.text());
    if (!rows.length) return [];

    const sample = rows[0];

    const titleKey = findColumn(sample, ["title", "event", "name", "race", "matchup"]);
    const startKey = findColumn(sample, ["start", "start date", "date", "datetime", "start_datetime"]);
    const endKey = findColumn(sample, ["end", "end date", "end_datetime", "finish"]);
    const locationKey = findColumn(sample, ["location", "venue", "country", "city", "track", "stadium", "arena"]);

    if (!titleKey || !startKey) {
      throw new Error(`${cfg.label}: required columns missing. Need title + start (or date).`);
    }

    const out = [];
    for (const r of rows) {
      const title = String(r[titleKey] || "").trim();
      const startRaw = String(r[startKey] || "").trim();
      const endRaw = endKey ? String(r[endKey] || "").trim() : "";
      const location = locationKey ? String(r[locationKey] || "").trim() : "";

      if (!title || !startRaw) continue;

      const s = parseDateFlexible(startRaw);
      if (!s) continue;
      const e = endRaw ? parseDateFlexible(endRaw) : null;

      out.push({
        sportKey,
        title,
        start: s.toISOString(),
        end: e ? e.toISOString() : "",
        location
      });
    }

    return out;
  }

  async function ensureSportLoaded(sportKey) {
    if (eventsBySport[sportKey]) return;
    try {
      eventsBySport[sportKey] = await fetchSportEvents(sportKey);
    } catch (e) {
      console.error(e);
      eventsBySport[sportKey] = [];
    }
  }

  /* =========================
     5) HIGHLIGHT GROUPING
     ========================= */
  function buildHighlightsForSport(sportKey, monthStart) {
    const rows = (eventsBySport[sportKey] || []).slice();

    const currentMonthKey = monthKey(monthStart);
    if (!rows.length) return [];

    if (sportKey === "f1") {
      // Old-style grouping by race weekend name + proximity
      const expanded = rows
        .map(e => ({
          ...e,
          d: startOfDay(e.start),
          n: canonicalF1Name(e.location, e.title),
          nk: normalizeKey(canonicalF1Name(e.location, e.title)),
          kind: sessionKind(e.title)
        }))
        .filter(x => x.n && !Number.isNaN(x.d.getTime()))
        .sort((a,b) => (a.nk < b.nk ? -1 : a.nk > b.nk ? 1 : a.d - b.d));

      const grouped = [];
      let g = null;
      const GAP_DAYS = 10;

      for (const r of expanded) {
        if (!g) {
          g = {
            title: r.n,
            nk: r.nk,
            start: r.d,
            end: r.d,
            hasRace: false,
            hasQuali: false,
            hasSprint: false,
            items: []
          };
        } else {
          const last = g.items[g.items.length - 1];
          const gap = (r.d - startOfDay(last.start)) / 86400000;
          if (g.nk !== r.nk || gap > GAP_DAYS) {
            grouped.push(g);
            g = {
              title: r.n,
              nk: r.nk,
              start: r.d,
              end: r.d,
              hasRace: false,
              hasQuali: false,
              hasSprint: false,
              items: []
            };
          }
        }

        g.items.push(r);
        if (r.d < g.start) g.start = r.d;
        if (r.d > g.end) g.end = r.d;
        if (r.kind === "race") g.hasRace = true;
        if (r.kind === "qualifying" || r.kind === "sprint qualifying") g.hasQuali = true;
        if (r.kind.includes("sprint")) g.hasSprint = true;
      }
      if (g) grouped.push(g);

      // Anchor on race date when possible so month sync is correct
      const cards = grouped.map(x => {
        const raceDates = x.items.filter(i => sessionKind(i.title) === "race").map(i => startOfDay(i.start)).sort((a,b)=>a-b);
        const anchor = raceDates.length ? raceDates[0] : x.start;
        return {
          title: x.title,
          start: x.start,
          end: x.end,
          anchor,
          primaryMonth: monthKey(anchor),
          flags: [
            x.hasRace ? "Race" : null,
            x.hasQuali ? "Quali" : null,
            x.hasSprint ? "Sprint" : null
          ].filter(Boolean)
        };
      });

      return cards
        .filter(c => c.primaryMonth === currentMonthKey)
        .sort((a,b) => a.anchor - b.anchor);
    }

    // Generic grouping for other sports
    const byTitle = new Map();
    for (const e of rows) {
      const d = startOfDay(e.start);
      const t = (e.title || "").trim();
      if (!t) continue;
      if (!byTitle.has(t)) byTitle.set(t, []);
      byTitle.get(t).push({ ...e, d });
    }

    const cards = [];
    for (const [title, list] of byTitle.entries()) {
      list.sort((a,b) => a.d - b.d);
      const start = list[0].d;
      const end = list[list.length - 1].d;
      const anchor = start;
      cards.push({
        title,
        start,
        end,
        anchor,
        primaryMonth: monthKey(anchor),
        flags: []
      });
    }

    return cards
      .filter(c => c.primaryMonth === currentMonthKey)
      .sort((a,b) => a.anchor - b.anchor);
  }

  /* =========================
     6) RENDER
     ========================= */
  function renderTabs() {
    tabsEl.innerHTML = "";
    for (const s of SPORTS) {
      const btn = document.createElement("button");
      btn.className = `sport-tab${s.key === selectedSport ? " active" : ""}`;
      btn.type = "button";
      btn.textContent = s.label;

      btn.addEventListener("click", async () => {
        selectedSport = s.key;
        appTitleEl.textContent = `${s.label} Event Calendar`;

        [...tabsEl.children].forEach(x => x.classList.remove("active"));
        btn.classList.add("active");

        await ensureSportLoaded(selectedSport);
        rerenderCalendarEvents();
        renderHighlights(calendar.view.currentStart);
      });

      tabsEl.appendChild(btn);
    }
  }

  function currentSportEventsFC() {
    return (eventsBySport[selectedSport] || []).map(e => ({
      title: e.title,
      start: e.start,
      end: e.end || null,
      extendedProps: { sportKey: e.sportKey, location: e.location }
    }));
  }

  function rerenderCalendarEvents() {
    calendar.removeAllEvents();
    calendar.addEventSource(currentSportEventsFC());
  }

  function renderHighlights(monthStart) {
    const monthText = monthStart.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    monthTitleEl.textContent = `Monthly highlights — ${monthText}`;
    highlightsEl.innerHTML = "";

    const cards = buildHighlightsForSport(selectedSport, monthStart);

    if (!cards.length) {
      highlightsEl.innerHTML = `<div class="card"><div class="title">No highlights found</div></div>`;
      return;
    }

    for (const c of cards) {
      const card = document.createElement("div");
      card.className = "card";

      const sportLabel = prettySport(selectedSport);
      const flags = c.flags.length ? ` • ${c.flags.join(" / ")}` : "";

      card.innerHTML = `
        <div class="title">${ICON[selectedSport] || "🎯"} ${c.title}</div>
        <div class="meta">
          <span class="pill-date">📅 ${formatRange(c.start, c.end)}</span>
          <span class="pill">🔥 ${sportLabel}${flags}</span>
        </div>
      `;
      highlightsEl.appendChild(card);
    }
  }

  function initCalendar() {
    calendar = new FullCalendar.Calendar(calendarEl, {
      initialView: "dayGridMonth",
      height: "auto",
      displayEventTime: false,
      dayMaxEvents: true,
      showNonCurrentDates: false,
      fixedWeekCount: false,

      events: currentSportEventsFC(),

      datesSet(info) {
        renderHighlights(info.view.currentStart);
      },

      eventDidMount(info) {
        const c = eventColorBySport(info.event.extendedProps?.sportKey || selectedSport);
        info.el.style.borderColor = c;
      }
    });

    calendar.render();
  }

  /* =========================
     7) BOOT
     ========================= */
  async function boot() {
    renderTabs();

    // load F1 first (must work now)
    await ensureSportLoaded("f1");

    appTitleEl.textContent = "F1 Event Calendar";
    initCalendar();

    // optional preload of enabled non-f1 tabs (quietly)
    for (const s of SPORTS) {
      if (s.key !== "f1" && s.enabled && s.sheetName) {
        ensureSportLoaded(s.key);
      }
    }
  }

  boot().catch(err => {
    console.error(err);
    highlightsEl.innerHTML = `
      <div class="card">
        <div class="title">Error loading calendar</div>
        <div class="meta"><span class="pill">${String(err.message || err)}</span></div>
      </div>
    `;
  });
})();
