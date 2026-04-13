import fs from "node:fs/promises";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const OUT_JSON = "f1_constructors_standings.json";
const YEAR = new Date().getUTCFullYear();

const SKY_F1_STANDINGS_URL = "https://www.skysports.com/f1/standings";
const SEASON_RESULTS_FILE = "f1_season_event_results.json";

const PAGES_BASE = "https://mredman48.github.io/F1-standings";
const TEAMLOGOS_DIR = "teamlogos";
const CACHE_BUST = true;

/* ------------------------------------------------ */
/* TEAM NAME OVERRIDES */
/* ------------------------------------------------ */

const TEAM_NAME_OVERRIDES = {
  "RB F1 Team": "VCARB",
  "Visa Cash App RB F1 Team": "VCARB",
  "Visa Cash App RB": "VCARB",
  "Racing Bulls": "VCARB",
  "Visa Cash App Racing Bulls": "VCARB",

  "Haas F1 Team": "Haas",
  "MoneyGram Haas F1 Team": "Haas",
  "Haas Ferrari": "Haas",

  "Alpine F1 Team": "Alpine",
  "BWT Alpine Formula One Team": "Alpine",
  "Alpine Renault": "Alpine",

  "Red Bull Racing": "Red Bull",
  "Oracle Red Bull Racing": "Red Bull",
  "Red Bull Racing Honda RBPT": "Red Bull",

  "Kick Sauber": "Audi",
  "Stake F1 Team Kick Sauber": "Audi",
  "Audi Formula 1 Team": "Audi",
  "Audi Formula One Team": "Audi",
  "Audi Revolut": "Audi",
  Sauber: "Audi",

  "Cadillac": "Cadillac",
  "Cadillac F1 Team": "Cadillac",
  "Cadillac Formula 1 Team": "Cadillac",
  "Cadillac Formula One Team": "Cadillac",

  "McLaren Formula 1 Team": "McLaren",
  "McLaren Mercedes": "McLaren",

  "Mercedes-AMG PETRONAS Formula One Team": "Mercedes",

  "Scuderia Ferrari HP": "Ferrari",

  "Williams Racing": "Williams",
  "Williams Mercedes": "Williams",

  "Aston Martin Aramco Formula One Team": "Aston Martin",
  "Aston Martin Aramco Mercedes": "Aston Martin",
};

function normalizeTeamName(name) {
  return TEAM_NAME_OVERRIDES[name] || name;
}

/* ------------------------------------------------ */
/* LOCAL TEAM LOGOS */
/* ------------------------------------------------ */

