const app = require("./app");
const { port } = require("./config/env");
const { ensureChrome } = require("./utils/downloadChrome");

ensureChrome()
  .then(() => {
    app.listen(port, () => {
      console.log(`Server listening on ${port}`);
    });
  })
  .catch((err) => {
    console.error("Failed to prepare Chrome binary:", err);
    process.exit(1);
  });
