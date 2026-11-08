const byId = (id) => document.getElementById(id);
const escape = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const MIRROR_DATA_ORIGIN = "https://lec615965-coder.github.io/medphd-2027-guide/data";
const PRIMARY_HOST = "medphd-2027-guide.loosemeerkat.chatgpt.site";

const fetchJson = async (path) => {
  const filename = path.split("/").at(-1);
  const candidates = window.location.hostname === PRIMARY_HOST
    ? [MIRROR_DATA_ORIGIN + "/" + filename, path]
    : [path];
  let lastError;
  for (const target of candidates) {
    try {
      const response = await fetch(target, { cache: "no-store" });
      if (!response.ok) throw new Error(target + " unavailable");
      return response.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
};

const state = { sources: [], notices: [], monitor: {}, keyword: "", region: "", degree: "" };

function readableTime(value) {
  if (!value) return "首次核验尚未完成";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    timeZone: "Asia/Shanghai"
  }).format(date);
}

function sourceMatches(source) {
  const query = state.keyword.trim().toLowerCase();
  const featured = source.featured || {};
  const featuredText = [featured.entryHeading, featured.scope, ...(featured.links || []).flatMap((item) => [item.type, item.label])];
  const haystack = [source.name, source.shortName, source.region, source.sourceType, source.status, ...source.degreeTypes, ...source.fields, ...featuredText]
    .join(" ").toLowerCase();
  return (!query || haystack.includes(query))
    && (!state.region || source.region === state.region)
    && (!state.degree || source.degreeTypes.includes(state.degree));
}

function noticeMatches(notice) {
  const source = state.sources.find((item) => item.id === notice.sourceId);
  const query = state.keyword.trim().toLowerCase();
  const degreeTypes = Array.isArray(notice.degreeTypes) ? notice.degreeTypes : [notice.degreeType];
  const haystack = [notice.title, notice.summary, ...degreeTypes, notice.field, source?.name || ""]
    .join(" ").toLowerCase();
  return (!query || haystack.includes(query))
    && (!state.region || source?.region === state.region)
    && (!state.degree || degreeTypes.includes(state.degree));
}

function renderNotices() {
  const host = byId("notice-list");
  const list = state.notices.filter(noticeMatches);
  byId("notice-count").textContent = list.length ? "找到 " + list.length + " 条已核验信息" : "暂未找到已核验通知";
  if (!list.length) {
    host.innerHTML = '<div class="empty-state"><b>信息流保持克制。</b><p>当前筛选范围内尚无带官方原文链接、可公开展示的 2027 招生通知。你仍可在下方“监测院校”中直达已登记的官方入口；首次定时核验完成后，符合规则的原文链接会出现在这里。</p></div>';
    return;
  }
  host.innerHTML = list.map((notice) => {
    const source = state.sources.find((item) => item.id === notice.sourceId);
    return '<article class="notice-row">'
      + '<div class="notice-meta">' + escape(source?.shortName || "官方来源") + '<br />' + escape(notice.publishedAt || "日期待核") + '</div>'
      + '<div class="notice-body"><h3>' + escape(notice.title) + '</h3><p>' + escape(notice.summary) + '</p></div>'
      + '<div class="notice-tags"><span class="tag">' + escape(notice.degreeType) + '</span><span class="tag">' + escape(notice.field) + '</span></div>'
      + '<a class="notice-link" href="' + escape(notice.url) + '" target="_blank" rel="noopener noreferrer" aria-label="打开官方原文：' + escape(notice.title) + '">↗</a>'
      + '</article>';
  }).join("");
}

