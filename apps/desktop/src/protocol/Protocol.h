#pragma once

// Mirrors packages/shared/src/protocol.ts. Deliberately not a 1:1 port of
// every field yet -- only what the phase-1 network/status vertical slice
// needs (hello/welcome/roster/settings/error/solar/band_event). `tune`,
// `ptt`, `antenna`, `profile`, `power`, `swr`, and `save_settings` encoders
// are included since they're cheap (plain JSON building) and unblock the
// audio-engine phase later; the full `Settings` schema itself is not yet
// modeled here -- see the "settings" case in ServerMessage below.

#include <juce_core/juce_core.h>
#include <optional>
#include <string>
#include <vector>

namespace koden {

struct StationInfo
{
    juce::String id;
    juce::String callsign;
    juce::String grid;
    double freqKHz = 0.0;
    double txFreqKHz = 0.0;
    juce::String mode;
    bool transmitting = false;
    juce::String antenna;
    double headingDeg = 0.0;

    bool operator==(const StationInfo& other) const
    {
        return id == other.id && callsign == other.callsign && grid == other.grid
               && freqKHz == other.freqKHz && txFreqKHz == other.txFreqKHz && mode == other.mode
               && transmitting == other.transmitting && antenna == other.antenna && headingDeg == other.headingDeg;
    }
    bool operator!=(const StationInfo& other) const { return !(*this == other); }
};

enum class ServerMessageType
{
    unknown,
    welcome,
    roster,
    meter,
    solar,
    bandEvent,
    error,
    settings
};

/**
 * A tagged union of every server->client message. Only the fields relevant
 * to `type` are populated; the rest are left at their defaults. `settings`
 * carries the raw parsed JSON (`settingsRaw`) rather than a typed struct --
 * the desktop client doesn't do anything with saved settings yet.
 */
struct ServerMessage
{
    ServerMessageType type = ServerMessageType::unknown;

    // welcome
    juce::String id;
    double serverTimeMs = 0.0;

    // roster
    std::vector<StationInfo> stations;

    // meter
    double sMeterDb = 0.0;
    double noiseFloorDb = 0.0;
    std::vector<juce::String> audibleStationIds;

    // solar
    double sfi = 0.0;
    double kp = 0.0;

    // band_event
    juce::String bandEventKind;
    juce::String bandId;

    // error / band_event message text
    juce::String message;

    // settings (unparsed -- see comment above)
    juce::var settingsRaw;
    bool hasSettings = false;
};

/** Parses one JSON text WS frame into a ServerMessage. Returns `unknown` type on any malformed input, matching the client's "ignore malformed server messages" behavior. */
ServerMessage parseServerMessage(const juce::String& json);

juce::String encodeHello(const juce::String& callsign, const juce::String& grid);
juce::String encodeTune(double freqKHz, const juce::String& mode, std::optional<double> txFreqKHz, std::optional<juce::String> filterWidth);
juce::String encodePtt(bool active);
juce::String encodeAntenna(const juce::String& antenna, double headingDeg);
juce::String encodeProfile(const juce::String& callsign, const juce::String& grid);
juce::String encodePower(double watts);
juce::String encodeSwr(double swr);

} // namespace koden
