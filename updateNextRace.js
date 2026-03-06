// updateNextRace.js
import fs from "fs/promises";

// -------------------- CONFIG --------------------
const OPENF1_JSON = "https://raw.githubusercontent.com/MarkRedman/F1-standings-data/main/openf1_next_race.json";

// -------------------- TIME HELPERS --------------------
function daysUntilUtc(date, now = new Date()) {
  const ms = new Date(date).getTime() - now.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

// -------------------- UTILS --------------------
function countryToIso2(countryName) {
  const map = {
    australia: "au",
    bahrain: "bh",
    china: "cn",
    japan: "jp",
    "saudi arabia": "sa",
    qatar: "qa",
    singapore: "sg",
    "united arab emirates": "ae",
    uae: "ae",
    canada: "ca",
    mexico: "mx",
    brazil: "br",
    argentina: "ar",
    "united states": "us",
    usa: "us",
    "united kingdom": "gb",
    greatbritain: "gb",
    monaco: "mc",
    italy: "it",
    spain: "es",
    france: "fr",
    belgium: "be",
    netherlands: "nl",
    austria: "at",
    hungary: "hu",
    germany: "de",
    portugal: "pt",
    sweden: "se",
    finland: "fi",
    denmark: "dk",
    norway: "no",
    poland: "pl",
    turkey: "tr",
    switzerland: "ch",
  };
  if (!countryName) return null;
  return map[countryName.toLowerCase().replace(/\s/g, "")] || null;
}

function buildFlagUrls(iso2) {
  if (!iso2) return { iso2: null, png: null, svg: null };
  const code = iso2.toLowerCase();
  return {
    iso2: code,
    png: `https://flagcdn.com/w160/${code}.png`,
    svg: `https://flagcdn.com/${code}.svg`,
  };
}

function buildSessionsUtc(sessions) {
  if (!sessions) return [];
  return sessions.map((s) => ({
    type: s.type,
    startUtc: s.startUtc,
    endUtc: s.endUtc,
  }));
}

function computeWindowUtc(sessions) {
  if (!sessions || !sessions.length) return { startUtc: null, endUtc: null };
  const starts = sessions.map((s) => new Date(s.startUtc)).filter((d) => !isNaN(d));
  const ends = sessions.map((s) => new Date(s.endUtc)).filter((d) => !isNaN(d));
  return {
    startUtc: starts.length ? new Date(Math.min(...starts)).toISOString() : null,
    endUtc: ends.length ? new Date(Math.max(...ends)).toISOString() : null,
  };
}

// -------------------- MAIN --------------------
async function updateNextRace() {
  try {
    const res = await fetch(OPENF1_JSON);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching JSON`);
    const data = await res.json();

    const nextEventRaw = data.nextEvent || {};
    const weekendStart = nextEventRaw.weekend?.startUtc;
    const sessions = buildSessionsUtc(nextEventRaw.sessions || []);
    const window = computeWindowUtc(sessions);

    const country = nextEventRaw.location?.raw || null;
    const iso2 = countryToIso2(country);
    const flag = buildFlagUrls(iso2);

    const out = {
      header: "Next F1 event",
      generatedAtUtc: new Date().toISOString(),
      source: { kind: "openf1", url: OPENF1_JSON },
      nextEvent: {
        type: "RACE_WEEKEND",
        title: nextEventRaw.title || null,
        season: nextEventRaw.season || null,
        location: {
          raw: country,
          city: nextEventRaw.location?.city || null,
          country,
          flag,
        },
        racePage: nextEventRaw.racePage || null,
        trackMap: nextEventRaw.trackMap || null,
        countdowns: { startsInDays: weekendStart ? daysUntilUtc(weekendStart) : null },
        weekend: { startUtc: window.startUtc, endUtc: window.endUtc },
        sessions,
      },
    };

    await fs.writeFile("f1_next_race.json", JSON.stringify(out, null, 2), "utf8");
    console.log("✅ f1_next_race.json updated (UTC times)");
  } catch (err) {
    console.error("❌ Error updating next race:", err);
    process.exit(1);
  }
}

updateNextRace();
