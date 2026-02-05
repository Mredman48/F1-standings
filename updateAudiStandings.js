// updateAudiStandings.js
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

const OPENF1_BASE = "https://api.openf1.org/v1";
const ERGAST_BASES = ["https://api.jolpi.ca/ergast/f1", "https://ergast.com/api/f1"];

const OUT_JSON = "f1_audi_standings.json";

const TEAMLOGOS_DIR = "teamlogos";
const HEADSHOTS_DIR = "headshots";

// GitHub Pages base (Widgy-friendly)
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// Audi logo (you already use this file path in your JSON)
const AUDI_LOGO_LOCAL = "teamlogos/audi_logo_colored.png";
const AUDI_LOGO_PAGES = `${PAGES_BASE}/${AUDI_LOGO_LOCAL}`;

// External Audi logo source (kept in sources)
const AUDI_LOGO_SOURCE_PNG =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/0/03/Audif1.com_logo17_%28cropped%29.svg/1920px-Audif1.com_logo17_%28cropped%29.svg.png";

// ---------- small helpers ----------

function toSlug(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

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

async function fetchBinary(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function exists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

// ---------- Ergast helpers (with fallback) ----------

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
  const err = new Error(`Failed Ergast fetch for ${pathPart}. Attempts: ${JSON.stringify(attempts)}`);
  err.attempts = attempts;
  throw err;
}

function getRacesFromErgast(data) {
  return data?.MRData?.RaceTable?.Races || [];
}

function getStandingsListsFromErgast(data) {
  return data?.MRData?.StandingsTable?.StandingsLists || [];
}

// ---------- OpenF1 headshot pipeline (real only) ----------

async function getOpenF1HeadshotUrlByDriverNumber(driverNumber) {
  const url = `${OPENF1_BASE}/drivers?driver_number=${encodeURIComponent(driverNumber)}`;
  try {
    const rows = await fetchJson(url);
    if (!Array.isArray(rows) || rows.length === 0) return null;

    // pick newest by meeting_key if present
    const best = rows.reduce((a, b) => {
      const ak = Number(a?.meeting_key ?? -1);
      const bk = Number(b?.meeting_key ?? -1);
      return bk > ak ? b : a;
    }, rows[0]);

    return best?.headshot_url || null;
  } catch {
    return null;
  }
}

/**
 * Downloads OpenF1 headshot -> converts to PNG -> saves to /headshots/<slug>.png
 * Returns GitHub Pages URL OR null if not available.
 *
 * No placeholders: if no headshot_url, return null.
 * If previously saved PNG exists and OpenF1 fails, keep it by returning the Pages URL.
 */
async function getOrUpdateHeadshotPng({ firstName, lastName, driverNumber }, width = 900) {
  const slug = `${toSlug(firstName)}-${toSlug(lastName)}`;
  const fileName = `${slug}.png`;
  const localPath = path.join(HEADSHOTS_DIR, fileName);
  const pagesUrl = `${PAGES_BASE}/${HEADSHOTS_DIR}/${fileName}`;

  const openf1Url = await getOpenF1HeadshotUrlByDriverNumber(driverNumber);

  if (!openf1Url) {
    // If we already have a saved image from a prior run, keep using it.
    if (await exists(localPath)) return pagesUrl;
    return null; // no placeholder
  }

  const buf = await fetchBinary(openf1Url);

  await ensureDir(HEADSHOTS_DIR);

  // Convert to PNG; if source is already PNG/JPG/WEBP, this normalizes it.
  // (Transparency only exists if the source contains it.)
  const png = await sharp(buf)
    .resize({ width, withoutEnlargement: true })
    .png()
    .toBuffer();

  await fs.writeFile(localPath, png);
  return pagesUrl;
}

// ---------- Audi logo ensure (keeps your existing JSON fields) ----------

async function ensureAudiLogo() {
  await ensureDir(TEAMLOGOS_DIR);
  const local = AUDI_LOGO_LOCAL;
  if (await exists(local)) return;

  // Download the colored Audi logo source and store as PNG (already PNG)
  const buf = await fetchBinary(AUDI_LOGO_SOURCE_PNG);
  await fs.writeFile(local, buf);
}

// ---------- Main logic ----------

async function updateAudiStandings() {
  const now = new Date();

  await ensureAudiLogo();

  // We want “current” if Audi exists, else fallback to previous season like your output.
  // We’ll check current driver standings for constructor “audi” first; if not present, use 2025 “Sauber” placeholders.
  const currentSeason = "current";

  // Fetch current standings
  let seasonUsed = currentSeason;
  let roundUsed = "-";

  let driverStandingsUrlUsed = null;
  let constructorStandingsUrlUsed = null;
  let lastRaceUrlUsed = null;

  let driverStandingsData = null;
  let constructorStandingsData = null;
  let lastRaceData = null;

  // Helper to load a season set
  async function loadSeason(season) {
    const ds = await fetchErgastWithFallback(`/${season}/driverstandings.json`);
    const cs = await fetchErgastWithFallback(`/${season}/constructorstandings.json`);
    const lr = await fetchErgastWithFallback(`/${season}/last/results.json`);

    driverStandingsUrlUsed = ds.url;
    constructorStandingsUrlUsed = cs.url;
    lastRaceUrlUsed = lr.url;

    return {
      driver: ds.data,
      constructor: cs.data,
      lastRace: lr.data,
      lastRaceRound: getRacesFromErgast(lr.data)?.[0]?.round || "-",
      lastRaceSeason: getRacesFromErgast(lr.data)?.[0]?.season || season,
    };
  }

  // Determine if Audi exists in current constructor standings
  let loaded = await loadSeason("current");

  const csLists = getStandingsListsFromErgast(loaded.constructor);
  const cs = csLists?.[0]?.ConstructorStandings || [];
  const audiInCurrent = cs.some((x) => (x?.Constructor?.constructorId || "").toLowerCase() === "audi");

  if (!audiInCurrent) {
    // fallback season like your output: 2025
    loaded = await loadSeason("2025");
    seasonUsed = "2025";
  }

  // Set roundUsed from last race
  roundUsed = String(loaded.lastRaceRound || "-");

  driverStandingsData = loaded.driver;
  constructorStandingsData = loaded.constructor;
  lastRaceData = loaded.lastRace;

  // Pull last race details (same shape as your output)
  const lastRace = getRacesFromErgast(lastRaceData)?.[0];
  const lastRaceOut = lastRace
    ? {
        season: String(lastRace.season || seasonUsed),
        round: String(lastRace.round || "-"),
        raceName: lastRace.raceName || "-",
        date: lastRace.date || "-",
        timeUtc: lastRace.time || "-",
        circuit: {
          name: lastRace?.Circuit?.circuitName || "-",
          locality: lastRace?.Circuit?.Location?.locality || "-",
          country: lastRace?.Circuit?.Location?.country || "-",
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

  // Constructor standing: if Audi not present, use Sauber from 2025 but label as Audi (matches your note)
  const consLists = getStandingsListsFromErgast(constructorStandingsData);
  const consRows = consLists?.[0]?.ConstructorStandings || [];

  const getConsRow = (constructorId) =>
    consRows.find((x) => (x?.Constructor?.constructorId || "").toLowerCase() === constructorId);

  const audiConsRow = audiInCurrent ? getConsRow("audi") : null;
  const sauberConsRow = getConsRow("sauber");

  const consUsed = audiConsRow || sauberConsRow || null;

  const teamStandingOut = consUsed
    ? {
        team: "Audi",
        position: `P${consUsed.position}`,
        points: Number(consUsed.points),
        wins: Number(consUsed.wins),
        originalTeam: consUsed?.Constructor?.name || "-",
      }
    : {
        team: "Audi",
        position: "-",
        points: "-",
        wins: "-",
        originalTeam: "-",
      };

  // Driver standings: if Audi not present, use 2025 Sauber drivers but label Audi
  const dsLists = getStandingsListsFromErgast(driverStandingsData);
  const dsRows = dsLists?.[0]?.DriverStandings || [];

  // Collect drivers that belong to constructor in that season set
  // In Ergast, each driver standing has Constructors[] array.
  function belongsToConstructor(row, constructorId) {
    const cs = row?.Constructors || [];
    return cs.some((c) => (c?.constructorId || "").toLowerCase() === constructorId);
  }

  const constructorIdForDrivers = audiInCurrent ? "audi" : "sauber";
  const driverRows = dsRows.filter((r) => belongsToConstructor(r, constructorIdForDrivers));

  // For Audi placeholder mode, keep exactly 2 drivers if present
  const chosenDrivers = driverRows.slice(0, 2);

  // Best finish placeholders:
  // You already have bestFinish filled from last year in your working output.
  // We will keep “bestFinish” but if we can’t compute it reliably here, we preserve dashes.
  // (This does not affect your “only headshot change” request.)
  function bestFinishFromRow(row) {
    // Keep existing semantics: position + raceName + round + date + circuit
    // If you already compute it in your current file, you can swap this back in.
    return {
      position: "-",
      raceName: "-",
      round: "-",
      date: "-",
      circuit: "-",
    };
  }

  // Build drivers output with ONLY headshot change (OpenF1 download+png)
  const driversOut = [];
  for (const r of chosenDrivers) {
    const d = r?.Driver;
    const firstName = d?.givenName || "-";
    const lastName = d?.familyName || "-";
    const driverNumber = d?.permanentNumber ? Number(d.permanentNumber) : null;

    // ✅ new headshot pipeline (real only)
    const headshotPagesUrl =
      driverNumber != null
        ? await getOrUpdateHeadshotPng({ firstName, lastName, driverNumber }, 900)
        : null;

    driversOut.push({
      driverId: d?.driverId || toSlug(`${firstName}-${lastName}`),
      position: `P${r?.position ?? "-"}`,
      points: Number(r?.points ?? 0),
      wins: Number(r?.wins ?? 0),
      firstName,
      lastName,
      code: d?.code || "-",
      driverNumber: driverNumber ?? "-",
      team: "Audi",
      headshotUrl: headshotPagesUrl, // ✅ either Pages URL or null (no placeholder)
      placeholder: !audiInCurrent, // matches your “placeholder mode”
      bestFinish: bestFinishFromRow(r),
      originalTeam: (r?.Constructors?.[0]?.name || "-"),
    });
  }

  // If placeholder mode and Ergast returns fewer than 2 drivers, pad with minimal rows (no headshot placeholders)
  while (driversOut.length < 2) {
    driversOut.push({
      driverId: "-",
      position: "-",
      points: "-",
      wins: "-",
      firstName: "-",
      lastName: "-",
      code: "-",
      driverNumber: "-",
      team: "Audi",
      headshotUrl: null,
      placeholder: true,
      bestFinish: { position: "-", raceName: "-", round: "-", date: "-", circuit: "-" },
      originalTeam: "Sauber",
    });
  }

  // Output JSON matches your structure
  const out = {
    header: "Audi standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      openf1: OPENF1_BASE,
      audiLogoSourcePng: AUDI_LOGO_SOURCE_PNG,
      ergastBases: ERGAST_BASES,
      driverStandings: driverStandingsUrlUsed,
      constructorStandings: constructorStandingsUrlUsed,
      lastRace: lastRaceUrlUsed,
    },
    meta: {
      mode: audiInCurrent
        ? "AUDI_LIVE"
        : "AUDI_PLACEHOLDERS_FROM_KICK_SAUBER_LAST_YEAR",
      seasonUsed: String(seasonUsed),
      roundUsed: String(roundUsed),
      note: audiInCurrent
        ? "Audi present in standings; using live data."
        : "Audi not present in current standings yet; using Kick Sauber drivers + constructor data from last year as placeholders (team label forced to Audi).",
    },
    audi: {
      team: "Audi",
      teamLogoPng: AUDI_LOGO_PAGES,
      teamLogoLocalPath: AUDI_LOGO_LOCAL,
      teamStanding: teamStandingOut,
    },
    lastRace: lastRaceOut,
    drivers: driversOut,
  };

  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON}`);
}

updateAudiStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});