const TEAM_LOGOS_LOCAL = {
  "red bull": "2025_red-bull_color_v2.png",
  "red bull racing": "2025_red-bull_color_v2.png",
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

/* ------------------------------------------------ */
/* PLACEHOLDER TEAMS */
/* ------------------------------------------------ */

const PLACEHOLDER_TEAMS = [
  { team: "Alpine" },
  { team: "Aston Martin" },
  { team: "Audi" },
  { team: "Cadillac" },
  { team: "Ferrari" },
  { team: "Haas" },
  { team: "McLaren" },
  { team: "Mercedes" },
  { team: "Red Bull" },
  { team: "VCARB" },
  { team: "Williams" },
].sort((a, b) => a.team.localeCompare(b.team));

/* ------------------------------------------------ */
/* HELPERS */
/* ------------------------------------------------ */

function withCacheBust(url) {
  if (!url) return url;
  return CACHE_BUST ? `${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}` : url;
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function fmtPos(pos) {
  const raw = String(pos ?? "").trim();
  if (!raw) return "-";

  const n = Number(raw.replace(/^P/i, ""));
  return Number.isFinite(n) && n > 0 ? `P${n}` : "-";
}

function safeNumOrDash(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : "-";
}

function normalizeKey(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function resolveTeamLogo(teamName) {
  const key = normalizeKey(teamName);
  const fileName = TEAM_LOGOS_LOCAL[key];
  if (!fileName) return null;
  return withCacheBust(`${PAGES_BASE}/${TEAMLOGOS_DIR}/${fileName}`);
}

function buildAlphabeticalPlaceholders() {
  return PLACEHOLDER_TEAMS.map((t) => {
    const logo = resolveTeamLogo(t.team);
    return {
      team: t.team,
      position: "-",
      points: "-",
      wins: "-",
      teamLogoPng: logo,
      logoMissing: logo == null,
      placeholder: true,
    };
  });
}

function decodeHtmlEntities(str) {
  if (!str) return str;
  return str
    .replace(/&nbsp;/g, " ")
    .replace(/&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function htmlToText(html) {
  let text = String(html);
  text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ");
  text = text.replace(/<!--[\s\S]*?-->/g, " ");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(
    /<\/(p|div|section|article|header|footer|main|li|tr|td|th|h1|h2|h3|h4|h5|h6|a|ul|ol)>/gi,
    "\n"
  );
  text = text.replace(/<[^>]+>/g, " ");
  text = decodeHtmlEntities(text);
  return text.replace(/\r/g, "");
}

function cleanLine(line) {
  return String(line || "").replace(/\s+/g, " ").trim();
}

function formatEventRaceName(event) {
  const eventType = cleanText(event?.eventType).toLowerCase();
  const meetingName = cleanText(event?.meetingName);
  const raceName = cleanText(event?.raceName);
  const sessionName = cleanText(event?.sessionName).toLowerCase();

  const baseName =
    meetingName &&
    meetingName.toLowerCase() !== "race" &&
    meetingName.toLowerCase() !== "sprint"
      ? meetingName
      : raceName &&
          raceName.toLowerCase() !== "race" &&
          raceName.toLowerCase() !== "sprint"
        ? raceName
        : "-";

  if (eventType === "sprint" || sessionName === "sprint") {
    if (baseName === "-") return "Sprint";
    return baseName.toLowerCase().endsWith(" sprint")
      ? baseName
      : `${baseName} Sprint`;
  }

  return baseName;
}

function parseLastRaceFromSeasonResults(data) {
  const events = Array.isArray(data?.events) ? data.events : [];

  if (events.length === 0) {
    return {
      season: String(YEAR),
      round: "-",
      raceName: "-",
      date: "-",
      circuit: {
        name: "-",
        locality: "-",
        country: "-",
      },
      winner: {
        firstName: "-",
        lastName: "-",
        fullName: "-",
        team: "-",
      },
    };
  }

  const sorted = [...events].sort((a, b) => {
    const aTime = Date.parse(a?.dateEndUtc || a?.dateStartUtc || a?.date || 0);
    const bTime = Date.parse(b?.dateEndUtc || b?.dateStartUtc || b?.date || 0);

    const aSafe = Number.isFinite(aTime) ? aTime : 0;
    const bSafe = Number.isFinite(bTime) ? bTime : 0;

    return bSafe - aSafe;
  });

  const latest = sorted[0];
  const winnerRow = Array.isArray(latest?.drivers)
    ? latest.drivers.find((d) => cleanText(d?.position) === "P1")
    : null;

  const winnerFullName = cleanText(winnerRow?.fullName);
  const nameParts = winnerFullName ? winnerFullName.split(/\s+/) : [];
  const firstName =
    nameParts.length > 1 ? nameParts.slice(0, -1).join(" ") : nameParts[0] || "-";
  const lastName =
    nameParts.length > 1 ? nameParts[nameParts.length - 1] : "-";

  return {
    season: String(data?.season ?? YEAR),
    round: latest?.round != null ? String(latest.round) : "-",
    raceName: formatEventRaceName(latest),
    date: latest?.date ?? "-",
    circuit: {
      name: latest?.circuit ?? "-",
      locality: latest?.location?.locality ?? "-",
      country: latest?.location?.country ?? "-",
    },
    winner: {
      firstName,
      lastName,
      fullName: winnerFullName || "-",
      team: normalizeTeamName(winnerRow?.team ?? "-"),
    },
  };
}

async function fetchText(url, accept = "text/html,*/*") {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: accept,
      "Accept-Language": "en-CA,en-US;q=0.9,en;q=0.8",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      Referer: "https://www.skysports.com/f1",
    },
    redirect: "follow",
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}\n${text}`);
  }

  return { res, text, url };
}

async function readJson(file) {
  const raw = await fs.readFile(file, "utf8");
  return JSON.parse(raw);
}

/* ------------------------------------------------ */
/* SKY CONSTRUCTORS PARSER */
/* ------------------------------------------------ */

function extractConstructorStandingsBlock(text) {
  const compact = text.replace(/\s+/g, " ");

  const patterns = [
    /#\s*Team\s+Pts\s+((?:\d+\s+[A-Za-z][A-Za-z0-9 &'.\-]+?\s+\d+\s*){5,})/i,
    /Team\s+Pts\s+((?:\d+\s+[A-Za-z][A-Za-z0-9 &'.\-]+?\s+\d+\s*){5,})/i,
  ];

  for (const re of patterns) {
    const match = compact.match(re);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
}

function parseConstructorRowsFromBlock(block) {
  const rowRe =
    /(\d+)\s+([A-Za-z][A-Za-z0-9 &'.\-]+?)\s+(\d+)(?=\s+\d+\s+[A-Za-z]|\s*$)/g;

  const rows = [];
  for (const match of block.matchAll(rowRe)) {
    const [, posRaw, teamRaw, pointsRaw] = match;

    const team = normalizeTeamName(cleanLine(teamRaw));

    rows.push({
      team,
      position: fmtPos(posRaw),
      points: safeNumOrDash(pointsRaw),
      wins: "-",
      placeholder: false,
    });
  }

  return rows;
}

function parseSkyConstructorStandings(html) {
  const text = htmlToText(html);
  const block = extractConstructorStandingsBlock(text);

  if (!block) {
    return {
      rows: [],
      reason: "constructor_block_not_found",
      sample: cleanLine(text).slice(0, 700),
    };
  }

  const rows = parseConstructorRowsFromBlock(block);

  return {
    rows,
    reason: rows.length ? null : "constructor_rows_not_parsed",
    blockSample: block.slice(0, 500),
  };
}

/* ------------------------------------------------ */
/* OUTPUT HELPERS */
/* ------------------------------------------------ */

function dedupeConstructors(rows) {
  const seen = new Set();
  const out = [];

  for (const row of rows) {
    const key = normalizeKey(row.team);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }

  return out;
}

function ensureCadillac(rows) {
  const hasCadillac = rows.some((t) => normalizeKey(t.team) === "cadillac");

  if (hasCadillac) return rows;

  const logo = resolveTeamLogo("Cadillac");
  return [
    ...rows,
    {
      team: "Cadillac",
      position: "-",
      points: "-",
      wins: "-",
      teamLogoPng: logo,
      logoMissing: logo == null,
      placeholder: true,
    },
  ];
}

function sortConstructors(rows) {
  return [...rows].sort((a, b) => {
    const pa = Number(String(a.position).replace(/^P/i, ""));
    const pb = Number(String(b.position).replace(/^P/i, ""));

    const aOk = Number.isFinite(pa) && pa > 0;
    const bOk = Number.isFinite(pb) && pb > 0;

    if (aOk && bOk) return pa - pb;
    if (aOk) return -1;
    if (bOk) return 1;

    return String(a.team).localeCompare(String(b.team));
  });
}

/* ------------------------------------------------ */
/* MAIN */
/* ------------------------------------------------ */

async function updateConstructors() {
  const now = new Date().toISOString();

  const [skyResp, seasonResults] = await Promise.all([
    fetchText(SKY_F1_STANDINGS_URL),
    readJson(SEASON_RESULTS_FILE),
  ]);

  const parsedStandings = parseSkyConstructorStandings(skyResp.text);

  let constructors = [];
  let mode = "SKY_SPORTS_STANDINGS";
  let standingsParseReason = parsedStandings.reason;

  if (Array.isArray(parsedStandings.rows) && parsedStandings.rows.length > 0) {
    constructors = parsedStandings.rows.map((row) => {
      const logo = resolveTeamLogo(row.team);
      return {
        team: row.team,
        position: row.position,
        points: row.points,
        wins: row.wins,
        teamLogoPng: logo,
        logoMissing: logo == null,
        placeholder: false,
      };
    });

    constructors = dedupeConstructors(constructors);
    constructors = ensureCadillac(constructors);
    constructors = sortConstructors(constructors);
  } else {
    constructors = buildAlphabeticalPlaceholders();
    mode = "SKY_SPORTS_EMPTY_PLACEHOLDERS_LOCAL_LOGOS";
    standingsParseReason = standingsParseReason || "no_rows_parsed";
  }

  const lastRace = parseLastRaceFromSeasonResults(seasonResults);

  const out = {
    header: "Constructors standings",
    generatedAtUtc: now,
meta: {
  seasonUsed: String(YEAR),
  roundUsed: lastRace.round,
  cacheBust: CACHE_BUST,
  standingsParseReason,
},
    lastRace,
    constructors,
  };

  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");

  console.log(
    `Wrote ${OUT_JSON} season=${out.meta.seasonUsed} round=${out.meta.roundUsed} constructors=${out.constructors.length} mode=${out.meta.mode}`
  );
  console.log(`Standings source: ${SKY_F1_STANDINGS_URL}`);
  console.log(`Standings parse reason: ${standingsParseReason}`);
}

updateConstructors().catch((err) => {
  console.error(err);
  process.exit(1);
});
