const { COLLECTED_FILE, readJson, writeJson } = require('../config/settings');

let collected = readJson(COLLECTED_FILE, []);

function getCollectedJobs(limit = null) {
  if (limit && typeof limit === 'number') {
    return collected.slice().reverse().slice(0, limit);
  }
  return collected;
}

function addJob(job) {
  if (!job) return;
  // Prevent duplicate insertion by link or messageId
  const exists = collected.some(
    j => (j.link && j.link === job.link) ||
         (j.source === job.source && j.messageId === job.messageId)
  );
  if (!exists) {
    collected.push(job);
    saveCollected();
  }
}

function saveCollected() {
  // Keep last 1000 jobs in storage
  writeJson(COLLECTED_FILE, collected.slice(-1000));
}

function getCollectedCount() {
  return collected.length;
}

module.exports = {
  collected,
  getCollectedJobs,
  addJob,
  saveCollected,
  getCollectedCount
};
