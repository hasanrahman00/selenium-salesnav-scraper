const fs = require("fs");
const path = require("path");
const https = require("https");
const unzipper = require("unzipper");

const chromeRoot = path.join(__dirname, "..", "chrome-for-testing");
const chromeExe = path.join(chromeRoot, "chrome-win64", "chrome.exe");
const downloadsIndexUrl =
  "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json";

const fetchJson = (url) =>
  new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to fetch ${url}. Status ${res.statusCode}`));
          res.resume();
          return;
        }
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on("error", reject);
  });

const downloadFile = (url, destination) =>
  new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destination);
    const handleResponse = (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        https.get(res.headers.location, handleResponse).on("error", reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download ${url}. Status ${res.statusCode}`));
        res.resume();
        return;
      }
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    };

    https.get(url, handleResponse).on("error", (err) => {
      fs.unlink(destination, () => reject(err));
    });
  });

const extractZip = (zipPath, destination) =>
  new Promise((resolve, reject) => {
    fs.createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: destination }))
      .on("close", resolve)
      .on("error", reject);
  });

const ensureChrome = async () => {
  if (fs.existsSync(chromeExe)) {
    return;
  }

  fs.mkdirSync(chromeRoot, { recursive: true });

  const data = await fetchJson(downloadsIndexUrl);
  const stable = data?.channels?.Stable;
  const win64Entry = stable?.downloads?.chrome?.find(
    (item) => item.platform === "win64"
  );

  if (!win64Entry?.url) {
    throw new Error("Unable to resolve Chrome for Testing download URL.");
  }

  const zipPath = path.join(chromeRoot, "chrome-win64.zip");

  console.log(
    `Chrome binary missing. Downloading ${stable.version} for win64...`
  );
  await downloadFile(win64Entry.url, zipPath);
  await extractZip(zipPath, chromeRoot);
  fs.unlinkSync(zipPath);

  if (!fs.existsSync(chromeExe)) {
    throw new Error("Chrome binary was downloaded but could not be found.");
  }
};

module.exports = { ensureChrome };
