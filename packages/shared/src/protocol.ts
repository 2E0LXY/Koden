import { z } from "zod";

export const ModeSchema = z.enum(["USB", "LSB", "CW", "AM", "FM", "RTTY", "DATA"]);

export const FilterWidthSchema = z.enum(["narrow", "normal", "wide"]);
export type FilterWidth = z.infer<typeof FilterWidthSchema>;

export const AntennaIdSchema = z.enum([
  "longwire",
  "vertical",
  "dipole",
  "g5rv",
  "yagi-small",
  "yagi-3el",
  "yagi-5el",
]);

/** Client -> server: introduce this station. */
export const HelloMessage = z.object({
  type: z.literal("hello"),
  callsign: z.string().min(1).max(12),
  grid: z.string().min(4).max(6),
});

/**
 * Client -> server: retune the VFO and/or change mode. `freqKHz` is the
 * station's effective *listening* frequency (VFO frequency plus any RIT
 * offset, applied client-side). `txFreqKHz` is what other stations hear
 * this station transmit on -- normally equal to `freqKHz`, but different
 * when operating split (transmitting on VFO B while listening on VFO A).
 */
// Generous bounds around the full HF+6m amateur range (160m's 1800kHz low
// edge to 6m's 54000kHz high edge, with slack either side for future band
// additions) -- wide enough to never clip a legitimate tuning, but enough
// to reject the kind of nonsense (negative, zero, or absurd values like 1e9)
// that would otherwise get broadcast verbatim to every other listener's
// roster and corrupt their waterfall/tuning display.
const MIN_TUNE_FREQ_KHZ = 1_000;
const MAX_TUNE_FREQ_KHZ = 60_000;

export const TuneMessage = z.object({
  type: z.literal("tune"),
  freqKHz: z.number().min(MIN_TUNE_FREQ_KHZ).max(MAX_TUNE_FREQ_KHZ),
  mode: ModeSchema,
  txFreqKHz: z.number().min(MIN_TUNE_FREQ_KHZ).max(MAX_TUNE_FREQ_KHZ).optional(),
  filterWidth: FilterWidthSchema.optional(),
});

/** Client -> server: push-to-talk state changed. */
export const PttMessage = z.object({
  type: z.literal("ptt"),
  active: z.boolean(),
});

/** Client -> server: antenna type and/or rotator heading changed. */
export const AntennaMessage = z.object({
  type: z.literal("antenna"),
  antenna: AntennaIdSchema,
  headingDeg: z.number().min(0).max(359),
});

/** Client -> server: operator changed their callsign and/or grid locator from the setup panel. */
export const ProfileMessage = z.object({
  type: z.literal("profile"),
  callsign: z.string().min(1).max(12),
  grid: z.string().min(4).max(6),
});

/** Client -> server: RF output power (RF POWER knob) changed, in watts. */
export const PowerMessage = z.object({
  type: z.literal("power"),
  watts: z.number().min(0).max(200),
});

/** Client -> server: antenna match (SWR) changed, e.g. after running the ATU or hopping bands. */
export const SwrMessage = z.object({
  type: z.literal("swr"),
  swr: z.number().min(1).max(10),
});

export const AgcModeSchema = z.enum(["OFF", "FAST", "MID", "SLOW"]);
export const NotchModeSchema = z.enum(["off", "manual", "auto"]);
export const TuneStepSchema = z.enum(["FINE", "NORMAL", "COARSE", "FAST"]);

export const ReceiveParamsSchema = z.object({
  afGain: z.number(),
  rfGain: z.number(),
  squelch: z.number(),
  nbLevel: z.number(),
  nrLevel: z.number(),
  notchDepth: z.number(),
  notchFreqHz: z.number(),
  notchWidth: z.number(),
  notchMode: NotchModeSchema,
  ifShiftHz: z.number(),
  pbtQ: z.number(),
  width: z.number(),
  agcMode: AgcModeSchema,
  attEnabled: z.boolean(),
  ipoEnabled: z.boolean(),
  apfEnabled: z.boolean(),
  dnrEnabled: z.boolean(),
  afRfBalance: z.number(),
});

export const VfoStateSchema = z.object({
  freqKHz: z.number(),
  mode: ModeSchema,
});

export const BandMemoryEntrySchema = VfoStateSchema.extend({
  attEnabled: z.boolean(),
  ipoEnabled: z.boolean(),
});

