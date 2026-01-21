const express = require("express");
const cookiesSave = require("./cookies/save");
const cookiesStatus = require("./cookies/status");
const jobsRun = require("./jobs/run");
const jobsStop = require("./jobs/stop");
const jobsResume = require("./jobs/resume");
const jobsDelete = require("./jobs/delete");
const jobsDownload = require("./jobs/download");
const jobsList = require("./jobs/list");

const router = express.Router();

router.use("/cookies", cookiesSave);
router.use("/cookies", cookiesStatus);
router.use("/jobs", jobsRun);
router.use("/jobs", jobsStop);
router.use("/jobs", jobsResume);
router.use("/jobs", jobsDelete);
router.use("/jobs", jobsDownload);
router.use("/jobs", jobsList);

module.exports = router;
