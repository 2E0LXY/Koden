#pragma once

#include "../protocol/Protocol.h"
#include <atomic>
#include <cstdint>
#include <functional>
#include <ixwebsocket/IXWebSocket.h>
#include <memory>
#include <vector>

namespace koden {

/**
 * Thin wrapper around ix::WebSocket speaking the Koden wire protocol: JSON
 * text frames for control messages, raw binary frames for 16-bit mono PCM
 * audio (see packages/shared/src/audio.ts for the frame constants). Mirrors
 * the role of packages/client/src/net/wsClient.ts.
 *
 * IXWebSocket delivers callbacks on its own background thread -- callers
 * that need to touch UI state (e.g. a JUCE Component) must hop back to
 * their own thread (juce::MessageManager::callAsync or a polled snapshot);
 * this class does not do that itself, matching how the browser client's
 * wsClient.ts also leaves that to its caller.
 */
class KodenSocket
{
public:
    using StatusHandler = std::function<void(bool connected)>;
    using ServerMessageHandler = std::function<void(const ServerMessage&)>;
    using AudioFrameHandler = std::function<void(const int16_t* samples, size_t count)>;

    explicit KodenSocket(juce::String url);
    ~KodenSocket();

    void connect();
    void close();

    void sendHello(const juce::String& callsign, const juce::String& grid);
    void sendTune(double freqKHz, const juce::String& mode, std::optional<double> txFreqKHz = std::nullopt, std::optional<juce::String> filterWidth = std::nullopt);
    void sendPtt(bool active);
    void sendAntenna(const juce::String& antenna, double headingDeg);
    void sendProfile(const juce::String& callsign, const juce::String& grid);
    void sendPower(double watts);
    void sendSwr(double swr);
    /** samples must be exactly FRAME_SAMPLES (see packages/shared/src/audio.ts) -- the server drops any frame of the wrong size. */
    void sendAudioFrame(const int16_t* samples, size_t count);

    void onStatus(StatusHandler h) { statusHandler = std::move(h); }
    void onServerMessage(ServerMessageHandler h) { messageHandler = std::move(h); }
    void onAudioFrame(AudioFrameHandler h) { audioHandler = std::move(h); }

private:
    void sendText(const juce::String& json);

    ix::WebSocket ws;
    StatusHandler statusHandler;
    ServerMessageHandler messageHandler;
    AudioFrameHandler audioHandler;
    std::atomic<bool> connected { false };
};

} // namespace koden