/**
 * Everything about a station's setup worth remembering between sessions --
 * VFOs, memory channels, receiver/transmit trims, antenna/rotator, and UI
 * prefs. Deliberately excludes anything transient/session-only (roster,
 * meter readings, PTT/VOX-active state, connection status, tuner-running
 * animation, SWR, band-scan toggle) that wouldn't make sense to restore.
 */
export const SettingsSchema = z.object({
  vfoA: VfoStateSchema,
  vfoB: VfoStateSchema,
  activeVfo: z.enum(["A", "B"]),
  split: z.boolean(),
  vfoLocked: z.boolean(),
  tuneStep: TuneStepSchema,
  ritEnabled: z.boolean(),
  xitEnabled: z.boolean(),
  offsetHz: z.number(),
  pbt1Hz: z.number(),
  pbt2Hz: z.number(),
  filterWidth: FilterWidthSchema,
  memory: z.array(VfoStateSchema.nullable()),
  memIndex: z.number(),
  vfoMMode: z.enum(["VFO", "M"]),
  mox: z.boolean(),
  vox: z.boolean(),
  voxDelayKnob: z.number(),
  voxGainKnob: z.number(),
  rx: ReceiveParamsSchema,
  compEnabled: z.boolean(),
  procLevel: z.number(),
  moniEnabled: z.boolean(),
  moniLevel: z.number(),
  micGain: z.number(),
  txPower: z.number(),
  keySpeed: z.number(),
  dim: z.boolean(),
  mScope: z.boolean(),
  antenna: AntennaIdSchema,
  heading: z.number(),
  sfxEnabled: z.boolean(),
  selectedMicId: z.string(),
  selectedSpeakerId: z.string(),
  bandMemory: z.record(z.string(), BandMemoryEntrySchema),
});
export type Settings = z.infer<typeof SettingsSchema>;

/** Client -> server: persist this station's full setup, keyed by callsign. */
export const SaveSettingsMessage = z.object({
  type: z.literal("save_settings"),
  settings: SettingsSchema,
});

export const ClientMessage = z.discriminatedUnion("type", [
  HelloMessage,
  TuneMessage,
  PttMessage,
  AntennaMessage,
  ProfileMessage,
  PowerMessage,
  SwrMessage,
  SaveSettingsMessage,
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

export const StationInfoSchema = z.object({
  id: z.string(),
  callsign: z.string(),
  grid: z.string(),
  freqKHz: z.number(),
  txFreqKHz: z.number(),
  mode: ModeSchema,
  transmitting: z.boolean(),
  antenna: AntennaIdSchema,
  headingDeg: z.number(),
});
export type StationInfo = z.infer<typeof StationInfoSchema>;

/** Server -> client: connection accepted, here is your session id. */
export const WelcomeMessage = z.object({
  type: z.literal("welcome"),
  id: z.string(),
  serverTimeMs: z.number(),
});

/** Server -> client: full list of currently connected stations. */
export const RosterMessage = z.object({
  type: z.literal("roster"),
  stations: z.array(StationInfoSchema),
});

/** Server -> client: this listener's current S-meter / noise floor reading. */
export const MeterMessage = z.object({
  type: z.literal("meter"),
  sMeterDb: z.number(),
  noiseFloorDb: z.number(),
  audibleStationIds: z.array(z.string()),
});

/** Server -> client: a notable propagation event worth surfacing in the UI. */
export const BandEventMessage = z.object({
  type: z.literal("band_event"),
  kind: z.enum(["meteor_scatter", "band_opening", "band_closing", "flutter"]),
  bandId: z.string(),
  message: z.string(),
});

/** Server -> client: current real solar conditions (from NOAA SWPC), refreshed periodically. */
export const SolarMessage = z.object({
  type: z.literal("solar"),
  sfi: z.number(),
  kp: z.number(),
});

export const ErrorMessage = z.object({
  type: z.literal("error"),
  message: z.string(),
});

/** Server -> client: this callsign's saved setup, if any was found (sent once, right after welcome). */
export const SettingsMessage = z.object({
  type: z.literal("settings"),
  settings: SettingsSchema.nullable(),
});

export const ServerMessage = z.discriminatedUnion("type", [
  WelcomeMessage,
  RosterMessage,
  MeterMessage,
  SolarMessage,
  BandEventMessage,
  ErrorMessage,
  SettingsMessage,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;
