const waitForAnyVisible = async (target, selectors, timeoutMs) => {
  const start = Date.now();
  for (;;) {
    for (const selector of selectors) {
      try {
        const locator = target.locator(selector);
        const count = await locator.count();
        if (count > 0) {
          const first = locator.first();
          if (await first.isVisible()) {
            return first;
          }
        }
      } catch (error) {
        // ignore and keep trying
      }
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for page content to be visible");
    }
    await target.waitForTimeout(150);
  }
};

const waitForSalesNavReady = async (page, timeoutMs = 30000) => {
  await page.waitForLoadState("load", { timeout: timeoutMs });

  const selectors = [
    "main",
    "div.search-results__result-item",
    "section.search-results__result-list",
    "div.search-results__result-list",
    "[data-test-search-results]",
  ];

  await waitForAnyVisible(page, selectors, timeoutMs);
};

const getExtensionSelectors = (name) => {
  const lower = name.toLowerCase();
  if (lower === "lusha") {
    return [
      "#LU__extension_badge_main",
      "#LU__extension_badge_wrapper",
      "#LU__extension_badge_logo",
      "[aria-label*='Lusha']",
      "[title*='Lusha']",
      "xpath=//*[contains(@class,'lusha') and (self::div or self::button)]",
      "xpath=//*[contains(., 'Lusha') and (self::div or self::button)]",
      "xpath=//img[contains(@alt,'Lusha')]/ancestor::*[self::div or self::button]",
    ];
  }
  return [];
};

const clickExtensionIcon = async (page, name, timeoutMs = 15000) => {
  const selectors = getExtensionSelectors(name);
  if (!selectors.length) {
    throw new Error(`Unknown extension name: ${name}`);
  }
  const el = await waitForAnyVisible(page, selectors, timeoutMs);
  await el.scrollIntoViewIfNeeded();
  try {
    await el.click();
  } catch (error) {
    await el.click({ force: true });
  }
};

module.exports = {
  waitForAnyVisible,
  waitForSalesNavReady,
  clickExtensionIcon,
};
