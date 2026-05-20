const AUTO_REFRESH_MS = 24 * 60 * 60 * 1000;

const elements = {
  articleCount: document.querySelector("#articleCount"),
  lastUpdated: document.querySelector("#lastUpdated"),
  nextRefresh: document.querySelector("#nextRefresh"),
  refreshButton: document.querySelector("#refreshButton"),
  regions: document.querySelector("#regions"),
  status: document.querySelector("#status"),
  windowLabel: document.querySelector("#windowLabel"),
  regionTemplate: document.querySelector("#regionTemplate"),
  outletTemplate: document.querySelector("#outletTemplate"),
  articleTemplate: document.querySelector("#articleTemplate")
};

let refreshTimer = null;
let countdownTimer = null;
let nextRefreshAt = null;

function formatDateTime(value) {
  if (!value) return "Unknown";

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatRelative(value) {
  if (!value) return "Unknown time";

  const date = new Date(value);
  const seconds = Math.max(1, Math.round((Date.now() - date.getTime()) / 1000));
  const divisions = [
    ["year", 31536000],
    ["month", 2592000],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
    ["second", 1]
  ];
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  for (const [unit, amount] of divisions) {
    if (seconds >= amount || unit === "second") {
      return formatter.format(-Math.floor(seconds / amount), unit);
    }
  }

  return "Just now";
}

function formatCountdown() {
  if (!nextRefreshAt) return "In 24 hours";

  const remaining = Math.max(0, nextRefreshAt - Date.now());
  const hours = Math.floor(remaining / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);

  if (hours === 0 && minutes === 0) return "Soon";
  if (hours === 0) return `In ${minutes} min`;
  return `In ${hours} hr ${minutes} min`;
}

function setStatus(text, mode = "normal") {
  elements.status.textContent = text;
  elements.status.classList.toggle("error", mode === "error");
}

function renderArticle(article) {
  const node = elements.articleTemplate.content.firstElementChild.cloneNode(true);
  const link = node.querySelector("a");
  const time = node.querySelector("time");
  const provider = node.querySelector(".meta span");
  const summary = article.summary ? document.createElement("p") : null;

  link.href = article.url;
  link.textContent = article.title;
  time.dateTime = article.publishedAt || "";
  time.textContent = article.publishedAt ? formatRelative(article.publishedAt) : "Recently indexed";
  provider.textContent = article.provider || article.source || "News index";

  if (summary) {
    summary.className = "article-summary";
    summary.textContent = article.summary;
    node.appendChild(summary);
  }

  return node;
}

function renderOutlet(outlet) {
  const node = elements.outletTemplate.content.firstElementChild.cloneNode(true);
  const title = node.querySelector("h3");
  const homepage = node.querySelector(".homepage");
  const count = node.querySelector(".outlet-count");
  const articles = node.querySelector(".articles");

  title.textContent = outlet.name;
  homepage.href = outlet.homepage;
  homepage.textContent = outlet.domain;
  count.textContent = String(outlet.articles.length);

  if (!outlet.articles.length) {
    node.classList.add("no-results");
  }

  outlet.articles.forEach((article) => {
    articles.appendChild(renderArticle(article));
  });

  return node;
}

function renderRegion(region) {
  const node = elements.regionTemplate.content.firstElementChild.cloneNode(true);
  const title = node.querySelector("h2");
  const count = node.querySelector(".region-header span");
  const grid = node.querySelector(".outlet-grid");
  const articleCount = region.outlets.reduce((sum, outlet) => sum + outlet.articles.length, 0);

  title.textContent = region.name;
  count.textContent = `${articleCount} articles`;

  region.outlets.forEach((outlet) => {
    grid.appendChild(renderOutlet(outlet));
  });

  return node;
}

function renderDashboard(payload) {
  elements.regions.replaceChildren();
  elements.articleCount.textContent = String(payload.articleCount || 0);
  elements.windowLabel.textContent = payload.window?.label || "Past 24 hours";
  elements.lastUpdated.textContent = formatDateTime(payload.generatedAt);

  (payload.regions || []).forEach((region) => {
    elements.regions.appendChild(renderRegion(region));
  });
}

function scheduleNextRefresh(intervalMs = AUTO_REFRESH_MS) {
  window.clearTimeout(refreshTimer);
  window.clearInterval(countdownTimer);

  nextRefreshAt = Date.now() + intervalMs;
  elements.nextRefresh.textContent = formatCountdown();

  countdownTimer = window.setInterval(() => {
    elements.nextRefresh.textContent = formatCountdown();
  }, 60000);

  refreshTimer = window.setTimeout(() => {
    loadNews({ automatic: true });
  }, intervalMs);
}

async function loadNews(options = {}) {
  elements.refreshButton.disabled = true;
  setStatus(options.automatic ? "Auto updating" : "Updating");

  try {
    const response = await fetch(`/api/news?ts=${Date.now()}`, {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`News request failed with ${response.status}`);
    }

    const payload = await response.json();
    renderDashboard(payload);
    scheduleNextRefresh(payload.refreshIntervalMs || AUTO_REFRESH_MS);
    setStatus(payload.stale ? "Stale" : "Live", payload.stale ? "error" : "normal");
  } catch (error) {
    setStatus("Error", "error");
    elements.nextRefresh.textContent = "Retry manually";
    console.error(error);
  } finally {
    elements.refreshButton.disabled = false;
  }
}

elements.refreshButton.addEventListener("click", () => loadNews());
loadNews();
