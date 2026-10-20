/** Местные сутки бюллетеня (YYYY-MM-DD) как момент для форматирования next-intl (часовой пояс Душанбе). */
export function ecoDateValue(date: string): Date {
  return new Date(`${date}T12:00:00+05:00`);
}
