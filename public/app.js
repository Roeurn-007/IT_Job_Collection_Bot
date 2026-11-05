/**
 * IT Job Collection Bot - Modern Frontend Application
 * Handles Real-time polling, Faceted filtering, Search, Bookmarks, and Modals
 */

// ==========================================================================
// Bookmarks & LocalStorage Managers
// ==========================================================================
const Bookmarks = {
  KEY: 'it_job_bookmarks',
  get() {
    try {
      return JSON.parse(localStorage.getItem(this.KEY) || '[]');
    } catch {
      return [];
    }
  },
  has(id) {
    return this.get().includes(String(id));
  },
  toggle(id) {
    const list = this.get();
    const strId = String(id);
    const index = list.indexOf(strId);
    let added = false;
    if (index > -1) {
      list.splice(index, 1);
      added = false;
    } else {
      list.push(strId);
      added = true;
    }
    localStorage.setItem(this.KEY, JSON.stringify(list));
    updateBookmarkCounts();
    return added;
  },
  count() {
    return this.get().length;
  }
};

// ==========================================================================
// Helpers: HTML decoding, Role detection, Salary & Contacts extraction
// ==========================================================================
function decodeHtml(str) {
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

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

function detectRole(text) {
  const t = (text || '').toLowerCase();
  if (t.includes('full stack') || t.includes('fullstack') || t.includes('mern') || t.includes('mean')) {
    return { id: 'fullstack', label: 'Full Stack', colorClass: 'fullstack', icon: '⚡' };
  }
  if (t.includes('backend') || t.includes('back-end') || t.includes('api developer') || t.includes('node.js') ||
      t.includes('python developer') || t.includes('java') || t.includes('spring') || t.includes('golang') ||
      t.includes('.net') || t.includes('c#') || t.includes('php') || t.includes('laravel') || t.includes('nestjs')) {
    return { id: 'backend', label: 'Backend', colorClass: 'backend', icon: '🛠️' };
  }
  if (t.includes('frontend') || t.includes('front-end') || t.includes('react') || t.includes('vue') ||
      t.includes('angular') || t.includes('next.js') || t.includes('web developer') || t.includes('javascript') || t.includes('typescript')) {
    return { id: 'frontend', label: 'Frontend', colorClass: 'frontend', icon: '💻' };
  }
  if (t.includes('mobile') || t.includes('ios') || t.includes('android') || t.includes('flutter') ||
      t.includes('react native') || t.includes('swift') || t.includes('kotlin') || t.includes('dart')) {
    return { id: 'mobile', label: 'Mobile', colorClass: 'mobile', icon: '📱' };
  }
  if (t.includes('qa') || t.includes('quality assurance') || t.includes('tester') || t.includes('testing') || t.includes('sdet')) {
    return { id: 'qa', label: 'QA / Testing', colorClass: 'qa', icon: '🧪' };
  }
  if (t.includes('devops') || t.includes('cloud') || t.includes('aws') || t.includes('azure') ||
      t.includes('gcp') || t.includes('sre') || t.includes('kubernetes') || t.includes('docker') ||
      t.includes('system admin') || t.includes('infrastructure') || t.includes('network engineer')) {
    return { id: 'devops', label: 'DevOps & Cloud', colorClass: 'devops', icon: '☁️' };
  }
  if (t.includes('data engineer') || t.includes('data scientist') || t.includes('data analyst') ||
      t.includes('machine learning') || t.includes('ai engineer') || t.includes('bi analyst') ||
      t.includes('sql') || t.includes('database') || t.includes('dba')) {
    return { id: 'data', label: 'Data & AI', colorClass: 'data', icon: '🧠' };
  }
  if (t.includes('ui/ux') || t.includes('ui ux') || t.includes('product designer') ||
      t.includes('ux researcher') || t.includes('figma') || t.includes('graphic designer') || t.includes('web designer')) {
    return { id: 'uiux', label: 'UI/UX Design', colorClass: 'uiux', icon: '🎨' };
  }
  if (t.includes('intern') || t.includes('internship') || t.includes('fresher') || t.includes('junior') || t.includes('trainee')) {
    return { id: 'junior', label: 'Junior / Intern', colorClass: 'junior', icon: '🎓' };
  }
  return { id: 'it', label: 'IT / Software', colorClass: 'it', icon: '💼' };
}

function extractSalary(text) {
  if (!text) return null;
  const regexes = [
    /(?:salary|💸|ប្រាក់ខែ)[\s:：]*([$USDusd\d\s,~–\-+]+(?:negotiable|ចរចា)?)/i,
    /(\$[\d,]+(?:\s*[–\-\~]\s*\$?[\d,]+)?)/,
    /(USD\s*[\d,]+(?:\s*[–\-\~]\s*[\d,]+)?)/i,
    /([\d,]+\s*\$\s*(?:[–\-\~]\s*[\d,]+\s*\$)?)/,
    /(negotiable|ចរចា)/i
  ];
  for (const re of regexes) {
    const m = text.match(re);
    if (m && m[1]) {
      const match = m[1].trim();
      if (match.length >= 3 && match.length <= 40 &&
         (match.includes('$') || /usd/i.test(match) || /negotiable/i.test(match) || /ចរចា/.test(match))) {
        return match;
      }
    }
  }
  return null;
}

function extractContacts(text) {
  if (!text) return { emails: [], phones: [], links: [] };
  const emails = [...new Set((text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || []))];
  const phones = [...new Set((text.match(/(?:\+855\s?|0)[1-9]\d(?:\s?\d{2,3}){2}/g) || []))];
  const rawLinks = text.match(/https?:\/\/[^\s<>"')]+/g) || [];
  const links = [...new Set(rawLinks.filter(l => !l.includes('t.me/')))];
  return { emails, phones, links };
}

function formatRelativeTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 172800) return 'Yesterday';
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatFullDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const wd = weekdays[d.getDay()];
  const mon = months[d.getMonth()];
  const day = d.getDate();
  const yr = d.getFullYear();
  let hr = d.getHours();
  const min = String(d.getMinutes()).padStart(2, '0');
  const ampm = hr >= 12 ? 'PM' : 'AM';
  hr = hr % 12 || 12;
  return `${wd}, ${mon} ${day}, ${yr} at ${hr}:${min} ${ampm}`;
}

const TIMEZONE = 'Asia/Phnom_Penh';

function getPhnomPenhDate(iso) {
  if (!iso) return { dateStr: '', isToday: false, display: '' };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { dateStr: '', isToday: false, display: '' };

  const dateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);

  const todayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());

  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    weekday: 'long'
  }).format(d);

  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }).format(d);

  const isToday = dateStr === todayStr;

  return {
    dateStr,
    isToday,
    weekday,
    time,
    display: `${isToday ? 'Today, ' : ''}${dateStr} ${weekday} ${time}`
  };
}

