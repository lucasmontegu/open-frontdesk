/**
 * Normalizes Argentine phone numbers to E.164 mobile format (+54 9 AREA NUMBER).
 * Handles spaces/dashes/parentheses, the 0 trunk prefix, the 15 mobile prefix, 00 and 54 country prefixes.
 * Every national number is assumed to be mobile (WhatsApp-capable), because a landline cannot be told apart
 * from the digits alone. Numbers with another country code are kept as plain E.164.
 * Returns null when the input cannot be a valid number.
 */
export function normalizeArgentinePhone(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const hasPlus = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  if (!hasPlus && digits.startsWith("00")) digits = digits.slice(2);
  const international = hasPlus || trimmed.replace(/\D/g, "").startsWith("00");

  let national: string;
  if (digits.startsWith("54") && (international || digits.length >= 12)) {
    national = digits.slice(2);
  } else if (international) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  } else {
    national = digits;
  }

  // Mobile marker after the country code (+54 9 ...).
  if (national.startsWith("9") && national.length === 11) national = national.slice(1);
  if (national.startsWith("0")) national = national.slice(1);

  // Old-style "area 15 number": the 15 sits after a 2, 3 or 4 digit area code.
  if (national.length === 12) {
    for (const areaLen of [2, 3, 4]) {
      if (national.slice(areaLen, areaLen + 2) === "15") {
        national = national.slice(0, areaLen) + national.slice(areaLen + 2);
        break;
      }
    }
  }

  if (!/^[1-9]\d{9}$/.test(national)) return null;
  return `+549${national}`;
}
