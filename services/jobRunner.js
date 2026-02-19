const fs = require("fs");
const path = require("path");
const { ensureCsvHeader, appendCsvRow } = require("../utils/csvFile");
const { dataDir } = require("../config/paths");
const { createJob, updateJob, getJob } = require("./jobStore");
const { startScraper, stopScraper } = require("./scraperSession");
const { extractLushaContacts } = require("../automation/lusha/extract");
const { clickLushaMinimize, clickLushaBadge } = require("../automation/lusha/actions");
const { clickContactoutBadge } = require("../automation/contactout/actions");
const { extractContactoutData } = require("../automation/contactout/extract");
const { minimizeContactout } = require("../automation/contactout/minimize");
const { extractSalesNavLeads } = require("../automation/salesNav/extract");
const { cleanName } = require("../utils/nameCleaner");
const { humanScrollSalesDashboard } = require("../automation/utils/salesDashBoardScroller");
const { clickNextPage, clickNextPageWithRetry, getPageInfo, getLeadListKey } = require("../automation/utils/pagination");
const { waitForAnyVisible, waitForSalesNavReady } = require("../automation/utils/dom");
const { disconnectBrowser } = require("./browser/launch");

const intervals = new Map();
const sessions = new Map();

const normalizeName = (name) => {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
};

const createCsvPath = (listName) => {
  const safe = normalizeName(listName || "job");
  const stamp = Date.now();
  return path.join(dataDir, `${safe}-${stamp}.csv`);
};

const csvHeader = "Page Number,Full Name,First Name,Last Name,Title,Company Name,Person Address,LinkedIn URL,Website,Website_one";

const escapeCsvValue = (value) => {
  const text = String(value ?? "");
  if (text.includes("\"") || text.includes(",") || text.includes("\n")) {
    return `"${text.replace(/\"/g, '""')}"`;
  }
  return text;
};

const toCsvRow = (record) => {
  const domains = Array.isArray(record.domains) ? record.domains : [];
  return [
    escapeCsvValue(record.pageNumber ?? ""),
    escapeCsvValue(record.fullName),
    escapeCsvValue(record.firstName),
    escapeCsvValue(record.lastName),
    escapeCsvValue(record.title || ""),
    escapeCsvValue(record.companyName),
    escapeCsvValue(record.location || ""),
    escapeCsvValue(record.linkedInUrl || ""),
    escapeCsvValue(domains[0] || ""),
    escapeCsvValue(domains[1] || ""),
  ].join(",");
};

const mergeDomains = (records, extensionRecords) => {
  if (!Array.isArray(records) || !Array.isArray(extensionRecords)) {
    return records;
  }
  for (const ext of extensionRecords) {
    const extRawName = String(ext.fullName || "");
    const extCleaned = cleanName(extRawName);
    const extFirstName = extCleaned.split(/\s+/)[0]?.toLowerCase();
    const extDomains = Array.isArray(ext.domains) ? ext.domains : [];
    if (!extFirstName || extDomains.length === 0) {
      continue;
    }
    for (const record of records) {
      if (!record) {
        continue;
      }
      const firstNameMatch =
        record.firstName && record.firstName.toLowerCase() === extFirstName;
      if (firstNameMatch) {
        if (!record.domains || record.domains.length === 0) {
          record.domains = [...extDomains];
        }
        break;
      }
    }
  }
  return records;
};

const hasLushaContacts = async (page, timeoutMs = 1500) => {
  const selectors = [
    "[data-test-id='bulk-contact-container-with-data']",
    ".bulk-contact-profile-container",
  ];
  try {
    await waitForAnyVisible(page, selectors, timeoutMs);
    return true;
  } catch (error) {
    return false;
  }
};

const hasContactoutContacts = async (page, timeoutMs = 1500) => {
  try {
    await waitForAnyVisible(page, ["[data-testid='contact-information']"], timeoutMs);
    return true;
  } catch (error) {
    return false;
  }
};

const detectLushaLoginPanel = async (page) => {
  for (const frame of page.frames()) {
    try {
      const name = frame.name() || "";
      if (name && name !== "LU__extension_iframe") {
        continue;
      }
      const found = await frame.evaluate(() => {
        const root = document.querySelector('#root');
        const loginBtn = document.querySelector('.login-btn, .lusha-login button');
        const loginText = document.querySelector('.lusha-login');
        return Boolean(root && (loginBtn || loginText));
      });
      if (found) {
        return true;
      }
    } catch (error) {
      // ignore
    }
  }
  return false;
};

