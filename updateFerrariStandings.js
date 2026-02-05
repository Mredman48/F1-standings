// updateFerrariStandings.js
import fs from "node:fs/promises";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

// ✅ Your Ferrari logo URL
const FERRARI_LOGO_PNG =
  "https://raw.githubusercontent.com/Mredman48/F1-standings/refs/heads/main/teamlogos/2025_ferrari_color_v2.png";

const OUT_JSON = "f1_ferrari_standings.json";

// ---------- Fetch helpers ----------

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    redirect: "follow",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return JSON.parse(text);
}

// Convert https://en.wikipedia.org/wiki/Max_Verstappen => "Max_Verstappen"
function wikipediaTitleFromUrl(wikiUrl) {
  try {
    const u = new URL(wikiUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("wiki");
    if (idx === -1 || !parts[idx + 1]) return null;
    return decodeURIComponent(parts[idx + 1]);
  } catch {
    return null;
  }
}

// Wikipedia title -> Wikidata QID
async function getWikidataQidFromEnwikiTitle(title) {
  const api =
    `https://www.wikidata.org/w/api.php?action=wbgetentities` +
    `&sites=enwiki&titles=${encodeURIComponent(title)}` +
    `&props=sitelinks&format=json&origin=*`;

  const data = await fetchJson(api);
  const entities = data?.entities || {};
  const firstKey = Object.keys(entities)[0];
  if (!firstKey || firstKey === "-1") return null;
  return firstKey; // QID like "Q173206"
}

// QID -> P18 Commons file name
async function getCommonsFileFromQid(qid) {
  const api =
    `https://www.wikidata.org/w/api.php?action=wbgetclaims` +
    `&entity=${encodeURIComponent(qid)}` +
    `&property=P18&format=json&origin=*`;

  const data = await fetchJson(api);
  const claims = data?.claims?.P18;
  const file = claims?.[0]?.mainsnak?.datavalue?.value;
  return file || null;
}

// Commons file -> direct URL (optionally resized)
function commonsFileToUrl(fileName, width = 900) {
  const base = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(
    fileName
  )}`;
  return width ? `${base}?width=${width}` : base;
}

// Wikipedia URL -> Commons image URL (via Wikidata P18)
async function getHeadshotFromWikipediaUrl(wikipediaUrl, width = 900) {
  try {
    const title = wikipediaTitleFromUrl(wikipediaUrl);
    if (!title) return "-";

    const qid = await getWikidataQidFromEnwikiTitle(title);
    if (!qid) return "-";

    const file = await getCommonsFileFromQid(qid);
    if (!file) return "-";

    return commonsFileToUrl(file, width);
  } catch {
    return "-";
  }
}

// ---------- Placeholder builders ----------

function dashBestResult() {
  return {
    position: "-",
    raceName: "-",
    round: "-",
    date: "-",
    circuit: "-",
  };
}

function dashLastRace() {
  return {
    season: "-",
    round: "-",
    raceName: "-",
    date: "-",
    timeUtc: "-",
    circuit: {
      name: "-",
      locality: "-",
      country: "-",
    },
  };
}

function dashTeamStanding(teamDisplay, originalTeam = "-") {
  return {
    team: teamDisplay,
    position: "-",
    points: "-",
    wins: "-",
    originalTeam,
  };
}

// ---------- Main ----------

async function updateFerrariStandings() {
  const now = new Date();

  // Ferrari drivers
  // NOTE: Wikipedia URLs are stable and power the Wikidata -> Commons headshot pipeline.
  const driversConfig = [
    {
      firstName: "Charles",
      lastName: "Leclerc",
      code: "LEC",
      driverNumber: "16",
      wikipediaUrl: "https://en.wikipedia.org/wiki/Charles_Leclerc",
    },
    {
      firstName: "Lewis",
      lastName: "Hamilton",
      code: "HAM",
      driverNumber: "44",
      wikipediaUrl: "https://en.wikipedia.org/wiki/Lewis_Hamilton",
    },
  ];

  // Pull real headshots (Commons), keep every other datapoint as "-"
  const drivers = [];
  for (const d of driversConfig) {
    const headshotUrl = await getHeadshotFromWikipediaUrl(d.wikipediaUrl, 900);

    drivers.push({
      position: "-",
      points: "-",
      wins: "-",
      firstName: d.firstName,
      lastName: d.lastName,
      code: d.code,
      driverNumber: d.driverNumber,
      team: "Ferrari",
      headshotUrl, // ✅ real link (Commons) or "-" if unavailable
      placeholder: true,
      bestResult: dashBestResult(),
    });
  }

  const out = {
    header: "Ferrari standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      ferrariLogo: FERRARI_LOGO_PNG,
      headshots: "Wikidata P18 -> Wikimedia Commons (Special:FilePath)",
      driverStandings: "DASH_PLACEHOLDERS",
      constructorStandings: "DASH_PLACEHOLDERS",
      lastRace: "DASH_PLACEHOLDERS",
    },
    meta: {
      mode: "DASH_PLACEHOLDERS_REAL_HEADSHOTS_WIKIDATA_COMMONS",
      seasonUsed: "-",
      roundUsed: "-",
      note:
        "All non-image datapoints are '-' placeholders for widget building. Driver headshots are pulled via Wikidata (P18) and served from Wikimedia Commons.",
    },
    ferrari: {
      team: "Ferrari",
      teamLogoPng: FERRARI_LOGO_PNG,
      teamStanding: dashTeamStanding("Ferrari", "Scuderia Ferrari"),
    },
    lastRace: dashLastRace(),
    drivers,
  };

  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON}`);
}

updateFerrariStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});