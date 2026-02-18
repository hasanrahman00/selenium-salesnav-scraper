const { waitForAnyVisible, waitForSalesNavReady } = require("../utils/dom");
const { clickLushaBadge } = require("./actions");

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

const getLushaFrame = (page) => {
  return page.frames().find((f) => {
    const url = f.url() || "";
    return f.name() === "LU__extension_iframe" || url.includes("lusha");
  }) || null;
};

const expandAllCards = async (target) => {
  await target.evaluate(() => {
    const arrows = Array.from(document.querySelectorAll(
      '.divider-and-arrow-container img[alt="Arrow Down"], .divider-and-arrow-container'
    ));
    arrows.forEach((el) => {
      const clickable = el.closest('.divider-and-arrow-container') || el;
      if (clickable) {
        clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }
    });
  });
};

const extractLushaContacts = async (
  page,
  { timeoutMs = 20000, maxCards = 25, debug = true, retryOnTimeout = true } = {}
) => {
  const t0 = Date.now();
  if (debug) {
    console.log(`[lusha] start (timeout=${timeoutMs}ms, maxCards=${maxCards})`);
  }
  const tReadyStart = Date.now();
  await waitForSalesNavReady(page, timeoutMs);
  if (debug) {
    console.log(`[lusha] waitForSalesNavReady ${Date.now() - tReadyStart}ms`);
  }

  const run = async (target) => {
    const containerSelectors = [
      "[data-test-id='bulk-contact-container-with-data']",
      ".bulk-contact-profile-container",
    ];
    const tVisible = Date.now();
    try {
      await waitForAnyVisible(target, containerSelectors, timeoutMs);
    } catch (error) {
      if (retryOnTimeout) {
        if (debug) {
          console.log("[lusha] container not visible, retrying by clicking Lusha badge");
        }
        await clickLushaBadge(page, Math.min(8000, timeoutMs));
        await waitForAnyVisible(target, containerSelectors, timeoutMs);
      } else {
        throw error;
      }
    }
    if (debug) {
      console.log(`[lusha] waitForAnyVisible ${Date.now() - tVisible}ms`);
    }
    const tExpand = Date.now();
    await expandAllCards(target);
    await page.waitForTimeout(150);
    if (debug) {
      console.log(`[lusha] expandAllCards ${Date.now() - tExpand}ms`);
    }
    const tScript = Date.now();
    const raw = await target.evaluate((mc) => {
      const cards = Array.from(document.querySelectorAll('.bulk-contact-profile-container'));
      return cards.slice(0, mc).map((card) => {
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
    }, maxCards);
    if (debug) {
      console.log(`[lusha] evaluate ${Date.now() - tScript}ms`);
    }

    const tMap = Date.now();
    const mapped = raw.map((record) => {
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
    if (debug) {
      console.log(`[lusha] mapRecords ${Date.now() - tMap}ms`);
    }
    return mapped;
  };

  const lushaFrame = getLushaFrame(page);
  const tFrame = Date.now();
  const result = lushaFrame ? await run(lushaFrame) : await run(page);
  if (debug) {
    console.log(`[lusha] total ${Date.now() - t0}ms (frame=${lushaFrame ? "yes" : "no"}, switch=${Date.now() - tFrame}ms)`);
  }
  return result;
};

module.exports = {
  extractLushaContacts,
  splitName,
  extractDomains,
};
