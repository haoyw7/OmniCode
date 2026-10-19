// Reuse the formatter across calls to avoid repeated initialization.
// Use a fixed locale to keep count formatting consistent across environments.
const INTEGER_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

/** Format whole-number UI counts with stable thousands separators. */
export function formatInteger(value: number): string {
  return INTEGER_FORMATTER.format(value);
}
