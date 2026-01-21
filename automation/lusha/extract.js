const { By, until, waitForAnyVisible, waitForSalesNavReady } = require("../utils/dom");

const withFrame = async (driver, frameEl, fn) => {
  await driver.switchTo().frame(frameEl);
  try {
    return await fn();
  } finally {
    await driver.switchTo().defaultContent();
  }
};

const splitName = (fullName) => {
  const cleaned = String(fullName || "").trim();
  if (!cleaned) {
    return { firstName: "", lastName: "" };
  }
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "" };
  }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
};

const extractDomains = (text) => {
  if (!text) {
    return [];
  }
  const matches = String(text).match(/@([a-z0-9.-]+\.[a-z]{2,})/gi) || [];
  return Array.from(new Set(matches.map((m) => m.replace(/^@/, "").toLowerCase())));
};

const getLushaFrame = async (driver) => {
  const frames = await driver.findElements(By.css("iframe"));
  for (const frame of frames) {
    try {
      const id = await frame.getAttribute("id");
      if (id === "LU__extension_iframe") {
        return frame;
      }
    } catch (error) {
      // ignore
    }
  }
  return null;
};

const expandAllCards = async (driver) => {
  await driver.executeScript(`
    const arrows = Array.from(document.querySelectorAll(
      '.divider-and-arrow-container img[alt="Arrow Down"], .divider-and-arrow-container'
    ));
    arrows.forEach((el) => {
      const clickable = el.closest('.divider-and-arrow-container') || el;
      if (clickable) {
        clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }
    });
  `);
};

const extractLushaContacts = async (driver, { timeoutMs = 20000, maxCards = 25 } = {}) => {
  await waitForSalesNavReady(driver, timeoutMs);

  const run = async () => {
    const containerLocators = [
      By.css("[data-test-id='bulk-contact-container-with-data']"),
      By.css(".bulk-contact-profile-container"),
    ];
    await waitForAnyVisible(driver, containerLocators, timeoutMs);
    await expandAllCards(driver);
    await driver.sleep(150);
    const raw = await driver.executeScript(`
      const cards = Array.from(document.querySelectorAll('.bulk-contact-profile-container'));
      return cards.slice(0, ${maxCards}).map((card) => {
        const fullNameEl = card.querySelector('.bulk-contact-full-name');
        const companyEl = card.querySelector('.bulk-contact-company-name');
        const fullName = fullNameEl ? fullNameEl.textContent.trim() : '';
        const companyName = companyEl ? companyEl.textContent.trim() : '';
        const spans = Array.from(card.querySelectorAll('.bulk-contact-value-text .user-base.overflow-span'));
        const domains = spans
          .map((span) => (span.textContent || '').trim())
          .filter(Boolean);
        return { fullName, companyName, domains };
      });
    `);

    return raw.map((record) => {
      const { firstName, lastName } = splitName(record.fullName);
      const domains = [];
      for (const text of record.domains || []) {
        const extracted = extractDomains(text);
        for (const d of extracted) {
          if (!domains.includes(d)) {
            domains.push(d);
          }
        }
      }
      return {
        fullName: record.fullName,
        firstName,
        lastName,
        companyName: record.companyName,
        website: domains.join(";"),
        domains,
      };
    });
  };

  const lushaFrame = await getLushaFrame(driver);
  if (lushaFrame) {
    return withFrame(driver, lushaFrame, run);
  }
  return run();
};

module.exports = {
  extractLushaContacts,
  splitName,
  extractDomains,
};
