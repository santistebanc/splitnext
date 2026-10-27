/** The day an entry belongs to: "Today", "Yesterday", a weekday this week, or a date. */
export function dayLabel(date: Date): string {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Today';

  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

  if (today.getTime() - date.getTime() < 7 * 24 * 60 * 60_000) return date.toLocaleDateString(undefined, { weekday: 'long' });

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** When it happened within its day: "Just now", "5m ago", "2h ago" today, a clock time before. */
export function timeLabel(date: Date): string {
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);

  if (date.toDateString() === new Date().toDateString()) {
    if (minutes < 1) return 'Just now';

    if (minutes < 60) return `${minutes}m ago`;

    return `${Math.floor(minutes / 60)}h ago`;
  }

  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/**
 * When something happened, in a sentence, as Activity tells it: "just now" or
 * "5m ago" today, and otherwise its day with the time, such as
 * "yesterday, 14:05", "Monday, 09:30", or "Oct 12, 18:00".
 */
export function whenLabel(date: Date): string {
  const time = timeLabel(date);

  if (date.toDateString() === new Date().toDateString()) return time === 'Just now' ? 'just now' : time;
  const day = dayLabel(date);

  return `${day === 'Yesterday' ? 'yesterday' : day}, ${time}`;
}
