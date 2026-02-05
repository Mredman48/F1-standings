// updateFerrariStandings.js
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

// Ferrari logo
const FERRARI_LOGO_PNG =
  "https://raw.githubusercontent.com/Mredman48/F1-standings/refs/heads/main/teamlogos/2025_ferrari_color_v2.png";

const HEADSHOT_DIR = "headshots";
const OUT_JSON = "f1_ferrari_standings.json";

// Purpose-built: fetch an official F1 cutout PNG for a given driver slug
async function fetchF1DriverCutoutPng(slug, width = 1024) {
  const profileUrl = `https://www.formula1.com/en/drivers/${slug}.html`;

  // Fetch the driver profile HTML
  const res = await fetch(profileUrl, {
    headers: { "User-Agent": UA },
    redirect: "follow",
  });

  if (!res.ok) {
    throw new Error(`Could not fetch driver profile: ${slug} (${res.status})`);
  }

  const html = await res.text();

  // Find the first media.formula1.com image URL on the profile page
  const match = html.match(
    /https:\/\/media\.formula1\.com\/image\/upload\/[^"']+\.(?:webp|png)/i
  );

  if (!match) {
    throw new Error(`No cutout found on page for driver: ${slug}`);
  }

  let imgUrl = match[0];

  // Ensure we ask for the desired width
  if (imgUrl.match(/w_\d+/)) {
    imgUrl = imgUrl.replace(/w_\d+/, `w_${width}`);
  } else if (imgUrl.includes("c_fill")) {
    imgUrl = imgUrl.replace("c_fill", `c_fill,w_${width}`);
  } else {
    imgUrl = imgUrl.replace("/image/upload/", `/image/upload/w_${width}/`);
  }

  // Download the WebP
  const imgResponse = await fetch(imgUrl, {
    headers: { "User-Agent": UA },
  });
  if (!imgResponse.ok) {
    throw new Error(`Failed to download driver cutout: ${slug}`);
  }
  const webpBuffer = Buffer.from(await imgResponse.arrayBuffer());

  // Convert to PNG
  const pngBuffer = await sharp(webpBuffer).png().toBuffer();

  // Save locally
  await fs.mkdir(HEADSHOT_DIR, { recursive: true });
  const fileName = `${slug}_${width}.png`;
  const filePath = path.join(HEADSHOT_DIR, fileName);
  await fs.writeFile(filePath, pngBuffer);

  // Return the GitHub Pages raw URL
  return `https://raw.githubusercontent.com/Mredman48/F1-standings/refs/heads/main/${HEADSHOT_DIR}/${fileName}`;
}

// Build the JSON
async function updateFerrariStandings() {
  const now = new Date();

  // Ferrari drivers — each must exist on formula1.com
  const driversConfig = [
    { firstName: "Charles", lastName: "Leclerc", code: "LEC", slug: "charles-leclerc" },
    { firstName: "Lewis", lastName: "Hamilton", code: "HAM", slug: "lewis-hamilton" },
  ];

  const drivers = [];

  for (const d of driversConfig) {
    console.log(`Fetching cutout PNG for ${d.slug}...`);
    let headshotUrl;
    try {
      headshotUrl = await fetchF1DriverCutoutPng(d.slug, 1024);
    } catch (err) {
      console.error(`ERROR for driver ${d.slug}:`, err.message);
      throw err; // fail hard if missing
    }

    drivers.push({
      position: "-",
      points: "-",
      wins: "-",
      firstName: d.firstName,
      lastName: d.lastName,
      code: d.code,
      driverNumber: "-",
      team: "Ferrari",
      headshotUrl, // official transparent PNG
      placeholder: true,
      bestResult: {
        position: "-",
        raceName: "-",
        round: "-",
        date: "-",
        circuit: "-",
      },
    });
  }

  const out = {
    header: "Ferrari standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      ferrariLogo: FERRARI_LOGO_PNG,
      headshots: "Official F1 media cutouts from formula1.com",
      driverStandings: "DASH_PLACEHOLDERS",
      constructorStandings: "DASH_PLACEHOLDERS",
      lastRace: "DASH_PLACEHOLDERS",
    },
    meta: {
      mode: "OFFICIAL_HEADSHOTS_PNG",
      seasonUsed: "-",
      roundUsed: "-",
      note:
        "Driver profile photos are real cutouts from the official F1 site in PNG with transparent backgrounds.",
    },
    ferrari: {
      team: "Ferrari",
      teamLogoPng: FERRARI_LOGO_PNG,
      teamStanding: {
        team: "Ferrari",
        position: "-",
        points: "-",
        wins: "-",
        originalTeam: "-",
      },
    },
    lastRace: {
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
    },
    drivers,
  };

  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON}`);
}

updateFerrariStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});