// UnderControl Web Clipper - Bilibili Video Info Extraction
// AGPL-3.0 License

(function () {
  if (window.__udBilibiliInitialized) return;
  window.__udBilibiliInitialized = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "extractBilibiliInfo") {
      try {
        const info = extractBilibiliInfo();
        sendResponse({ success: true, ...info });
      } catch (err) {
        sendResponse({ success: false, error: err.message || "Failed to extract video info" });
      }
      return false; // synchronous response
    }
  });

  function extractBilibiliInfo() {
    // Try to get from __INITIAL_STATE__ (most reliable)
    const state = window.__INITIAL_STATE__;
    if (state && state.videoData) {
      const vd = state.videoData;
      return {
        bvid: state.bvid || vd.bvid,
        cid: vd.cid,
        title: vd.title,
        author: vd.owner?.name,
        duration: vd.duration,
        pages: vd.pages?.map((p) => ({ cid: p.cid, part: p.part, page: p.page })),
        currentPage: state.p || 1,
      };
    }

    // Fallback: extract bvid from URL
    const match = location.pathname.match(/\/video\/(BV[a-zA-Z0-9]+)/);
    if (match) {
      return {
        bvid: match[1],
        cid: null,
        title: document.title.replace(/_哔哩哔哩_bilibili$/, "").trim(),
        author: null,
        duration: null,
        pages: null,
        currentPage: 1,
      };
    }

    throw new Error("Not a Bilibili video page");
  }
})();
