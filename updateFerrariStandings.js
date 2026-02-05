// updateFerrariStandings.js
import fs from "node:fs/promises";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

// ✅ Your Ferrari logo URL
const FERRARI_LOGO_PNG =
  "https://raw.githubusercontent.com/Mredman48/F1-standings/refs/heads/main/teamlogos/2025_ferrari_color_v2.png";

const OUT_JSON = "f1_ferrari_standings.json";

// ----------------- Helpers -----------------

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return await res.text();
}

/**
 * Pull official F1 driver cutout URL from the driver profile page,
 * then increase width for higher-res.
 */
async function getF1DriverCutoutUrl(slug, width = 1400) {
  const pageUrl = `https://www.formula1.com/en/drivers/${slug}`;
  const html = await fetchHtml(pageUrl);

  const m = html.match(
    /https:\/\/media\.formula1\.com\/image\/upload\/[^"']+?\.(?:webp|png|jpg|jpeg)/i
  );
  if (!m) throw new Error(`Could not find driver image on ${pageUrl}`);

  let imgUrl = m[0];

  if (imgUrl.match(/w_\d+/)) {
    imgUrl = imgUrl.replace(/w_\d+/, `w_${width}`);
  } else if (imgUrl.includes("c_fill")) {
    imgUrl = imgUrl.replace("c_fill", `c_fill,w_${width}`);
  } else {
    imgUrl = imgUrl.replace("/image/upload/", `/image/upload/w_${width}/`);
  }

  return imgUrl;
}

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

// ----------------- Main -----------------

async function updateFerrariStandings() {
  const now = new Date();

  // Ferrari drivers (edit any time if you want different names)
  const driversConfig = [
    {
      firstName: "Charles",
      lastName: "Leclerc",
      code: "LEC",
      driverNumber: "16",
      slug: "charles-leclerc",
    },
    {
      firstName: "Lewis",
      lastName: "Hamilton",
      code: "HAM",
      driverNumber: "44",
      slug: "lewis-hamilton",
    },
  ];

  // High-res headshots (if a fetch fails, we set "-")
  const drivers = [];
  for (const d of driversConfig) {
    let headshotUrl = "-";
    try {
      headshotUrl = await getF1DriverCutoutUrl(d.slug, 1400);
    } catch (e) {
      console.log(`Could not fetch headshot for ${d.slug}:`, e?.message || e);
    }

    drivers.push({
      position: "-",      // placeholders as dashes
      points: "-",        // placeholders as dashes
      wins: "-",          // placeholders as dashes
      firstName: d.firstName,
      lastName: d.lastName,
      code: d.code,
      driverNumber: d.driverNumber,
      team: "Ferrari",
      headshotUrl,
      placeholder: true,
      bestResult: dashBestResult(),
    });
  }

  const out = {
    header: "Ferrari standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      ferrariLogo: FERRARI_LOGO_PNG,
      headshots: "formula1.com driver profile pages (media.formula1.com)",
      driverStandings: "DASH_PLACEHOLDERS",
      constructorStandings: "DASH_PLACEHOLDERS",
      lastRace: "DASH_PLACEHOLDERS",
    },
    meta: {
      mode: "DASH_PLACEHOLDERS_REAL_HIGHRES_HEADSHOTS",
      seasonUsed: "-",
      roundUsed: "-",
      note:
        "All non-image datapoints are '-' placeholders for widget building. Driver headshots are pulled from official F1 driver pages in high resolution.",
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