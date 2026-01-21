const fs = require("fs");
const path = require("path");
const { ensureCsvHeader, appendCsvRow } = require("../utils/csvFile");
const { dataDir } = require("../config/paths");
const { createJob, updateJob, getJob } = require("./jobStore");
const { startScraper, stopScraper } = require("./scraperSession");
const { extractLushaContacts } = require("../automation/lusha/extract");
const { clickLushaMinimize } = require("../automation/lusha/actions");
const { clickContactoutBadge } = require("../automation/contactout/actions");
const { extractContactoutData } = require("../automation/contactout/extract");

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

const csvHeader = "Full Name,First Name,Last Name,Company Name,Title,Website,Website_one";

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
    escapeCsvValue(record.fullName),
    escapeCsvValue(record.firstName),
    escapeCsvValue(record.lastName),
    escapeCsvValue(record.companyName),
    escapeCsvValue(record.title || ""),
    escapeCsvValue(domains[0] || ""),
    escapeCsvValue(domains[1] || ""),
  ].join(",");
};

const mergeContactoutData = (records, contactoutRecords) => {
  if (!Array.isArray(records) || !Array.isArray(contactoutRecords)) {
    return records;
  }

  for (const contactout of contactoutRecords) {
    const coFirstName = String(contactout.fullName || "").split(/\s+/)[0]?.toLowerCase();
    const coDomains = Array.isArray(contactout.domains) ? contactout.domains : [];

    for (const record of records) {
      if (!record) {
        continue;
      }
      const firstNameMatch =
        coFirstName && record.firstName && record.firstName.toLowerCase() === coFirstName;
      const companyMatch =
        contactout.companyName &&
        record.companyName &&
        record.companyName.toLowerCase() === contactout.companyName.toLowerCase();

      if (firstNameMatch || companyMatch) {
        if (!record.title && contactout.title) {
          record.title = contactout.title;
        }
        if ((!record.domains || record.domains.length === 0) && coDomains.length) {
          record.domains = [...coDomains];
          record.website = coDomains.join(";");
        }
      }
    }
  }
  return records;
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
  const driver = session?.driver;
  const extractDelayMs = Number(process.env.EXTRACT_DELAY_MS || 800);
  const flowStart = Date.now();
  if (extractDelayMs > 0 && driver) {
    await driver.sleep(extractDelayMs);
  }
  const lushaStart = Date.now();
  const records = driver ? await extractLushaContacts(driver, { maxCards: 25 }) : [];
  const lushaSeconds = ((Date.now() - lushaStart) / 1000).toFixed(2);
  updateJob(job.id, { lushaSeconds: Number(lushaSeconds) });
  let contactoutSeconds = 0;
  try {
    if (driver) {
      await clickLushaMinimize(driver);
      const clickGapMs = Number(process.env.CLICK_GAP_MS || 1000);
      if (clickGapMs > 0) {
        await driver.sleep(clickGapMs);
      }
      await clickContactoutBadge(driver, {
        timeoutMs: Number(process.env.CONTACTOUT_CLICK_TIMEOUT_MS || 8000),
        skipReadyWait: true,
        perFrameWaitMs: Number(process.env.CONTACTOUT_FRAME_WAIT_MS || 600),
        postMinimizeDelayMs: Number(process.env.CONTACTOUT_MINIMIZE_DELAY_MS || 400),
      });
      const contactoutDelayMs = Number(process.env.CONTACTOUT_DELAY_MS || 600);
      if (contactoutDelayMs > 0) {
        await driver.sleep(contactoutDelayMs);
      }
      const contactoutStart = Date.now();
      const contactoutData = await extractContactoutData(driver, {
        timeoutMs: Number(process.env.CONTACTOUT_TIMEOUT_MS || 15000),
      }).catch(() => []);
      contactoutSeconds = Number(((Date.now() - contactoutStart) / 1000).toFixed(2));
      mergeContactoutData(records, contactoutData);
    }
  } catch (error) {
    // keep extraction result even if ContactOut click fails
  }
  const extractSeconds = Number((Number(lushaSeconds) + contactoutSeconds).toFixed(2));
  const flowSeconds = Number(((Date.now() - flowStart) / 1000).toFixed(2));
  updateJob(job.id, {
    lushaSeconds: Number(lushaSeconds),
    contactoutSeconds,
    extractSeconds,
    totalSeconds: flowSeconds,
  });
  let total = 0;
  for (const record of records) {
    appendCsvRow(filePath, toCsvRow(record));
    total += 1;
  }
  updateJob(job.id, { total });
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
  const driver = session?.driver;
  const extractDelayMs = Number(process.env.EXTRACT_DELAY_MS || 800);
  const flowStart = Date.now();
  if (extractDelayMs > 0 && driver) {
    await driver.sleep(extractDelayMs);
  }
  const lushaStart = Date.now();
  const records = driver ? await extractLushaContacts(driver, { maxCards: 25 }) : [];
  const lushaSeconds = ((Date.now() - lushaStart) / 1000).toFixed(2);
  updateJob(job.id, { lushaSeconds: Number(lushaSeconds) });
  let contactoutSeconds = 0;
  try {
    if (driver) {
      await clickLushaMinimize(driver);
      const clickGapMs = Number(process.env.CLICK_GAP_MS || 1000);
      if (clickGapMs > 0) {
        await driver.sleep(clickGapMs);
      }
      await clickContactoutBadge(driver, {
        timeoutMs: Number(process.env.CONTACTOUT_CLICK_TIMEOUT_MS || 8000),
        skipReadyWait: true,
        perFrameWaitMs: Number(process.env.CONTACTOUT_FRAME_WAIT_MS || 600),
        postMinimizeDelayMs: Number(process.env.CONTACTOUT_MINIMIZE_DELAY_MS || 400),
      });
      const contactoutDelayMs = Number(process.env.CONTACTOUT_DELAY_MS || 600);
      if (contactoutDelayMs > 0) {
        await driver.sleep(contactoutDelayMs);
      }
      const contactoutStart = Date.now();
      const contactoutData = await extractContactoutData(driver, {
        timeoutMs: Number(process.env.CONTACTOUT_TIMEOUT_MS || 15000),
      }).catch(() => []);
      contactoutSeconds = Number(((Date.now() - contactoutStart) / 1000).toFixed(2));
      mergeContactoutData(records, contactoutData);
    }
  } catch (error) {
    // keep extraction result even if ContactOut click fails
  }
  const extractSeconds = Number((Number(lushaSeconds) + contactoutSeconds).toFixed(2));
  const flowSeconds = Number(((Date.now() - flowStart) / 1000).toFixed(2));
  updateJob(job.id, {
    lushaSeconds: Number(lushaSeconds),
    contactoutSeconds,
    extractSeconds,
    totalSeconds: flowSeconds,
  });
  let total = job.total || 0;
  for (const record of records) {
    appendCsvRow(job.filePath, toCsvRow(record));
    total += 1;
  }
  updateJob(job.id, { total });
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
