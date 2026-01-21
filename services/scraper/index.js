const { launchBrowser } = require("../browser/launch");
const { waitForSalesNavReady } = require("../../automation/utils/dom");
const { clickLushaBadge, clickLushaMinimize } = require("../../automation/lusha/actions");
const { clickContactoutBadge } = require("../../automation/contactout/actions");
const { loadCookies } = require("../browser/cookies");

const normalizeSameSite = (value) => {
  if (!value) {
    return undefined;
  }
  const normalized = String(value).toLowerCase();
  if (normalized === "no_restriction" || normalized === "none") {
    return "None";
  }
  if (normalized === "lax") {
    return "Lax";
  }
  if (normalized === "strict") {
    return "Strict";
  }
  return undefined;
};

const normalizeCookie = (cookie) => {
  if (!cookie || !cookie.name) {
    return null;
  }
  const normalized = {
    name: cookie.name,
    value: cookie.value ?? "",
  };
  if (cookie.domain) {
    if (cookie.hostOnly === true) {
      normalized.domain = cookie.domain.replace(/^\./, "");
    } else {
      normalized.domain = cookie.domain;
    }
  }
  if (cookie.path) {
    normalized.path = cookie.path;
  }
  if (typeof cookie.secure === "boolean") {
    normalized.secure = cookie.secure;
  }
  if (typeof cookie.httpOnly === "boolean") {
    normalized.httpOnly = cookie.httpOnly;
  }
  if (typeof cookie.expirationDate === "number" && Number.isFinite(cookie.expirationDate)) {
    normalized.expiry = Math.floor(cookie.expirationDate);
  }
  const sameSite = normalizeSameSite(cookie.sameSite);
  if (sameSite) {
    normalized.sameSite = sameSite;
  }
  return normalized;
};

const setCookiesFor = async (driver, url, cookies, redirectUrl) => {
  if (!Array.isArray(cookies) || cookies.length === 0) {
    return false;
  }
  try {
    await driver.get(url);
  } catch (error) {
    console.warn(`Failed to open ${url}: ${error.message || error}`);
    return false;
  }
    const navigationGapMs = Number(process.env.NAV_GAP_MS || 1200);
    if (navigationGapMs > 0) {
      await driver.sleep(navigationGapMs);
    }
    const prepared = cookies
    .map((cookie) => normalizeCookie(cookie))
    .filter(Boolean);
  for (const cookie of prepared) {
    try {
      await driver.manage().addCookie(cookie);
    } catch (error) {
      // ignore invalid cookies
    }
  }
    const postCookieGapMs = Number(process.env.POST_COOKIE_GAP_MS || 800);
    if (postCookieGapMs > 0) {
      await driver.sleep(postCookieGapMs);
    }
  const targetUrl = redirectUrl || url;
  try {
    await driver.get(targetUrl);
  } catch (error) {
    console.warn(`Failed to open ${targetUrl}: ${error.message || error}`);
  }
    if (navigationGapMs > 0) {
      await driver.sleep(navigationGapMs);
    }
  return true;
};

