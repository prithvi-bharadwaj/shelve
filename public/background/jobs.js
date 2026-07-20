// Organize job lifecycle: in-memory state, session persistence, and the
// stale-job watchdog exposed through status polling.

import { ORGANIZE_JOB_PREFIX, ORGANIZE_RESULT_TTL_MS, ORGANIZE_STALE_MS } from "./constants.js";

export const organizeJobs = new Map();

// A job superseded by a retry must not overwrite the newer job's state.
function isCurrentJob(job) {
  const current = organizeJobs.get(job.windowId);
  return !current || current.id === job.id;
}

export function updateOrganizeJob(job, changes) {
  Object.assign(job, changes, { updatedAt: Date.now() });
  if (!isCurrentJob(job)) return;
  organizeJobs.set(job.windowId, job);
  persistOrganizeJob(job).catch(() => undefined);
}

export async function finishOrganizeJob(job, result) {
  job.status = result?.error ? "error" : "done";
  job.result = result;
  job.error = result?.error;
  job.updatedAt = Date.now();
  if (isCurrentJob(job)) {
    organizeJobs.set(job.windowId, job);
    await persistOrganizeJob(job);
  }
  return { ...result, jobId: job.id };
}

export function publicOrganizeJob(job) {
  return {
    id: job.id,
    status: job.status,
    stage: job.stage,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    tabCount: job.tabCount || 0,
    result: job.result,
    error: job.error
  };
}

export async function persistOrganizeJob(job) {
  if (!chrome.storage.session) return;
  const snapshot = publicOrganizeJob(job);
  job.persistQueue = (job.persistQueue || Promise.resolve())
    .then(() => chrome.storage.session.set({ [`${ORGANIZE_JOB_PREFIX}${job.windowId}`]: snapshot }))
    .catch(() => undefined);
  await job.persistQueue;
}

export async function getOrganizeStatus(windowId) {
  const targetWindowId = windowId || (await chrome.windows.getCurrent()).id;
  let job = organizeJobs.get(targetWindowId);
  if (job?.status === "running" && Date.now() - job.updatedAt > ORGANIZE_STALE_MS) {
    await finishOrganizeJob(job, { error: "Organizing stalled — try again." });
  }
  if (!job && chrome.storage.session) {
    try {
      const key = `${ORGANIZE_JOB_PREFIX}${targetWindowId}`;
      const stored = (await chrome.storage.session.get(key))[key];
      if (stored?.status === "running") {
        stored.status = "error";
        stored.error = "Organizing was interrupted. Try again.";
        stored.result = { error: stored.error };
        stored.updatedAt = Date.now();
        await chrome.storage.session.set({ [key]: stored });
      }
      job = stored;
    } catch {
      // Session state is an enhancement; the in-memory job remains authoritative.
    }
  }
  if (!job) return { job: null };
  if (job.status !== "running" && Date.now() - job.updatedAt > ORGANIZE_RESULT_TTL_MS) {
    await clearOrganizeJob(targetWindowId);
    return { job: null };
  }
  return { job: publicOrganizeJob(job) };
}

export async function consumeOrganizeResult(windowId, jobId) {
  const targetWindowId = windowId || (await chrome.windows.getCurrent()).id;
  const current = organizeJobs.get(targetWindowId);
  if (current && current.id !== jobId) return { cleared: false };
  await clearOrganizeJob(targetWindowId);
  return { cleared: true };
}

async function clearOrganizeJob(windowId) {
  const current = organizeJobs.get(windowId);
  organizeJobs.delete(windowId);
  if (current?.persistQueue) await current.persistQueue;
  if (chrome.storage.session) {
    await chrome.storage.session.remove(`${ORGANIZE_JOB_PREFIX}${windowId}`).catch(() => undefined);
  }
}
