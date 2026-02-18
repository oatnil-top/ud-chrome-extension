// UnderControl Web Clipper - Markdown Extraction via Readability + Turndown
// AGPL-3.0 License

(function () {
  if (window.__udMarkdownInitialized) return;
  window.__udMarkdownInitialized = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "extractMarkdown") {
      try {
        const markdown = extractMarkdown();
        sendResponse({ success: true, markdown });
      } catch (err) {
        sendResponse({ success: false, error: err.message || "Markdown extraction failed" });
      }
      return false; // synchronous response
    }
  });

  function extractMarkdown() {
    if (typeof Readability === "undefined") {
      throw new Error("Readability library not loaded");
    }
    if (typeof TurndownService === "undefined") {
      throw new Error("TurndownService library not loaded");
    }

    // Clone the document so Readability doesn't mutate the live DOM
    const docClone = document.cloneNode(true);
    const reader = new Readability(docClone);
    const article = reader.parse();

    if (!article || !article.content) {
      throw new Error("Could not extract readable content from this page");
    }

    // Configure Turndown
    const turndown = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      emDelimiter: "*",
      bulletListMarker: "-",
      hr: "---",
    });

    // Add GFM plugin (tables, strikethrough, etc.) if available
    if (typeof turndownPluginGfm !== "undefined" && turndownPluginGfm.gfm) {
      turndown.use(turndownPluginGfm.gfm);
    }

    // Convert the extracted article HTML to Markdown
    const markdown = turndown.turndown(article.content);

    // Prepend the article title if available
    const title = article.title ? `# ${article.title}\n\n` : "";

    return title + markdown;
  }
})();
