// updateConstructors.js
import fs from "node:fs/promises";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

// Ergast (Jolpi first, Ergast fallback)
const ERGAST_BASES = ["https://api.jolpi.ca/ergast/f1", "https://ergast.com/api/f1"];

// Output JSON (plural)
const OUT_JSON = "f1_constructors_standings.json";

// GitHub Pages base (Widgy-friendly)
const PAGES_BASE = "https://mredman48.github.io/F1-standings";
const TEAMLOGOS_DIR = "teamlogos";

// Turn on if Widgy/GitHub CDN is stubborn
const CACHE_BUST = true;

// ✅ Team name shortening (display names)
const TEAM_NAME_OVERRIDES = {
  "RB F1 Team": "VCARB",
  "Haas F1 Team": "Haas",
  "Alpine F1 Team": "Alpine",
};

function normalizeTeamName(name) {
  return TEAM_NAME_OVERRIDES[name] || name;
}

// ✅ LOCAL-ONLY logo mapping: Ergast constructorId -> filename in /teamlogos
// NOTE: Aston Martin filename fixed to match your team script naming.
const TEAM_LOGOS_LOCAL = {
  red_bull: "2025_red-bull_color_v2.png",
  ferrari: "2025_ferrari_color_v2.png",
  mercedes: "2025_mercedes_color_v2.png",
  mclaren: "2025_mclaren_color_v2.png",

  // ✅ FIXED: use the hyphenated file name you referenced elsewhere
  aston_martin: "2025_aston-martin_color_v2.png",

  alpine: "2025_alpine_color_v2.png",
  williams: "2025_williams_color_v2.png",
  haas: "2025_haas_color_v2.png",
  sauber: "2025_sauber_color_v2.png",
  rb: "2025_vcarb_color_v2.png",

  // ✅ Cadillac placeholder logo (upload this file to /teamlogos)
  cadillac: "2025_cadillac_color_v2.png",
};

// ---------- Fetch helpers ----------

async function fetchText(url, accept = "application/json") {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: accept },
    redirect: "follow",
  });
  const text = await res.text();
  return { res, text };
}

async function fetchJson(url) {
  const { res, text } = await fetchText(url, "application/json");
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}\n${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function fetchErgastWithFallback(pathPart) {
  const attempts = [];
  for (const base of ERGAST_BASES) {
    const url = `${base}${pathPart}`;
    try {
      const data = await fetchJson(url);
      attempts.push({ url, status: 200, ok: true });
      return { data, url, attempts };
    } catch (e) {
      attempts.push({ url, status: "ERR", ok: false, err: String(e?.message || e) });
    }
  }
  const err = new Error(
    `Failed Ergast fetch for ${pathPart}. Attempts: ${JSON.stringify(attempts)}`
  );
  err.attempts = attempts;
  throw err;
}

// ---------- Ergast parsers ----------

function getStandingsListsFromErgast(data) {
  return data?.MRData?.StandingsTable?.StandingsLists || [];
}

function getRacesFromErgast(data) {
  return data?.MRData?.RaceTable?.Races || [];
}

// ---------- Logo resolver (LOCAL ONLY) ----------

function withCacheBust(url) {
  if (!url) return url;
  return CACHE_BUST ? `${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}` : url;
}

/**
 * ✅ LOCAL ONLY
 * Returns a GitHub Pages URL into /teamlogos.
 * Throws if we don't have a mapping (NO external fallback).
 */
function resolveTeamLogo(constructorId) {
  const id = String(constructorId || "").toLowerCase();
  const fileName = TEAM_LOGOS_LOCAL[id];

  if (!fileName) {
    throw new Error(
      `Missing local logo mapping for constructorId="${id}". Add it to TEAM_LOGOS_LOCAL.`
    );
  }

  return withCacheBust(`${PAGES_BASE}/${TEAMLOGOS_DIR}/${fileName}`);
}

// ---------- Season fallback ----------

async function loadSeasonPack(season) {
  const cs = await fetchErgastWithFallback(`/${season}/constructorstandings.json`);
  const lr = await fetchErgastWithFallback(`/${season}/last/results.json`);

  const csLists = getStandingsListsFromErgast(cs.data);
  const constructorRows = csLists?.[0]?.ConstructorStandings || [];

  const lastRace = getRacesFromErgast(lr.data)?.[0] || null;

  return {
    season,
    constructorStandingsUrl: cs.url,
    lastRaceUrl: lr.url,
    constructorRows,
    lastRace,
  };
}

function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : "-";
}

