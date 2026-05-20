const http = require("node:http");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const OUTLETS_PATH = path.join(ROOT, "config", "outlets.json");
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12000;
const MAX_ARTICLES_PER_OUTLET = 8;
const MTV_LATEST_URL = "https://www.mtv.com.lb/";

const WAR_QUERY_TERMS = [
  "Gaza",
  "Lebanon",
  "Iran",
  "Hezbollah",
  "Hamas",
  "IDF",
  "\"Gaza war\"",
  "\"Israel-Hamas war\"",
  "\"Israel Iran\"",
  "\"Israel Lebanon\"",
  "\"West Bank\"",
  "\"Red Sea\"",
  "Houthis",
  "ceasefire",
  "hostages",
  "missiles",
  "strikes"
];

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8"
};

let lastSuccessfulPayload = null;

async function readOutlets() {
  const raw = await fs.readFile(OUTLETS_PATH, "utf8");
  return JSON.parse(raw);
}

function buildGdeltUrl(outlet) {
  const query = `domainis:${outlet.domain} (${WAR_QUERY_TERMS.join(" OR ")})`;
  const params = new URLSearchParams({
    query,
    mode: "artlist",
    format: "json",
    maxrecords: "25",
    timespan: "24h",
    sort: "datedesc"
  });

  return `https://api.gdeltproject.org/api/v2/doc/doc?${params.toString()}`;
}

