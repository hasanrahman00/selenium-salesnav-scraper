const express = require("express");
const { startJob } = require("../../services/jobRunner");

const router = express.Router();

router.post("/run", async (req, res) => {
  const listName = String(req.body.listName || "").trim();
  const listUrl = String(req.body.listUrl || "").trim();
  if (!listName) {
    return res.status(400).json({ message: "List name is required" });
  }
  try {
    const job = await startJob({ listName, listUrl });
    return res.status(201).json(job);
  } catch (error) {
    return res.status(500).json({ message: String(error.message || error) });
  }
});

module.exports = router;
