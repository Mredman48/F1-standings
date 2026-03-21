// updateSeasonCalendar.js
import fs from "node:fs/promises";
import ical from "node-ical";

const ICS_URL = "https://better-f1-calendar.vercel.app/api/calendar.ics";
const USER_TZ = "America/Edmonton";
const LOCALE = "en-CA";
const OUTPUT_FILE = "f1_season_calendar.json";

/* -------------------- omit canceled races -------------------- */

const OMIT_RACE_KEYS = new Set([
  "bahrain",
  "saudi-arabia",
]);

/* -------------------- helpers -------------------- */
function daysUntil(date, now = new Date()) {
  const ms = date.getTime() - now.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function shortDateInTZ(dateObj, timeZone = USER_TZ) {
  ...
}

function shortTimeInTZ(dateObj, timeZone = USER_TZ) {
  ...
}

function shortDateTimeInTZ(dateObj, timeZone = USER_TZ) {
  return `${shortDateInTZ(dateObj, timeZone)} ${shortTimeInTZ(dateObj, timeZone)}`;
}

function daysUntil(date, now = new Date()) {
  const ms = date.getTime() - now.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^formula 1\s+/i, "")
    .replace(/^f1\s+/i, "")
    .replace(/grand prix/g, "grandprix")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function titleCaseWords(s) {
  if (!s) return null;
  return String(s)
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

function shortDateInTZ(dateObj, timeZone = USER_TZ) {
  return dateObj.toLocaleDateString(LOCALE, {
    timeZone,
    weekday: "short",
    month: "short",
    day: "2-digit",
  });
}

function shortTimeInTZ(dateObj, timeZone = USER_TZ) {
  return dateObj.toLocaleTimeString(LOCALE, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function shortDateTimeInTZ(dateObj, timeZone = USER_TZ) {
  return `${shortDateInTZ(dateObj, timeZone)} ${shortTimeInTZ(dateObj, timeZone)}`;
}

/* -------------------- race key resolution -------------------- */

function canonicalRaceKey(gpName, location = "", summary = "") {
  const gp = normalize(gpName);
  const loc = normalize(location);
  const sum = normalize(summary);

  if (gp.includes("australian") || loc.includes("melbourne") || sum.includes("australian")) return "australia";
  if (gp.includes("chinese") || loc.includes("shanghai") || sum.includes("chinese")) return "china";
  if (gp.includes("japanese") || loc.includes("suzuka") || sum.includes("japanese")) return "japan";
  if (gp.includes("bahrain") || loc.includes("bahrain")) return "bahrain";
  if (gp.includes("saudi") || loc.includes("jeddah") || sum.includes("saudi")) return "saudi-arabia";
  if (gp.includes("miami") || loc.includes("miami")) return "miami";
  if (gp.includes("monaco") || loc.includes("monaco") || loc.includes("montecarlo")) return "monaco";
  if (gp.includes("spanish") || loc.includes("barcelona")) return "spain";
  if (gp.includes("canadian") || loc.includes("montreal")) return "canada";
  if (gp.includes("austrian") || loc.includes("spielberg")) return "austria";
  if (gp.includes("british") || loc.includes("silverstone")) return "great-britain";
  if (gp.includes("belgian") || loc.includes("spa")) return "belgium";
  if (gp.includes("hungarian") || loc.includes("budapest") || loc.includes("hungaroring")) return "hungary";
  if (gp.includes("dutch") || loc.includes("zandvoort")) return "netherlands";
  if (gp.includes("italian") || loc.includes("monza")) return "italy";
  if (gp.includes("azerbaijan") || loc.includes("baku")) return "azerbaijan";
  if (gp.includes("singapore") || loc.includes("singapore")) return "singapore";
  if (gp.includes("unitedstates") || gp.includes("usgrandprix") || loc.includes("austin")) return "united-states";
  if (gp.includes("mexicocity") || gp.includes("mexican") || loc.includes("mexicocity")) return "mexico";
  if (gp.includes("saopaulo") || gp.includes("brazilian") || loc.includes("interlagos")) return "sao-paulo";
  if (gp.includes("lasvegas") || loc.includes("lasvegas")) return "las-vegas";
  if (gp.includes("qatar") || loc.includes("lusail")) return "qatar";
  if (gp.includes("abudhabi") || loc.includes("yasmarina")) return "abu-dhabi";
  if (gp.includes("emiliaromagna") || loc.includes("imola")) return "emilia-romagna";
  if (gp.includes("madrid") || loc.includes("madrid")) return "madrid";

  return gp || sum;
}

/* -------------------- display mappings -------------------- */

const DISPLAY_TITLE_BY_KEY = {
  australia: "FORMULA 1 AUSTRALIAN GRAND PRIX",
  china: "FORMULA 1 CHINESE GRAND PRIX",
  japan: "FORMULA 1 JAPANESE GRAND PRIX",
  bahrain: "FORMULA 1 BAHRAIN GRAND PRIX",
  "saudi-arabia": "FORMULA 1 SAUDI ARABIAN GRAND PRIX",
  miami: "FORMULA 1 MIAMI GRAND PRIX",
  monaco: "FORMULA 1 MONACO GRAND PRIX",
  spain: "FORMULA 1 SPANISH GRAND PRIX",
  canada: "FORMULA 1 CANADIAN GRAND PRIX",
  austria: "FORMULA 1 AUSTRIAN GRAND PRIX",
  "great-britain": "FORMULA 1 BRITISH GRAND PRIX",
  belgium: "FORMULA 1 BELGIAN GRAND PRIX",
  hungary: "FORMULA 1 HUNGARIAN GRAND PRIX",
  netherlands: "FORMULA 1 DUTCH GRAND PRIX",
  italy: "FORMULA 1 ITALIAN GRAND PRIX",
  azerbaijan: "FORMULA 1 AZERBAIJAN GRAND PRIX",
  singapore: "FORMULA 1 SINGAPORE GRAND PRIX",
  "united-states": "FORMULA 1 UNITED STATES GRAND PRIX",
  mexico: "FORMULA 1 MEXICO CITY GRAND PRIX",
  "sao-paulo": "FORMULA 1 SAO PAULO GRAND PRIX",
  "las-vegas": "FORMULA 1 LAS VEGAS GRAND PRIX",
  qatar: "FORMULA 1 QATAR GRAND PRIX",
  "abu-dhabi": "FORMULA 1 ABU DHABI GRAND PRIX",
  "emilia-romagna": "FORMULA 1 EMILIA ROMAGNA GRAND PRIX",
  madrid: "FORMULA 1 MADRID GRAND PRIX",
};

const LOCATION_BY_KEY = {
  australia: { city: "Melbourne", country: "Australia", iso2: "au" },
  china: { city: "Shanghai", country: "China", iso2: "cn" },
  japan: { city: "Suzuka", country: "Japan", iso2: "jp" },
  bahrain: { city: "Sakhir", country: "Bahrain", iso2: "bh" },
  "saudi-arabia": { city: "Jeddah", country: "Saudi Arabia", iso2: "sa" },
  miami: { city: "Miami", country: "United States", iso2: "us" },
  monaco: { city: "Monaco", country: "Monaco", iso2: "mc" },
  spain: { city: "Barcelona", country: "Spain", iso2: "es" },
  canada: { city: "Montreal", country: "Canada", iso2: "ca" },
  austria: { city: "Spielberg", country: "Austria", iso2: "at" },
  "great-britain": { city: "Silverstone", country: "United Kingdom", iso2: "gb" },
  belgium: { city: "Spa-Francorchamps", country: "Belgium", iso2: "be" },
  hungary: { city: "Budapest", country: "Hungary", iso2: "hu" },
  netherlands: { city: "Zandvoort", country: "Netherlands", iso2: "nl" },
  italy: { city: "Monza", country: "Italy", iso2: "it" },
  azerbaijan: { city: "Baku", country: "Azerbaijan", iso2: "az" },
  singapore: { city: "Singapore", country: "Singapore", iso2: "sg" },
  "united-states": { city: "Austin", country: "United States", iso2: "us" },
  mexico: { city: "Mexico City", country: "Mexico", iso2: "mx" },
  "sao-paulo": { city: "Sao Paulo", country: "Brazil", iso2: "br" },
  "las-vegas": { city: "Las Vegas", country: "United States", iso2: "us" },
  qatar: { city: "Lusail", country: "Qatar", iso2: "qa" },
  "abu-dhabi": { city: "Abu Dhabi", country: "United Arab Emirates", iso2: "ae" },
  "emilia-romagna": { city: "Imola", country: "Italy", iso2: "it" },
  madrid: { city: "Madrid", country: "Spain", iso2: "es" },
};

const MAP_FILE_BY_KEY = {
  australia: "melbourne.png",
  china: "shanghai.png",
  japan: "suzuka.png",
  bahrain: "bahrain.png",
  "saudi-arabia": "jeddah.png",
  miami: "miami.png",
  monaco: "monaco.png",
  spain: "barcelona.png",
  canada: "montreal.png",
  austria: "spielberg.png",
  "great-britain": "silverstone.png",
  belgium: "spa.png",
  hungary: "hungaroring.png",
  netherlands: "zandvoort.png",
  italy: "monza.png",
  azerbaijan: "baku.png",
  singapore: "singapore.png",
  "united-states": "austin.png",
  mexico: "mexico-city.png",
  "sao-paulo": "interlagos.png",
  "las-vegas": "las-vegas.png",
  qatar: "lusail.png",
  "abu-dhabi": "yas-marina.png",
  "emilia-romagna": "imola.png",
  madrid: "madrid.png",
};

function buildFlag(iso2) {
  if (!iso2) {
    return { iso2: null, png: null, svg: null };
  }

  return {
    iso2,
    png: `https://flagcdn.com/w160/${iso2}.png`,
    svg: `https://flagcdn.com/${iso2}.svg`,
  };
}

function buildMap(key) {
  const filename = MAP_FILE_BY_KEY[key] || null;

  if (!filename) {
    return {
      found: false,
      filename: null,
      pngUrl: null,
      note: `No custom map file configured for key "${key}".`,
    };
  }

  return {
    found: true,
    filename,
    pngUrl: `${PAGES_BASE}/maps/${encodeURIComponent(filename)}`,
    note: null,
  };
}

/* -------------------- session parsing -------------------- */

function getSessionType(summary) {
  const s = String(summary || "").toLowerCase().trim();

  if (/\b(practice\s*1|fp1)\b/.test(s)) return "FP1";
  if (/\b(practice\s*2|fp2)\b/.test(s)) return "FP2";
  if (/\b(practice\s*3|fp3)\b/.test(s)) return "FP3";

  if (
    /\b(sprint\s+qualifying|sprint\s+qualification|sprint\s+shootout|sq)\b/.test(s) ||
    (/\bsprint\b/.test(s) && /\b(qualifying|qualification|shootout)\b/.test(s))
  ) {
    return "Sprint Qualifying";
  }

  if (/\bqualifying\b/.test(s) && !/\bsprint\b/.test(s)) return "Qualifying";
  if (/\bqualification\b/.test(s) && !/\bsprint\b/.test(s)) return "Qualifying";
  if (/\bsprint\b/.test(s)) return "Sprint";

  if (
    /\b(race|grand prix)\b/.test(s) &&
    !/\bqualifying\b/.test(s) &&
    !/\bqualification\b/.test(s) &&
    !/\bsprint\b/.test(s)
  ) {
    return "Race";
  }

  return null;
}

function getGpName(summary) {
  const parts = String(summary || "").split(" - ");
  return (parts[0] || summary || "").trim();
}

function displaySessionType(type) {
  if (type === "Qualifying") return "Quali";
  if (type === "Sprint Qualifying") return "Sprint Quali";
  return type;
}

function dedupeSessions(sessions) {
  const map = new Map();

  for (const s of sessions) {
    const key = `${s.sessionType}|${s.start.toISOString()}`;
    if (!map.has(key)) {
      map.set(key, s);
    }
  }

  return Array.from(map.values()).sort((a, b) => a.start - b.start);
}

function buildSessionsOut(gpSessions) {
  return gpSessions.map((s) => ({
    type: displaySessionType(s.sessionType),
    startUtc: s.start.toISOString(),
    endUtc: s.end.toISOString(),
    startLocalDateShort: shortDateInTZ(s.start),
    startLocalTimeShort: shortTimeInTZ(s.start),
    startLocalDateTimeShort: shortDateTimeInTZ(s.start),
  }));
}

function computeWindowFromSessions(sessions) {
  if (!sessions || sessions.length === 0) {
    return { startUtc: null, endUtc: null };
  }

  const starts = sessions.map((s) => new Date(s.startUtc)).filter((d) => !isNaN(d));
  const ends = sessions.map((s) => new Date(s.endUtc)).filter((d) => !isNaN(d));

  return {
    startUtc: starts.length ? new Date(Math.min(...starts)).toISOString() : null,
    endUtc: ends.length ? new Date(Math.max(...ends)).toISOString() : null,
  };
}

/* -------------------- main -------------------- */

async function updateSeasonCalendar() {
  const now = new Date();

  console.log("Fetching ICS...");
  const res = await fetch(ICS_URL, {
    headers: {
      Accept: "text/calendar,text/plain,*/*",
      "User-Agent": "f1-standings-bot/1.0",
    },
    redirect: "follow",
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch ICS: HTTP ${res.status}`);
  }

  const icsText = await res.text();

  console.log("Parsing ICS...");
  const parsed = ical.parseICS(icsText);

  const events = Object.values(parsed).filter((x) => x?.type === "VEVENT");
  console.log("VEVENT count:", events.length);

  const allSessions = events
    .map((ev) => {
      const summary = String(ev.summary || "").trim();
      const sessionType = getSessionType(summary);
      if (!sessionType) return null;

      const start = ev.start instanceof Date ? ev.start : new Date(ev.start);
      const end = ev.end instanceof Date ? ev.end : new Date(ev.end);
      if (isNaN(start) || isNaN(end)) return null;

      const gpName = getGpName(summary);
      const location = String(ev.location || "").trim();
      const raceKey = canonicalRaceKey(gpName, location, summary);

      return {
        raceKey,
        gpName,
        sessionType,
        start,
        end,
        location,
        summary,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  console.log("Parsed session count:", allSessions.length);

  const grouped = new Map();

  for (const row of allSessions) {
    if (!grouped.has(row.raceKey)) {
      grouped.set(row.raceKey, {
        raceKey: row.raceKey,
        gpName: row.gpName,
        locationRaw: row.location,
        sessions: [],
      });
    }

    const race = grouped.get(row.raceKey);

    if (!race.locationRaw && row.location) {
      race.locationRaw = row.location;
    }

    race.sessions.push({
      sessionType: row.sessionType,
      start: row.start,
      end: row.end,
      summary: row.summary,
    });
  }

  let races = Array.from(grouped.values())
    .map((race) => ({
      ...race,
      sessions: dedupeSessions(race.sessions),
    }))
    .filter((race) => race.sessions.some((s) => s.sessionType === "Race"));

  console.log("Unique races before omit:", races.length);

  races = races.filter((race) => !OMIT_RACE_KEYS.has(race.raceKey));

  console.log("Unique races after omit:", races.length);

  races.sort((a, b) => {
    const aStart = a.sessions[0]?.start?.getTime?.() ?? 0;
    const bStart = b.sessions[0]?.start?.getTime?.() ?? 0;
    return aStart - bStart;
  });

  const seasonCalendar = races.map((race, index) => {
    const season = String(race.sessions[0]?.start?.getUTCFullYear?.() ?? new Date().getUTCFullYear());
    const title = DISPLAY_TITLE_BY_KEY[race.raceKey] || titleCaseWords(race.gpName) || race.gpName;
    const locationData = LOCATION_BY_KEY[race.raceKey] || {
      city: null,
      country: titleCaseWords(race.locationRaw) || null,
      iso2: null,
    };

    const sessionsOut = buildSessionsOut(race.sessions);
    const window = computeWindowFromSessions(sessionsOut);
    const weekendStart = window.startUtc ? new Date(window.startUtc) : race.sessions[0].start;

    return {
      round: index + 1,
      type: "RACE_WEEKEND",
      title,
      season,
      location: {
        raw: race.locationRaw || null,
        city: locationData.city,
        country: locationData.country,
        flag: buildFlag(locationData.iso2),
      },
      raceKey: race.raceKey,
      countdowns: {
        startsInDays: daysUntil(weekendStart, now),
      },
      weekend: {
        startUtc: window.startUtc,
        endUtc: window.endUtc,
      },
      map: buildMap(race.raceKey),
      sessions: sessionsOut,
    };
  });

  const out = {
    header: "F1 season calendar",
    generatedAtUtc: now.toISOString(),
    displayTimeZone: USER_TZ,
    source: {
      kind: "ics",
      url: ICS_URL,
    },
    totalRaces: seasonCalendar.length,
    seasonCalendar,
  };

  await fs.writeFile(OUTPUT_FILE, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUTPUT_FILE}`);
}

updateSeasonCalendar().catch((err) => {
  console.error(err);
  process.exit(1);
});
