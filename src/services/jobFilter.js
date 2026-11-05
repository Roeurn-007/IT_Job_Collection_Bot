const { getKeywords } = require('../config/settings');

const JOB_INDICATORS = [
  // English indicators
  'hiring', 'recruit', 'recruitment', 'job', 'vacancy', 'career', 'position',
  'opening', 'openings', 'work', 'employ', 'employment', 'staff', 'wanted',
  'needed', 'apply', 'application', 'join our team', 'join us', 'we are hiring',
  'looking for', 'seeking', 'vacant', 'role', 'roles', 'post', 'posts',
  'candidate', 'candidates', 'employee', 'employees', 'hire', 'hires',
  'full-time', 'part-time', 'intern', 'internship', 'fresher', 'experienced',
  // Khmer indicators
  'ឱកាសការងារ', 'ជ្រើសរើស', 'ជ្រើសរើសបុគ្គលិក', 'តួនាទី', 'តំណែង',
  'ដំណឹងជ្រើសរើស', 'ត្រូវការជ្រើសរើស', 'ប្រាក់ខែ', 'ដាក់ពាក្យ', 'បទពិសោធន៍',
  'ស្វែងរក', 'ទំនួលខុសត្រូវ'
];

const NEGATIVE_KEYWORDS = [
  // Spams / contests / lottery / giveaways
  'lucky draw', 'giveaway', 'give away', 'sweepstake', 'lottery',
  'chance to win', 'react to this post to win', 'winners will be announced',
  'win an iphone', 'win prizes', 'lucky winner',
  // Khmer contest / lottery
  'ឈ្នះរង្វាន់', 'ចាប់រង្វាន់', 'ចាប់ឆ្នោត'
];

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Sanitizes text by stripping URLs, emails, and @handles
 * to prevent false positives (e.g. wwwinfinity.net email matching .net keyword)
 */
function cleanTextForMatching(raw) {
  if (!raw) return '';
  return raw
    .replace(/https?:\/\/[^\s]+/gi, ' ') // Strip URLs
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi, ' ') // Strip emails
    .replace(/@\w+/g, ' '); // Strip @usernames
}

function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Validates if the text is a legitimate IT job post
 */
function isJobPost(text, customKeywords = null) {
  if (!text) return false;
  const decoded = decodeHtmlEntities(text);
  const t = decoded.toLowerCase();

  // 1. Block spam/contests/lottery
  for (const neg of NEGATIVE_KEYWORDS) {
    if (t.includes(neg)) return false;
  }

  // 2. Must contain at least one job indicator (English or Khmer)
  let hasJobIndicator = false;
  for (const ind of JOB_INDICATORS) {
    const i = ind.toLowerCase().trim();
    if (!i) continue;
    if (t.includes(i)) {
      hasJobIndicator = true;
      break;
    }
  }
  if (!hasJobIndicator) return false;

  // 3. Must contain at least one IT keyword (checked against sanitized text)
  const keywordsList = customKeywords || getKeywords();
  const cleaned = cleanTextForMatching(decoded);

  for (const kw of keywordsList) {
    const k = kw.toLowerCase().trim();
    if (!k) continue;
    try {
      let re;
      if (k === '.net') {
        re = /(?:^|[\s,;:(/\[])\.net(?=[\s,;:!?)\]/-]|$)/i;
      } else if (k === 'c#') {
        re = /(?:^|[\s,;:(/\[])c#(?=[\s,;:!?)\]/-]|$)/i;
      } else {
        const left = /^\w/.test(k) ? '\\b' : '';
        const right = /\w$/.test(k) ? '\\b' : '';
        re = new RegExp(left + escapeRegExp(k) + right, 'i');
      }
      if (re.test(cleaned)) {
        return true;
      }
    } catch (_) {
      if (cleaned.includes(k)) return true;
    }
  }

  return false;
}

/**
 * Returns all matched IT keywords for a given post
 */
function getMatchedKeywords(text, customKeywords = null) {
  if (!text) return [];
  const decoded = decodeHtmlEntities(text);
  const cleaned = cleanTextForMatching(decoded);
  const keywordsList = customKeywords || getKeywords();
  const matched = [];

  for (const kw of keywordsList) {
    const k = kw.toLowerCase().trim();
    if (!k) continue;
    try {
      let re;
      if (k === '.net') {
        re = /(?:^|[\s,;:(/\[])\.net(?=[\s,;:!?)\]/-]|$)/i;
      } else if (k === 'c#') {
        re = /(?:^|[\s,;:(/\[])c#(?=[\s,;:!?)\]/-]|$)/i;
      } else {
        const left = /^\w/.test(k) ? '\\b' : '';
        const right = /\w$/.test(k) ? '\\b' : '';
        re = new RegExp(left + escapeRegExp(k) + right, 'i');
      }
      if (re.test(cleaned)) {
        matched.push(kw);
      }
    } catch (_) {
      if (cleaned.includes(k)) matched.push(kw);
    }
  }

  return matched;
}

module.exports = {
  JOB_INDICATORS,
  NEGATIVE_KEYWORDS,
  cleanTextForMatching,
  decodeHtmlEntities,
  isJobPost,
  getMatchedKeywords
};
