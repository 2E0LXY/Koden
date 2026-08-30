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

/**
 * Same tuning, but with a cache-busting query param that changes on every
 * call. iframe.src assignments that differ *only* in the hash fragment are a
 * same-document fragment navigation per spec (fires hashchange on the framed
 * page, no reload) -- fine if OpenWebRX watches hashchange at runtime, silently
 * inert if it only reads location.hash once at initial load. Forcing the query
 * string to change too guarantees a real navigation either way, at the cost of
 * a brief reconnect glitch on each retune (acceptable since retuning is
 * already debounced to only fire after the dial settles).
 */
export function sdrRxEmbedUrl(freqKHz: number, mode: Mode, retuneSeq: number): string {
  const [origin, hash] = sdrRxUrl(freqKHz, mode).split("#");
  return `${origin}?_r=${retuneSeq}#${hash}`;
}

/**
 * Whether the SDR receiver can actually be embedded in a hidden iframe here.
 * The receiver is plain http (no TLS on that nonstandard port); embedding a
 * plain-http iframe inside an https page is blocked outright by browsers as
 * mixed active content -- silently, with no visible error beyond a console
 * warning. Top-level navigation (an ordinary link/new tab) isn't subject to
 * that restriction, so it stays available as the fallback either way.
 */
export function canEmbedSdrAudio(): boolean {
  return !(typeof window !== "undefined" && window.location.protocol === "https:" && SDR_BASE_URL.startsWith("http://"));
}
