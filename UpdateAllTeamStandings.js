import fs from "node:fs/promises";

const DRIVER_STANDINGS_FILE = "f1_driver_standings.json";
const CONSTRUCTOR_STANDINGS_FILE = "f1_constructors_standings.json";
const SEASON_RESULTS_FILE = "f1_season_event_results.json";

const PAGES_BASE = "https://mredman48.github.io/F1-standings";
const TEAMLOGOS_DIR = "teamlogos";
const HEADSHOTS_DIR = "headshots";
const DRIVER_NUMBER_FOLDER = "driver-numbers";

const DRIVER_FIRSTNAME_OVERRIDES = {
  alexander: "alex",
};

const TEAMS = [
  {
    key: "redbull",
    displayName: "Red Bull",
    outputFile: "f1_redbull_standings.json",
    objectKey: "redBull",
    keywords: ["red bull"],
    logoFile: "2025_red-bull_color_v2.png",
  },
  {
    key: "ferrari",
    displayName: "Ferrari",
    outputFile: "f1_ferrari_standings.json",
    objectKey: "ferrari",
    keywords: ["ferrari"],
    logoFile: "2025_ferrari_color_v2.png",
  },
  {
    key: "mercedes",
    displayName: "Mercedes",
    outputFile: "f1_mercedes_standings.json",
    objectKey: "mercedes",
    keywords: ["mercedes"],
    logoFile: "2025_mercedes_color_v2.png",
  },
  {
    key: "mclaren",
    displayName: "McLaren",
    outputFile: "f1_mclaren_standings.json",
    objectKey: "mclaren",
    keywords: ["mclaren"],
    logoFile: "2025_mclaren_color_v2.png",
  },
  {
    key: "alpine",
    displayName: "Alpine",
    outputFile: "f1_alpine_standings.json",
    objectKey: "alpine",
    keywords: ["alpine"],
    logoFile: "2025_alpine_color_v2.png",
  },
  {
    key: "astonmartin",
    displayName: "Aston Martin",
    outputFile: "f1_astonmartin_standings.json",
    objectKey: "astonMartin",
    keywords: ["aston martin"],
    logoFile: "2025_aston-martin_color_v2.png",
  },
  {
    key: "williams",
    displayName: "Williams",
    outputFile: "f1_williams_standings.json",
    objectKey: "williams",
    keywords: ["williams"],
    logoFile: "2025_williams_color_v2.png",
  },
  {
    key: "haas",
    displayName: "Haas",
    outputFile: "f1_haas_standings.json",
    objectKey: "haas",
    keywords: ["haas"],
    logoFile: "2025_haas_color_v2.png",
  },
  {
    key: "audi",
    displayName: "Audi",
    outputFile: "f1_audi_standings.json",
    objectKey: "audi",
    keywords: ["audi", "sauber"],
    logoFile: "audi_logo_colored.png",
  },
  {
    key: "cadillac",
    displayName: "Cadillac",
    outputFile: "f1_cadillac_standings.json",
    objectKey: "cadillac",
    keywords: ["cadillac"],
    logoFile: "2025_cadillac_color_v2.png",
  },
  {
    key: "vcarb",
    displayName: "VCARB",
    outputFile: "f1_vcarb_standings.json",
    objectKey: "vcarb",
    keywords: ["vcarb", "racing bulls", "visa cash app rb", "rb f1 team"],
    logoFile: "2025_vcarb_color_v2.png",
  },
];

/* -------------------------------- */
/* HELPERS */
/* -------------------------------- */

