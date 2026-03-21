// updateAllRaces.js
import fs from "node:fs/promises";
import ical from "node-ical";

const ICS_URL = "https://better-f1-calendar.vercel.app/api/calendar.ics";
const USER_TZ = "America/Edmonton";
const LOCALE = "en-CA";
const OUTPUT_FILE = "f1_all_races.json";

/* -------------------- explicit race aliases -------------------- */

const CANONICAL_RACE_KEYS = {
  australia: [
    "australiangrandprix",
    "australiangp",
    "melbourne",
  ],
  china: [
    "chinesegrandprix",
    "chinagrandprix",
    "chinesegp",
    "shanghai",
  ],
  japan: [
    "japanesegrandprix",
    "japangrandprix",
    "japanesegp",
    "suzuka",
  ],
  bahrain: [
    "bahraingrandprix",
    "bahraingp",
    "sakhir",
    "bahrain",
  ],
  "saudi-arabia": [
    "saudiarabiangrandprix",
    "saudiarabiagp",
    "saudigrandprix",
    "jeddah",
    "saudiarabia",
  ],
  miami: [
    "miamigrandprix",
    "miamigp",
    "miami",
  ],
  monaco: [
    "monacograndprix",
    "monacogp",
    "monaco",
    "montecarlo",
  ],
  spain: [
    "spanishgrandprix",
    "spaingrandprix",
    "spanishgp",
    "barcelona",
    "madridgrandprix",
    "madridgp",
    "madrid",
  ],
  canada: [
    "canadiangrandprix",
    "canadagrandprix",
    "canadiangp",
    "montreal",
  ],
  austria: [
    "austriangrandprix",
    "austriagrandprix",
    "austriangp",
    "spielberg",
  ],
  "great-britain": [
    "britishgrandprix",
    "greatbritaingrandprix",
    "britishgp",
    "silverstone",
  ],
  belgium: [
    "belgiangrandprix",
    "belgiumgrandprix",
    "belgiangp",
    "spafrancorchamps",
    "spa",
  ],
  hungary: [
    "hungariangrandprix",
    "hungarygrandprix",
    "hungariangp",
    "budapest",
    "hungaroring",
  ],
  netherlands: [
    "dutchgrandprix",
    "netherlandsgrandprix",
    "dutchgp",
    "zandvoort",
  ],
  italy: [
    "italiangrandprix",
    "italygrandprix",
    "italiangp",
    "monza",
  ],
  azerbaijan: [
    "azerbaijangrandprix",
    "azerbaijangp",
    "baku",
  ],
  singapore: [
    "singaporegrandprix",
    "singaporegp",
    "singapore",
  ],
  "united-states": [
    "unitedstatesgrandprix",
    "usgrandprix",
    "unitedstatesgp",
    "austin",
    "cota",
  ],
  mexico: [
    "mexicocitygrandprix",
    "mexicangrandprix",
    "mexicograndprix",
    "mexicocity",
    "mexico",
  ],
  "sao-paulo": [
    "saopaulograndprix",
    "braziliangrandprix",
    "brazilgrandprix",
    "saopaulo",
    "interlagos",
  ],
  "las-vegas": [
    "lasvegasgrandprix",
    "lasvegasgp",
    "lasvegas",
  ],
  qatar: [
    "qatargrandprix",
    "qatargp",
    "lusail",
    "qatar",
  ],
  "abu-dhabi": [
    "abudhabigrandprix",
    "abudhabigp",
    "yasmarina",
    "abudhabi",
  ],
  "emilia-romagna": [
    "emiliaromagnagrandprix",
    "emiliaromagnagp",
    "imola",
  ],
};

const OMIT_RACES = new Set(["bahrain", "saudi-arabia"]);

/* -------------------- helpers -------------------- */

function cleanText(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/formula\s*1/g, "")
    .replace(/f1/g, "")
    .replace(/grand\s*prix/g, "grandprix")
    .replace(/gp/g, "gp")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function getSessionType(summary) {
  const s = String(summary || "").toLowerCase();

  if (s.includes("practice 1") || s.includes("fp1")) return "FP1";
  if (s.includes("practice 2") || s.includes("fp2")) return "FP2";
  if (s.includes("practice 3") || s.includes("fp3")) return "FP3";
  if (s.includes("sprint qualifying") || s.includes("sprint qualification") || s.includes("shootout")) return "Sprint Qualifying";
  if (s.includes("sprint") && !s.includes("qualifying") && !s.includes("shootout")) return "Sprint";
  if (s.includes("qualifying") && !s.includes("sprint")) return "Qualifying";
  if (s.includes("race") || s.includes("grand prix")) return "Race";

  return null;
}

function getGpName(summary) {
  return String(summary || "").split(" - ")[0].trim();
}

function shortDate(date) {
  return date.toLocaleDateString(LOCALE, {
    timeZone: USER_TZ,
    weekday: "short",
    month: "short",
    day: "2-digit",
  });
}

