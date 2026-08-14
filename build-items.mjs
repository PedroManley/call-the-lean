// Daily content pipeline for Call the Lean — no AI involved.
// Pulls fresh headlines from a fixed list of rated outlets' RSS feeds, applies
// mechanical filters, and writes data/items.json. Run it each morning (or on a
// scheduler) to refresh the pool; the game seeds each day's edition from the date.
//
//   node build-items.mjs
//
// Curated per-item "tells" survive refreshes: any item whose URL already has a
// tell in the existing data/items.json keeps it. Items without one fall back to
// the outlet's house-style note in the game.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, "data", "items.json");

// ---------------------------------------------------------------------------
// Outlet config. Scale 0..4 = Left / Lean Left / Center / Lean Right / Right.
// MBFC maps: Left=0, Left-Center=1, Least Biased=2, Right-Center=3, Right=4.
// AllSides maps its own labels 1:1. `alt` = second accepted answer where the
// raters genuinely disagree (both score full credit). Ratings checked 2026-08-14.
// ---------------------------------------------------------------------------
const OUTLETS = {
  "Mother Jones": {
    lean: 0, alt: 1, mbfc: "Left-Center", allsides: "Left",
    contested: "AllSides rates Mother Jones Left; MBFC rates it Left-Center. Both answers score full credit.",
    note: "Progressive investigative magazine — contested policy fights get stated-as-fact framing, and stories tend to have named villains.",
    aliases: ["mother jones"],
    feeds: ["https://www.motherjones.com/politics/feed/", "https://www.motherjones.com/feed/"],
  },
  "The Intercept": {
    lean: 0, mbfc: "Left", allsides: "Left",
    note: "Adversarial left outlet — official claims arrive in scare quotes, and enforcement agencies are usually the antagonists.",
    aliases: ["the intercept", "intercept"],
    feeds: ["https://theintercept.com/feed/?rss"],
  },
  "The New York Times": {
    lean: 1, mbfc: "Left-Center", allsides: "Lean Left",
    note: "Institutional voice with measured verbs — the lean shows in story selection and quiet juxtaposition, rarely in vocabulary.",
    aliases: ["new york times", "nytimes", "nyt", "n.y. times", "the times"],
    feeds: ["https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml", "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml"],
  },
  "NPR": {
    lean: 1, mbfc: "Left-Center", allsides: "Lean Left",
    note: "Explainer tone and empathy-first sourcing — watch soft labels like “controversial” and who gets quoted.",
    aliases: ["npr", "national public radio"],
    feeds: ["https://feeds.npr.org/1014/rss.xml", "https://feeds.npr.org/1001/rss.xml"],
  },
  "BBC News": {
    lean: 2, mbfc: "Least Biased", allsides: "Center",
    note: "Wire-style who-what-when — adjectives are rationed on both sides, and “reportedly” hedges the claims.",
    aliases: ["bbc"],
    feeds: ["https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml"],
  },
  "The Hill": {
    lean: 2, alt: 1, mbfc: "Least Biased", allsides: "Center",
    contested: "MBFC and AllSides both place The Hill at center, but a 2026 AllSides editorial review scored it Lean Left. Either answer scores full credit.",
    note: "Beltway box scores — wins and losses reported like sports, framed the way officials framed them.",
    aliases: ["the hill"],
    feeds: ["https://thehill.com/feed/"],
  },
  "The Christian Science Monitor": {
    lean: 2, mbfc: "Least Biased", allsides: "Center",
    note: "Measured and hedged, no villains — hot topics covered without culture-war vocabulary.",
    aliases: ["christian science monitor", "csmonitor"],
    feeds: ["https://rss.csmonitor.com/feeds/politics", "https://rss.csmonitor.com/feeds/all"],
  },
  "New York Post": {
    lean: 3, mbfc: "Right-Center", allsides: "Lean Right",
    note: "Tabloid verbs and mockery with targets usually on the left — but it also runs straight wire copy, which is the hard mode.",
    aliases: ["new york post", "ny post", "nypost"],
    feeds: ["https://nypost.com/politics/feed/", "https://nypost.com/feed/"],
  },
  "Washington Examiner": {
    lean: 3, mbfc: "Right-Center", allsides: "Lean Right",
    note: "Conservative accountability angles and opinion-forward headlines aimed at Democrats and Beltway insiders.",
    aliases: ["washington examiner"],
    feeds: ["https://www.washingtonexaminer.com/feed"],
  },
  "Fox News": {
    lean: 4, mbfc: "Right", allsides: "Right",
    note: "Charged labels — “rhetoric,” scare quotes — and story selection that keeps progressive figures in the frame.",
    aliases: ["fox news", "foxnews", "fox"],
    feeds: ["https://moxie.foxnews.com/google-publisher/politics.xml", "https://moxie.foxnews.com/google-publisher/latest.xml"],
  },
  "The Daily Wire": {
    lean: 4, mbfc: "Right", allsides: null,
    singleSource: "Rated Right by MBFC; no AllSides rating was retrievable, so this one rests on a single source.",
    note: "Speaks directly to a conservative reader — “far-left” labels, prosecuting verbs, first-name mockery.",
    aliases: ["daily wire", "dailywire"],
    feeds: ["https://www.dailywire.com/feeds/rss.xml"],
  },
};

