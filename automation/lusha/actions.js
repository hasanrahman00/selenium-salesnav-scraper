const { By, waitForAnyVisible, waitForSalesNavReady, clickExtensionIcon, until } = require("../utils/dom");

const clickLushaMinimize = async (driver, timeoutMs = 15000) => {
  const locators = [
    By.css(".minimize-icon-container img[alt='Minimize']"),
    By.css(".minimize-icon-container"),
    By.xpath("//img[@alt='Minimize']/ancestor::*[self::div or self::button]")
  ];

  const clickEl = async () => {
    const el = await waitForAnyVisible(driver, locators, timeoutMs);
    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", el);
    await driver.wait(until.elementIsVisible(el), timeoutMs);
    try {
      await el.click();
      console.log("[extensions] Clicked Lusha minimize using element.click()");
    } catch (error) {
      console.log(`[extensions] Lusha minimize click failed: ${error.message || error}`);
      await driver.executeScript("arguments[0].click();", el);
      console.log("[extensions] Clicked Lusha minimize using JS click()");
    }
  };

  // Try in main document first
  try {
    await clickEl();
    return;
  } catch (error) {
    // fall through to iframe search
  }

  const frames = await driver.findElements(By.css("iframe"));
  for (const frame of frames) {
    try {
      const id = await frame.getAttribute("id");
      if (id && id !== "LU__extension_iframe") {
        continue;
      }
      await driver.switchTo().frame(frame);
      await clickEl();
      await driver.switchTo().defaultContent();
      return;
    } catch (error) {
      try {
        await driver.switchTo().defaultContent();
      } catch (switchError) {
        // ignore
      }
    }
  }
  throw new Error("Lusha minimize button not found");
};

const clickLushaBadge = async (driver, timeoutMs = 15000) => {
  await waitForSalesNavReady(driver, timeoutMs);
  await clickExtensionIcon(driver, "lusha", timeoutMs);
};

module.exports = {
  clickLushaBadge,
  clickLushaMinimize,
};
