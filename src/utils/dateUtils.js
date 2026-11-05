const TIMEZONE = 'Asia/Phnom_Penh';

function getPhnomPenhDateStr(date = new Date()) {
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
}

function formatPhnomPenhDate(date = new Date()) {
  if (!date) return { dateStr: '', weekday: '', time: '', isToday: false, display: '' };
  const d = new Date(date);
  if (isNaN(d.getTime())) return { dateStr: '', weekday: '', time: '', isToday: false, display: '' };

  const dateStr = getPhnomPenhDateStr(d);
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

  const todayStr = getPhnomPenhDateStr(new Date());
  const isToday = dateStr === todayStr;

  return {
    dateStr,
    weekday,
    time,
    isToday,
    display: `${isToday ? 'Today, ' : ''}${dateStr} ${weekday} ${time}`
  };
}

function formatDate(date) {
  return formatPhnomPenhDate(date).display;
}

module.exports = {
  TIMEZONE,
  getPhnomPenhDateStr,
  formatPhnomPenhDate,
  formatDate
};