function getTelegramLink(job) {
  if (job.link) return job.link;
  if (job.sourceId && job.messageId) {
    const sid = String(job.sourceId).replace(/^@/, '');
    return `https://t.me/${sid}/${job.messageId}`;
  }
  return '#';
}

function getJobUniqueId(job) {
  return `${job.sourceId || job.source}_${job.messageId}`;
}

function getJobPhotoUrl(job) {
  if (!job.media || job.media.type !== 'photo') return null;
  return `/api/photo/${job.media.fileId}`;
}

function highlightText(text, query) {
  if (!query || !query.trim()) return escapeHtml(text);
  const q = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${q})`, 'gi');
  const parts = text.split(re);
  return parts.map(part => {
    if (part.toLowerCase() === query.trim().toLowerCase()) {
      return `<mark class="highlight">${escapeHtml(part)}</mark>`;
    }
    return escapeHtml(part);
  }).join('');
}

// ==========================================================================
// Application State
// ==========================================================================
const state = {
  allJobs: [],
  filteredJobs: [],
  channels: [],
  selectedRole: '',
  searchTerm: '',
  selectedChannel: '',
  selectedDateRange: '',
  filterHasSalary: false,
  filterHasMedia: false,
  filterOnlySaved: false,
  currentSort: 'newest',
  currentView: localStorage.getItem('it_jobs_view') || 'grid',
  currentModalIndex: -1,
  autoRefresh: true,
  autoRefreshTimer: null
};

// ==========================================================================
// DOM Elements
// ==========================================================================
const dom = {
  // Brand & Status
  statusPulse: document.getElementById('statusPulse'),
  headerChannelsCount: document.getElementById('headerChannelsCount'),
  savedCountBadge: document.getElementById('savedCountBadge'),
  btnAutoRefresh: document.getElementById('btnAutoRefresh'),
  btnOpenChannels: document.getElementById('btnOpenChannels'),
  btnSavedView: document.getElementById('btnSavedView'),
  btnRefresh: document.getElementById('btnRefresh'),
  refreshIcon: document.getElementById('refreshIcon'),
  btnThemeToggle: document.getElementById('btnThemeToggle'),

  // Stats cards
  statCardTotal: document.getElementById('statCardTotal'),
  statCardToday: document.getElementById('statCardToday'),
  statCardSources: document.getElementById('statCardSources'),
  statCardSaved: document.getElementById('statCardSaved'),
  statTotal: document.getElementById('statTotal'),
  statToday: document.getElementById('statToday'),
  statSources: document.getElementById('statSources'),
  statSaved: document.getElementById('statSaved'),

  // Category Pills
  categoryPills: document.getElementById('categoryPills'),

  // Search & Controls
  searchInput: document.getElementById('searchInput'),
  searchClear: document.getElementById('searchClear'),
  btnViewGrid: document.getElementById('btnViewGrid'),
  btnViewList: document.getElementById('btnViewList'),
  sortSelect: document.getElementById('sortSelect'),
  btnExport: document.getElementById('btnExport'),

  // Results & Container
  resultsCounter: document.getElementById('resultsCounter'),
  countFiltered: document.getElementById('countFiltered'),
  countTotal: document.getElementById('countTotal'),
  lastSyncTime: document.getElementById('lastSyncTime'),
  jobsContainer: document.getElementById('jobsContainer'),
  emptyState: document.getElementById('emptyState'),
  btnEmptyReset: document.getElementById('btnEmptyReset'),

  // Job Details Modal
  jobModal: document.getElementById('jobModal'),
  modalClose: document.getElementById('modalClose'),
  modalSourceBadge: document.getElementById('modalSourceBadge'),
  modalCategoryBadge: document.getElementById('modalCategoryBadge'),
  modalDate: document.getElementById('modalDate'),
  modalImageContainer: document.getElementById('modalImageContainer'),
  modalImage: document.getElementById('modalImage'),
  modalSalaryBanner: document.getElementById('modalSalaryBanner'),
  modalSalaryAmount: document.getElementById('modalSalaryAmount'),
  modalFullText: document.getElementById('modalFullText'),
  modalContactsSection: document.getElementById('modalContactsSection'),
  modalContactsGrid: document.getElementById('modalContactsGrid'),
  btnModalPrev: document.getElementById('btnModalPrev'),
  btnModalNext: document.getElementById('btnModalNext'),
  btnModalBookmark: document.getElementById('btnModalBookmark'),
  modalBookmarkLabel: document.getElementById('modalBookmarkLabel'),
  btnModalCopy: document.getElementById('btnModalCopy'),
  btnModalTelegram: document.getElementById('btnModalTelegram'),

  // Channels Explorer Modal
  channelsModal: document.getElementById('channelsModal'),
  channelsModalClose: document.getElementById('channelsModalClose'),
  channelsModalCloseBtn: document.getElementById('channelsModalCloseBtn'),
  channelsSearchInput: document.getElementById('channelsSearchInput'),
  channelsListContainer: document.getElementById('channelsListContainer'),

  // Toast Container
  toastContainer: document.getElementById('toastContainer')
};

// ==========================================================================
// Theme Management
// ==========================================================================
function initTheme() {
  const saved = localStorage.getItem('it_jobs_theme');
  if (saved) {
    document.documentElement.dataset.theme = saved;
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = prefersDark ? 'dark' : 'light';
  }
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme;
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('it_jobs_theme', next);
  showToast(`Switched to ${next} theme`, 'info');
}

// ==========================================================================
// Toast Notifications
// ==========================================================================
function showToast(msg, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✓' : 'ℹ'}</span>
    <span>${escapeHtml(msg)}</span>
  `;
  dom.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 250);
  }, 2600);
}

