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

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const state = { sources: [], notices: [], monitor: {}, keyword: "", region: "", degree: "", expandedExpiredSources: new Set() };

// Prefer an institution's public mentor directory when one is available. Every
// remaining card still exposes a mentor link, falling back to its registered
// official source instead of directing visitors to an unverified third party.
const MENTOR_DIRECTORIES = {
  ccmu: "https://yjsh.ccmu.edu.cn/dsdw/dsjj/bsyjsds/index.htm",
  shsmu: "http://daoshi.shsmu.edu.cn/Pages/IntroductionHome.aspx",
  "csu-xy": "https://faculty.csu.edu.cn/er_teacher_list.jsp?id=1040&lang=zh_CN&st=0&urltype=tsites.CollegeTeacherList&wbtreeid=1002",
  "xjtu-med": "https://medgs.xjtu.edu.cn/dsjj1/xsxwbszdjs.htm"
};

function mentorLink(source) {
  const directUrl = source.mentorUrl || MENTOR_DIRECTORIES[source.id];
  const href = directUrl || source.url;
  const note = directUrl
    ? "打开官方导师介绍"
    : "该校尚未单列公开导师库，打开已登记官方入口";
  return '<a class="mentor-link" href="' + escape(href) + '" target="_blank" rel="noopener noreferrer" title="' + escape(note) + '">导师介绍</a>';
}

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

function noticeDateValue(notice) {
  return /^20\d{2}-\d{2}-\d{2}$/.test(notice.publishedAt || "") ? notice.publishedAt : "0000-00-00";
}

function registrationDeadline(source) {
  const requirement = source.featured?.requirements?.find((item) => item.label === "报名时间");
  if (!requirement?.value) return null;
  const firstWindow = requirement.value.split(/[；;。]/)[0];
  if (/(未发布|不是考生|导师资格|导师新增|导师上岗|上岗申请|另行通知)/.test(firstWindow)) return null;
  const matches = [...firstWindow.matchAll(/(?:(20\d{2})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*(\d{1,2}):(\d{2}))?/g)];
  if (!matches.length) return null;
  let inferredYear = Number(matches[0][1] || 2026);
  const parsed = matches.map((match) => {
    if (match[1]) inferredYear = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4] || 23);
    const minute = Number(match[5] || 59);
    return {
      // Date.UTC reads its arguments as UTC. The source times are Beijing time,
      // so shift by UTC+8 before comparing them with the visitor's clock.
      value: Date.UTC(inferredYear, month - 1, day, hour, minute) - BEIJING_OFFSET_MS,
      label: inferredYear + " 年 " + month + " 月 " + day + " 日" + (match[4] ? " " + String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0") : "")
    };
  });
  return parsed.at(-1);
}

function isRegistrationClosed(source) {
  const deadline = registrationDeadline(source);
  return Boolean(deadline && deadline.value < Date.now());
}

function compareSourcesByDeadline(left, right) {
  const leftDeadline = registrationDeadline(left);
  const rightDeadline = registrationDeadline(right);
  const leftValue = leftDeadline?.value ?? Number.POSITIVE_INFINITY;
  const rightValue = rightDeadline?.value ?? Number.POSITIVE_INFINITY;
  if (leftValue !== rightValue) return leftValue - rightValue;
  return left.name.localeCompare(right.name, "zh-CN");
}

function sourceHeader(source, includeType, isClosed = false) {
  const deadline = registrationDeadline(source);
  const origin = includeType ? source.region + " · " + source.sourceType : source.region;
  return '<div class="source-card-top"><span>' + escape(origin) + '</span><span>' + escape(source.status) + '</span>'
    + (deadline ? '<span class="source-deadline' + (isClosed ? ' is-closed' : '') + '">' + (isClosed ? '已截止（北京时间） ' : '报名截至 ') + escape(deadline.label) + '</span>' : '') + '</div>';
}

function isCharterNotice(notice) {
  return /招生章程/.test([notice.title, notice.field].join(" "));
}

function renderNotices() {
  const host = byId("notice-list");
  const toggle = byId("notice-toggle");
  const charters = state.notices.filter(noticeMatches).filter(isCharterNotice)
    .sort((left, right) => noticeDateValue(right).localeCompare(noticeDateValue(left)) || left.title.localeCompare(right.title, "zh-CN"));
  const visibleList = charters.slice(0, 2);
  byId("notice-count").textContent = charters.length
    ? "招生章程 · 最近 " + visibleList.length + " 条"
    : "暂未找到招生章程";
  toggle.hidden = true;
  toggle.setAttribute("aria-expanded", "false");
  if (!charters.length) {
    host.innerHTML = '<div class="empty-state"><b>当前筛选范围暂无招生章程。</b><p>可调整查询条件，或在下方院校卡片中查看已登记的官方入口与报名时间。</p></div>';
    return;
  }
  host.innerHTML = visibleList.map((notice) => {
    const source = state.sources.find((item) => item.id === notice.sourceId);
    return '<article class="notice-row">'
      + '<div class="notice-meta">' + escape(source?.shortName || "官方来源") + '<br />' + escape(notice.publishedAt || "日期待核") + '</div>'
      + '<div class="notice-body"><h3>' + escape(notice.title) + '</h3><p>' + escape(notice.summary) + '</p></div>'
      + '<div class="notice-tags"><span class="tag">' + escape(notice.degreeType) + '</span><span class="tag">' + escape(notice.field) + '</span></div>'
      + '<a class="notice-link" href="' + escape(notice.url) + '" target="_blank" rel="noopener noreferrer" aria-label="打开官方原文：' + escape(notice.title) + '">↗</a>'
      + '</article>';
  }).join("");
}

