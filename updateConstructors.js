// updateConstructors.js
import fs from "node:fs/promises";

const UA = "f1-standings-bot";

const OUT_JSON = "f1_constructors_standings.json";

const YEAR = new Date().getUTCFullYear();

const FOH_CONSTRUCTORS_URL =
  `https://www.formulaonehistory.com/results/${YEAR}-f1-constructors-championship-standings/`;

const F1_RESULTS_RACES_URL =
  `https://www.formula1.com/en/results/${YEAR}/races`;

const PAGES_BASE = "https://mredman48.github.io/F1-standings";
const TEAMLOGOS_DIR = "teamlogos";
const CACHE_BUST = true;

/* ------------------------------------------------ */
/* TEAM NORMALIZATION */
/* ------------------------------------------------ */

const TEAM_NAME_OVERRIDES = {
  "RB F1 Team": "VCARB",
  "Visa Cash App RB": "VCARB",
  "Racing Bulls": "VCARB",
  "Haas F1 Team": "Haas",
  "MoneyGram Haas F1 Team": "Haas",
  "Alpine F1 Team": "Alpine",
  "Red Bull Racing": "Red Bull",
  "Oracle Red Bull Racing": "Red Bull",
  "Stake F1 Team Kick Sauber": "Audi",
  "Kick Sauber": "Audi",
  "Audi Formula 1 Team": "Audi",
  "McLaren Formula 1 Team": "McLaren",
  "Mercedes-AMG Petronas F1 Team": "Mercedes",
};

function normalizeTeamName(name) {
  return TEAM_NAME_OVERRIDES[name] || name;
}

/* ------------------------------------------------ */
/* TEAM LOGOS */
/* ------------------------------------------------ */

const TEAM_LOGOS_LOCAL = {
  "red bull": "2025_red-bull_color_v2.png",
  ferrari: "2025_ferrari_color_v2.png",
  mercedes: "2025_mercedes_color_v2.png",
  mclaren: "2025_mclaren_color_v2.png",
  "aston martin": "2025_aston-martin_color_v2.png",
  alpine: "2025_alpine_color_v2.png",
  williams: "2025_williams_color_v2.png",
  haas: "2025_haas_color_v2.png",
  audi: "audi_logo_colored.png",
  vcarb: "2025_vcarb_color_v2.png",
  cadillac: "2025_cadillac_color_v2.png",
};

function normalizeKey(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function logo(team) {
  const key = normalizeKey(team);
  const file = TEAM_LOGOS_LOCAL[key];
  if (!file) return null;

  const url = `${PAGES_BASE}/${TEAMLOGOS_DIR}/${file}`;
  return CACHE_BUST ? `${url}?v=${Date.now()}` : url;
}

/* ------------------------------------------------ */
/* RACE LOCATION MAP */
/* ------------------------------------------------ */

const RACE_LOCATION_MAP = {
  australia: { city: "Melbourne", country: "Australia" },
  chinese: { city: "Shanghai", country: "China" },
  japan: { city: "Suzuka", country: "Japan" },
  bahrain: { city: "Sakhir", country: "Bahrain" },
  monaco: { city: "Monte Carlo", country: "Monaco" },
  canada: { city: "Montreal", country: "Canada" },
  british: { city: "Silverstone", country: "United Kingdom" },
  belgian: { city: "Spa", country: "Belgium" },
  italian: { city: "Monza", country: "Italy" },
  singapore: { city: "Singapore", country: "Singapore" },
  qatar: { city: "Lusail", country: "Qatar" },
  abu: { city: "Abu Dhabi", country: "UAE" },
};

/* ------------------------------------------------ */
/* HELPERS */
/* ------------------------------------------------ */

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}`);
  }

  return res.text();
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------ */
/* PARSE STANDINGS */
/* ------------------------------------------------ */

function parseStandings(html) {
  const text = htmlToText(html);

  const sectionStart = text.indexOf("Constructors Championship Standings");

  if (sectionStart === -1) {
    return { rows: [], reason: "heading_not_found" };
  }

  const section = text.slice(sectionStart);

  const rows = [];

  const regex = /(\d+)\s+([A-Za-z0-9\s\-'.&]+?)\s+(\d+)/g;

  for (const m of section.matchAll(regex)) {
    const pos = Number(m[1]);
    const teamRaw = m[2].trim();
    const pts = Number(m[3]);

    if (pos > 15) continue;

    rows.push({
      position: `P${pos}`,
      team: normalizeTeamName(teamRaw),
      points: pts,
      wins: "-",
      teamLogoPng: logo(teamRaw),
    });
  }

  const unique = [];
  const seen = new Set();

  for (const r of rows) {
    const k = normalizeKey(r.team);
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(r);
  }

  return {
    rows: unique,
    reason: unique.length ? null : "no_rows_parsed",
  };
}

/* ------------------------------------------------ */
/* PARSE LAST RACE */
/* ------------------------------------------------ */

function parseLastRace(html) {
  const lines = html
    .replace(/<[^>]+>/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  for (let i = 0; i < lines.length - 5; i++) {
    const race = lines[i];
    const date = lines[i + 1];
    const winner = lines[i + 2];
    const team = lines[i + 3];
    const laps = lines[i + 4];
    const time = lines[i + 5];

    if (!/^[A-Za-z\s]+$/.test(race)) continue;
    if (!/^\d{2}\s[A-Za-z]{3}$/.test(date)) continue;

    const raceKey = normalizeKey(race).split(" ")[0];
    const loc = RACE_LOCATION_MAP[raceKey] || {};

    return {
      season: YEAR,
      round: "latest",
      raceName: race,
      date,
      timeUtc: time,
      circuit: {
        name: "-",
        locality: loc.city || "-",
        country: loc.country || "-",
      },
      winner: {
        name: winner,
        team,
        laps,
      },
    };
  }

  return null;
}

/* ------------------------------------------------ */
/* MAIN */
/* ------------------------------------------------ */

async function updateConstructors() {
  const [standingsHtml, racesHtml] = await Promise.all([
    fetchText(FOH_CONSTRUCTORS_URL),
    fetchText(F1_RESULTS_RACES_URL),
  ]);

  const parsedStandings = parseStandings(standingsHtml);
  const lastRace = parseLastRace(racesHtml);

  const constructors = parsedStandings.rows;

  const out = {
    header: "Constructors standings",
    generatedAtUtc: new Date().toISOString(),

    sources: {
      constructors: FOH_CONSTRUCTORS_URL,
      races: F1_RESULTS_RACES_URL,
    },

    meta: {
      standingsParseReason: parsedStandings.reason,
    },

    lastRace,

    constructors,
  };

  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2));

  console.log(
    `Wrote ${OUT_JSON} constructors=${constructors.length}`
  );
}

updateConstructors().catch((err) => {
  console.error(err);
  process.exit(1);
});