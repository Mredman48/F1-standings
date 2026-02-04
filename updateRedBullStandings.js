// updateRedBullStandings.js
import fs from "node:fs/promises";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

// ✅ Your exact logo URL
const REDBULL_LOGO_PNG =
  "https://raw.githubusercontent.com/Mredman48/F1-standings/refs/heads/main/teamlogos/2025_red-bull_color_v2.png";

const OUT_JSON = "f1_redbull_standings.json";

// ----------------- Fetch helpers -----------------

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return await res.text();
}

/**
 * Pull official F1 driver cutout URL from the driver profile page.
 * Then increase the requested width for higher-res.
 */
async function getF1DriverCutoutUrl(slug, width = 1400) {
  const pageUrl = `https://www.formula1.com/en/drivers/${slug}`;
  const html = await fetchHtml(pageUrl);

  // Find a media.formula1.com image URL on the page (driver cutout)
  const m = html.match(
    /https:\/\/media\.formula1\.com\/image\/upload\/[^"']+?\.(?:webp|png|jpg|jpeg)/i
  );
  if (!m) throw new Error(`Could not find driver image on ${pageUrl}`);

  let imgUrl = m[0];

  // Upgrade width transform if present
  if (imgUrl.match(/w_\d+/)) {
    imgUrl = imgUrl.replace(/w_\d+/, `w_${width}`);
  } else if (imgUrl.includes("c_fill")) {
    imgUrl = imgUrl.replace("c_fill", `c_fill,w_${width}`);
  } else {
    imgUrl = imgUrl.replace("/image/upload/", `/image/upload/w_${width}/`);
  }

  return imgUrl;
}

// ----------------- Dummy data builders (all fields populated) -----------------

function dummyTeamStanding() {
  return {
    team: "Red Bull",
    position: "P2",
    points: 123,
    wins: 4,
    originalTeam: "Oracle Red Bull Racing",
  };
}

function dummyLastRace() {
  return {
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
  };
}

function dummyBestResult(position, raceName, round, date, circuit) {
  return { position, raceName, round, date, circuit };
}

// ----------------- Main -----------------

async function updateRedBullStandings() {
  const now = new Date();

  // ✅ High-res F1 official images
  // (If a driver page changes, we fall back to a blank string instead of crashing)
  let maxHeadshot = "";
  let hadjarHeadshot = "";
  try {
    maxHeadshot = await getF1DriverCutoutUrl("max-verstappen", 1400);
  } catch (e) {
    console.log("Could not fetch Max headshot:", e?.message || e);
  }

  try {
    hadjarHeadshot = await getF1DriverCutoutUrl("isack-hadjar", 1400);
  } catch (e) {
    console.log("Could not fetch Hadjar headshot:", e?.message || e);
  }

  const out = {
    header: "Red Bull standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      redBullLogo: REDBULL_LOGO_PNG,
      headshots: "formula1.com driver profile pages (media.formula1.com)",
      driverStandings: "DUMMY",
      constructorStandings: "DUMMY",
      lastRace: "DUMMY",
    },
    meta: {
      mode: "DUMMY_DATA_REAL_HIGHRES_HEADSHOTS",
      seasonUsed: "2026",
      roundUsed: "3",
      note:
        "All stats are dummy values for widget building. Headshots are pulled from F1 driver pages and upscaled to high resolution.",
    },
    redbull: {
      team: "Red Bull",
      teamLogoPng: REDBULL_LOGO_PNG,
      teamStanding: dummyTeamStanding(),
    },
    lastRace: dummyLastRace(),
    drivers: [
      {
        position: "P1",
        points: 58,
        wins: 2,
        firstName: "Max",
        lastName: "Verstappen",
        code: "VER",
        driverNumber: 1,
        team: "Red Bull",
        headshotUrl: maxHeadshot,
        placeholder: true,
        bestResult: dummyBestResult(
          "P1",
          "Australian Grand Prix 2026",
          "1",
          "2026-03-08",
          "Albert Park Circuit"
        ),
      },
      {
        position: "P15",
        points: 2,
        wins: 0,
        firstName: "Isack",
        lastName: "Hadjar",
        code: "HAD",
        driverNumber: 99,
        team: "Red Bull",
        headshotUrl: hadjarHeadshot,
        placeholder: true,
        bestResult: dummyBestResult(
          "P8",
          "Saudi Arabian Grand Prix 2026",
          "2",
          "2026-03-15",
          "Jeddah Corniche Circuit"
        ),
      },
    ],
  };

  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON}`);
}

updateRedBullStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});