function renderDeadlineTable() {
  const table = byId("deadline-table-body");
  const note = byId("deadline-table-note");
  const upcoming = state.sources.filter(sourceMatches)
    .map((source) => ({ source, deadline: registrationDeadline(source) }))
    .filter((item) => item.deadline && item.deadline.value >= Date.now())
    .sort((left, right) => left.deadline.value - right.deadline.value || left.source.name.localeCompare(right.source.name, "zh-CN"))
    .slice(0, 5);

  note.textContent = upcoming.length
    ? "按北京时间排列 · 仅列尚未截止的普通招考 / 申请－考核报名"
    : "当前筛选范围内暂无尚未截止的已核验报名时间";
  table.innerHTML = upcoming.length ? upcoming.map(({ source, deadline }) => '<tr>'
    + '<td><a href="#source-' + escape(source.id) + '">' + escape(source.name) + '</a><span>' + escape(source.region) + '</span></td>'
    + '<td><time datetime="' + escape(new Date(deadline.value).toISOString()) + '">' + escape(deadline.label) + '</time></td>'
    + '<td>' + escape(source.status) + '</td>'
    + '</tr>').join("")
    : '<tr><td class="deadline-empty" colspan="3">暂无可展示的近期报名截止时间。</td></tr>';
}

function renderSources() {
  const host = byId("source-grid");
  const list = state.sources.filter(sourceMatches).sort(compareSourcesByDeadline);
  const verifiedCount = state.sources.filter((item) => item.featured).length;
  const datedCount = list.filter(registrationDeadline).length;
  byId("source-summary").textContent = "当前显示 " + list.length + " / " + state.sources.length + " 个官方来源；其中 " + verifiedCount + " 所展示已核验的 2027 招生或导师资格信息。已按 " + datedCount + " 所院校的报名截止时间由早到晚排列；未发布考生截止日期或仅含导师资格信息的来源排在后面。";
  host.innerHTML = list.map((source) => {
    const isClosed = isRegistrationClosed(source);
    const isExpanded = state.expandedExpiredSources.has(source.id);
    if (!source.featured) {
      return '<article class="source-card" id="source-' + escape(source.id) + '">'
        + sourceHeader(source, false, isClosed)
        + '<h3>' + escape(source.name) + '</h3>'
        + '<p>' + escape(source.degreeTypes.join(" · ")) + ' · ' + escape(source.sourceType) + '</p>'
        + '<div class="source-card-actions">' + mentorLink(source)
        + '<a href="' + escape(source.url) + '" target="_blank" rel="noopener noreferrer">前往官方入口</a></div>'
        + '</article>';
    }
    if (isClosed && !isExpanded) {
      return '<article class="source-card source-card-featured source-card-expired" id="source-' + escape(source.id) + '">'
        + sourceHeader(source, true, true)
        + '<div class="expired-card-summary"><div><h3>' + escape(source.name) + '</h3>'
        + '<p>' + escape(source.degreeTypes.join(" · ")) + ' · ' + escape(source.sourceType) + '</p></div>'
        + '<div><p class="expired-card-note">该校普通招考报名已按北京时间截止；保留卡片供查阅官方原文。</p>'
        + '<button class="source-expander" type="button" data-source-expander="' + escape(source.id) + '" aria-expanded="false">展开全部信息 <span aria-hidden="true">↓</span></button></div></div>'
        + '</article>';
    }
    const entryLinks = source.featured.links.map((link) => '<a class="entry-link" href="' + escape(link.url) + '" target="_blank" rel="noopener noreferrer">'
      + '<span>' + escape(link.type) + '</span><b>' + escape(link.label) + '</b><i>↗</i></a>').join("");
    const detailRows = source.featured.requirements.map((item) => '<div class="source-detail-row">'
      + '<span>' + escape(item.label) + '</span><p>' + escape(item.value) + '</p></div>').join("");
    return '<article class="source-card source-card-featured" id="source-' + escape(source.id) + '">'
      + sourceHeader(source, true, isClosed)
      + '<div class="featured-identity"><h3>' + escape(source.name) + '</h3>'
      + '<p>' + escape(source.degreeTypes.join(" · ")) + ' · ' + escape(source.sourceType) + '</p>'
      + '<div class="source-card-actions">' + mentorLink(source)
      + '<a class="source-home-link" href="' + escape(source.url) + '" target="_blank" rel="noopener noreferrer">院校来源主页</a></div></div>'
      + '<div class="entry-panel"><p class="entry-panel-label">' + escape(source.featured.entryHeading || "2027 年入口") + '</p>' + entryLinks + '</div>'
      + '<div class="source-detail-rows">' + detailRows + '</div>'
      + '<p class="source-scope">' + escape(source.featured.scope) + '</p>'
      + (isClosed ? '<button class="source-expander source-expander-collapse" type="button" data-source-expander="' + escape(source.id) + '" aria-expanded="true">收起已截止信息 <span aria-hidden="true">↑</span></button>' : '')
      + '</article>';
  }).join("")
    || '<div class="empty-state"><b>没有匹配的来源。</b><p>尝试清除关键词或放宽地区、学位类型条件。</p></div>';
}

function render() {
  renderNotices();
  renderDeadlineTable();
  renderSources();
}

function bindControls() {
  const form = byId("query-form");
  const keyword = byId("keyword");
  const region = byId("region-filter");
  const degree = byId("degree-filter");
  byId("source-grid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-source-expander]");
    if (!button) return;
    const sourceId = button.dataset.sourceExpander;
    if (state.expandedExpiredSources.has(sourceId)) state.expandedExpiredSources.delete(sourceId);
    else state.expandedExpiredSources.add(sourceId);
    renderSources();
  });
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
    byId("registry-school-count").textContent = sources.length;
    byId("registry-entry-count").textContent = sources.length;
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