// ==========================================================================
// Data Fetching & Sync
// ==========================================================================
async function fetchData() {
  try {
    dom.refreshIcon.classList.add('spinning');

    const [statusRes, collectedRes, channelsRes] = await Promise.all([
      fetch('/api/status').then(r => r.json()).catch(() => ({})),
      fetch('/api/collected?limit=300').then(r => r.json()).catch(() => []),
      fetch('/api/channels').then(r => r.json()).catch(() => [])
    ]);

    // Format and decode job data
    const rawJobs = Array.isArray(collectedRes) ? collectedRes : [];
    state.allJobs = rawJobs.map(job => {
      const decodedSnippet = decodeHtml(job.snippet || '');
      const decodedText = decodeHtml(job.text || job.snippet || '');
      const role = detectRole(decodedText || decodedSnippet);
      const salary = extractSalary(decodedText || decodedSnippet);
      const contacts = extractContacts(decodedText || decodedSnippet);
      const uniqueId = getJobUniqueId(job);

      return {
        ...job,
        uniqueId,
        snippet: decodedSnippet,
        text: decodedText,
        role,
        salary,
        contacts
      };
    });

    state.channels = Array.isArray(channelsRes) && channelsRes.length
      ? channelsRes
      : (statusRes.channelsList || []);

    // Update Status Indicators
    dom.statusPulse.className = 'status-pulse';
    dom.statusPulse.title = 'Bot system active & collecting';

    // Update channel and bookmark counts
    dom.headerChannelsCount.textContent = state.channels.length || '50';
    updateBookmarkCounts();

    // Update Stats Overview
    updateStatsBar();

    // Apply Filter & Render
    applyFilters();

    dom.lastSyncTime.textContent = `Updated at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  } catch (err) {
    console.error('Fetch error:', err);
    dom.statusPulse.className = 'status-pulse offline';
    dom.statusPulse.title = 'Offline or disconnected';
    showToast('Failed to connect to server', 'info');
  } finally {
    setTimeout(() => {
      dom.refreshIcon.classList.remove('spinning');
    }, 400);
  }
}

function updateBookmarkCounts() {
  const count = Bookmarks.count();
  dom.savedCountBadge.textContent = count;
  dom.statSaved.textContent = count;
}

function updateStatsBar() {
  const total = state.allJobs.length;
  const todayCount = state.allJobs.filter(j => j.isToday || getPhnomPenhDate(j.date).isToday).length;
  const uniqueChannelsCount = state.channels.length || new Set(state.allJobs.map(j => j.source).filter(Boolean)).size;

  dom.statTotal.textContent = total;
  dom.statToday.textContent = todayCount;
  dom.statSources.textContent = uniqueChannelsCount;
}

// ==========================================================================
// Filtering & Sorting Logic
// ==========================================================================
function applyFilters() {
  const term = state.searchTerm.toLowerCase().trim();

  state.filteredJobs = state.allJobs.filter(job => {
    // 1. Text Search Match
    if (term) {
      const fullContent = `${job.source || ''} ${job.role?.label || ''} ${job.snippet || ''} ${job.text || ''} ${job.salary || ''}`.toLowerCase();
      if (!fullContent.includes(term)) {
        return false;
      }
    }

    // 2. Role Category Filter
    if (state.selectedRole && job.role?.id !== state.selectedRole) {
      return false;
    }

    // 3. Date Filter (from Today stat card - strictly matches Cambodia Today)
    if (state.selectedDateRange === 'today') {
      const dateInfo = getPhnomPenhDate(job.date);
      if (!job.isToday && !dateInfo.isToday) return false;
    }

    // 4. Saved Bookmarks
    if (state.filterOnlySaved && !Bookmarks.has(job.uniqueId)) {
      return false;
    }

    return true;
  });

  // Apply Sorting
  sortJobs();

  // Render UI
  renderJobs();
}

function sortJobs() {
  if (state.currentSort === 'newest') {
    // Prioritize today's jobs first, then newest timestamp (matches Telegram /recent)
    state.filteredJobs.sort((a, b) => {
      const aInfo = getPhnomPenhDate(a.date);
      const bInfo = getPhnomPenhDate(b.date);
      const aToday = (a.isToday || aInfo.isToday) ? 1 : 0;
      const bToday = (b.isToday || bInfo.isToday) ? 1 : 0;
      if (aToday !== bToday) return bToday - aToday;
      return new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime();
    });
  } else if (state.currentSort === 'oldest') {
    state.filteredJobs.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  } else if (state.currentSort === 'source') {
    state.filteredJobs.sort((a, b) => (a.source || '').localeCompare(b.source || ''));
  }
}

// ==========================================================================
// Rendering: Cards & Layouts
// ==========================================================================
function renderJobs() {
  const total = state.allJobs.length;
  const filtered = state.filteredJobs.length;

  dom.countFiltered.textContent = filtered;
  dom.countTotal.textContent = total;

  if (filtered === 0) {
    dom.jobsContainer.innerHTML = '';
    dom.jobsContainer.classList.add('hidden');
    dom.emptyState.classList.remove('hidden');
    return;
  }

  dom.emptyState.classList.add('hidden');
  dom.jobsContainer.classList.remove('hidden');
  dom.jobsContainer.className = `jobs-grid ${state.currentView === 'list' ? 'list-view' : ''}`;

  const cardsHtml = state.filteredJobs.map((job, index) => {
    const isBookmarked = Bookmarks.has(job.uniqueId);
    const photo = getJobPhotoUrl(job);
    const tgLink = getTelegramLink(job);
    const dateInfo = getPhnomPenhDate(job.date);
    const isToday = job.isToday || dateInfo.isToday;
    const badgeHtml = isToday
      ? `<span class="badge-post-status badge-post-today">🔥 NEW TODAY</span>`
      : `<span class="badge-post-status badge-post-recent">📅 RECENT</span>`;
    const snippetHtml = highlightText(job.snippet || '', state.searchTerm);

    // Media element
    const mediaHtml = photo
      ? `<img class="job-card-img" src="${photo}" alt="Job Flyer" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'job-card-placeholder-banner\\'>${job.role?.icon || '💼'}</div>'">`
      : `<div class="job-card-placeholder-banner">${job.role?.icon || '💼'}</div>`;

    // Salary tag
    const salaryTagHtml = job.salary
      ? `<div class="salary-tag"><span>💰</span><span>${escapeHtml(job.salary)}</span></div>`
      : '';

    // Extracted contacts micro pills
    let contactsHtml = '';
    if (job.contacts) {
      const pills = [];
      job.contacts.phones.slice(0, 1).forEach(ph => {
        pills.push(`<span class="contact-pill btn-copy-contact" data-copy="${escapeHtml(ph)}" title="Click to copy phone">📞 ${escapeHtml(ph)}</span>`);
      });
      job.contacts.emails.slice(0, 1).forEach(em => {
        pills.push(`<span class="contact-pill btn-copy-contact" data-copy="${escapeHtml(em)}" title="Click to copy email">✉️ ${escapeHtml(em)}</span>`);
      });
      if (pills.length) {
        contactsHtml = `<div class="contacts-preview">${pills.join('')}</div>`;
      }
    }

    return `
      <article class="job-card ${isBookmarked ? 'bookmarked' : ''}" data-index="${index}">
        <div class="job-card-media" onclick="openJobModal(${index})">
          ${mediaHtml}
          <div class="card-floating-badges">
            ${badgeHtml}
            <button class="btn-star-card ${isBookmarked ? 'active' : ''}" data-job-id="${job.uniqueId}" title="${isBookmarked ? 'Remove bookmark' : 'Bookmark job'}" onclick="event.stopPropagation(); handleToggleBookmark('${job.uniqueId}', this);">
              <svg class="icon star-icon" viewBox="0 0 24 24" fill="${isBookmarked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            </button>
          </div>
        </div>

        <div class="job-card-body">
          <div class="job-card-meta">
            <a href="${tgLink}" target="_blank" rel="noopener noreferrer" class="source-tag" title="Open source channel on Telegram" onclick="event.stopPropagation();">
              <span>✈</span>
              <span>${escapeHtml(job.source || 'Channel')}</span>
            </a>
            <div class="meta-right">
              <span class="category-tag ${job.role?.colorClass || 'it'}">${job.role?.label || 'IT'}</span>
              <span class="post-time" title="${escapeHtml(dateInfo.display)}">${dateInfo.display}</span>
            </div>
          </div>

          ${salaryTagHtml}

          <div class="job-card-text" onclick="openJobModal(${index})" title="Click to view full description">
            ${snippetHtml}
          </div>

          ${contactsHtml}

          <div class="job-card-footer">
            <button class="btn-card-details" onclick="openJobModal(${index})">
              Details
            </button>
            <button class="btn-card-icon btn-copy-text" data-text="${escapeHtml(job.text || job.snippet || '')}" title="Copy description to clipboard" onclick="event.stopPropagation(); copyTextToClipboard(this.dataset.text);">
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            <a href="${tgLink}" target="_blank" rel="noopener noreferrer" class="btn-card-telegram" onclick="event.stopPropagation();">
              <svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 0 0-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/></svg>
              <span>Telegram</span>
            </a>
          </div>
        </div>
      </article>
    `;
  }).join('');

  dom.jobsContainer.innerHTML = cardsHtml;

  // Add click listeners to contact micro pills
  dom.jobsContainer.querySelectorAll('.btn-copy-contact').forEach(pill => {
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      copyTextToClipboard(pill.dataset.copy);
    });
  });
}

