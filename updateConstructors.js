// updateConstructors.js
import fs from "node:fs/promises";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

const OUT_JSON = "f1_constructors_standings.json";

const PAGES_BASE = "https://mredman48.github.io/F1-standings";
const TEAMLOGOS_DIR = "teamlogos";
const CACHE_BUST = true;

const YEAR = new Date().getUTCFullYear();

const FOH_CONSTRUCTORS_URL =
  `https://www.formulaonehistory.com/results/${YEAR}-f1-constructors-championship-standings/`;

const F1_RESULTS_RACES_URL =
  `https://www.formula1.com/en/results/${YEAR}/races`;

/* ------------------------------------------------ */
/* TEAM NAME OVERRIDES */
/* ------------------------------------------------ */

const TEAM_NAME_OVERRIDES = {
  "RB F1 Team": "VCARB",
  "Visa Cash App RB F1 Team": "VCARB",
  "Visa Cash App RB": "VCARB",
  "Racing Bulls": "VCARB",
  "Haas F1 Team": "Haas",
  "Alpine F1 Team": "Alpine",
  "Red Bull Racing": "Red Bull",
  "Kick Sauber": "Audi",
  "Stake F1 Team Kick Sauber": "Audi",
  "Audi Formula 1 Team": "Audi",
  "Cadillac Formula 1 Team": "Cadillac",
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
  "haas f1 team": "2025_haas_color_v2.png",
  audi: "audi_logo_colored.png",
  vcarb: "2025_vcarb_color_v2.png",
  "racing bulls": "2025_vcarb_color_v2.png",
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

function fmtPos(pos) {
  const n = Number(pos);
  if (!Number.isFinite(n)) return "-";
  return `P${n}`;
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
  text = text.replace(/<[^>]+>/g, " ");

  return decodeHtmlEntities(text).replace(/\s+/g, " ").trim();
}

function htmlToLines(html) {
  let text = String(html);

  text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ");
  text = text.replace(/<!--[\s\S]*?-->/g, " ");
  text = text.replace(
    /<\/(p|div|section|article|header|footer|main|li|tr|td|th|h1|h2|h3|h4|h5|h6|a|ul|ol)>/gi,
    "\n"
  );
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<[^>]+>/g, " ");

  text = decodeHtmlEntities(text);

  return text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function cleanLine(line) {
  return String(line || "").replace(/\s+/g, " ").trim();
}

async function fetchText(url, accept = "text/html,*/*") {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: accept },
    redirect: "follow",
  });

  const text = await res.text();
  return { res, text, url };
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

/* ------------------------------------------------ */
/* FORMULA ONE HISTORY STANDINGS PARSER */
/* ------------------------------------------------ */

function parseFohConstructorsStandings(html, year) {
  const text = htmlToText(html);

  const headingRe = new RegExp(`${year}\\s+F1\\s+Constructors\\s+Championship\\s+Standings`, "i");
  const headingMatch = text.match(headingRe);

  if (!headingMatch || headingMatch.index == null) {
    return { rows: [], reason: "heading_not_found" };
  }

  const section = text.slice(headingMatch.index);

  const teamNames = [
    "Mercedes",
    "Ferrari",
    "McLaren",
    "Red Bull Racing",
    "Haas F1 Team",
    "Racing Bulls",
    "Audi",
    "Alpine",
    "Williams",
    "Cadillac",
    "Aston Martin",
  ];

  const escapedTeams = teamNames
    .sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");

  // Matches rows like:
  // 1 Mercedes 43
  // 4 Red Bull Racing 8
  // Also survives compact HTML->text output.
  const rowRe = new RegExp(`(?:^|\\s)(\\d+)\\s*(${escapedTeams})\\s*(\\d+)(?=\\s|$)`, "g");

  const rows = [];
  for (const match of section.matchAll(rowRe)) {
    const [, pos, teamRaw, pts] = match;

    rows.push({
      teamRaw: cleanLine(teamRaw),
      team: normalizeTeamName(cleanLine(teamRaw)),
      position: fmtPos(pos),
      points: safeNumOrDash(pts),
      wins: "-",
      placeholder: false,
    });
  }

  const seen = new Set();
  const unique = [];

  for (const row of rows) {
    const key = normalizeKey(row.teamRaw);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }

  return {
    rows: unique,
    reason: unique.length ? null : "no_rows_parsed",
  };
}

/* ------------------------------------------------ */
/* F1.COM LAST RACE PARSER */
/* ------------------------------------------------ */

