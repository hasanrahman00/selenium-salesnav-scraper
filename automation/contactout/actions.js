const { By, until, waitForAnyVisible, waitForSalesNavReady } = require("../utils/dom");

const withFrame = async (driver, frameEl, fn) => {
  await driver.switchTo().frame(frameEl);
  try {
    return await fn();
  } finally {
    await driver.switchTo().defaultContent();
  }
};

const findContactoutButton = async (driver, timeoutMs) => {
  const buttonLocators = [
    By.id("floating-button"),
    By.css("#app #floating-button"),
    By.css("img[alt='contactout']"),
  ];
  return waitForAnyVisible(driver, buttonLocators, timeoutMs);
};

const normalizeOptions = (input) => {
  if (typeof input === "number") {
    return { timeoutMs: input };
  }
  return input || {};
};

const clickContactoutBadge = async (driver, options = {}) => {
  const settings = normalizeOptions(options);
  const timeoutMs = Number(settings.timeoutMs || 15000);
  const skipReadyWait = Boolean(settings.skipReadyWait);
  const mainDocWaitMs = Number(settings.mainDocWaitMs || 1200);
  const perFrameWaitMs = Number(settings.perFrameWaitMs || 800);
  const minimizeWaitMs = Number(settings.minimizeWaitMs || 1500);
  const postMinimizeDelayMs = Number(settings.postMinimizeDelayMs || 600);

  if (!skipReadyWait) {
    await waitForSalesNavReady(driver, timeoutMs);
  }
  const currentUrl = await driver.getCurrentUrl();
  console.log(`[extensions] Trying to click ContactOut on ${currentUrl}`);

  // Try main document first
  try {
    const el = await findContactoutButton(driver, mainDocWaitMs);
    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", el);
    await driver.wait(until.elementIsVisible(el), timeoutMs);
    await el.click();
    console.log("[extensions] Clicked ContactOut in main document");
    return;
  } catch (error) {
    // fall through to iframe search
  }

  const frames = await driver.findElements(By.css("iframe"));
  console.log(`[extensions] Found ${frames.length} iframes, scanning for ContactOut`);
  for (const frame of frames) {
    try {
      const src = await frame.getAttribute("src");
      const id = await frame.getAttribute("id");
      const name = await frame.getAttribute("name");
      console.log(`[extensions] iframe id=${id || ""} name=${name || ""} src=${src || ""}`);
    } catch (error) {
      // ignore logging errors
    }
  }

  let lushaFrame = null;
  for (const frame of frames) {
    try {
      const id = await frame.getAttribute("id");
      if (id === "LU__extension_iframe") {
        lushaFrame = frame;
        break;
      }
    } catch (error) {
      // ignore
    }
  }
  if (lushaFrame) {
    try {
      await withFrame(driver, lushaFrame, async () => {
        const minimize = await waitForAnyVisible(driver, [
          By.css(".minimize-icon-container"),
          By.css("img[alt='Minimize']"),
        ], minimizeWaitMs);
        await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", minimize);
        await driver.wait(until.elementIsVisible(minimize), minimizeWaitMs);
        await driver.executeScript("arguments[0].click();", minimize);
      });
      if (postMinimizeDelayMs > 0) {
        await driver.sleep(postMinimizeDelayMs);
      }
    } catch (error) {
      // ignore minimize errors here
    }
  }

  const directFrameLocators = [
    By.css("iframe[src*='contactout']"),
    By.css("iframe[title*='ContactOut']"),
  ];
  for (const locator of directFrameLocators) {
    try {
      const frame = await driver.findElement(locator);
      await withFrame(driver, frame, async () => {
        const el = await findContactoutButton(driver, perFrameWaitMs);
        await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", el);
        await driver.wait(until.elementIsVisible(el), timeoutMs);
        await el.click();
      });
      console.log("[extensions] Clicked ContactOut inside targeted iframe");
      return;
    } catch (error) {
      // ignore and continue
    }
  }
  for (const frame of frames) {
    try {
      await withFrame(driver, frame, async () => {
        const el = await findContactoutButton(driver, perFrameWaitMs);
        await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", el);
        await driver.wait(until.elementIsVisible(el), timeoutMs);
        await el.click();
      });
      console.log("[extensions] Clicked ContactOut inside iframe");
      return;
    } catch (error) {
      // ignore and continue
    }
  }

  throw new Error("ContactOut badge not found in main document or iframes");
};

module.exports = {
  clickContactoutBadge,
};