function buildGoogleNewsUrl(outlet) {
  const query = `site:${outlet.domain} (${WAR_QUERY_TERMS.join(" OR ")}) when:1d`;
  const params = new URLSearchParams({
    q: query,
    hl: "en-US",
    gl: "US",
    ceid: "US:en"
  });

  return `https://news.google.com/rss/search?${params.toString()}`;
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        "accept": "application/json,text/xml,application/rss+xml,text/plain,*/*",
        "user-agent": "MiddleEastWarNewsBrief/1.0"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function parseDate(value) {
  if (!value) return null;

  if (/^\d{14}$/.test(value)) {
    const year = value.slice(0, 4);
    const month = value.slice(4, 6);
    const day = value.slice(6, 8);
    const hour = value.slice(8, 10);
    const minute = value.slice(10, 12);
    const second = value.slice(12, 14);
    const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const normalized = String(value).replace(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
    "$1-$2-$3T$4:$5:$6Z"
  );
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isRecent(date) {
  if (!date) return true;
  return Date.now() - date.getTime() <= ONE_DAY_MS;
}

function normalizeDomain(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^www\./, "");
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function stripTags(value) {
  return decodeEntities(value).replace(/<[^>]*>/g, "").trim();
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getTag(block, tagName) {
  const match = block.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? decodeEntities(match[1]).trim() : "";
}

function getSourceTag(block) {
  const match = block.match(/<source\b[^>]*>([\s\S]*?)<\/source>/i);
  return match ? stripTags(match[1]) : "";
}

function parseGoogleRss(xml, outlet) {
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];

  return items.map((item) => {
    const publishedDate = parseDate(getTag(item, "pubDate"));
    const title = stripTags(getTag(item, "title")).replace(new RegExp(`\\s+-\\s+${escapeRegExp(outlet.name)}$`, "i"), "");
    const description = stripTags(getTag(item, "description"));

    return {
      title,
      url: getTag(item, "link"),
      publishedAt: publishedDate ? publishedDate.toISOString() : null,
      image: null,
      summary: description,
      domain: outlet.domain,
      source: getSourceTag(item) || outlet.name,
      provider: "Google News RSS"
    };
  }).filter((article) => article.title && article.url && isRecent(parseDate(article.publishedAt)));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeGdeltArticle(article, outlet) {
  const publishedDate = parseDate(article.seendate);

  return {
    title: stripTags(article.title),
    url: article.url_mobile || article.url,
    publishedAt: publishedDate ? publishedDate.toISOString() : null,
    image: article.socialimage || null,
    summary: "",
    domain: article.domain || outlet.domain,
    source: outlet.name,
    provider: "GDELT"
  };
}

function getAnchorCandidates(html) {
  const anchors = [];
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorPattern.exec(html)) !== null) {
    const text = normalizeWhitespace(stripTags(match[2]));
    if (!text) continue;

    anchors.push({
      href: decodeEntities(match[1]),
      text
    });
  }

  return anchors;
}

function resolveMtvUrl(href) {
  try {
    return new URL(href, MTV_LATEST_URL).toString();
  } catch {
    return MTV_LATEST_URL;
  }
}

function parseMtvLatestItems(html, limit) {
  const anchors = getAnchorCandidates(html);
  const seen = new Set();
  const items = [];

  for (const anchor of anchors) {
    const hasArabic = /[\u0600-\u06FF]/.test(anchor.text);
    const hasTimePrefix = /^\d{1,2}:\d{2}\s+/.test(anchor.text);
    if (!hasArabic || !hasTimePrefix) continue;

    const timeMatch = anchor.text.match(/^(\d{1,2}:\d{2})\s+(.+)$/);
    const originalTitle = timeMatch ? timeMatch[2] : anchor.text;
    const key = normalizeArticleKey(anchor.href || originalTitle);
    if (seen.has(key)) continue;
    seen.add(key);

    items.push({
      sourceTime: timeMatch ? timeMatch[1] : null,
      originalTitle,
      url: resolveMtvUrl(anchor.href)
    });

    if (items.length >= limit) break;
  }

  return items;
}

async function translateToEnglish(text) {
  const params = new URLSearchParams({
    client: "gtx",
    sl: "auto",
    tl: "en",
    dt: "t",
    q: text
  });
  const raw = await fetchText(`https://translate.googleapis.com/translate_a/single?${params.toString()}`);
  const data = JSON.parse(raw);
  const translated = data?.[0]?.map((part) => part?.[0] || "").join("");

  return normalizeWhitespace(translated) || text;
}

async function fetchMtvLatestTranslated(outlet) {
  const errors = [];
  const html = await fetchText(MTV_LATEST_URL);
  const latestItems = parseMtvLatestItems(html, outlet.maxArticles || MAX_ARTICLES_PER_OUTLET);

  if (!latestItems.length) {
    return {
      ...outlet,
      status: "empty",
      errors: ["MTV Lebanon: could not find a latest timestamped headline"],
      articles: []
    };
  }

  const articles = await Promise.all(latestItems.map(async (latest) => {
    let translatedTitle = latest.originalTitle;

    try {
      translatedTitle = await translateToEnglish(latest.originalTitle);
    } catch (error) {
      errors.push(`Translation: ${error.message}`);
    }

    return {
      title: translatedTitle,
      url: latest.url,
      publishedAt: new Date().toISOString(),
      image: null,
      summary: latest.sourceTime ? `MTV source time: ${latest.sourceTime}` : "Latest MTV Lebanon headline",
      originalTitle: latest.originalTitle,
      domain: outlet.domain,
      source: outlet.name,
      provider: errors.length ? "MTV Lebanon" : "MTV Lebanon + Google Translate"
    };
  }));

  return {
    ...outlet,
    status: "ok",
    errors,
    articles
  };
}

function uniqueArticles(articles) {
  const seen = new Set();

  return articles.filter((article) => {
    const key = normalizeArticleKey(article.url || article.title);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeArticleKey(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach((param) => {
      url.searchParams.delete(param);
    });
    return url.toString();
  } catch {
    return String(value || "").toLowerCase().trim();
  }
}

async function fetchOutletNews(outlet) {
  if (outlet.strategy === "mtvLatestTranslated") {
    return fetchMtvLatestTranslated(outlet);
  }

  const errors = [];
  let articles = [];

  try {
    const rss = await fetchText(buildGoogleNewsUrl(outlet));
    articles = parseGoogleRss(rss, outlet);
  } catch (error) {
    errors.push(`Google News RSS: ${error.message}`);
  }

  if (articles.length === 0) {
    try {
      const raw = await fetchText(buildGdeltUrl(outlet));
      const data = JSON.parse(raw);
      const outletDomain = normalizeDomain(outlet.domain);

      articles = (data.articles || [])
        .map((article) => normalizeGdeltArticle(article, outlet))
        .filter((article) => normalizeDomain(article.domain).includes(outletDomain))
        .filter((article) => article.title && article.url)
        .filter((article) => isRecent(parseDate(article.publishedAt)));
    } catch (error) {
      errors.push(`GDELT: ${error.message}`);
    }
  }

  articles = uniqueArticles(articles)
    .sort((left, right) => {
      const leftTime = parseDate(left.publishedAt)?.getTime() || 0;
      const rightTime = parseDate(right.publishedAt)?.getTime() || 0;
      return rightTime - leftTime;
    })
    .slice(0, outlet.maxArticles || MAX_ARTICLES_PER_OUTLET);

  return {
    ...outlet,
    status: articles.length ? "ok" : "empty",
    errors,
    articles
  };
}

function groupByRegion(outlets) {
  return outlets.reduce((regions, outlet) => {
    const region = regions.find((entry) => entry.name === outlet.region);
    if (region) {
      region.outlets.push(outlet);
    } else {
      regions.push({ name: outlet.region, outlets: [outlet] });
    }
    return regions;
  }, []);
}

async function buildNewsPayload() {
  const outlets = await readOutlets();
  const startedAt = new Date();
  const settled = await Promise.allSettled(outlets.map(fetchOutletNews));

  const normalizedOutlets = settled.map((result, index) => {
    if (result.status === "fulfilled") return result.value;

    return {
      ...outlets[index],
      status: "error",
      errors: [result.reason?.message || "Unknown fetch error"],
      articles: []
    };
  });

  const articleCount = normalizedOutlets.reduce((sum, outlet) => sum + outlet.articles.length, 0);

  const payload = {
    generatedAt: new Date().toISOString(),
    window: {
      label: "Past 24 hours",
      from: new Date(startedAt.getTime() - ONE_DAY_MS).toISOString(),
      to: startedAt.toISOString()
    },
    refreshIntervalMs: ONE_DAY_MS,
    articleCount,
    regions: groupByRegion(normalizedOutlets)
  };

  if (articleCount > 0) {
    lastSuccessfulPayload = payload;
  }

  return payload;
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload, null, 2));
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    const extension = path.extname(filePath);
    response.writeHead(200, {
      "content-type": MIME_TYPES[extension] || "application/octet-stream",
      "cache-control": "no-store"
    });
    response.end(file);
  } catch (error) {
    response.writeHead(error.code === "ENOENT" ? 404 : 500);
    response.end(error.code === "ENOENT" ? "Not found" : "Server error");
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

    if (request.method === "GET" && url.pathname === "/api/news") {
      try {
        sendJson(response, 200, await buildNewsPayload());
      } catch (error) {
        if (lastSuccessfulPayload) {
          sendJson(response, 200, {
            ...lastSuccessfulPayload,
            stale: true,
            error: error.message
          });
          return;
        }

        sendJson(response, 502, {
          generatedAt: new Date().toISOString(),
          error: error.message,
          regions: []
        });
      }
      return;
    }

    if (request.method === "GET") {
      await serveStatic(request, response);
      return;
    }

    response.writeHead(405, { "allow": "GET" });
    response.end("Method not allowed");
  } catch (error) {
    response.writeHead(500);
    response.end(error.message);
  }
});

function getLocalNetworkUrls() {
  const urls = [`http://localhost:${PORT}`];
  const interfaces = os.networkInterfaces();

  Object.values(interfaces).forEach((entries) => {
    (entries || []).forEach((entry) => {
      if (entry.family === "IPv4" && !entry.internal) {
        urls.push(`http://${entry.address}:${PORT}`);
      }
    });
  });

  return [...new Set(urls)];
}

server.listen(PORT, HOST, () => {
  console.log("News dashboard running:");
  getLocalNetworkUrls().forEach((url) => console.log(`  ${url}`));
});
