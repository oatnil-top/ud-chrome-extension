# Chrome Web Store Listing

## 说明

Save any web page as a complete HTML snapshot and clean Markdown — locally or to your UnderControl server.

**Copy Markdown**
- One-click copy page content as clean Markdown to clipboard
- No login required — works on any page instantly
- Smart extraction via Readability + Turndown: strips ads, nav, and non-content elements
- GPU-safe: automatically strips video/canvas elements to prevent browser crashes on complex pages

**Local Save (no login required)**
- One-click save to local disk — works offline, no server needed
- Downloads two files: full-page HTML snapshot (via SingleFile) and extracted Markdown
- Perfect for archiving articles, research, and reference pages

**Save to UnderControl (with login)**
- Save pages as tasks in your UnderControl instance
- HTML snapshot uploaded as attachment, Markdown extracted into task description
- Supports login and API key authentication

**Bilibili Transcript Extraction**
- Extract subtitles/transcripts from Bilibili videos as formatted Markdown
- Supports CC and AI-generated subtitles
- Save locally or as a task in UnderControl

**How it works**
1. Click the extension icon on any web page
2. Choose "Copy Markdown" for instant clipboard copy
3. Or "Save to Local" to download HTML + Markdown files
4. Or log in to save directly to your UnderControl instance

Powered by SingleFile for accurate page capture and Readability + Turndown for intelligent content extraction.

Open source under AGPL-3.0.

## 类别

Productivity

## 语言

English

## 单一用途说明

This extension captures the current web page as an HTML snapshot and Markdown file, then saves them locally, copies Markdown to clipboard, or uploads to an UnderControl server.

## 权限说明

### activeTab

Required to read the content of the current tab when the user clicks "Save Page", "Save to Local", or "Copy Markdown". The extension captures the page DOM to generate an HTML snapshot and extract Markdown content.

### storage

Required to persist user preferences and authentication state (API URL, login tokens, API key) across browser sessions using chrome.storage.local.

### scripting

Required to inject page capture scripts (SingleFile for HTML snapshots) and content extraction scripts (Readability + Turndown for Markdown) into the active tab when the user initiates a save or copy.

### downloads

Required to save captured HTML snapshot and Markdown files to the user's local disk when using the "Save to Local" feature.

### cookies

Required to access Bilibili session cookies (SESSDATA) for extracting subtitles from videos that require authentication.

### 主机权限 (host_permissions: <all_urls>)

Required so the extension can capture any web page the user visits. The SingleFile library needs access to page resources (images, styles, fonts) on any domain to create a complete self-contained HTML snapshot.

## 远程代码

**选择: 不，我并未使用远程代码**

All scripts (SingleFile, Readability, Turndown) are bundled locally in the extension's lib/ directory. No code is loaded from external servers at runtime.

## 数据使用

**勾选:**

- [x] 网站内容 — The extension captures page HTML content and extracts text as Markdown when the user explicitly clicks "Save" or "Copy Markdown". Content is either saved to local disk, copied to clipboard, or uploaded to the user's own UnderControl server.
- [x] 身份验证信息 — The extension stores login credentials (username/password tokens, API key) in chrome.storage.local to authenticate with the user's UnderControl server. Credentials are only sent to the server URL configured by the user.

**不勾选:**

- [ ] 个人身份信息
- [ ] 健康信息
- [ ] 财务和付款信息
- [ ] 个人通讯
- [ ] 位置
- [ ] 网络记录 — The extension does NOT track or collect browsing history. It only processes the current page when the user explicitly initiates a save.
- [ ] 用户活动