function shortTime(date) {
  return date.toLocaleTimeString(LOCALE, {
    timeZone: USER_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function canonicalRaceKey(name, location = "", summary = "") {
  const candidates = [
    cleanText(name),
    cleanText(location),
    cleanText(summary),
    cleanText(`${name} ${location}`),
  ];

  for (const [canonical, aliases] of Object.entries(CANONICAL_RACE_KEYS)) {
    if (candidates.some((c) => aliases.some((a) => c.includes(a) || a.includes(c)))) {
      return canonical;
    }
  }

  return cleanText(name);
}

function isCancelledEvent(summary, description = "") {
  const text = `${summary} ${description}`.toLowerCase();
  return (
    text.includes("called off") ||
    text.includes("cancelled") ||
    text.includes("canceled") ||
    text.includes("postponed")
  );
}

function preferredDisplayName(canonicalKey, existingName, summary, location) {
  const fallbackNames = {
    australia: "Australian Grand Prix",
    china: "Chinese Grand Prix",
    japan: "Japanese Grand Prix",
    bahrain: "Bahrain Grand Prix",
    "saudi-arabia": "Saudi Arabian Grand Prix",
    miami: "Miami Grand Prix",
    monaco: "Monaco Grand Prix",
    spain: "Spanish Grand Prix",
    canada: "Canadian Grand Prix",
    austria: "Austrian Grand Prix",
    "great-britain": "British Grand Prix",
    belgium: "Belgian Grand Prix",
    hungary: "Hungarian Grand Prix",
    netherlands: "Dutch Grand Prix",
    italy: "Italian Grand Prix",
    azerbaijan: "Azerbaijan Grand Prix",
    singapore: "Singapore Grand Prix",
    "united-states": "United States Grand Prix",
    mexico: "Mexico City Grand Prix",
    "sao-paulo": "São Paulo Grand Prix",
    "las-vegas": "Las Vegas Grand Prix",
    qatar: "Qatar Grand Prix",
    "abu-dhabi": "Abu Dhabi Grand Prix",
    "emilia-romagna": "Emilia Romagna Grand Prix",
  };

  if (fallbackNames[canonicalKey]) return fallbackNames[canonicalKey];
  return existingName || getGpName(summary) || location || canonicalKey;
}

function dedupeSessions(sessions) {
  const map = new Map();

  for (const s of sessions) {
    const key = `${s.type}|${s.start.toISOString()}`;
    if (!map.has(key)) {
      map.set(key, s);
    }
  }

  return Array.from(map.values()).sort((a, b) => a.start - b.start);
}

/* -------------------- main -------------------- */

async function updateAllRaces() {
  console.log("Fetching ICS…");

  const res = await fetch(ICS_URL, {
    headers: {
      "User-Agent": "f1-standings-bot/1.0",
      Accept: "text/calendar,text/plain,*/*",
    },
    redirect: "follow",
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch ICS: HTTP ${res.status}`);
  }

  const icsText = await res.text();
  const data = ical.parseICS(icsText);

  const events = Object.values(data).filter((e) => e?.type === "VEVENT");
  console.log("Raw VEVENT count:", events.length);

  const sessionRows = events
    .map((ev) => {
      const summary = String(ev.summary || "").trim();
      const description = String(ev.description || "").trim();
      const location = String(ev.location || "").trim();
      const type = getSessionType(summary);

      if (!type) return null;
      if (isCancelledEvent(summary, description)) return null;

      const start = new Date(ev.start);
      const end = new Date(ev.end);

      if (isNaN(start) || isNaN(end)) return null;

      const gpName = getGpName(summary);
      const raceKey = canonicalRaceKey(gpName, location, summary);

      return {
        raceKey,
        gpName,
        type,
        start,
        end,
        location,
        summary,
        description,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  console.log("Parsed session count:", sessionRows.length);

  const grouped = new Map();

  for (const row of sessionRows) {
    if (!grouped.has(row.raceKey)) {
      grouped.set(row.raceKey, {
        raceKey: row.raceKey,
        name: preferredDisplayName(row.raceKey, row.gpName, row.summary, row.location),
        location: row.location || "",
        sessions: [],
      });
    }

    const race = grouped.get(row.raceKey);

    if (!race.location && row.location) {
      race.location = row.location;
    }

    race.sessions.push({
      type: row.type,
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
    .filter((race) => race.sessions.some((s) => s.type === "Race"));

  console.log("Unique races before omit:", races.length);

  races = races.filter((race) => !OMIT_RACES.has(race.raceKey));

  console.log("Unique races after omit:", races.length);

  races.sort((a, b) => {
    const aStart = a.sessions[0]?.start?.getTime?.() ?? 0;
    const bStart = b.sessions[0]?.start?.getTime?.() ?? 0;
    return aStart - bStart;
  });

  const output = {
    header: "All F1 races",
    generatedAtUtc: new Date().toISOString(),
    displayTimeZone: USER_TZ,
    totalRaces: races.length,
    races: races.map((race, index) => ({
      round: index + 1,
      key: race.raceKey,
      name: race.name,
      location: race.location || null,
      weekend: {
        startUtc: race.sessions[0]?.start?.toISOString?.() ?? null,
        endUtc: race.sessions[race.sessions.length - 1]?.end?.toISOString?.() ?? null,
      },
      sessions: race.sessions.map((s) => ({
        type: s.type,
        startUtc: s.start.toISOString(),
        endUtc: s.end.toISOString(),
        startLocalDate: shortDate(s.start),
        startLocalTime: shortTime(s.start),
      })),
    })),
  };

  await fs.writeFile(OUTPUT_FILE, JSON.stringify(output, null, 2), "utf8");
  console.log(`Wrote ${OUTPUT_FILE}`);
}

updateAllRaces().catch((err) => {
  console.error(err);
  process.exit(1);
});
