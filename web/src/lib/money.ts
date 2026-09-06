/**
 * Money is integer paisa everywhere in this codebase. Never floats.
 *
 * `Rs. 1,860` is stored, passed and computed as `186000`. Floating-point
 * rupees accumulate rounding error across a cart of modifiers, tax and a
 * delivery fee, and the error surfaces as a receipt that doesn't add up.
 *
 * Formatting happens only at the edge — in components, never in the
 * pricing engine.
 */

export type Paisa = number;

/** Rupees → paisa. Use when authoring seed data, never on user input. */
export function rupees(amount: number): Paisa {
  return Math.round(amount * 100);
}

/**
 * Formats paisa for display: `186000` → `"Rs. 1,860"`.
 *
 * Whole rupees drop the decimals, because café prices are whole rupees and
 * `Rs. 1,860.00` reads like a utility bill. Fractional amounts keep them so
 * a discounted line never silently rounds in the display.
 */
export function formatPKR(paisa: Paisa): string {
  const isNegative = paisa < 0;
  const abs = Math.abs(paisa);
  const whole = Math.floor(abs / 100);
  const fraction = abs % 100;

  const grouped = whole.toLocaleString("en-PK");
  const body =
    fraction === 0
      ? grouped
      : `${grouped}.${fraction.toString().padStart(2, "0")}`;

  return `${isNegative ? "−" : ""}Rs. ${body}`;
}
