// updateConstructors.js

import fs from "node:fs/promises";

const UA = "f1-standings-bot";

const YEAR = new Date().getUTCFullYear();

const OUT_JSON = "f1_constructors_standings.json";

const PAGES_BASE = "https://mredman48.github.io/F1-standings";
const TEAMLOGOS_DIR = "teamlogos";

/* ------------------------------------------------ */
/* TEAM LOGOS */
/* ------------------------------------------------ */

const TEAM_LOGOS = {
  "Red Bull": "2025_red-bull_color_v2.png",
  Ferrari: "2025_ferrari_color_v2.png",
  Mercedes: "2025_mercedes_color_v2.png",
  McLaren: "2025_mclaren_color_v2.png",
  "Aston Martin": "2025_aston-martin_color_v2.png",
  Alpine: "2025_alpine_color_v2.png",
  Williams: "2025_williams_color_v2.png",
  Haas: "2025_haas_color_v2.png",
  VCARB: "2025_vcarb_color_v2.png",
  Audi: "audi_logo_colored.png",
  Cadillac: "2025_cadillac_color_v2.png",
};

function logo(team) {
  const file = TEAM_LOGOS[team];
  if (!file) return null;
  return `${PAGES_BASE}/${TEAMLOGOS_DIR}/${file}`;
}

/* ------------------------------------------------ */
/* FETCH */
/* ------------------------------------------------ */

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}`);
  }

  return res.json();
}

/* ------------------------------------------------ */
/* GET LATEST RACE */
/* ------------------------------------------------ */

async function getLatestRace() {
  const index = await fetchJson(
    `https://livetiming.formula1.com/static/${YEAR}/Index.json`
  );

  const meetings = index.Meetings;

  const races = meetings
    .map((m) => m.Sessions.find((s) => s.Name === "Race"))
    .filter(Boolean);

  const last = races[races.length - 1];

  return {
    round: last.Number,
    name: last.Meeting.Name,
    country: last.Meeting.Location,
    date: last.StartDate,
  };
}

/* ------------------------------------------------ */
/* GET STANDINGS */
/* ------------------------------------------------ */

async function getConstructorStandings() {
  const data = await fetchJson(
    `https://api.formula1.com/v1/standings/constructors?season=${YEAR}`
  );

  const list = data?.standings || [];

  return list.map((row) => ({
    team: row.teamName,
    position: `P${row.position}`,
    points: row.points,
    wins: row.wins,
    teamLogoPng: logo(row.teamName),
  }));
}

/* ------------------------------------------------ */
/* MAIN */
/* ------------------------------------------------ */

async function updateConstructors() {
  const lastRace = await getLatestRace();

  const constructors = await getConstructorStandings();

  const out = {
    header: "Constructors standings",
    generatedAtUtc: new Date().toISOString(),

    source: "formula1 official API",

    lastRace: {
      season: YEAR,
      round: lastRace.round,
      raceName: lastRace.name,
      date: lastRace.date,
      circuit: {
        name: "-",
        locality: lastRace.country,
        country: lastRace.country,
      },
    },

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