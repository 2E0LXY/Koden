#include "KodenSocket.h"
#include <ixwebsocket/IXNetSystem.h>

namespace koden {

KodenSocket::KodenSocket(juce::String url)
{
    // No-op on Linux/macOS; required once before any socket use on Windows.
    ix::initNetSystem();
    ws.setUrl(url.toStdString());

    ws.setOnMessageCallback([this](const ix::WebSocketMessagePtr& msg) {
        switch (msg->type)
        {
            case ix::WebSocketMessageType::Open:
                connected = true;
                if (statusHandler)
                    statusHandler(true);
                break;
            case ix::WebSocketMessageType::Close:
            case ix::WebSocketMessageType::Error:
                connected = false;
                if (statusHandler)
                    statusHandler(false);
                break;
            case ix::WebSocketMessageType::Message:
                if (msg->binary)
                {
                    if (audioHandler)
                    {
                        auto count = msg->str.size() / sizeof(int16_t);
                        audioHandler(reinterpret_cast<const int16_t*>(msg->str.data()), count);
                    }
                }
                else if (messageHandler)
                {
                    // Malformed JSON is ignored, matching wsClient.ts's
                    // "ignore malformed server messages rather than crashing".
                    auto parsed = parseServerMessage(juce::String(msg->str));
                    if (parsed.type != ServerMessageType::unknown)
                        messageHandler(parsed);
                }
                break;
            default:
                break;
        }
    });
}

KodenSocket::~KodenSocket()
{
    close();
    // Pairs with initNetSystem() in the constructor -- no-op on Linux/macOS,
    // but on Windows leaves a WSAStartup call with no matching WSACleanup
    // otherwise (harmless for one long-lived instance since process exit
    // cleans it up regardless, but every additional KodenSocket built while
    // an earlier one still exists would otherwise leak one more).
    ix::uninitNetSystem();
}

void KodenSocket::connect()
{
    ws.start();
}

void KodenSocket::close()
{
    ws.stop();
}

void KodenSocket::sendText(const juce::String& json)
{
    if (connected)
        ws.send(json.toStdString());
}

void KodenSocket::sendHello(const juce::String& callsign, const juce::String& grid)
{
    sendText(encodeHello(callsign, grid));
}

void KodenSocket::sendTune(double freqKHz, const juce::String& mode, std::optional<double> txFreqKHz, std::optional<juce::String> filterWidth)
{
    sendText(encodeTune(freqKHz, mode, txFreqKHz, filterWidth));
}

void KodenSocket::sendPtt(bool active)
{
    sendText(encodePtt(active));
}

void KodenSocket::sendAntenna(const juce::String& antenna, double headingDeg)
{
    sendText(encodeAntenna(antenna, headingDeg));
}

void KodenSocket::sendProfile(const juce::String& callsign, const juce::String& grid)
{
    sendText(encodeProfile(callsign, grid));
}

void KodenSocket::sendPower(double watts)
{
    sendText(encodePower(watts));
}

void KodenSocket::sendSwr(double swr)
{
    sendText(encodeSwr(swr));
}

void KodenSocket::sendAudioFrame(const int16_t* samples, size_t count)
{
    if (!connected)
        return;
    ws.sendBinary(std::string(reinterpret_cast<const char*>(samples), count * sizeof(int16_t)));
}

} // namespace koden
