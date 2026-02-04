// updateRedBullStandings.js
import fs from "node:fs/promises";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";
const OPENF1_BASE = "https://api.openf1.org/v1";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return await res.text();
}

/**
 * Pull the official F1 driver cutout from the driver profile page and upscale it.
 * Returns a media.formula1.com image URL (webp) at your desired width.
 */
async function getF1DriverCutoutUrl(slug, width = 1400) {
  const pageUrl = `https://www.formula1.com/en/drivers/${slug}`;
  const html = await fetchHtml(pageUrl);

  // Find the first "media.formula1.com/image/upload/....webp" on the page (driver cutout)
  const m = html.match(/https:\/\/media\.formula1\.com\/image\/upload\/[^"']+?\.(?:webp|png|jpg|jpeg)/i);
  if (!m) throw new Error(`Could not find driver image on ${pageUrl}`);

  let imgUrl = m[0];

  // If URL already has w_###, replace it; else inject w_WIDTH after c_fill,
  if (imgUrl.match(/w_\d+/)) {
    imgUrl = imgUrl.replace(/w_\d+/, `w_${width}`);
  } else if (imgUrl.includes("c_fill")) {
    imgUrl = imgUrl.replace("c_fill", `c_fill,w_${width}`);
  } else {
    // fallback: just prepend a width transform segment after /upload/
    imgUrl = imgUrl.replace("/image/upload/", `/image/upload/w_${width}/`);
  }

  return imgUrl;
}

// ✅ Your exact logo URL (raw GitHub)
const REDBULL_LOGO_PNG =
  "https://raw.githubusercontent.com/Mredman48/F1-standings/refs/heads/main/teamlogos/2025_red-bull_color_v2.png";

// Output JSON
const OUT_JSON = "f1_redbull_standings.json";

// If OpenF1 can’t supply a headshot, we use a harmless placeholder.
// Replace this with any image you want (or one you host in your repo).
const FALLBACK_HEADSHOT =
  "https://raw.githubusercontent.com/Mredman48/F1-standings/refs/heads/main/teamlogos/placeholder_headshot.png";

async function fetchText(url, headers = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, ...headers },
    redirect: "follow",
  });
  const text = await res.text();
  return { res, text };
}

async function fetchJson(url) {
  const { res, text } = await fetchText(url, { Accept: "application/json" });
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON from ${url}: ${text.slice(0, 140)}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return data;
}

/**
 * Build a map of driver -> headshot url.
 * We use OpenF1’s latest session so it works during offseason too.
 * Keys included:
 * - driver_number (preferred)
 * - name keys (fallback)
 */
async function getOpenF1HeadshotIndex() {
  const idx = {
    byNumber: new Map(),
    byName: new Map(), // "first last" lowercase => url
  };

  try {
    const sessions = await fetchJson(`${OPENF1_BASE}/sessions?session_key=latest`);
    const sessionKey = Array.isArray(sessions) ? sessions[0]?.session_key : null;
    if (!sessionKey) return idx;

    const drivers = await fetchJson(
      `${OPENF1_BASE}/drivers?session_key=${encodeURIComponent(sessionKey)}`
    );

    if (!Array.isArray(drivers)) return idx;

    for (const d of drivers) {
      const url = d?.headshot_url || null;
      if (!url) continue;

      if (d?.driver_number != null) {
        idx.byNumber.set(Number(d.driver_number), url);
      }

      const first = (d?.first_name || "").trim();
      const last = (d?.last_name || "").trim();
      const full = `${first} ${last}`.trim().toLowerCase();
      if (full && full !== " ") idx.byName.set(full, url);
    }

    return idx;
  } catch {
    return idx;
  }
}

function resolveHeadshot({ driverNumber, firstName, lastName }, headshotIndex) {
  if (driverNumber != null) {
    const byNum = headshotIndex.byNumber.get(Number(driverNumber));
    if (byNum) return byNum;
  }
  const full = `${firstName} ${lastName}`.trim().toLowerCase();
  const byName = headshotIndex.byName.get(full);
  if (byName) return byName;

  return FALLBACK_HEADSHOT;
}

function buildDummyJson(headshotIndex) {
  const now = new Date();

  // Dummy values (everything populated)
  const driversBase = [
    {
      // Real headshot expected
      firstName: "Max",
      lastName: "Verstappen",
      code: "VER",
      driverNumber: 1,
      // Dummy season stats
      position: "P1",
      points: 58,
      wins: 2,
      team: "Red Bull",
      placeholder: true,
      bestResult: {
        position: "P1",
        raceName: "Australian Grand Prix 2026",
        round: "1",
        date: "2026-03-08",
        circuit: "Albert Park Circuit",
      },
    },
    {
      // Might not exist in OpenF1 yet; will fallback if not found
      firstName: "Isack",
      lastName: "Hadjar",
      code: "HAD",
      driverNumber: 99,
      position: "P15",
      points: 2,
      wins: 0,
      team: "Red Bull",
      placeholder: true,
      bestResult: {
        position: "P8",
        raceName: "Saudi Arabian Grand Prix 2026",
        round: "2",
        date: "2026-03-15",
        circuit: "Jeddah Corniche Circuit",
      },
    },
  ];

  // Add resolved real headshotUrl fields
  const drivers = driversBase.map((d) => ({
    ...d,
    headshotUrl: resolveHeadshot(
      { driverNumber: d.driverNumber, firstName: d.firstName, lastName: d.lastName },
      headshotIndex
    ),
  }));

  return {
    header: "Red Bull standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      openf1: OPENF1_BASE,
      // These remain DUMMY so your widget doesn’t break when you later switch to live pulls.
      driverStandings: "DUMMY",
      constructorStandings: "DUMMY",
      lastRace: "DUMMY",
    },
    meta: {
      mode: "DUMMY_DATA_REAL_HEADSHOTS",
      seasonUsed: "2026",
      roundUsed: "3",
      note:
        "All fields are populated with dummy values for widget building. Headshots are pulled from OpenF1 (latest session) when available.",
    },
    redbull: {
      team: "Red Bull",
      teamLogoPng: REDBULL_LOGO_PNG,
      teamStanding: {
        team: "Red Bull",
        position: "P2",
        points: 123,
        wins: 4,
        originalTeam: "Oracle Red Bull Racing",
      },
    },
    lastRace: {
      season: "2026",
      round: "3",
      raceName: "Gulf Air Bahrain Grand Prix 2026",
      date: "2026-03-29",
      timeUtc: "15:00:00Z",
      circuit: {
        name: "Bahrain International Circuit",
        locality: "Sakhir",
        country: "Bahrain",
      },
    },
    drivers,
  };
}

async function updateRedBullStandings() {
  const headshotIndex = await getOpenF1HeadshotIndex();
  const out = buildDummyJson(headshotIndex);

  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON}`);
}

updateRedBullStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});