const detectContactoutLoginPanel = async (page) => {
  for (const frame of page.frames()) {
    try {
      const found = await frame.evaluate(() => {
        const root = document.querySelector('#root');
        const loginBtn = Array.from(document.querySelectorAll('button')).find((b) =>
          /login|sign up/i.test((b.textContent || ''))
        );
        const headerLogo = document.querySelector('[data-testid="header-logo"]');
        const signupTitle = Array.from(document.querySelectorAll('h1')).some((h) =>
          /sign up/i.test(h.textContent || '')
        );
        return Boolean(root && (loginBtn || signupTitle) && headerLogo);
      });
      if (found) {
        return true;
      }
    } catch (error) {
      // ignore
    }
  }
  return false;
};

const runPageExtraction = async ({ page, job, filePath, pageIndex, total }) => {
  const extractDelayMs = Number(process.env.EXTRACT_DELAY_MS || 200);
  const timings = {
    preExtractMs: 0,
    scrollMs: 0,
    salesNavExtractMs: 0,
    lushaExtractMs: 0,
    lushaMinimizeMs: 0,
    contactoutClickMs: 0,
    contactoutExtractMs: 0,
    csvWriteMs: 0,
  };
  const flowStart = Date.now();

  // 1. Pre-extraction delay
  if (extractDelayMs > 0 && page) {
    const tPre = Date.now();
    await page.waitForTimeout(extractDelayMs);
    timings.preExtractMs = Date.now() - tPre;
  }

  // 2. Click Lusha badge to activate extension
  if (page) {
    try {
      await clickLushaBadge(page, Number(process.env.LUSHA_BADGE_TIMEOUT_MS || 8000));
    } catch (error) {
      // keep going
    }
  }

  // 3. Human scroll the dashboard
  if (page) {
    const tScroll = Date.now();
    await humanScrollSalesDashboard(page, {
      minSteps: Number(process.env.HUMAN_SCROLL_MIN_STEPS || 7),
      maxSteps: Number(process.env.HUMAN_SCROLL_MAX_STEPS || 10),
      stepPx: Number(process.env.HUMAN_SCROLL_STEP_PX || 200),
      minDelayMs: Number(process.env.HUMAN_SCROLL_MIN_DELAY_MS || 200),
      maxDelayMs: Number(process.env.HUMAN_SCROLL_MAX_DELAY_MS || 550),
      timeoutMs: Number(process.env.HUMAN_SCROLL_TIMEOUT_MS || 15000),
      maxRounds: Number(process.env.HUMAN_SCROLL_MAX_ROUNDS || 20),
      bottomStallLimit: Number(process.env.HUMAN_SCROLL_BOTTOM_STALL_LIMIT || 4),
    });
    timings.scrollMs = Date.now() - tScroll;
  }

  // 4. Extract lead data from Sales Nav DOM
  const tSalesNav = Date.now();
  const records = page ? await extractSalesNavLeads(page) : [];
  timings.salesNavExtractMs = Date.now() - tSalesNav;

  // 5. Extract Lusha domains and merge by first name
  let lushaSeconds = 0;
  try {
    if (page) {
      const lushaVisible = await hasLushaContacts(page, 1200);
      if (!lushaVisible) {
        const lushaLogin = await detectLushaLoginPanel(page);
        if (lushaLogin) {
          throw new Error("Lusha login expired. Please re-login in your Chrome profile.");
        }
      }
      const lushaStart = Date.now();
      const lushaRecords = await extractLushaContacts(page, { maxCards: 25, debug: true, retryOnTimeout: true });
      timings.lushaExtractMs = Date.now() - lushaStart;
      lushaSeconds = Number((timings.lushaExtractMs / 1000).toFixed(2));
      mergeDomains(records, lushaRecords);

      // 6. Minimize Lusha
      const tMin = Date.now();
      await clickLushaMinimize(page, { timeoutMs: 1500, preferFrame: true });
      timings.lushaMinimizeMs = Date.now() - tMin;
    }
  } catch (error) {
    if (error && error.message && error.message.includes("login expired")) {
      throw error;
    }
  }
  updateJob(job.id, { lushaSeconds });

  // 7. Click ContactOut badge and extract domains immediately
  let contactoutSeconds = 0;
  try {
    if (page) {
      const tClick = Date.now();
      await clickContactoutBadge(page, {
        timeoutMs: Number(process.env.CONTACTOUT_CLICK_TIMEOUT_MS || 4000),
        skipReadyWait: true,
        perFrameWaitMs: Number(process.env.CONTACTOUT_FRAME_WAIT_MS || 150),
        mainDocWaitMs: Number(process.env.CONTACTOUT_MAIN_WAIT_MS || 300),
        postMinimizeDelayMs: Number(process.env.CONTACTOUT_MINIMIZE_DELAY_MS || 50),
        maxFrames: Number(process.env.CONTACTOUT_MAX_FRAMES || 6),
      });
      timings.contactoutClickMs = Date.now() - tClick;
      const expectedLeadKey = await getLeadListKey(page).catch(() => null);
      const contactoutStart = Date.now();
      const contactoutData = await extractContactoutData(page, {
        timeoutMs: Number(process.env.CONTACTOUT_TIMEOUT_MS || 10000),
        debug: true,
        minResults: 1,
        retryDelayMs: Number(process.env.CONTACTOUT_RETRY_DELAY_MS || 500),
        maxRetries: Number(process.env.CONTACTOUT_MAX_RETRIES || 2),
        expectedLeadKey,
      }).catch(() => []);
      timings.contactoutExtractMs = Date.now() - contactoutStart;
      contactoutSeconds = Number((timings.contactoutExtractMs / 1000).toFixed(2));
      mergeDomains(records, contactoutData);

      // 7.5. Minimize ContactOut sidebar
      try {
        await minimizeContactout(page, { timeoutMs: 2000 });
      } catch (error) {
        // non-critical, continue
      }
    }
  } catch (error) {
    if (error && error.message && error.message.includes("login expired")) {
      throw error;
    }
  }

  // 7.6. Random sleep 2-3 seconds before pagination
  if (page) {
    const sleepMs = 2000 + Math.random() * 1000;
    console.log(`[flow] sleeping ${Math.round(sleepMs)}ms before pagination`);
    await page.waitForTimeout(sleepMs);
  }

  // 8. Write all records to CSV
  let added = 0;
  const tCsv = Date.now();
  for (const record of records) {
    record.pageNumber = pageIndex;
    appendCsvRow(filePath, toCsvRow(record));
    added += 1;
  }
  timings.csvWriteMs = Date.now() - tCsv;

  const extractSeconds = Number((lushaSeconds + contactoutSeconds).toFixed(2));
  const flowSeconds = Number(((Date.now() - flowStart) / 1000).toFixed(2));
  const nextTotal = (total || 0) + added;
  updateJob(job.id, {
    lushaSeconds,
    contactoutSeconds,
    extractSeconds,
    totalSeconds: flowSeconds,
    total: nextTotal,
    pageIndex,
  });
  console.log(
    `[timing][page:${pageIndex}] scroll=${timings.scrollMs}ms salesNav=${timings.salesNavExtractMs}ms lushaExtract=${timings.lushaExtractMs}ms lushaMin=${timings.lushaMinimizeMs}ms contactoutClick=${timings.contactoutClickMs}ms contactoutExtract=${timings.contactoutExtractMs}ms total=${Math.round(flowSeconds * 1000)}ms`
  );
  console.log(`[timing][page:${pageIndex}] csvWrite=${timings.csvWriteMs}ms rows=${added}`);
  return { added, total: nextTotal };
};