function slug(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function normalizePoints(val) {
  if (val === "-" || val === "" || val === null || val === undefined) return 0;
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

function normalizeStandingPosition(pos) {
  if (!pos) return "-";

  const p = String(pos).toUpperCase().trim();

  if (p === "P0") return "-";
  if (p === "DNF") return "DNF";
  if (p === "DNS") return "DNS";
  if (p === "DSQ") return "DSQ";
  if (p === "NC") return "NC";

  const n = Number(p.replace(/^P/, ""));
  if (!Number.isFinite(n) || n <= 0) return "-";

  return `P${n}`;
}

function normalizeLocation(input) {
  return {
    locality: input?.locality ?? input?.location?.locality ?? "-",
    country: input?.country ?? input?.location?.country ?? "-",
  };
}

function emptyBestResult(position = "-") {
  return {
    position,
    eventType: "-",
    raceName: "-",
    round: "-",
    date: "-",
    circuit: "-",
    location: {
      locality: "-",
      country: "-",
    },
    sourceUrl: null,
  };
}

function emptyLastRace() {
  return {
    raceName: "-",
    round: "-",
    date: "-",
    circuit: "-",
    location: {
      locality: "-",
      country: "-",
    },
  };
}

function numberImage(num) {
  if (!num) return null;
  return `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-${num}.png`;
}

async function headshot(first, last) {
  if (!first || !last) return null;

  let firstName = String(first).toLowerCase();
  if (DRIVER_FIRSTNAME_OVERRIDES[firstName]) {
    firstName = DRIVER_FIRSTNAME_OVERRIDES[firstName];
  }

  const file = `${slug(firstName)}-${slug(last)}.png`;
  return `${PAGES_BASE}/${HEADSHOTS_DIR}/${file}`;
}

function matchesTeamName(name, keywords) {
  const value = String(name || "").toLowerCase();
  return keywords.some((keyword) => value.includes(keyword));
}

function formatBestResultRaceName(best) {
  const raceName = String(best?.raceName || "").trim();
  const sessionName = String(best?.sessionName || "").trim();

  if (!raceName && !sessionName) return "-";
  if (!raceName) return sessionName || "-";

  const sessionLower = sessionName.toLowerCase();

  if (!sessionName || sessionLower === "race") {
    return raceName;
  }

  if (raceName.toLowerCase().includes(sessionLower)) {
    return raceName;
  }

  return `${raceName} ${sessionName}`;
}

function bestResultFromSeasonData(best) {
  if (!best) return emptyBestResult();

  return {
    position: best?.position ?? "-",
    eventType: best?.eventType ?? "-",
    raceName: formatBestResultRaceName(best),
    round: best?.round != null ? String(best.round) : "-",
    date: best?.date ?? "-",
    circuit: best?.circuit ?? "-",
    location: {
      locality: best?.location?.locality ?? "-",
      country: best?.location?.country ?? "-",
    },
    sourceUrl: best?.sourceUrl ?? null,
  };
}

/* -------------------------------- */
/* READ JSON */
/* -------------------------------- */

async function readJson(file) {
  const raw = await fs.readFile(file, "utf8");
  return JSON.parse(raw);
}

/* -------------------------------- */
/* TEAM LOOKUPS */
/* -------------------------------- */

function getTeamDrivers(driverData, teamConfig) {
  return (driverData.drivers || []).filter((d) => {
    const teamA = d?.constructor?.name || "";
    const teamB = d?.constructor?.fullName || "";
    return (
      matchesTeamName(teamA, teamConfig.keywords) ||
      matchesTeamName(teamB, teamConfig.keywords)
    );
  });
}

function getTeamConstructor(constructorData, teamConfig) {
  const row = (constructorData.constructors || []).find((c) =>
    matchesTeamName(c.team, teamConfig.keywords)
  );

  if (!row) {
    return {
      team: teamConfig.displayName,
      position: "-",
      points: 0,
      wins: 0,
    };
  }

  return {
    team: teamConfig.displayName,
    position: normalizeStandingPosition(row.position),
    points: normalizePoints(row.points),
    wins: normalizePoints(row.wins),
  };
}

function mergeLastRace(lastRace) {
  if (!lastRace) return emptyLastRace();

  return {
    raceName: lastRace?.raceName ?? "-",
    round: lastRace?.round != null ? String(lastRace.round) : "-",
    date: lastRace?.date ?? "-",
    circuit: lastRace?.circuit?.name ?? lastRace?.circuit ?? "-",
    location: normalizeLocation(lastRace),
  };
}

/* -------------------------------- */
/* TEAM JSON BUILDER */
/* -------------------------------- */

async function buildTeamJson(
  teamConfig,
  driverData,
  constructorData,
  seasonResultsData
) {
  const teamDrivers = getTeamDrivers(driverData, teamConfig);
  const teamStanding = getTeamConstructor(constructorData, teamConfig);
  const bestByDriverNumber = seasonResultsData?.bestByDriverNumber || {};

  const drivers = [];

  for (const d of teamDrivers) {
    const drv = d.driver || {};

    const first = drv.firstName || "-";
    const last = drv.lastName || "-";
    const num = drv.driverNumber != null ? Number(drv.driverNumber) : null;

    const seasonBest =
      num != null ? bestByDriverNumber[String(num)] ?? bestByDriverNumber[num] : null;

    drivers.push({
      firstName: first,
      lastName: last,
      code: drv.code || "-",
      driverNumber: num,

      numberImageUrl: numberImage(num),
      headshotUrl: await headshot(first, last),

      position: normalizeStandingPosition(d.position),
      points: normalizePoints(d.points),
      wins: normalizePoints(d.wins),

      team: teamConfig.displayName,
      bestResult: bestResultFromSeasonData(seasonBest),
    });
  }

  drivers.sort((a, b) => {
    const pa = Number(String(a.position).replace(/^P/i, ""));
    const pb = Number(String(b.position).replace(/^P/i, ""));
    const aOk = Number.isFinite(pa) && pa > 0;
    const bOk = Number.isFinite(pb) && pb > 0;

    if (aOk && bOk) return pa - pb;
    if (aOk) return -1;
    if (bOk) return 1;
    return String(a.lastName).localeCompare(String(b.lastName));
  });

  return {
    header: `${teamConfig.displayName} standings`,
    generatedAtUtc: new Date().toISOString(),

    sources: {
      driverStandings: DRIVER_STANDINGS_FILE,
      constructorStandings: CONSTRUCTOR_STANDINGS_FILE,
      seasonResults: SEASON_RESULTS_FILE,
    },

    [teamConfig.objectKey]: {
      team: teamConfig.displayName,
      teamLogoPng: `${PAGES_BASE}/${TEAMLOGOS_DIR}/${teamConfig.logoFile}`,
      teamStanding,
    },

    lastRace: mergeLastRace(constructorData.lastRace),

    drivers,
  };
}

/* -------------------------------- */
/* MAIN */
/* -------------------------------- */

async function updateAllTeamStandings() {
  const [driverData, constructorData, seasonResultsData] = await Promise.all([
    readJson(DRIVER_STANDINGS_FILE),
    readJson(CONSTRUCTOR_STANDINGS_FILE),
    readJson(SEASON_RESULTS_FILE),
  ]);

  for (const teamConfig of TEAMS) {
    const out = await buildTeamJson(
      teamConfig,
      driverData,
      constructorData,
      seasonResultsData
    );

    await fs.writeFile(
      teamConfig.outputFile,
      JSON.stringify(out, null, 2),
      "utf8"
    );

    console.log(`Wrote ${teamConfig.outputFile}`);
  }
}

updateAllTeamStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});
