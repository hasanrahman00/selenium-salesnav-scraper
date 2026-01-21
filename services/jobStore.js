const { v4: uuid } = require("uuid");

const jobs = new Map();

const createJob = ({ listName, listUrl, filePath }) => {
  const id = uuid();
  const name = `${listName} #${id.slice(0, 8)}`;
  const job = {
    id,
    name,
    listName,
    listUrl,
    status: "Running",
    total: 0,
    filePath,
    startedAt: new Date().toISOString(),
  };
  jobs.set(id, job);
  return job;
};

const updateJob = (id, patch) => {
  const current = jobs.get(id);
  if (!current) {
    return null;
  }
  const next = { ...current, ...patch };
  jobs.set(id, next);
  return next;
};

const getJob = (id) => jobs.get(id);

const listJobs = () => Array.from(jobs.values());

const removeJob = (id) => {
  jobs.delete(id);
};

module.exports = {
  createJob,
  updateJob,
  getJob,
  listJobs,
  removeJob,
};
