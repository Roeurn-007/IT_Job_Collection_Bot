const { SEEN_FILE, readJson, writeJson } = require('../config/settings');

// Initialize seen Set from persistent storage
const seenSet = new Set(readJson(SEEN_FILE, []));

function isDuplicate(key) {
  if (!key) return false;
  return seenSet.has(String(key));
}

function markSeen(key) {
  if (!key) return;
  seenSet.add(String(key));
  saveSeen();
}

function saveSeen() {
  const arr = Array.from(seenSet).slice(-5000);
  writeJson(SEEN_FILE, arr);
}

function getSeenCount() {
  return seenSet.size;
}

module.exports = {
  isDuplicate,
  markSeen,
  saveSeen,
  getSeenCount,
  seenSet
};