function resetAllFilters() {
  state.searchTerm = '';
  state.selectedRole = '';
  state.selectedDateRange = '';
  state.filterOnlySaved = false;

  dom.searchInput.value = '';
  dom.searchClear.classList.add('hidden');
  dom.statCardToday.classList.remove('active-filter');
  dom.statCardSaved.classList.remove('active-filter');

  dom.categoryPills.querySelectorAll('.cat-pill').forEach(p => p.classList.remove('active'));
  dom.categoryPills.querySelector('[data-role=""]').classList.add('active');

  applyFilters();
  showToast('Filters reset', 'info');
}

// ==========================================================================
// Bookmarks Toggle
// ==========================================================================
function handleToggleBookmark(uniqueId, buttonEl) {
  const added = Bookmarks.toggle(uniqueId);
  const card = buttonEl.closest('.job-card');
  if (card) {
    card.classList.toggle('bookmarked', added);
  }
  buttonEl.classList.toggle('active', added);
  buttonEl.innerHTML = `<svg class="icon star-icon" viewBox="0 0 24 24" fill="${added ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;

  showToast(added ? 'Saved to bookmarks' : 'Removed from bookmarks', added ? 'success' : 'info');

  if (state.filterOnlySaved && !added) {
    applyFilters();
  }
}

// ==========================================================================
// Job Details Modal
// ==========================================================================
function openJobModal(index) {
  const job = state.filteredJobs[index];
  if (!job) return;

  state.currentModalIndex = index;

  // Header meta
  dom.modalSourceBadge.textContent = job.source || 'Telegram';
  dom.modalCategoryBadge.textContent = job.role?.label || 'IT Role';
  dom.modalCategoryBadge.className = `modal-category-tag ${job.role?.colorClass || 'it'}`;
  
  const dateInfo = getPhnomPenhDate(job.date);
  const isToday = job.isToday || dateInfo.isToday;
  dom.modalDate.innerHTML = `
    <span class="modal-badge ${isToday ? 'badge-post-today' : 'badge-post-recent'}">
      ${isToday ? '🔥 [NEW JOB POST TODAY]' : '📅 [RECENT JOB POST]'}
    </span>
    <span class="modal-date-text">Posted: ${escapeHtml(dateInfo.display)}</span>
  `;

  // Photo
  const photo = getJobPhotoUrl(job);
  if (photo) {
    dom.modalImage.src = photo;
    dom.modalImageContainer.classList.remove('hidden');
  } else {
    dom.modalImageContainer.classList.add('hidden');
    dom.modalImage.src = '';
  }

  // Salary banner
  if (job.salary) {
    dom.modalSalaryAmount.textContent = job.salary;
    dom.modalSalaryBanner.classList.remove('hidden');
  } else {
    dom.modalSalaryBanner.classList.add('hidden');
  }

  // Full text with preserved line breaks and clickable links
  let text = job.text || job.snippet || '';
  const linkedText = escapeHtml(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  dom.modalFullText.innerHTML = linkedText;

  // Extracted contacts section
  const contacts = job.contacts;
  const hasContacts = contacts && (contacts.phones.length > 0 || contacts.emails.length > 0 || contacts.links.length > 0);

  if (hasContacts) {
    dom.modalContactsSection.classList.remove('hidden');
    let contactsHtml = '';
    contacts.phones.forEach(p => {
      contactsHtml += `
        <button class="contact-card" onclick="copyTextToClipboard('${escapeHtml(p)}')">
          <span>📞</span>
          <span>${escapeHtml(p)}</span>
          <span style="font-size: 0.72rem; color: var(--text-muted);">(Copy)</span>
        </button>
      `;
    });
    contacts.emails.forEach(e => {
      contactsHtml += `
        <button class="contact-card" onclick="copyTextToClipboard('${escapeHtml(e)}')">
          <span>✉️</span>
          <span>${escapeHtml(e)}</span>
          <span style="font-size: 0.72rem; color: var(--text-muted);">(Copy)</span>
        </button>
      `;
    });
    contacts.links.forEach(l => {
      contactsHtml += `
        <a href="${escapeHtml(l)}" target="_blank" rel="noopener noreferrer" class="contact-card">
          <span>🔗</span>
          <span>${escapeHtml(l.replace(/^https?:\/\//, '').slice(0, 30))}…</span>
        </a>
      `;
    });
    dom.modalContactsGrid.innerHTML = contactsHtml;
  } else {
    dom.modalContactsSection.classList.add('hidden');
    dom.modalContactsGrid.innerHTML = '';
  }

  // Bookmark button in modal
  const isBookmarked = Bookmarks.has(job.uniqueId);
  dom.btnModalBookmark.className = `action-btn ${isBookmarked ? 'active' : ''}`;
  dom.modalBookmarkLabel.textContent = isBookmarked ? 'Saved' : 'Save';
  dom.btnModalBookmark.onclick = () => {
    const added = Bookmarks.toggle(job.uniqueId);
    dom.btnModalBookmark.className = `action-btn ${added ? 'active' : ''}`;
    dom.modalBookmarkLabel.textContent = added ? 'Saved' : 'Save';
    showToast(added ? 'Saved to bookmarks' : 'Removed from bookmarks', added ? 'success' : 'info');
    renderJobs();
  };

  // Copy full Telegram-formatted post button
  dom.btnModalCopy.onclick = () => {
    const rawText = job.text || job.snippet || '';
    const badge = isToday ? '🔥 [NEW JOB POST TODAY]' : '📅 [RECENT JOB POST]';
    const tgPostMsg = `${badge}\n\n${rawText}\n\n(Source: ${job.source || ''})\nPosted: ${dateInfo.display}\n${getTelegramLink(job)}`;
    copyTextToClipboard(tgPostMsg);
  };

  // Telegram link
  dom.btnModalTelegram.href = getTelegramLink(job);

  // Prev / Next button states
  dom.btnModalPrev.disabled = index <= 0;
  dom.btnModalNext.disabled = index >= state.filteredJobs.length - 1;

  dom.btnModalPrev.onclick = () => {
    if (state.currentModalIndex > 0) {
      openJobModal(state.currentModalIndex - 1);
    }
  };
  dom.btnModalNext.onclick = () => {
    if (state.currentModalIndex < state.filteredJobs.length - 1) {
      openJobModal(state.currentModalIndex + 1);
    }
  };

  // Show modal
  dom.jobModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeJobModal() {
  dom.jobModal.classList.add('hidden');
  document.body.style.overflow = '';
  state.currentModalIndex = -1;
}

// ==========================================================================
// Channels Explorer Modal
// ==========================================================================
function openChannelsModal() {
  renderChannelsList('');
  dom.channelsModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  dom.channelsSearchInput.focus();
}

function closeChannelsModal() {
  dom.channelsModal.classList.add('hidden');
  document.body.style.overflow = '';
}

function renderChannelsList(query) {
  const q = (query || '').toLowerCase().trim();
  const sourceCounts = {};
  state.allJobs.forEach(j => {
    if (j.source) {
      const s = j.source.replace(/^@/, '');
      sourceCounts[s] = (sourceCounts[s] || 0) + 1;
    }
  });

  const list = state.channels.filter(ch => !q || ch.toLowerCase().includes(q));

  if (!list.length) {
    dom.channelsListContainer.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 20px;">No channels matching your search.</div>';
    return;
  }

  dom.channelsListContainer.innerHTML = list.map(ch => {
    const count = sourceCounts[ch] || 0;
    return `
      <div class="channel-item">
        <a href="https://t.me/${ch}" target="_blank" rel="noopener noreferrer" style="display:flex; align-items:center; gap:6px;">
          <span style="color:var(--telegram)">✈</span>
          <span>@${escapeHtml(ch)}</span>
        </a>
        <span class="channel-count">${count} jobs</span>
      </div>
    `;
  }).join('');
}

// ==========================================================================
// Copy to Clipboard Utility
// ==========================================================================
function copyTextToClipboard(text) {
  if (!text) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast('Copied to clipboard!', 'success');
    }).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    showToast('Copied to clipboard!', 'success');
  } catch {
    showToast('Failed to copy', 'info');
  }
  document.body.removeChild(ta);
}

// ==========================================================================
// Export Functionality (JSON & CSV)
// ==========================================================================
function exportJobs() {
  const data = state.filteredJobs.map(j => ({
    source: j.source,
    role: j.role?.label,
    salary: j.salary || 'N/A',
    date: j.date,
    link: getTelegramLink(j),
    snippet: j.snippet
  }));

  const jsonStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(data, null, 2));
  const dl = document.createElement('a');
  dl.setAttribute('href', jsonStr);
  dl.setAttribute('download', `IT_Jobs_${new Date().toISOString().slice(0, 10)}.json`);
  document.body.appendChild(dl);
  dl.click();
  dl.remove();
  showToast(`Exported ${data.length} jobs as JSON`, 'success');
}

// ==========================================================================
// Event Listeners & Interactions
// ==========================================================================
function setupEventListeners() {
  // Theme Toggle
  if (dom.btnThemeToggle) dom.btnThemeToggle.addEventListener('click', toggleTheme);

  // Manual Refresh
  if (dom.btnRefresh) {
    dom.btnRefresh.addEventListener('click', () => {
      fetchData();
      fetch('/api/refresh', { method: 'POST' }).catch(() => {});
    });
  }

  // Auto Refresh Toggle
  if (dom.btnAutoRefresh) {
    dom.btnAutoRefresh.addEventListener('click', () => {
      state.autoRefresh = !state.autoRefresh;
      dom.btnAutoRefresh.classList.toggle('active', state.autoRefresh);
      dom.btnAutoRefresh.classList.toggle('paused', !state.autoRefresh);
      const txt = dom.btnAutoRefresh.querySelector('.auto-refresh-text');
      if (txt) txt.textContent = state.autoRefresh ? 'Auto (15s)' : 'Paused';
      showToast(state.autoRefresh ? 'Auto-refresh enabled' : 'Auto-refresh paused', 'info');
    });
  }

  // Channels Modal
  if (dom.btnOpenChannels) dom.btnOpenChannels.addEventListener('click', openChannelsModal);
  if (dom.statCardSources) dom.statCardSources.addEventListener('click', openChannelsModal);
  if (dom.channelsModalClose) dom.channelsModalClose.addEventListener('click', closeChannelsModal);
  if (dom.channelsModalCloseBtn) dom.channelsModalCloseBtn.addEventListener('click', closeChannelsModal);
  if (dom.channelsSearchInput) {
    dom.channelsSearchInput.addEventListener('input', (e) => {
      renderChannelsList(e.target.value);
    });
  }

  // Bookmarks View Toggle
  if (dom.btnSavedView) {
    dom.btnSavedView.addEventListener('click', () => {
      state.filterOnlySaved = !state.filterOnlySaved;
      if (dom.statCardSaved) dom.statCardSaved.classList.toggle('active-filter', state.filterOnlySaved);
      applyFilters();
    });
  }

  if (dom.statCardSaved) {
    dom.statCardSaved.addEventListener('click', () => {
      state.filterOnlySaved = !state.filterOnlySaved;
      dom.statCardSaved.classList.toggle('active-filter', state.filterOnlySaved);
      applyFilters();
    });
  }

  // Stat Card Total -> Reset Filters
  if (dom.statCardTotal) dom.statCardTotal.addEventListener('click', resetAllFilters);

  // Stat Card Today -> Filter Today
  if (dom.statCardToday) {
    dom.statCardToday.addEventListener('click', () => {
      if (state.selectedDateRange === 'today') {
        state.selectedDateRange = '';
        dom.statCardToday.classList.remove('active-filter');
      } else {
        state.selectedDateRange = 'today';
        dom.statCardToday.classList.add('active-filter');
      }
      applyFilters();
    });
  }

  // Category Pills Strip
  if (dom.categoryPills) {
    dom.categoryPills.querySelectorAll('.cat-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        dom.categoryPills.querySelectorAll('.cat-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        state.selectedRole = pill.dataset.role || '';
        applyFilters();
      });
    });
  }

  // Search Input with Debounce & Clear
  let searchTimeout;
  if (dom.searchInput) {
    dom.searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      const val = e.target.value;
      if (dom.searchClear) dom.searchClear.classList.toggle('hidden', !val);
      searchTimeout = setTimeout(() => {
        state.searchTerm = val;
        applyFilters();
      }, 180);
    });
  }

  if (dom.searchClear) {
    dom.searchClear.addEventListener('click', () => {
      if (dom.searchInput) dom.searchInput.value = '';
      state.searchTerm = '';
      dom.searchClear.classList.add('hidden');
      if (dom.searchInput) dom.searchInput.focus();
      applyFilters();
    });
  }

  // Layout View Mode (Grid vs List)
  if (dom.btnViewGrid) {
    dom.btnViewGrid.addEventListener('click', () => {
      state.currentView = 'grid';
      localStorage.setItem('it_jobs_view', 'grid');
      dom.btnViewGrid.classList.add('active');
      if (dom.btnViewList) dom.btnViewList.classList.remove('active');
      renderJobs();
    });
  }

  if (dom.btnViewList) {
    dom.btnViewList.addEventListener('click', () => {
      state.currentView = 'list';
      localStorage.setItem('it_jobs_view', 'list');
      dom.btnViewList.classList.add('active');
      if (dom.btnViewGrid) dom.btnViewGrid.classList.remove('active');
      renderJobs();
    });
  }

  if (state.currentView === 'list') {
    if (dom.btnViewList) dom.btnViewList.classList.add('active');
    if (dom.btnViewGrid) dom.btnViewGrid.classList.remove('active');
  }

  // Sort Dropdown
  if (dom.sortSelect) {
    dom.sortSelect.addEventListener('change', (e) => {
      state.currentSort = e.target.value;
      sortJobs();
      renderJobs();
    });
  }

  // Reset Filters Button on Empty State
  if (dom.btnEmptyReset) dom.btnEmptyReset.addEventListener('click', resetAllFilters);

  // Export
  if (dom.btnExport) dom.btnExport.addEventListener('click', exportJobs);

  // Modal Close & Backdrop Click
  if (dom.modalClose) dom.modalClose.addEventListener('click', closeJobModal);
  if (dom.jobModal) {
    dom.jobModal.addEventListener('click', (e) => {
      if (e.target === dom.jobModal) closeJobModal();
    });
  }
  if (dom.channelsModal) {
    dom.channelsModal.addEventListener('click', (e) => {
      if (e.target === dom.channelsModal) closeChannelsModal();
    });
  }

  // Global Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    // Focus search on '/'
    if (e.key === '/' && document.activeElement !== dom.searchInput && document.activeElement.tagName !== 'INPUT') {
      e.preventDefault();
      dom.searchInput.focus();
      return;
    }
    // Refresh on 'r' or 'R' when no input is focused
    if ((e.key === 'r' || e.key === 'R') && document.activeElement.tagName !== 'INPUT') {
      fetchData();
      return;
    }
    // Close modals on Escape
    if (e.key === 'Escape') {
      if (!dom.jobModal.classList.contains('hidden')) {
        closeJobModal();
      } else if (!dom.channelsModal.classList.contains('hidden')) {
        closeChannelsModal();
      } else if (dom.searchInput.value) {
        dom.searchInput.value = '';
        state.searchTerm = '';
        dom.searchClear.classList.add('hidden');
        applyFilters();
      }
      return;
    }
    // Arrow navigation in Job Modal
    if (!dom.jobModal.classList.contains('hidden')) {
      if (e.key === 'ArrowLeft' && state.currentModalIndex > 0) {
        openJobModal(state.currentModalIndex - 1);
      } else if (e.key === 'ArrowRight' && state.currentModalIndex < state.filteredJobs.length - 1) {
        openJobModal(state.currentModalIndex + 1);
      }
    }
  });

  // Auto-refresh interval (15s)
  setInterval(() => {
    if (state.autoRefresh && dom.jobModal.classList.contains('hidden')) {
      fetchData();
    }
  }, 15000);
}

// Global modal open helper
window.openJobModal = openJobModal;
window.handleToggleBookmark = handleToggleBookmark;
window.copyTextToClipboard = copyTextToClipboard;

// ==========================================================================
// Initialization
// ==========================================================================
initTheme();
setupEventListeners();
fetchData();
