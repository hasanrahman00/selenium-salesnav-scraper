const { chromium } = require("playwright-core");
const { CDP_URL } = require("../../config/browser");

let browser = null;

const connectBrowser = async () => {
  if (browser && browser.isConnected()) {
    return browser;
  }
  browser = await chromium.connectOverCDP(CDP_URL);
  return browser;
};

const getPage = async () => {
  const b = await connectBrowser();
  const contexts = b.contexts();
  const context = contexts.length > 0 ? contexts[0] : await b.newContext();
  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();
  return { browser: b, context, page };
};

const disconnectBrowser = async () => {
  if (browser) {
    try {
      browser.close();
    } catch (error) {
      // ignore disconnect errors
    }
    browser = null;
  }
};

module.exports = {
  connectBrowser,
  getPage,
  disconnectBrowser,
};
