const { getPhnomPenhDateStr, formatPhnomPenhDate } = require('../utils/dateUtils');

/**
 * Validates post date against maxAgeDays filter
 * @param {Date|string|number} postDate 
 * @param {number} maxAgeDays 
 */
function isPostWithinMaxAge(postDate, maxAgeDays = 30) {
  if (!postDate) return { isValid: false, isWithinMaxAge: false };
  const d = new Date(postDate);
  if (isNaN(d.getTime())) return { isValid: false, isWithinMaxAge: false };

  const now = Date.now();
  const ageMs = now - d.getTime();
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

  const dateInfo = formatPhnomPenhDate(d);
  const isToday = getPhnomPenhDateStr(d) === getPhnomPenhDateStr(new Date());

  return {
    isValid: true,
    isWithinMaxAge: ageMs <= maxAgeMs,
    ageMs,
    maxAgeMs,
    isToday,
    dateInfo
  };
}

module.exports = {
  isPostWithinMaxAge
};
