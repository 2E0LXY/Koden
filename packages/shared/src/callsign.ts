/**
 * Koden deliberately allows any freeform "callsign" -- a real amateur radio
 * callsign or just a nickname (the join screen says so explicitly). This is
 * NOT a real-callsign-format validator; it only rejects control characters,
 * newlines, and other non-printable junk. That matters because the string
 * gets echoed to every other connected station, embedded verbatim into
 * M0AI's system prompt as trusted context, and spoken aloud by its live
 * voice reply -- a newline or embedded control character there is a prompt-
 * injection/display-corruption vector that a plain length check doesn't
 * catch, even though the freeform-nickname feature itself is intentional.
 */
const PRINTABLE_ASCII_PATTERN = /^[\x20-\x7e]{1,12}$/;

export function isValidCallsign(callsign: string): boolean {
  return PRINTABLE_ASCII_PATTERN.test(callsign);
}
