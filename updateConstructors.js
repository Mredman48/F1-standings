// updateConstructors.js
import fs from "node:fs/promises";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

// Ergast-compatible sources (Jolpica first, Ergast fallback)
const ERGAST_BASES = ["https://api.jolpi.ca/ergast/f1", "https://ergast.com/api/f1"];

// Output JSON
const OUT_JSON = "f1_constructors_standings.json";

// GitHub Pages base (Widgy-friendly)
const PAGES_BASE = "https://mredman48.github.io/F1-standings";
const TEAMLOGOS_DIR = "teamlogos";

// Cache busting (helps Widgy/CDN)
const CACHE_BUST = true;

// ✅ Team name shortening (display names)
const TEAM_NAME_OVERRIDES = {
  "RB F1 Team": "VCARB",
  "Visa Cash App RB F1 Team": "VCARB",
  "Visa Cash App RB": "VCARB",
  "Haas F1 Team": "Haas",
  "Alpine F1 Team": "Alpine",
};

function normalizeTeamName(name) {
  return TEAM_NAME_OVERRIDES[name] || name;
}

// ✅ LOCAL-ONLY logo mapping: constructorId -> filename in /teamlogos
// (Audi instead of Sauber)
const TEAM_LOGOS_LOCAL = {
  red_bull: "2025_red-bull_color_v2.png",
  ferrari: "2025_ferrari_color_v2.png",
  mercedes: "2025_mercedes_color_v2.png",
  mclaren: "2025_mclaren_color_v2.png",
  aston_martin: "2025_aston-martin_color_v2.png",
  alpine: "2025_alpine_color_v2.png",
  williams: "2025_williams_color_v2.png",
  haas: "2025_haas_color_v2.png",
  audi: "audi_logo_colored.png",
  rb: "2025_vcarb_color_v2.png",
  cadillac: "2025_cadillac_color_v2.png",
};

// ✅ Placeholder team list (DISPLAY NAMES) — sorted alphabetically
// This is what you’ll emit until current standings populate.
const PLACEHOLDER_TEAMS = [
  { constructorId: "alpine", team: "Alpine" },
  { constructorId: "aston_martin", team: "Aston Martin" },
  { constructorId: "audi", team: "Audi" },
  { constructorId: "cadillac", team: "Cadillac" },
  { constructorId: "ferrari", team: "Ferrari" },
  { constructorId: "haas", team: "Haas" },
  { constructorId: "mclaren", team: "McLaren" },
  { constructorId: "mercedes", team: "Mercedes" },
  { constructorId: "rb", team: "VCARB" },
  { constructorId: "red_bull", team: "Red Bull" },
  { constructorId: "williams", team: "Williams" },
].sort((a, b) => a.team.localeCompare(b.team));

// ---------- Helpers ----------

function withCacheBust(url) {
  if (!url) return url;
  return CACHE_BUST ? `${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}` : url;
}

function fmtPos(pos) {
  if (pos == null || pos === "-" || pos === "") return "-";
  const n = Number(pos);
  if (!Number.isFinite(n)) return "-";
  return `P${n}`;
}

