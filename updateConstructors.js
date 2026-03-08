// updateConstructors.js
import fs from "node:fs/promises";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

const F1_RESULTS_BASE = "https://www.formula1.com/en/results";

const OUT_JSON = "f1_constructors_standings.json";

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
  "Haas F1 Team": "Haas",
  "Alpine F1 Team": "Alpine",
  "Red Bull Racing": "Red Bull",
  "Kick Sauber": "Sauber",
  "Stake F1 Team Kick Sauber": "Sauber",
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
  sauber: "audi_logo_colored.png",
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
/* BASIC HELPERS */
/* ------------------------------------------------ */

function getSeasonYear() {
  return new Date().getUTCFullYear();
}

function withCacheBust(url) {
  if (!url) return url;
  return CACHE_BUST ? `${url}?v=${Date.now()}` : url;
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

function buildResultsUrl(year, section) {
  return `${F1_RESULTS_BASE}/${year}/${section}`;
}

/* ------------------------------------------------ */
/* HTML PARSER */
/* ------------------------------------------------ */

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

function htmlToLines(html) {
  let text = String(html);

  text = text.replace(/<script[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<!--[\s\S]*?-->/g, " ");

  text = text.replace(/<\/(p|div|section|article|li|tr|td|th|h1|h2|h3|h4|h5|h6)>/gi, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<[^>]+>/g, " ");

  text = decodeHtmlEntities(text);

  return text
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/* ------------------------------------------------ */
/* FETCH */
/* ------------------------------------------------ */

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
  });

  const text = await res.text();
  return { res, text };
}

/* ------------------------------------------------ */
/* LOGO RESOLUTION */
/* ------------------------------------------------ */

function resolveTeamLogo(teamName) {
  const key = normalizeKey(teamName);
  const fileName = TEAM_LOGOS_LOCAL[key];
  if (!fileName) return null;
  return withCacheBust(`${PAGES_BASE}/${TEAMLOGOS_DIR}/${fileName}`);
}

/* ------------------------------------------------ */
/* PLACEHOLDERS */
/* ------------------------------------------------ */

function buildAlphabeticalPlaceholders() {
  return PLACEHOLDER_TEAMS.map((t) => ({
    team: t.team,
    position: "-",
    points: "-",
    wins: "-",
    teamLogoPng: resolveTeamLogo(t.team),
    placeholder: true,
  }));
}

/* ------------------------------------------------ */
/* PARSE TEAM STANDINGS */
/* ------------------------------------------------ */

function parseOfficialTeamStandings(html, year) {
  const lines = htmlToLines(html);

  const startIndex = lines.findIndex((l) =>
    new RegExp(`${year}\\s+Teams[’']\\s+Standings`, "i").test(l)
  );

  if (startIndex === -1) {
    return { rows: [], reason: "heading_not_found" };
  }

  const section = lines.slice(startIndex);

  const rows = [];

  const compactRowRe = /^(\d+)([A-Za-z][A-Za-z0-9 '&.-]*?)(\d+)$/;

  for (const rawLine of section) {
    const line = rawLine.trim();

    const m = line.match(compactRowRe);
    if (!m) continue;

    const [, pos, teamRaw, pts] = m;

    rows.push({
      teamRaw,
      team: normalizeTeamName(teamRaw),
      position: fmtPos(pos),
      points: safeNumOrDash(pts),
      wins: "-",
    });
  }

  const seen = new Set();
  const unique = [];

  for (const r of rows) {
    const key = normalizeKey(r.teamRaw);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(r);
  }

  return {
    rows: unique,
    reason: unique.length ? null : "no_rows_parsed",
  };
}

/* ------------------------------------------------ */
/* MAIN */
/* ------------------------------------------------ */

async function updateConstructors() {
  const year = getSeasonYear();

  const standingsUrl = buildResultsUrl(year, "team");

  const { res, text } = await fetchText(standingsUrl);

  if (!res.ok) {
    throw new Error(`Failed to fetch ${standingsUrl}`);
  }

  const parsed = parseOfficialTeamStandings(text, year);

  let constructors;

  if (parsed.rows.length > 0) {
    constructors = parsed.rows.map((row) => ({
      team: row.team,
      position: row.position,
      points: row.points,
      wins: row.wins,
      teamLogoPng: resolveTeamLogo(row.team),
      placeholder: false,
    }));
  } else {
    constructors = buildAlphabeticalPlaceholders();
  }

  const out = {
    header: "Constructors standings",
    generatedAtUtc: new Date().toISOString(),
    source: standingsUrl,
    meta: {
      mode: parsed.rows.length ? "F1COM_LIVE" : "PLACEHOLDER",
      season: year,
      parseReason: parsed.reason,
    },
    constructors,
  };

  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2));

  console.log(
    `Wrote ${OUT_JSON} constructors=${constructors.length} mode=${out.meta.mode}`
  );
}

updateConstructors().catch((err) => {
  console.error(err);
  process.exit(1);
});