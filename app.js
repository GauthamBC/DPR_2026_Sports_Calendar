(() => {
  // -----------------------------
  // CONFIG
  // -----------------------------
  const SHEET_PUB_HTML = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSTuRExRSKpKiorPUADig1yYm5_ye3jLG-5TcQ4Uhz07qgx-1mIkkhtEsFky9FpRd0QczIl2xEBYEd8/pubhtml";

  const SPORTS = [
    { key: "f1",     label: "F1",     sheetName: "F1_race" },
    { key: "nascar", label: "NASCAR", sheetName: "NASCAR" },
    { key: "nfl",    label: "NFL",    sheetName: "NFL" },
    { key: "nhl",    label: "NHL",    sheetName: "NHL" },
    { key: "nba",    label: "NBA",    sheetName: "NBA" },
    { key: "mlb",    label: "MLB",    sheetName: "MLB" },
    { key: "other",  label: "Other",  sheetName: "Other" },
  ];

  // -----------------------------
  // STATE
  // -----------------------------
  const state = {
    activeSport: "f1",
    calendar: null,
    cache: new Map(), // sportKey -> events[]
  };

  // -----------------------------
  // HELPERS
  // -----------------------------
  function getSpreadsheetId(pubUrl) {
    const m = String(pubUrl).match(/\/d\/e\/([^/]+)/i);
    return m ? m[1] : "";
  }

  function buildCsvUrl(pubUrl, sheetName) {
    const sid = getSpreadsheetId(pubUrl);
    if (!sid) throw new Error("Invalid Google Sheet publish URL");
    return `https://docs.google.com/spreadsheets/d/e/${sid}/pub?output=csv&sheet=${encodeURIComponent(sheetName)}`;
  }

  function parseCSV(text) {
    const rows = [];
    let row = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const nx = text[i + 1];
      if (q) {
        if (ch === '"' && nx === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else {
        if (ch === '"') q = true;
        else if (ch === ',') { row.push(cur); cur = ""; }
        else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ""; }
        else if (ch !== '\r') cur += ch;
      }
    }
    if (cur.length || row.length) { row.push(cur); rows.push(row); }
    if (!rows.length) return [];

    const headers = rows[0].map(h => String(h || "").trim());
    return rows.slice(1)
      .filter(r => r.some(v => String(v || "").trim() !== ""))
      .map(r => {
        const o = {};
        headers.forEach((h, i) => (o[h] = (r[i] ?? "").trim()));
        return o;
      });
  }

  function normKey(k) {
    return String(k || "")
      .toLowerCase()
      .replace(/\ufeff/g, "")
      .replace(/[^a-z0-9]+/g, "")
      .trim();
  }

  function pick(obj, aliases) {
    const map = new Map(Object.keys(obj).map(k => [normKey(k), obj[k]]));
    for (const a of aliases) {
      const v = map.get(normKey(a));
      if (v != null && String(v).trim() !== "") return String(v).trim();
    }
    return "";
  }

  function parseDateLoose(s) {
    if (!s) return null;
    const raw = String(s).trim();
    if (!raw) return null;
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?)?$/i);
    if (iso) {
      const [_, Y, M, D, hh = "00", mm = "00", ss = "00", tz = ""] = iso;
      if (tz) {
        const z = tz === "Z" ? "Z" : (tz.includes(":") ? tz : `${tz.slice(0,3)}:${tz.slice(3)}`);
        return new Date(`${Y}-${M}-${D}T${hh}:${mm}:${ss}${z}`);
      }
      return new Date(Number(Y), Number(M) - 1, Number(D), Number(hh), Number(mm), Number(ss));
    }
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function toLocalDateInputValue(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function addDays(date, n) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n, date.getHours(), date.getMinutes(), date.getSeconds());
  }

  function cleanTitle(t) {
    return String(t || "")
      .replace(/[🏁🏎️🏎⏱️🔥📅•]/g, "")
      .replace(/^\s*FORMULA\s*1\s*/i, "")
      .replace(/\s*\b\d{4}\b\s*/g, " ")
      .replace(/\s*-\s*(Practice\s*\d+|Qualifying|Race|Sprint\s*Race|Sprint\s*Qualification|Sprint\s*Shootout)\s*$/i, "")
      .replace(/\b(QATAR AIRWAYS|HEINEKEN|ARAMCO|CRYPTO\.COM|STC|MSC CRUISES|LENOVO|PIRELLI|AWS|ETIHAD AIRWAYS|GULF AIR|LOUIS VUITTON|MOËT & CHANDON|SINGAPORE AIRLINES|TAG HEUER)\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function stageFromTitle(title) {
    const t = String(title || "");
    if (/sprint\s*race/i.test(t)) return "Sprint";
    if (/sprint\s*(qualification|shootout)/i.test(t)) return "Sprint";
    if (/qualifying/i.test(t)) return "Quali";
    if (/race/i.test(t)) return "Race";
    if (/practice/i.test(t)) return "Practice";
    return "Event";
  }

  function normalizeRowsToEvents(rows, sportLabel) {
    const out = [];
    for (const r of rows) {
      const title = pick(r, ["title", "event", "name", "race", "match", "game", "summary"]);
      const startRaw = pick(r, ["start", "startdate", "date", "start_time", "datetime", "when"]);
      const endRaw = pick(r, ["end", "enddate", "end_time", "finish", "until"]);
      if (!title || !startRaw) continue;

      const s = parseDateLoose(startRaw);
      if (!s) continue;
      let e = parseDateLoose(endRaw);
      if (!e) e = addDays(s, 1);
      if (e <= s) e = addDays(s, 1);

      const stage = stageFromTitle(title);
      const location = pick(r, ["location", "venue", "city", "country"]);
      const source = pick(r, ["source", "series", "league", "network"]);

      out.push({
        title,
        start: s,
        end: e,
        stage,
        sport: sportLabel,
        location,
        source,
      });
    }
    return out;
  }

  function raceKeyForGrouping(eventTitle) {
    return cleanTitle(eventTitle).toLowerCase();
  }

  function monthKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
  }

  function buildHighlights(events, viewStartDate) {
    const targetMonth = monthKey(viewStartDate);

    const monthEvents = events.filter(ev => {
      const s = ev.start;
      const e = ev.end;
      const startsIn = monthKey(s) === targetMonth;
      const endsIn = monthKey(addDays(e, -1)) === targetMonth;
      return startsIn || endsIn;
    });

    const map = new Map();
    for (const ev of monthEvents) {
      const key = raceKeyForGrouping(ev.title);
      if (!map.has(key)) {
        map.set(key, {
          key,
          label: cleanTitle(ev.title),
          start: ev.start,
          end: ev.end,
          stages: new Set([ev.stage]),
        });
      } else {
        const g = map.get(key);
        if (ev.start < g.start) g.start = ev.start;
        if (ev.end > g.end) g.end = ev.end;
        g.stages.add(ev.stage);
      }
    }

    return [...map.values()]
      .sort((a,b) => a.start - b.start)
      .map(g => ({
        title: g.label || "Event",
        dateText: formatDateRange(g.start, addDays(g.end, -1)),
        stageText: summarizeStages(g.stages),
      }));
  }

  function summarizeStages(setObj) {
    const s = new Set(setObj);
    const parts = [];
    if (s.has("Race")) parts.push("Race");
    if (s.has("Quali")) parts.push("Quali");
    if (s.has("Sprint")) parts.push("Sprint");
    if (!parts.length && s.has("Practice")) parts.push("Practice");
    return `🔥 ${parts.length ? parts.join(" / ") : "Event"}`;
  }

  function formatDateRange(a, b) {
    const fmtD = new Intl.DateTimeFormat(undefined, { day: "numeric" });
    const fmtM = new Intl.DateTimeFormat(undefined, { month: "short" });
    const fmtY = new Intl.DateTimeFormat(undefined, { year: "numeric" });

    const sameDay = a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
    if (sameDay) return `📅 ${fmtD.format(a)} ${fmtM.format(a)}, ${fmtY.format(a)}`;

    if (a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth()) {
      return `📅 ${fmtD.format(a)}–${fmtD.format(b)} ${fmtM.format(a)}, ${fmtY.format(a)}`;
    }

    return `📅 ${fmtD.format(a)} ${fmtM.format(a)}–${fmtD.format(b)} ${fmtM.format(b)}, ${fmtY.format(b)}`;
  }

  function renderHighlights(events, viewStart) {
    const monthTitleEl = document.getElementById("monthTitle");
    const highlightsEl = document.getElementById("highlights");

    const monthName = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(viewStart);
    monthTitleEl.textContent = `Monthly highlights — ${monthName}`;

    const cards = buildHighlights(events, viewStart);

    if (!cards.length) {
      highlightsEl.innerHTML = `<article class="card"><h3 class="title">No highlights found</h3></article>`;
      return;
    }

    highlightsEl.innerHTML = cards.map(c => `
      <article class="card">
        <h3 class="title">🏎️ ${escapeHtml(c.title)}</h3>
        <div class="meta">
          <span class="pill-date">${escapeHtml(c.dateText)}</span>
          <span class="pill">${escapeHtml(c.stageText)}</span>
        </div>
      </article>
    `).join("");
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function toFullCalendarEvents(events) {
    return events.map(ev => ({
      title: `${badgeForStage(ev.stage)} ${shortenForGrid(ev.title)}`,
      start: ev.start,
      end: ev.end,
      allDay: true,
      backgroundColor: colorForStage(ev.stage),
      borderColor: colorForStage(ev.stage),
      textColor: "#eaf1ff",
    }));
  }

  function badgeForStage(stage) {
    if (stage === "Race") return "🏁";
    if (stage === "Quali") return "⏱️";
    if (stage === "Sprint") return "🏎️";
    if (stage === "Practice") return "🏎️";
    return "•";
  }

  function colorForStage(stage) {
    if (stage === "Race") return "#2b4578";
    if (stage === "Quali") return "#304f86";
    if (stage === "Sprint") return "#3a5b95";
    if (stage === "Practice") return "#27436f";
    return "#36578f";
  }

  function shortenForGrid(title) {
    const t = cleanTitle(title).replace(/^FORMULA\s*1\s*/i, "").trim();
    return t.length > 24 ? t.slice(0, 24).trim() : t;
  }

  async function fetchSportEvents(sportKey) {
    if (state.cache.has(sportKey)) return state.cache.get(sportKey);

    const cfg = SPORTS.find(s => s.key === sportKey);
    if (!cfg) return [];

    const csvUrl = buildCsvUrl(SHEET_PUB_HTML, cfg.sheetName);
    const res = await fetch(csvUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed loading ${cfg.sheetName}`);

    const txt = await res.text();
    const rows = parseCSV(txt);
    const events = normalizeRowsToEvents(rows, cfg.label);

    state.cache.set(sportKey, events);
    return events;
  }

  async function switchSport(sportKey) {
    state.activeSport = sportKey;
    updateTabs();

    const cfg = SPORTS.find(s => s.key === sportKey);
    const titleEl = document.getElementById("appTitle");
    titleEl.textContent = `${cfg.label} Event Calendar`;

    try {
      const events = await fetchSportEvents(sportKey);
      state.calendar.removeAllEvents();
      state.calendar.addEventSource(toFullCalendarEvents(events));

      const viewDate = state.calendar.getDate();
      renderHighlights(events, viewDate);
    } catch (e) {
      console.error(e);
      document.getElementById("highlights").innerHTML = `<article class="card"><h3 class="title">Could not load ${cfg.label} sheet</h3></article>`;
      state.calendar.removeAllEvents();
    }
  }

  function buildTabs() {
    const wrap = document.getElementById("sportTabs");
    wrap.innerHTML = SPORTS.map(s =>
      `<button class="sport-tab ${s.key===state.activeSport ? "active" : ""}" data-key="${s.key}">${s.label}</button>`
    ).join("");

    wrap.addEventListener("click", (e) => {
      const btn = e.target.closest(".sport-tab");
      if (!btn) return;
      const key = btn.dataset.key;
      if (!key || key === state.activeSport) return;
      switchSport(key);
    });
  }

  function updateTabs() {
    document.querySelectorAll(".sport-tab").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.key === state.activeSport);
    });
  }

  function initCalendar() {
    const el = document.getElementById("calendar");
    state.calendar = new FullCalendar.Calendar(el, {
      initialView: "dayGridMonth",
      fixedWeekCount: true,
      showNonCurrentDates: true,
      dayMaxEventRows: 3,
      height: "auto",
      eventDisplay: "block",
      headerToolbar: {
        left: "title",
        center: "",
        right: "today prev,next"
      },
      datesSet: async (info) => {
        const events = state.cache.get(state.activeSport) || [];
        renderHighlights(events, info.start);
      }
    });
    state.calendar.render();
  }

  async function init() {
    buildTabs();
    initCalendar();
    await switchSport("f1");
  }

  init();
})();