function safeNumOrDash(x) {
  if (x === null || x === undefined || x === "") return "-";
  const n = Number(x);
  return Number.isFinite(n) ? n : "-";
}

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
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from ${url}\n${text.slice(0, 200)}`);
  }
}

async function fetchErgastWithFallback(pathPart) {
  const attempts = [];
  for (const base of ERGAST_BASES) {
    const url = `${base}${pathPart}`;
    try {
      const data = await fetchJson(url);
      attempts.push({ url, ok: true });
      return { data, url, attempts };
    } catch (e) {
      attempts.push({ url, ok: false, err: String(e?.message || e) });
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

function getSeasonFromConstructorStandingsPayload(data) {
  return data?.MRData?.StandingsTable?.season ?? null;
}

// ---------- Logo resolver (LOCAL ONLY, non-fatal if missing mapping) ----------

function resolveTeamLogo(constructorId) {
  const id = String(constructorId || "").toLowerCase();
  const fileName = TEAM_LOGOS_LOCAL[id];
  if (!fileName) return null;
  return withCacheBust(`${PAGES_BASE}/${TEAMLOGOS_DIR}/${fileName}`);
}

// ---------- Placeholder mode (alphabetical teams) ----------

function buildAlphabeticalPlaceholders() {
  return PLACEHOLDER_TEAMS.map((t) => {
    const logo = resolveTeamLogo(t.constructorId);
    return {
      constructorId: t.constructorId,
      team: t.team,
      position: "-",     // no P1/P2 until standings exist
      points: "-",       // ✅ dashes as requested
      wins: "-",
      teamLogoPng: logo,
      logoMissing: logo == null,
      placeholder: true,
    };
  });
}

// ---------- Main ----------

async function updateConstructors() {
  const now = new Date();

  // Only CURRENT (no fallback to prior seasons)
  let csPack = null;
  let lrPack = null;

  let csUrlUsed = null;
  let lrUrlUsed = null;
  let csAttempts = [];
  let lrAttempts = [];

  try {
    csPack = await fetchErgastWithFallback("/current/constructorStandings.json");
    csUrlUsed = csPack.url;
    csAttempts = csPack.attempts || [];
  } catch (e) {
    csAttempts = e?.attempts || [];
    console.warn("Constructor standings fetch failed (current).", e.message);
  }

  try {
    lrPack = await fetchErgastWithFallback("/current/last/results.json");
    lrUrlUsed = lrPack.url;
    lrAttempts = lrPack.attempts || [];
  } catch (e) {
    lrAttempts = e?.attempts || [];
    console.warn("Last race fetch failed (current).", e.message);
  }

  const csLists = csPack ? getStandingsListsFromErgast(csPack.data) : [];
  const constructorRows = csLists?.[0]?.ConstructorStandings || [];

  const races = lrPack ? getRacesFromErgast(lrPack.data) : [];
  const lastRaceRaw = races?.[0] || null;

  const seasonUsed = csPack
    ? String(getSeasonFromConstructorStandingsPayload(csPack.data) || "current")
    : "current";

  const roundUsed = lastRaceRaw?.round ? String(lastRaceRaw.round) : "-";

  const lastRaceOut = lastRaceRaw
    ? {
        season: String(lastRaceRaw.season || seasonUsed),
        round: String(lastRaceRaw.round || "-"),
        raceName: lastRaceRaw.raceName || "-",
        date: lastRaceRaw.date || "-",
        timeUtc: lastRaceRaw.time || "-",
        circuit: {
          name: lastRaceRaw?.Circuit?.circuitName || "-",
          locality: lastRaceRaw?.Circuit?.Location?.locality || "-",
          country: lastRaceRaw?.Circuit?.Location?.country || "-",
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

  let constructors = [];
  let mode = "ERGAST_CURRENT_EMPTY_PLACEHOLDERS_LOCAL_LOGOS";

  if (Array.isArray(constructorRows) && constructorRows.length > 0) {
    mode = "ERGAST_CURRENT_LIVE_LOCAL_LOGOS";

    constructors = constructorRows.map((row) => {
      const c = row?.Constructor || {};
      const constructorId = String(c.constructorId || "-").toLowerCase();

      const rawName = c.name || "-";
      const shortName = normalizeTeamName(rawName);

      const logo = resolveTeamLogo(constructorId);

      return {
        constructorId,
        team: shortName,
        position: fmtPos(row?.position),
        points: safeNumOrDash(row?.points),
        wins: safeNumOrDash(row?.wins),
        teamLogoPng: logo,
        logoMissing: logo == null,
        placeholder: false,
      };
    });

    // Ensure Cadillac row exists even if not in feed yet
    const hasCadillac = constructors.some((t) => String(t.constructorId || "").toLowerCase() === "cadillac");
    if (!hasCadillac) {
      const logo = resolveTeamLogo("cadillac");
      constructors.push({
        constructorId: "cadillac",
        team: "Cadillac",
        position: "-",
        points: "-",
        wins: "-",
        teamLogoPng: logo,
        logoMissing: logo == null,
        placeholder: true,
      });
    }

    // Ensure Audi placeholder exists if not in feed yet
    const hasAudi = constructors.some((t) => String(t.constructorId || "").toLowerCase() === "audi");
    if (!hasAudi) {
      const logo = resolveTeamLogo("audi");
      constructors.push({
        constructorId: "audi",
        team: "Audi",
        position: "-",
        points: "-",
        wins: "-",
        teamLogoPng: logo,
        logoMissing: logo == null,
        placeholder: true,
      });
    }

    // Guardrail: logos must be repo-hosted (or null)
    for (const t of constructors) {
      if (typeof t.teamLogoPng === "string" && t.teamLogoPng && !t.teamLogoPng.startsWith(PAGES_BASE)) {
        throw new Error(`Non-repo logo detected for ${t.constructorId}: ${t.teamLogoPng}`);
      }
    }
  } else {
    // Alphabetical placeholder mode
    constructors = buildAlphabeticalPlaceholders();
  }

  const out = {
    header: "Constructors standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      ergastBases: ERGAST_BASES,
      constructorStandings: csUrlUsed || "ERGAST_COMPAT_UNAVAILABLE",
      constructorStandingsAttempts: csAttempts,
      lastRace: lrUrlUsed || "ERGAST_COMPAT_UNAVAILABLE",
      lastRaceAttempts: lrAttempts,
      logos: `LOCAL_ONLY: ${PAGES_BASE}/${TEAMLOGOS_DIR}/`,
    },
    meta: {
      mode,
      seasonUsed,
      roundUsed,
      cacheBust: CACHE_BUST,
      note:
        "Only uses CURRENT constructor standings (no fallback to last season). If current standings are empty/unavailable, emits alphabetical placeholder teams with '-' stats. Logos are LOCAL ONLY from /teamlogos via GitHub Pages.",
    },
    lastRace: lastRaceOut,
    constructors,
  };

  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(
    `Wrote ${OUT_JSON} season=${out.meta.seasonUsed} constructors=${out.constructors.length} mode=${out.meta.mode}`
  );
}

updateConstructors().catch((err) => {
  console.error(err);
  process.exit(1);
});