const closeExtraTabs = async (driver) => {
  const handles = await driver.getAllWindowHandles();
  if (handles.length <= 1) {
    return;
  }
  const keep = handles[0];
  for (const handle of handles) {
    if (handle === keep) {
      continue;
    }
    try {
      await driver.switchTo().window(handle);
      await driver.sleep(300);
      const closePromise = driver.close().catch(() => {});
      await Promise.race([
        closePromise,
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
      await driver.sleep(300);
    } catch (error) {
      break;
    }
  }
  try {
    await driver.switchTo().window(keep);
  } catch (error) {
    // ignore if keep handle is no longer available
  }
};

const isLoginPage = (url, title) => {
  const haystack = `${url || ""} ${title || ""}`.toLowerCase();
  return (
    haystack.includes("login") ||
    haystack.includes("sign-in") ||
    haystack.includes("signin") ||
    haystack.includes("checkpoint") ||
    haystack.includes("auth")
  );
};

const confirmLogin = async ({ driver, name, baseUrl, confirmUrl, cookies }) => {
  if (!Array.isArray(cookies) || cookies.length === 0) {
    return { ok: false, message: `${name} cookies are missing.` };
  }
  const opened = await setCookiesFor(driver, baseUrl, cookies, confirmUrl);
  if (!opened) {
    return { ok: false, message: `${name} site is not reachable.` };
  }
    const confirmDelayMs = Number(process.env.CONFIRM_DELAY_MS || 1500);
    if (confirmDelayMs > 0) {
      await driver.sleep(confirmDelayMs);
    }
  const currentUrl = await driver.getCurrentUrl();
  const title = await driver.getTitle();
  if (isLoginPage(currentUrl, title)) {
    return {
      ok: false,
      message: `${name} login failed. Redirected to login page.`,
    };
  }
  return { ok: true };
};

const startScraper = async (job) => {
  const driver = await launchBrowser();
  try {
    await driver.manage().window().maximize();
  } catch (error) {
    // ignore if maximize is not supported
  }
  const launchDelayMs = Number(process.env.LAUNCH_DELAY_MS || 1500);
  if (launchDelayMs > 0) {
    await driver.sleep(launchDelayMs);
  }
  await closeExtraTabs(driver);
  const cookies = loadCookies();
  try {
    if (job?.authChecked) {
      if (job?.listUrl) {
        await driver.get(job.listUrl);
      }
      return { driver, cookies, job };
    }
    const contactoutCheck = await confirmLogin({
      driver,
      name: "ContactOut",
      baseUrl: "https://contactout.com",
      confirmUrl: "https://contactout.com/lists",
      cookies: cookies.contactout,
    });
    if (!contactoutCheck.ok) {
      throw new Error(contactoutCheck.message);
    }

    const lushaCheck = await confirmLogin({
      driver,
      name: "Lusha",
      baseUrl: "https://dashboard.lusha.com",
      confirmUrl: "https://dashboard.lusha.com/dashboard",
      cookies: cookies.lusha,
    });
    if (!lushaCheck.ok) {
      throw new Error(lushaCheck.message);
    }

    const linkedinCheck = await confirmLogin({
      driver,
      name: "LinkedIn",
      baseUrl: "https://www.linkedin.com",
      confirmUrl: "https://www.linkedin.com/feed/",
      cookies: cookies.linkedin,
    });
    if (!linkedinCheck.ok) {
      throw new Error(linkedinCheck.message);
    }

    const shouldCloseTabs = String(process.env.CLOSE_EXTRA_TABS || "false").toLowerCase() === "true";
    if (shouldCloseTabs) {
      await closeExtraTabs(driver);
    }
    const preJobDelayMs = Number(process.env.PRE_JOB_DELAY_MS || 5000);
    if (preJobDelayMs > 0) {
      await driver.sleep(preJobDelayMs);
    }
    if (job?.listUrl) {
      await driver.get(job.listUrl);
      await waitForSalesNavReady(driver);
      const salesReadyDelayMs = Number(process.env.SALES_READY_DELAY_MS || 1500);
      if (salesReadyDelayMs > 0) {
        await driver.sleep(salesReadyDelayMs);
      }
      await clickLushaBadge(driver);
    }
    if (job) {
      job.authChecked = true;
    }
  } catch (error) {
    const keepOpen = String(process.env.KEEP_BROWSER_ON_ERROR || "true").toLowerCase() === "true";
    if (!keepOpen) {
      await driver.quit();
    }
    throw error;
  }
  return { driver, cookies, job };
};

const stopScraper = async (session) => {
  if (!session || !session.driver) {
    return;
  }
  await session.driver.quit();
};

module.exports = {
  startScraper,
  stopScraper,
};