const runPaginatedExtraction = async ({ page, job, filePath, initialTotal }) => {
  let total = initialTotal || 0;
  let pageIndex = 1;
  const maxPagesEnv = process.env.MAX_PAGES;
  const maxPages = Number.isFinite(Number(maxPagesEnv)) ? Number(maxPagesEnv) : 100;
  let lastPageNumber = null;
  if (page) {
    const info = await getPageInfo(page).catch(() => null);
    lastPageNumber = info?.pageNumber ?? null;
  }
  for (let i = 0; i < maxPages; i += 1) {
    // Check if job was stopped
    const currentJob = getJob(job.id);
    if (currentJob && currentJob.status === "Stopped") {
      console.log("[pagination] job stopped by user");
      return { total, failed: false };
    }

    let result;
    try {
      result = await runPageExtraction({ page, job, filePath, pageIndex, total });
    } catch (error) {
      const message = String(error.message || error);
      updateJob(job.id, { status: "Failed", error: message });
      await disconnectBrowser();
      return { total, failed: true, error: message };
    }
    total = result.total;
    if (!page) {
      break;
    }
    console.log(`[pagination] page ${pageIndex} done, moving next...`);
    const expectedNext = lastPageNumber ? lastPageNumber + 1 : null;
    const next = await clickNextPageWithRetry(page, {
      timeoutMs: Number(process.env.NEXT_PAGE_TIMEOUT_MS || 15000),
      expectedNext,
      maxRetries: 3,
    });
    if (!next.moved) {
      const reason = next.reason || "no-move";
      if (reason === "disabled") {
        console.log("[pagination] reached last page");
        break;
      }
      // After all retries exhausted, log but don't crash
      console.log(`[pagination] all retries exhausted: ${reason}`);
      if (reason.includes("page-mismatch")) {
        // Page mismatch after retries = data integrity risk, stop gracefully
        const errorMessage = `Pagination stopped after retries: ${reason}`;
        updateJob(job.id, { status: "Failed", error: errorMessage });
        return { total, failed: true, error: errorMessage };
      }
      // For timeouts, try to continue from current position
      console.log("[pagination] attempting to continue from current page state");
      const currentInfo = await getPageInfo(page).catch(() => null);
      if (currentInfo?.pageNumber && currentInfo.pageNumber > (lastPageNumber || 0)) {
        lastPageNumber = currentInfo.pageNumber;
        pageIndex += 1;
        continue;
      }
      const errorMessage = `Pagination failed after 3 retries: ${reason}`;
      updateJob(job.id, { status: "Failed", error: errorMessage });
      return { total, failed: true, error: errorMessage };
    }
    // Strict page tracking - only update on confirmed navigation
    if (next.pageNumber && lastPageNumber && next.pageNumber !== lastPageNumber + 1) {
      console.log(`[pagination] page mismatch after move: expected ${lastPageNumber + 1}, got ${next.pageNumber}`);
      const errorMessage = `Pagination page mismatch: expected ${lastPageNumber + 1}, got ${next.pageNumber}`;
      updateJob(job.id, { status: "Failed", error: errorMessage });
      return { total, failed: true, error: errorMessage };
    }
    lastPageNumber = next.pageNumber || (lastPageNumber ? lastPageNumber + 1 : null);
    pageIndex += 1;
  }
  if (maxPagesEnv && pageIndex > maxPages) {
    console.log(`[pagination] stopped at MAX_PAGES=${maxPages}`);
  }
  return { total, failed: false };
};

