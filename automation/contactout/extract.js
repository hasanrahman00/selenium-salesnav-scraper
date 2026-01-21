const freeEmailDomains = require("free-email-domains");
const { By, waitForAnyVisible } = require("../utils/dom");

const withFrame = async (driver, frameEl, fn) => {
  await driver.switchTo().frame(frameEl);
  try {
    return await fn();
  } finally {
    await driver.switchTo().defaultContent();
  }
};

const getContactoutFrame = async (driver) => {
  const frames = await driver.findElements(By.css("iframe"));
  for (const frame of frames) {
    try {
      const src = await frame.getAttribute("src");
      const id = await frame.getAttribute("id");
      if ((src && src.includes("contactout")) || id === "contactout-iframe") {
        return frame;
      }
    } catch (error) {
      // ignore
    }
  }
  return null;
};

const extractDomainsFromText = (text) => {
  if (!text) {
    return [];
  }
  const matches = String(text).match(/@([a-z0-9.-]+\.[a-z]{2,})/gi) || [];
  const domains = matches.map((m) => m.replace(/^@/, "").toLowerCase());
  const filtered = domains.filter((domain) => !freeEmailDomains.includes(domain));
  return Array.from(new Set(filtered));
};

const extractContactoutData = async (driver, { timeoutMs = 30000 } = {}) => {
  const run = async () => {
    await waitForAnyVisible(
      driver,
      [By.css("[data-testid='contact-information']")],
      timeoutMs
    );

    const raw = await driver.executeScript(`
      const containers = Array.from(document.querySelectorAll('[data-testid="contact-information"]'));
      return containers.map((container) => {
        const nameEl = container.querySelector('.css-72nh78');
        const titleEl = container.querySelector('.css-oq7ggv');
        const fullName = nameEl ? nameEl.textContent.trim() : '';
        const titleText = titleEl ? titleEl.textContent.trim() : '';
        const spans = Array.from(container.querySelectorAll('[data-testid="contact-row-container"] span'));
        const emails = spans.map((span) => (span.textContent || '').trim()).filter(Boolean);
        return { fullName, titleText, emails };
      });
    `);

    return raw.map((record) => {
      const titleParts = String(record.titleText || "").split(" at ");
      const title = titleParts[0]?.trim() || "";
      const companyName = titleParts.slice(1).join(" at ").trim();
      const domains = [];
      for (const emailText of record.emails || []) {
        const extracted = extractDomainsFromText(emailText);
        for (const d of extracted) {
          if (!domains.includes(d)) {
            domains.push(d);
          }
        }
      }
      return {
        fullName: record.fullName,
        title,
        companyName,
        domains: domains.slice(0, 2),
      };
    });
  };

  const frame = await getContactoutFrame(driver);
  if (frame) {
    return withFrame(driver, frame, run);
  }

  const frames = await driver.findElements(By.css("iframe"));
  for (const candidate of frames) {
    try {
      const result = await withFrame(driver, candidate, run);
      if (Array.isArray(result) && result.length) {
        return result;
      }
    } catch (error) {
      // ignore and continue
    }
  }

  return run();
};

module.exports = {
  extractContactoutData,
};