function renderSources() {
  const host = byId("source-grid");
  const list = state.sources.filter(sourceMatches);
  const verifiedCount = state.sources.filter((item) => item.featured).length;
  byId("source-summary").textContent = "当前显示 " + list.length + " / " + state.sources.length + " 个官方来源；其中 " + verifiedCount + " 所展示已核验的 2027 招生或导师资格信息，其余仅为监测入口。";
  host.innerHTML = list.map((source) => {
    if (!source.featured) {
      return '<article class="source-card">'
        + '<div class="source-card-top"><span>' + escape(source.region) + '</span><span>' + escape(source.status) + '</span></div>'
        + '<h3>' + escape(source.name) + '</h3>'
        + '<p>' + escape(source.degreeTypes.join(" · ")) + ' · ' + escape(source.sourceType) + '</p>'
        + '<a href="' + escape(source.url) + '" target="_blank" rel="noopener noreferrer">前往官方入口</a>'
        + '</article>';
    }
    const entryLinks = source.featured.links.map((link) => '<a class="entry-link" href="' + escape(link.url) + '" target="_blank" rel="noopener noreferrer">'
      + '<span>' + escape(link.type) + '</span><b>' + escape(link.label) + '</b><i>↗</i></a>').join("");
    const detailRows = source.featured.requirements.map((item) => '<div class="source-detail-row">'
      + '<span>' + escape(item.label) + '</span><p>' + escape(item.value) + '</p></div>').join("");
    return '<article class="source-card source-card-featured">'
      + '<div class="source-card-top"><span>' + escape(source.region) + ' · ' + escape(source.sourceType) + '</span><span>' + escape(source.status) + '</span></div>'
      + '<div class="featured-identity"><h3>' + escape(source.name) + '</h3>'
      + '<p>' + escape(source.degreeTypes.join(" · ")) + ' · ' + escape(source.sourceType) + '</p>'
      + '<a class="source-home-link" href="' + escape(source.url) + '" target="_blank" rel="noopener noreferrer">院校来源主页</a></div>'
      + '<div class="entry-panel"><p class="entry-panel-label">' + escape(source.featured.entryHeading || "2027 年入口") + '</p>' + entryLinks + '</div>'
      + '<div class="source-detail-rows">' + detailRows + '</div>'
      + '<p class="source-scope">' + escape(source.featured.scope) + '</p>'
      + '</article>';
  }).join("")
    || '<div class="empty-state"><b>没有匹配的来源。</b><p>尝试清除关键词或放宽地区、学位类型条件。</p></div>';
}

function render() {
  renderNotices();
  renderSources();
}

function bindControls() {
  const form = byId("query-form");
  const keyword = byId("keyword");
  const region = byId("region-filter");
  const degree = byId("degree-filter");
  keyword.addEventListener("input", () => { state.keyword = keyword.value; render(); });
  region.addEventListener("change", () => { state.region = region.value; render(); });
  degree.addEventListener("change", () => { state.degree = degree.value; render(); });
  form.addEventListener("reset", () => {
    window.setTimeout(() => {
      state.keyword = ""; state.region = ""; state.degree = ""; render();
    }, 0);
  });
}

async function boot() {
  try {
    const [sources, notices, monitor] = await Promise.all([
      fetchJson("./data/sources.json"), fetchJson("./data/notices.json"), fetchJson("./data/monitor.json")
    ]);
    state.sources = sources;
    state.notices = notices;
    state.monitor = monitor;
    const regions = [...new Set(sources.map((item) => item.region))].sort((a, b) => a.localeCompare(b, "zh-CN"));
    byId("region-filter").insertAdjacentHTML("beforeend", regions.map((item) => '<option value="' + escape(item) + '">' + escape(item) + '</option>').join(""));
    byId("source-count").textContent = sources.length;
    byId("monitor-status").textContent = monitor.lastCheckedAt ? "上次检查 " + readableTime(monitor.lastCheckedAt) : "待首次核验";
    byId("freshness").textContent = monitor.lastCheckedAt ? "上次检查： " + readableTime(monitor.lastCheckedAt) : monitor.message;
    bindControls();
    render();
  } catch (error) {
    byId("notice-count").textContent = "数据暂不可用";
    byId("notice-list").innerHTML = '<div class="empty-state"><b>信息源暂时无法读取。</b><p>请稍后刷新页面，或直接访问下方院校官方入口。</p></div>';
    byId("monitor-status").textContent = "数据读取异常";
  }
}

boot();

