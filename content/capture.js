// UnderControl Web Clipper - Content Script (Capture)
// AGPL-3.0 License

(function () {
  if (window.__udCaptureInitialized) return;
  window.__udCaptureInitialized = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "startCapture") {
      capturePageWithSingleFile()
        .then(result => {
          chrome.runtime.sendMessage({
            action: "captureComplete",
            title: result.title,
            url: result.url,
            html: result.html,
            filename: result.filename,
          });
        })
        .catch(err => {
          chrome.runtime.sendMessage({
            action: "captureError",
            error: err.message || "Capture failed",
          });
        });
      return true;
    }
  });

  async function capturePageWithSingleFile() {
    if (!globalThis.singlefile) {
      throw new Error("SingleFile library not loaded");
    }

    const options = {
      removeHiddenElements: true,
      removeUnusedStyles: true,
      removeUnusedFonts: true,
      removeFrames: false,
      blockVideos: true,
      blockScripts: true,
      compressHTML: true,
      removeAlternativeFonts: true,
      removeAlternativeMedias: true,
      removeAlternativeImages: false,
      groupDuplicateImages: true,
      filenameTemplate: "{page-title} ({date-iso} {time-locale})",
    };

    const pageData = await globalThis.singlefile.getPageData(options);

    const pageTitle = document.title || "Untitled";
    const safeTitle = pageTitle.replace(/[^a-zA-Z0-9\u4e00-\u9fff\s_-]/g, "_").substring(0, 100);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
    const filename = `${safeTitle}_${timestamp}.html`;

    return {
      title: pageTitle,
      url: location.href,
      html: pageData.content,
      filename: filename,
    };
  }
})();
