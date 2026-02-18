const freeEmailDomains = require("free-email-domains");

const extractDomainsFromText = (text) => {
  if (!text) return [];
  const matches = String(text).match(/@([a-z0-9.-]+\.[a-z]{2,})/gi) || [];
  const domains = matches.map((m) => m.replace(/^@/, "").toLowerCase());
  const filtered = domains.filter((domain) => !freeEmailDomains.includes(domain));
  return Array.from(new Set(filtered));
};

const runExtract = async (target) => {
  const raw = await target.evaluate(() => {
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
  });
  return raw.map((record) => {
    const titleParts = String(record.titleText || "").split(" at ");
    const title = titleParts[0]?.trim() || "";
    const companyName = titleParts.slice(1).join(" at ").trim();
    const domains = [];
    for (const emailText of record.emails || []) {
      for (const d of extractDomainsFromText(emailText)) {
        if (!domains.includes(d)) domains.push(d);
      }
    }
    return { fullName: record.fullName, title, companyName, domains: domains.slice(0, 2) };
  });
};

const waitForData = async (target, timeoutMs) => {
  const start = Date.now();
  for (;;) {
    try {
      const count = await target.locator('[data-testid="contact-information"]').count();
      if (count > 0) return true;
    } catch (error) {
      // ignore
    }
    if (Date.now() - start > timeoutMs) return false;
    await target.waitForTimeout(80);
  }
};

const extractContactoutData = async (page, opts = {}) => {
  const timeoutMs = Number(opts.timeoutMs || 10000);
  const maxRetries = Number(opts.maxRetries || 2);
  const retryDelayMs = Number(opts.retryDelayMs || 500);
  const debug = opts.debug !== false;
  const t0 = Date.now();

  // Find contactout frames first (data is in iframe)
  const frames = page.frames();
  const contactoutFrames = frames.filter((f) => {
    const url = f.url() || "";
    const name = f.name() || "";
    return url.includes("contactout") || name.includes("contactout");
  });

  // Try contactout frames, then all frames, then main page
  const targets = [...contactoutFrames, ...frames.filter((f) => !contactoutFrames.includes(f)), page];

  for (const target of targets) {
    try {
      const found = await waitForData(target, Math.min(timeoutMs, 2000));
      if (!found) continue;

      let result = await runExtract(target);
      let attempt = 0;
      const hasData = (list) =>
        Array.isArray(list) && list.length > 0 &&
        list.some((item) => (item.fullName || '').trim() || (item.domains || []).length);

      while (!hasData(result) && attempt < maxRetries) {
        attempt += 1;
        if (debug) console.log(`[contactout] retry ${attempt}`);
        await page.waitForTimeout(retryDelayMs);
        result = await runExtract(target);
      }

      if (hasData(result)) {
        if (debug) console.log(`[contactout] extracted ${result.length} records in ${Date.now() - t0}ms`);
        return result;
      }
    } catch (error) {
      // continue to next target
    }
  }

  if (debug) console.log(`[contactout] no data found in ${Date.now() - t0}ms`);
  return [];
};

module.exports = { extractContactoutData };
