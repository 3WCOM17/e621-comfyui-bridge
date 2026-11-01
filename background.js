chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "e621-import") return;
  fetch("http://127.0.0.1:8188/furry_prompt/e621/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      post_id: message.postId,
      tags: message.tags,
      prompt: message.prompt,
      image_url: message.imageUrl,
      mode: message.mode,
      replace: message.replace,
      auto_negative: message.autoNegative,
    }),
  })
    .then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "HTTP " + response.status);
      sendResponse({ ok: true, seq: data.seq, count: data.count });
    })
    .catch((error) => {
      sendResponse({ ok: false, error: String(error && error.message || error) });
    });
  return true;
});