const PER_OUTLET_CAP = 6;
const LEDE_MIN = 40;
// Use as much of the publisher's own syndicated excerpt as they provide, up to a cap.
// Full article text is deliberately NOT fetched or republished — headlines + feed
// excerpts with attribution and a link back is the line aggregators stay behind.
const LEDE_MAX = 600;
// Mechanical junk filter: promos, betting, shopping, entertainment listicles.
const JUNK = /promo code|sportsbook|betting|coupon|% off|best deals|deal of|sale\b|\$\d+\/month|giveaway|horoscope|crossword|wordle|recipes?\b|streaming (this|now)|new movies|what to watch|box office|red carpet/i;

// ---------------------------------------------------------------------------
const decode = (s) => (s || "")
  .replace(/<!\[CDATA\[|\]\]>/g, "")
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&#0?39;|&apos;/g, "'").replace(/&#8217;/g, "’").replace(/&#8216;/g, "‘")
  .replace(/&#8220;/g, "“").replace(/&#8221;/g, "”").replace(/&quot;/g, '"')
  .replace(/&#8230;|&hellip;/g, "…").replace(/&#8211;|&ndash;/g, "–")
  .replace(/&#8212;|&mdash;/g, "—").replace(/&#124;/g, "|").replace(/&#160;|&nbsp;/g, " ")
  .replace(/\s+/g, " ").trim();

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

function hashId(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return "i" + h.toString(36);
}

async function fetchFeed(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { "user-agent": "Mozilla/5.0 (CallTheLean prototype; personal project)" },
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.text();
  } finally { clearTimeout(timer); }
}

function parseItems(xml) {
  return xml.split(/<item[\s>]/).slice(1).map((c) => {
    const title = decode((c.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1]);
    const desc = decode((c.match(/<description[^>]*>([\s\S]*?)<\/description>/) || [])[1]);
    let link = decode((c.match(/<link[^>]*>([\s\S]*?)<\/link>/) || [])[1]);
    if (!/^https?:\/\//.test(link)) link = decode((c.match(/<guid[^>]*>([\s\S]*?)<\/guid>/) || [])[1]);
    return { title, desc, link };
  }).filter((i) => i.title);
}

function trimLede(s) {
  // strip WordPress-style feed boilerplate ("The post X appeared first on Y.")
  // BEFORE anything else, so it can't trip the self-reference filter
  s = s.replace(/The post .{0,220}appeared first on .{0,100}$/i, "").trim();
  if (s.length <= LEDE_MAX) return s;
  const cut = s.slice(0, LEDE_MAX);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return stop > LEDE_MIN ? cut.slice(0, stop + 1) : cut.replace(/\s+\S*$/, "") + "…";
}

function selfReferencing(text, aliases) {
  const n = " " + norm(text) + " ";
  return aliases.some((a) => n.includes(" " + norm(a) + " "));
}

async function main() {
  // carry hand-written tells (by URL) and each outlet's previous items forward,
  // so a flaky feed degrades to yesterday's headlines instead of a missing outlet
  const oldTells = {};
  const oldByOutlet = {};
  if (existsSync(OUT)) {
    try {
      for (const it of JSON.parse(readFileSync(OUT, "utf8")).items || []) {
        if (it.url && it.tell) oldTells[it.url] = it.tell;
        (oldByOutlet[it.outlet] = oldByOutlet[it.outlet] || []).push(it);
      }
    } catch {}
  }

  const items = [];
  const report = [];
  for (const [outlet, cfg] of Object.entries(OUTLETS)) {
    let raw = null, used = null;
    for (const url of cfg.feeds) {
      try { raw = await fetchFeed(url); used = url; break; }
      catch (e) { report.push(`  feed failed: ${url} (${e.message})`); }
    }
    if (!raw) {
      const carried = (oldByOutlet[outlet] || []).slice(0, PER_OUTLET_CAP);
      items.push(...carried);
      report.push(`${outlet}: ALL FEEDS FAILED — carried over ${carried.length} previous items`);
      continue;
    }

    const seen = new Set();
    let kept = 0, dropped = { self: 0, junk: 0, short: 0, dupe: 0, nolink: 0 };
    for (const it of parseItems(raw)) {
      if (kept >= PER_OUTLET_CAP) break;
      const headline = it.title;
      const lede = trimLede(it.desc || "");
      const key = norm(headline);
      if (seen.has(key)) { dropped.dupe++; continue; }
      seen.add(key);
      if (!/^https?:\/\//.test(it.link)) { dropped.nolink++; continue; }
      if (lede.length < LEDE_MIN) { dropped.short++; continue; }
      if (JUNK.test(headline) || JUNK.test(lede)) { dropped.junk++; continue; }
      if (selfReferencing(headline + " " + lede, cfg.aliases)) { dropped.self++; continue; }
      const rec = {
        id: hashId(it.link), outlet, lean: cfg.lean,
        headline, lede, url: it.link,
        tell: oldTells[it.link] || null,
      };
      if (cfg.alt !== undefined) rec.alt = cfg.alt;
      if (cfg.contested) rec.contested = cfg.contested;
      if (cfg.singleSource) rec.singleSource = cfg.singleSource;
      items.push(rec);
      kept++;
    }
    report.push(`${outlet}: kept ${kept} (dupe ${dropped.dupe}, self ${dropped.self}, junk ${dropped.junk}, short ${dropped.short}, nolink ${dropped.nolink}) via ${used}`);
  }

  const outlets = {};
  for (const [name, cfg] of Object.entries(OUTLETS)) {
    const { feeds, aliases, ...pub } = cfg;
    outlets[name] = { ...pub, items: items.filter((i) => i.outlet === name).length };
  }

  const byBucket = [0, 0, 0, 0, 0];
  items.forEach((i) => byBucket[i.lean]++);

  const today = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;

  const doc = {
    schema: 1,
    generated: stamp,
    note: "Headlines and ledes are quoted from publishers' public RSS feeds with attribution and a link back to the original. `lean` is an OUTLET-level rating (0=Left .. 4=Right), not a judgment of the individual article.",
    ratingSources: {
      method: "Outlet-level ratings from two independent published raters, mapped onto one 5-point scale. Where they disagree, both answers are accepted.",
      raters: ["Media Bias/Fact Check (mediabiasfactcheck.com)", "AllSides (allsides.com)"],
      licensing: "MBFC publishes a licensed Data API whose terms name news apps as an intended use. AllSides ratings are CC BY-NC 4.0 — attribution required, commercial use needs a license. Ad Fontes Media requires a license for any reuse and its scores are paywalled, so it is not used here. Ground News publishes no ratings of its own; it averages these same third parties.",
      checked: "2026-08-14",
    },
    leanScale: ["Left", "Lean Left", "Center", "Lean Right", "Right"],
    outlets,
    items,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(doc, null, 2), "utf8");

  console.log(report.join("\n"));
  console.log(`\npool: ${items.length} items | buckets L/LL/C/LR/R = ${byBucket.join("/")}`);
  console.log(`tells carried forward: ${items.filter((i) => i.tell).length}`);
  const thin = byBucket.map((n, i) => n < 2 ? doc.leanScale[i] : null).filter(Boolean);
  if (thin.length) console.log(`WARNING: thin buckets (<2 items): ${thin.join(", ")} — today's edition may repeat outlets there`);
  console.log(`wrote ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