const startJob = async ({ listName, listUrl }) => {
  const filePath = createCsvPath(listName);
  ensureCsvHeader(filePath, csvHeader);
  const job = createJob({ listName, listUrl, filePath });
  try {
    const session = await startScraper(job);
    sessions.set(job.id, session);
  } catch (error) {
    updateJob(job.id, { status: "Failed", error: String(error.message || error) });
    throw error;
  }
  const session = sessions.get(job.id);
  const page = session?.page;
  const result = await runPaginatedExtraction({
    page,
    job,
    filePath,
    initialTotal: 0,
  });
  updateJob(job.id, { total: result.total });
  if (result.failed) {
    return updateJob(job.id, { status: "Failed", error: result.error || "Pagination failed" });
  }
  const keepBrowser = String(process.env.KEEP_BROWSER_AFTER_JOB || "true").toLowerCase() === "true";
  if (!keepBrowser && session) {
    await stopScraper(session);
    sessions.delete(job.id);
  }
  return updateJob(job.id, { status: "Completed" });
};

const resumeJob = async (id) => {
  const job = getJob(id);
  if (!job) {
    return null;
  }
  if (job.status === "Running") {
    return job;
  }
  ensureCsvHeader(job.filePath, csvHeader);
  try {
    const session = await startScraper(job);
    sessions.set(job.id, session);
  } catch (error) {
    updateJob(job.id, { status: "Failed", error: String(error.message || error) });
    throw error;
  }
  const session = sessions.get(job.id);
  const page = session?.page;
  const result = await runPaginatedExtraction({
    page,
    job,
    filePath: job.filePath,
    initialTotal: job.total || 0,
  });
  updateJob(job.id, { total: result.total });
  if (result.failed) {
    return updateJob(job.id, { status: "Failed", error: result.error || "Pagination failed" });
  }
  const keepBrowser = String(process.env.KEEP_BROWSER_AFTER_JOB || "true").toLowerCase() === "true";
  if (!keepBrowser && session) {
    await stopScraper(session);
    sessions.delete(job.id);
  }
  return updateJob(job.id, { status: "Completed" });
};

const stopJob = async (id) => {
  const job = getJob(id);
  if (!job) {
    return null;
  }
  if (intervals.has(id)) {
    clearInterval(intervals.get(id));
    intervals.delete(id);
  }
  if (sessions.has(id)) {
    await stopScraper(sessions.get(id));
    sessions.delete(id);
  }
  return updateJob(id, { status: "Stopped" });
};

const completeJob = (id) => {
  const job = getJob(id);
  if (!job) {
    return null;
  }
  if (intervals.has(id)) {
    clearInterval(intervals.get(id));
    intervals.delete(id);
  }
  return updateJob(id, { status: "Completed" });
};

const failJob = (id, error) => {
  const job = getJob(id);
  if (!job) {
    return null;
  }
  if (intervals.has(id)) {
    clearInterval(intervals.get(id));
    intervals.delete(id);
  }
  return updateJob(id, { status: "Failed", error });
};

const deleteJobFile = (job) => {
  if (!job) {
    return;
  }
  if (job.filePath && fs.existsSync(job.filePath)) {
    fs.unlinkSync(job.filePath);
  }
};

module.exports = {
  startJob,
  resumeJob,
  stopJob,
  completeJob,
  failJob,
  deleteJobFile,
};