// ---------- Cadillac placeholder ----------

function cadillacPlaceholder() {
  return {
    constructorId: "cadillac",
    team: "Cadillac",
    position: "P11",
    points: "-",
    wins: "-",
    teamLogoPng: resolveTeamLogo("cadillac"),
    placeholder: true,
  };
}

// ---------- Main ----------

async function updateConstructors() {
  const now = new Date();

  // Try current first, fallback to 2025 if current is empty (offseason)
  let pack = await loadSeasonPack("current");
  if (!Array.isArray(pack.constructorRows) || pack.constructorRows.length === 0) {
    pack = await loadSeasonPack("2025");
  }

  const seasonUsed =
    pack.season === "current" ? String(pack.lastRace?.season || "current") : "2025";
  const roundUsed = String(pack.lastRace?.round || "-");

  const lastRaceOut = pack.lastRace
    ? {
        season: String(pack.lastRace.season || seasonUsed),
        round: String(pack.lastRace.round || "-"),
        raceName: pack.lastRace.raceName || "-",
        date: pack.lastRace.date || "-",
        timeUtc: pack.lastRace.time || "-",
        circuit: {
          name: pack.lastRace?.Circuit?.circuitName || "-",
          locality: pack.lastRace?.Circuit?.Location?.locality || "-",
          country: pack.lastRace?.Circuit?.Location?.country || "-",
        },
      }
    : {
        season: String(seasonUsed),
        round: "-",
        raceName: "-",
        date: "-",
        timeUtc: "-",
        circuit: { name: "-", locality: "-", country: "-" },
      };

  // Build constructors output from Ergast
  const constructors = pack.constructorRows.map((row) => {
    const c = row?.Constructor || {};
    const constructorId = (c.constructorId || "").toLowerCase();
    const rawName = c.name || "-";
    const shortName = normalizeTeamName(rawName);

    return {
      constructorId: constructorId || "-",
      team: shortName, // ✅ shortened
      position: row?.position ? `P${row.position}` : "-",
      points: safeNum(row?.points),
      wins: safeNum(row?.wins),
      teamLogoPng: resolveTeamLogo(constructorId), // ✅ LOCAL ONLY (throws if missing)
      placeholder: false,
    };
  });

  // ✅ Add Cadillac placeholder only if not already present
  const hasCadillac = constructors.some(
    (t) => String(t.constructorId || "").toLowerCase() === "cadillac"
  );
  if (!hasCadillac) constructors.push(cadillacPlaceholder());

  // ✅ Guardrail: ensure ALL logos are from your GitHub Pages repo
  for (const t of constructors) {
    if (typeof t.teamLogoPng === "string" && !t.teamLogoPng.startsWith(PAGES_BASE)) {
      throw new Error(`Non-repo logo detected for ${t.constructorId}: ${t.teamLogoPng}`);
    }
  }

  const out = {
    header: "Constructors standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      ergastBases: ERGAST_BASES,
      constructorStandings: pack.constructorStandingsUrl,
      lastRace: pack.lastRaceUrl,
      logos: `LOCAL_ONLY: ${PAGES_BASE}/${TEAMLOGOS_DIR}/`,
    },
    meta: {
      seasonUsed: String(seasonUsed),
      roundUsed: String(roundUsed),
      cacheBust: CACHE_BUST,
      note:
        "Logos are LOCAL ONLY (teamlogos folder via GitHub Pages). Cadillac is appended as a placeholder at P11 until it appears in the standings feed.",
    },
    lastRace: lastRaceOut,
    constructors,
  };

  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON}`);
}

updateConstructors().catch((err) => {
  console.error(err);
  process.exit(1);
});
