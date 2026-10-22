// @ai-generated
// Qariah (Sprint 48, S48.6): the unit of the daily notification limit.

/** The local calendar day of `date` as `YYYY-MM-DD`. */
export function localDay(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
