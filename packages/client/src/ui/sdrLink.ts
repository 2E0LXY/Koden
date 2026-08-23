import type { Mode } from "@koden/shared";

const SDR_BASE_URL = "http://sdr.ukvpn.cloud:91/";

/** Koden's mode names -> the OpenWebRX primary demodulator that hears the same thing. */
const MODE_TO_OPENWEBRX: Record<Mode, string> = {
  USB: "usb",
  LSB: "lsb",
  CW: "cw",
  AM: "am",
  FM: "nfm",
  RTTY: "usb",
  DATA: "usb",
};

/** RTTY/DATA are tuned on a USB carrier and identified by their audio tones -- point OpenWebRX's digimode decoder at the closest real-world match. */
const SECONDARY_MODE: Partial<Record<Mode, string>> = {
  RTTY: "rtty",
  DATA: "ft8",
};

/**
 * Build a link to the real SDR receiver, tuned to match whatever's on the
 * Koden dial right now, so a real signal at that frequency (if any) can
 * actually be heard. OpenWebRX auto-selects whichever physical receiver
 * covers the requested frequency, so no band/device needs to be specified
 * here -- only frequency and mode.
 */
export function sdrRxUrl(freqKHz: number, mode: Mode): string {
  const params = [`freq=${Math.round(freqKHz * 1000)}`, `mod=${MODE_TO_OPENWEBRX[mode]}`];
  const secondaryMod = SECONDARY_MODE[mode];
  if (secondaryMod) params.push(`secondary_mod=${secondaryMod}`);
  params.push("sql=-150");
  return `${SDR_BASE_URL}#${params.join(",")}`;
}
