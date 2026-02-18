const state = {
  jobs: [],
};

const listName = document.getElementById("listName");
const listUrl = document.getElementById("listUrl");
const listNameError = document.getElementById("listNameError");
const listUrlError = document.getElementById("listUrlError");
const runScraper = document.getElementById("runScraper");
const jobsBody = document.getElementById("jobsBody");
const toast = document.getElementById("toast");
const statTotal = document.getElementById("statTotal");
const statRunning = document.getElementById("statRunning");
const statCompleted = document.getElementById("statCompleted");
const statFailed = document.getElementById("statFailed");
const notifiedFailures = new Set();

const showToast = (message) => {
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2000);
};

const formatSeconds = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "\u2014";
  }
  return Number(value).toFixed(2);
};

const updateRunDisabled = (loading = false) => {
  const hasName = Boolean(listName.value.trim());
  const hasUrl = Boolean(listUrl.value.trim());
  const disabled = loading || !hasName || !hasUrl;
  runScraper.disabled = disabled;
};

const setButtonLoading = (loading) => {
  const spinner = runScraper.querySelector(".spinner");
  const text = runScraper.querySelector(".btn-text");
  spinner.hidden = !loading;
  text.textContent = loading ? "Starting\u2026" : "Run Scraper";
  updateRunDisabled(loading);
};

const clearErrors = () => {
  listNameError.textContent = "";
  listUrlError.textContent = "";
  listName.classList.remove("error-border");
  listUrl.classList.remove("error-border");
};

const validateInputs = () => {
  clearErrors();
  let valid = true;
  if (!listName.value.trim()) {
    listNameError.textContent = "List name is required";
    listName.classList.add("error-border");
    valid = false;
  }
  if (!listUrl.value.trim()) {
    listUrlError.textContent = "LinkedIn URL is required";
    listUrl.classList.add("error-border");
    valid = false;
  }
  return valid;
};

const updateStats = () => {
  const jobs = state.jobs;
  statTotal.textContent = jobs.length;
  statRunning.textContent = jobs.filter((j) => j.status === "Running").length;
  statCompleted.textContent = jobs.filter((j) => j.status === "Completed").length;
  statFailed.textContent = jobs.filter((j) => j.status === "Failed").length;
};

const icons = {
  play: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4 2.5l7 4.5-7 4.5V2.5z" fill="currentColor"/></svg>',
  pause: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="3" y="2" width="3" height="10" rx="1" fill="currentColor"/><rect x="8" y="2" width="3" height="10" rx="1" fill="currentColor"/></svg>',
  download: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v7M4 7l3 3 3-3M3 12h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  trash: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 4h9M5 4V3a1 1 0 011-1h2a1 1 0 011 1v1M4 4v7.5a1 1 0 001 1h4a1 1 0 001-1V4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const renderJobs = () => {
  jobsBody.innerHTML = "";
  if (state.jobs.length === 0) {
    jobsBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="8">
          <div class="empty-state">
            <div class="empty-icon">
              <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
                <rect x="8" y="14" width="40" height="28" rx="4" stroke="currentColor" stroke-width="1.5"/>
                <path d="M16 24h24M16 30h16M16 36h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                <circle cx="42" cy="36" r="3" stroke="currentColor" stroke-width="1.5"/>
              </svg>
            </div>
            <p>No jobs yet</p>
            <span>Create a new job above to get started</span>
          </div>
        </td>
      </tr>
    `;
    updateStats();
    return;
  }
  state.jobs.forEach((job) => {
    const badgeClass = job.status.toLowerCase();
    const isRunning = job.status === "Running";
    const toggleIcon = isRunning ? icons.pause : icons.play;
    const toggleLabel = isRunning ? "Pause" : "Run";
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><strong>${job.name}</strong></td>
      <td class="right mono">${job.total}</td>
      <td class="mono">${formatSeconds(job.lushaSeconds)}</td>
      <td class="mono">${formatSeconds(job.contactoutSeconds)}</td>
      <td class="mono">${formatSeconds(job.extractSeconds)}</td>
      <td class="mono">${formatSeconds(job.totalSeconds)}</td>
      <td><span class="badge ${badgeClass}">${job.status}</span></td>
      <td class="actions">
        <button class="btn ghost" data-action="toggle" data-id="${job.id}">
          ${toggleIcon} ${toggleLabel}
        </button>
        <button class="btn secondary" data-action="download" data-id="${job.id}" ${
          job.total === 0 ? "disabled" : ""
        }>
          ${icons.download} Download
        </button>
        <button class="btn danger" data-action="delete" data-id="${job.id}">
          ${icons.trash} Delete
        </button>
      </td>
    `;
    jobsBody.appendChild(row);
    if (job.status === "Failed" && job.error && !notifiedFailures.has(job.id)) {
      showToast(job.error);
      notifiedFailures.add(job.id);
    }
  });
  updateStats();
};

const fetchJobs = async () => {
  const res = await fetch("/api/jobs");
  state.jobs = await res.json();
  renderJobs();
};

const runJob = async () => {
  if (!validateInputs()) {
    return;
  }
  setButtonLoading(true);
  const res = await fetch("/api/jobs/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      listName: listName.value,
      listUrl: listUrl.value,
    }),
  });
  if (!res.ok) {
    const data = await res.json();
    listNameError.textContent = data.message || "Failed to start job";
    setButtonLoading(false);
    return;
  }
  listName.value = "";
  listUrl.value = "";
  setButtonLoading(false);
  fetchJobs();
};

const handleAction = async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) {
    return;
  }
  const id = target.dataset.id;
  if (target.dataset.action === "toggle") {
    const job = state.jobs.find((item) => item.id === id);
    if (!job) {
      return;
    }
    if (job.status === "Running") {
      await fetch(`/api/jobs/${id}/stop`, { method: "POST" });
    } else {
      await fetch(`/api/jobs/${id}/run`, { method: "POST" });
    }
    fetchJobs();
    return;
  }
  if (target.dataset.action === "download") {
    window.location.href = `/api/jobs/${id}/download`;
    return;
  }
  if (target.dataset.action === "delete") {
    await fetch(`/api/jobs/${id}`, { method: "DELETE" });
    fetchJobs();
  }
};

runScraper.addEventListener("click", runJob);
jobsBody.addEventListener("click", handleAction);
listName.addEventListener("input", () => updateRunDisabled(false));
listUrl.addEventListener("input", () => updateRunDisabled(false));

setButtonLoading(false);
fetchJobs();
setInterval(fetchJobs, 4000);
