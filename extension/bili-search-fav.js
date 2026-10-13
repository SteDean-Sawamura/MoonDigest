// B站 search results (search.bilibili.com): 「已收藏 · 收藏夹名」 before the titles of videos in any of your folders, and
// 「只看已收藏」 in the sort row, which swaps the results for B站's own favorites search over every folder (same keyword).
// The data comes from triage-bg.js (triage-fav-index, triage-fav-search).
(() => {
  if (window !== window.top || typeof chrome === "undefined" || !chrome.runtime?.id) return;
  const BVID_RE = /\/video\/(BV[0-9A-Za-z]{10})/;
  const esc = globalThis.MdgErrors.escapeHtml;
  const pad = (n) => String(n).padStart(2, "0");
  const dur = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}` : Math.floor(s / 60)) + `:${pad(s % 60)}`;
  const count = (n) => (n >= 1e4 ? `${(n / 1e4).toFixed(1).replace(/\.0$/, "")}万` : String(n));
  const where = (titles) => (titles.length > 1 ? `${titles[0]} 等 ${titles.length} 个` : titles[0]);

  const send = (msg) =>
    chrome.runtime.sendMessage(msg).then((r) => {
      if (!r?.ok) throw new Error(r?.error || "没有回应");
      return r.data;
    });
  const keyword = () => new URLSearchParams(location.search).get("keyword") || "";
  const onResults = () => /^\/(?:all|video)(?:\/|$)/.test(location.pathname);

  let index = null; // { bvid: [folder titles] }, null until loaded
  let indexAsked = false;
  let only = false;
  let shownKw = null; // the keyword the panel shows
  let panel = null;

  async function loadIndex() {
    if (indexAsked) return;
    indexAsked = true;
    try {
      index = (await send({ type: "triage-fav-index" })).index;
      schedule();
    } catch {
      // Not logged in or B站 said no: no marks, the switch still works and shows its own error.
    }
  }

  function markCards() {
    if (!index) return;
    for (const card of document.querySelectorAll(".search-page .bili-video-card")) {
      const b = BVID_RE.exec(card.querySelector('a[href*="/video/BV"]')?.getAttribute("href") || "")?.[1] || "";
      const tit = card.querySelector(".bili-video-card__info--tit");
      const old = tit?.querySelector(":scope > .mdg-favmark");
      if (old?.dataset.bvid === b) continue;
      old?.remove();
      const titles = index[b];
      if (!tit || !titles) continue;
      const el = Object.assign(document.createElement("span"), { className: "mdg-favmark", textContent: `已收藏 · ${where(titles)}` });
      el.dataset.bvid = b;
      el.title = `收藏在：${titles.join("、")}`;
      tit.prepend(el);
    }
  }

  function placeSwitch() {
    const row = document.querySelector(".search-condition-row");
    if (!row || row.querySelector(".mdg-favonly")) return;
    const box = Object.assign(document.createElement("span"), { className: "mdg-favonly" });
    const btn = Object.assign(document.createElement("button"), { type: "button", className: "vui_button vui_button--tab", textContent: "只看已收藏" });
    btn.title = "MoonDigest：在你所有的收藏夹里搜这个关键词";
    btn.addEventListener("click", () => {
      only = !only;
      schedule();
    });
    box.append(btn);
    row.append(box);
  }

  function renderPanel(state) {
    const host = document.querySelector(".search-page");
    if (!host) return;
    if (!panel?.isConnected) {
      panel = Object.assign(document.createElement("div"), { className: "mdg-favpanel" });
      host.before(panel);
    }
    const kw = esc(shownKw);
    if (state.loading) panel.innerHTML = `<p class="mdg-favhead">正在你的收藏夹里搜「${kw}」…</p>`;
    else if (state.error) panel.innerHTML = `<p class="mdg-favhead mdg-faverr">收藏夹搜索失败：${esc(state.error)}</p>`;
    else if (!state.items.length) panel.innerHTML = `<p class="mdg-favhead">收藏夹里没有和「${kw}」匹配的视频。收藏夹搜索只看标题和 UP 名字。</p>`;
    else {
      const head = `收藏夹里和「${kw}」匹配的视频：${state.items.length} 个${state.more ? "（只列前 400 个）" : ""}，按收藏时间从新到旧`;
      const cards = state.items
        .map((v) => {
          const titles = index?.[v.bvid];
          const url = `https://www.bilibili.com/video/${v.bvid}`;
          return `<div class="mdg-favcard${v.invalid ? " mdg-favgone" : ""}">
  <a class="mdg-favcover" href="${url}" target="_blank"><img src="${esc(v.cover)}@320w_200h_1c.webp" alt="" loading="lazy"><span>${dur(v.duration)}</span></a>
  <a class="mdg-favtit" href="${url}" target="_blank" title="${esc(v.title)}">${esc(v.title)}</a>
  <div class="mdg-favmeta">${v.invalid ? "已失效 · " : ""}${esc(v.up)} · ${count(v.play)} 播放${titles ? ` · ${esc(where(titles))}` : ""}</div>
</div>`;
        })
        .join("");
      panel.innerHTML = `<p class="mdg-favhead">${head}</p><div class="mdg-favgrid">${cards}</div>`;
    }
  }

  async function showOnly() {
    const kw = keyword();
    if (kw === shownKw && panel?.isConnected) return;
    shownKw = kw;
    renderPanel({ loading: true });
    let state;
    try {
      state = await send({ type: "triage-fav-search", keyword: kw });
    } catch (e) {
      state = { error: e.message };
    }
    if (kw === shownKw && only) renderPanel(state);
  }

  function apply() {
    if (!onResults()) return;
    loadIndex();
    placeSwitch();
    markCards();
    const on = only && Boolean(keyword());
    document.documentElement.classList.toggle("mdg-favonly-on", on);
    document.querySelector(".mdg-favonly button")?.classList.toggle("vui_button--active", on);
    if (on) showOnly();
    else {
      panel?.remove();
      panel = null;
      shownKw = null;
    }
  }

  // B站's search page is a single-page app: a new search or tab rewrites the DOM and the URL in place.
  let timer = 0;
  function schedule() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = 0;
      apply();
    }, 300);
  }
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  schedule();
})();
