(function () {
  "use strict";

  const postMatch = location.pathname.match(/\/posts\/(\d+)/);
  if (!postMatch) return;

  const EXCLUDE = new Set(["artist", "character", "invalid"]);
  const META_BLACKLIST = new Set([
    "hi_res", "absurd_res", "superabsurd_res", "huge_filesize", "small_filesize",
    "digital_media_(artwork)", "traditional_media_(artwork)", "digital_drawing_(artwork)",
    "english_text", "text", "watermark", "signature", "username", "logo",
    "translation_request", "commentary", "source_request", "sound_warning",
    "animated", "video", "webm", "flash", "gif", "mp4", "1:1", "16:9", "4:3", "3:2", "2:1",
  ]);

  let lastTags = [];
  let lastPrompt = "";
  let lastImageUrl = "";

  const box = document.createElement("div");
  box.className = "e621-comfy-box";
  box.innerHTML = `
    <div class="e621-comfy-title">e621 → ComfyUI</div>
    <div class="e621-comfy-row">
      <button type="button" data-action="fill">填入 ComfyUI</button>
      <button type="button" data-action="copy">只复制</button>
    </div>
    <label class="e621-comfy-opt"><input type="checkbox" checked> 过滤技术 meta</label>
    <label class="e621-comfy-opt">写入方式
      <select class="e621-comfy-mode">
        <option value="both">词条 + 调参</option>
        <option value="params">只调参数（不改提示词）</option>
        <option value="prompt">只填词条（不调参）</option>
      </select>
    </label>
    <label class="e621-comfy-opt">上次 e621
      <select class="e621-comfy-replace">
        <option value="replace">替换</option>
        <option value="append">追加</option>
      </select>
    </label>
    <label class="e621-comfy-opt"><input type="checkbox" class="e621-comfy-auto-neg" checked> 自动负向</label>
    <div class="e621-comfy-status">读取标签中…</div>
  `;
  document.documentElement.appendChild(box);

  const status = box.querySelector(".e621-comfy-status");
  const filterMeta = box.querySelector('input[type="checkbox"]');
  const autoNeg = box.querySelector(".e621-comfy-auto-neg");
  const modeSelect = box.querySelector(".e621-comfy-mode");
  const replaceSelect = box.querySelector(".e621-comfy-replace");

  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(
      { e621WriteMode: "both", e621ReplaceMode: "replace", e621AutoNegative: true },
      (data) => {
        modeSelect.value = data.e621WriteMode || "both";
        replaceSelect.value = data.e621ReplaceMode || "replace";
        autoNeg.checked = data.e621AutoNegative !== false;
      },
    );
    modeSelect.addEventListener("change", () => {
      chrome.storage.local.set({ e621WriteMode: modeSelect.value });
    });
    replaceSelect.addEventListener("change", () => {
      chrome.storage.local.set({ e621ReplaceMode: replaceSelect.value });
    });
    autoNeg.addEventListener("change", () => {
      chrome.storage.local.set({ e621AutoNegative: autoNeg.checked });
    });
  }

  function setStatus(text, error) {
    status.textContent = text;
    status.classList.toggle("error", Boolean(error));
  }

  function categoryOf(node) {
    const match = String(node.className || "").match(/tag-type-([a-z]+)/);
    return match ? match[1] : "general";
  }

  function cleanTag(value) {
    return String(value || "").trim().replace(/_/g, " ");
  }

  function buildTags(tagsObject) {
    const out = [];
    const seen = new Set();
    for (const [category, values] of Object.entries(tagsObject || {})) {
      if (EXCLUDE.has(category)) continue;
      for (const raw of values || []) {
        const tag = cleanTag(raw);
        const lower = tag.toLowerCase();
        if (!tag) continue;
        if (filterMeta.checked && category === "meta" && META_BLACKLIST.has(lower)) continue;
        if (seen.has(lower)) continue;
        seen.add(lower);
        out.push(tag);
      }
    }
    return out;
  }

  async function fetchApiTags() {
    const response = await fetch(`/posts/${postMatch[1]}.json`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("API " + response.status);
    const data = await response.json();
    const post = data && data.post;
    const tags = post && post.tags;
    if (!tags || typeof tags !== "object") throw new Error("API 没有 tags");
    const imageUrl = (post.sample && post.sample.url)
      || (post.file && post.file.url)
      || (post.preview && post.preview.url)
      || "";
    return { tags: buildTags(tags), imageUrl };
  }

  function domImageUrl() {
    const meta = document.querySelector('meta[property="og:image"]');
    if (meta && meta.content) return meta.content;
    const img = document.querySelector("#image-container img, img#image");
    return img && img.src ? img.src : "";
  }

  function fetchDomTags() {
    const grouped = {};
    for (const node of document.querySelectorAll("#tag-sidebar li[class*='tag-type-']")) {
      const category = categoryOf(node);
      if (EXCLUDE.has(category)) continue;
      const link = node.querySelector("a");
      const tag = cleanTag(link ? link.textContent : "");
      if (!tag) continue;
      (grouped[category] ||= []).push(tag);
    }
    return { tags: buildTags(grouped), imageUrl: domImageUrl() };
  }

  async function readTags() {
    try {
      return await fetchApiTags();
    } catch (error) {
      const fallback = fetchDomTags();
      if (fallback.tags.length) return fallback;
      throw error;
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.left = "-9999px";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    }
  }

  function sendToComfy(tags, prompt, imageUrl, mode, replace, autoNegative) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(
          {
            type: "e621-import",
            postId: Number(postMatch[1]),
            tags,
            prompt,
            imageUrl,
            mode,
            replace,
            autoNegative,
          },
          (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            if (!response || !response.ok) {
              reject(new Error(response && response.error || "ComfyUI 未响应"));
              return;
            }
            resolve(response);
          },
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  async function refresh() {
    setStatus("读取标签中…");
    try {
      const result = await readTags();
      lastTags = result.tags;
      lastImageUrl = result.imageUrl || "";
      lastPrompt = lastTags.join(", ");
      setStatus(`准备就绪：${lastTags.length} 条（已排除角色/作者）`);
    } catch (error) {
      setStatus("读取失败：" + (error.message || error), true);
    }
  }

  box.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (!lastTags.length) await refresh();
    if (!lastTags.length) return;
    if (action === "copy") {
      const ok = await copyText(lastPrompt);
      setStatus(ok ? `已复制 ${lastTags.length} 条` : "复制失败，请选中状态栏手动复制", !ok);
      return;
    }
    setStatus("发送到 ComfyUI…");
    const mode = modeSelect.value || "both";
    const replace = replaceSelect.value !== "append";
    try {
      const response = await sendToComfy(lastTags, lastPrompt, lastImageUrl, mode, replace, autoNeg.checked);
      if (response.mode === "params") {
        setStatus(`已发送：只调参数${response.params ? " + WD14 参数" : "（没有拿到参数）"}；未写入词条`);
      } else if (response.mode === "prompt") {
        setStatus(`已${response.replace ? "替换" : "追加"}：${response.count || lastTags.length} 条词条（不调参）${response.negative ? " + 自动负向" : ""}`);
      } else {
        setStatus(`已${response.replace ? "替换" : "追加"}：${response.count || lastTags.length} 条词条${response.params ? " + WD14 参数" : ""}${response.negative ? " + 自动负向" : ""}`);
      }
    } catch (error) {
      const ok = await copyText(lastPrompt);
      setStatus(ok ? "ComfyUI 未连接，已复制到剪贴板" : "发送和复制都失败", true);
    }
  });

  filterMeta.addEventListener("change", refresh);
  refresh();
})();