function parseOfficialRaceResults(html, year) {
  const lines = htmlToLines(html);

  const start = lines.findIndex((line) =>
    new RegExp(`^#?\\s*${year}\\s+RACE RESULTS$`, "i").test(line)
  );

  if (start === -1) {
    return { lastRace: null, reason: "heading_not_found" };
  }

  const section = lines.slice(start);

  for (let i = 0; i < section.length - 5; i += 1) {
    const raceName = cleanLine(section[i]);
    const date = cleanLine(section[i + 1]);
    const winner = cleanLine(section[i + 2]);
    const team = cleanLine(section[i + 3]);
    const laps = cleanLine(section[i + 4]);
    const timeUtc = cleanLine(section[i + 5]);

    if (new RegExp(`^#?\\s*${year}\\s+RACE RESULTS$`, "i").test(raceName)) continue;
    if (/^Grand Prix\s*Date\s*Winner\s*Team\s*Laps\s*Time$/i.test(raceName)) continue;

    if (!/^[A-Za-z][A-Za-z\s'’-]+$/.test(raceName)) continue;
    if (!/^\d{2}\s[A-Za-z]{3}$/.test(date)) continue;
    if (!/^[A-Za-zÀ-ÿ\s'’.\-]+\s[A-Z]{3}$/.test(winner)) continue;
    if (!/^[A-Za-z][A-Za-z0-9\s&'.-]+$/.test(team)) continue;
    if (!/^\d+$/.test(laps)) continue;
    if (!/^[0-9:.+-]+$/.test(timeUtc)) continue;

    return {
      lastRace: {
        season: String(year),
        round: "latest",
        raceName,
        date,
        timeUtc,
        circuit: {
          name: "-",
          locality: "-",
          country: "-",
        },
        winner: {
          name: winner,
          team,
          laps: Number(laps),
        },
      },
      reason: null,
    };
  }

  return {
    lastRace: null,
    reason: "no_rows_parsed",
  };
}

/* ------------------------------------------------ */
/* MAIN */
/* ------------------------------------------------ */

async function updateConstructors() {
  const now = new Date();

  const [standingsResp, racesResp] = await Promise.all([
    fetchText(FOH_CONSTRUCTORS_URL),
    fetchText(F1_RESULTS_RACES_URL),
  ]);

  let parsedStandings = { rows: [], reason: "http_error" };
  let parsedLastRace = { lastRace: null, reason: "http_error" };

  if (standingsResp.res.ok) {
    parsedStandings = parseFohConstructorsStandings(standingsResp.text, YEAR);
  }

  if (racesResp.res.ok) {
    parsedLastRace = parseOfficialRaceResults(racesResp.text, YEAR);
  }

  let constructors = [];
  let mode = "FOH_EMPTY_PLACEHOLDERS_LOCAL_LOGOS";

  if (Array.isArray(parsedStandings.rows) && parsedStandings.rows.length > 0) {
    mode = "FOH_LIVE_LOCAL_LOGOS";

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

    const hasCadillac = constructors.some(
      (t) => normalizeKey(t.team) === "cadillac"
    );

    if (!hasCadillac) {
      const logo = resolveTeamLogo("Cadillac");
      constructors.push({
        team: "Cadillac",
        position: "-",
        points: "-",
        wins: "-",
        teamLogoPng: logo,
        logoMissing: logo == null,
        placeholder: true,
      });
    }
  } else {
    constructors = buildAlphabeticalPlaceholders();
  }

  const lastRaceOut =
    parsedLastRace.lastRace || {
      season: String(YEAR),
      round: "-",
      raceName: "-",
      date: "-",
      timeUtc: "-",
      circuit: {
        name: "-",
        locality: "-",
        country: "-",
      },
      winner: {
        name: "-",
        team: "-",
        laps: "-",
      },
    };

  const out = {
    header: "Constructors standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      constructorsStandings: FOH_CONSTRUCTORS_URL,
      races: F1_RESULTS_RACES_URL,
      logos: `LOCAL_ONLY: ${PAGES_BASE}/${TEAMLOGOS_DIR}/`,
    },
    meta: {
      mode,
      seasonUsed: String(YEAR),
      roundUsed: lastRaceOut.round,
      cacheBust: CACHE_BUST,
      note:
        "Uses Formula One History for constructors standings and official F1.com for latest race. If standings are empty/unavailable, emits alphabetical placeholder teams with '-' stats. Logos are LOCAL ONLY from /teamlogos via GitHub Pages.",
      standingsParseReason: parsedStandings.reason,
      raceParseReason: parsedLastRace.reason,
    },
    lastRace: lastRaceOut,
    constructors,
  };

  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");

  console.log(
    `Wrote ${OUT_JSON} season=${out.meta.seasonUsed} constructors=${out.constructors.length} mode=${out.meta.mode}`
  );
  console.log(`Standings parse reason: ${parsedStandings.reason}`);
  console.log(`Race parse reason: ${parsedLastRace.reason}`);
}

updateConstructors().catch((err) => {
  console.error(err);
  process.exit(1);
});