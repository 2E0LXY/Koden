import { z } from "zod";

export const ModeSchema = z.enum(["USB", "LSB", "CW", "AM", "FM", "RTTY", "DATA"]);

export const FilterWidthSchema = z.enum(["narrow", "normal", "wide"]);
export type FilterWidth = z.infer<typeof FilterWidthSchema>;

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
export const TuneMessage = z.object({
  type: z.literal("tune"),
  freqKHz: z.number().positive(),
  mode: ModeSchema,
  txFreqKHz: z.number().positive().optional(),
  filterWidth: FilterWidthSchema.optional(),
});

/** Client -> server: push-to-talk state changed. */
export const PttMessage = z.object({
  type: z.literal("ptt"),
  active: z.boolean(),
});

export const ClientMessage = z.discriminatedUnion("type", [
  HelloMessage,
  TuneMessage,
  PttMessage,
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

export const ErrorMessage = z.object({
  type: z.literal("error"),
  message: z.string(),
});

export const ServerMessage = z.discriminatedUnion("type", [
  WelcomeMessage,
  RosterMessage,
  MeterMessage,
  BandEventMessage,
  ErrorMessage,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;
