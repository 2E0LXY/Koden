// Headless verification for the native network/protocol layer: connects to
// a real Koden server, performs the hello handshake, and confirms the
// welcome/roster/settings replies arrive and parse correctly. No GUI or
// audio device involved, so this runs in any sandboxed/CI environment --
// unlike the KodenDesktop GUI app, which needs a real display to verify
// visually.
//
// Usage: koden_net_smoketest [wss://host/ws] [callsign] [grid]

#include "KodenSocket.h"
#include <atomic>
#include <chrono>
#include <cstdio>
#include <thread>

int main(int argc, char** argv)
{
    juce::String url = argc > 1 ? juce::String(argv[1]) : juce::String("wss://kodenradio.uk/ws");
    juce::String callsign = argc > 2 ? juce::String(argv[2]) : juce::String("M0JUCE");
    juce::String grid = argc > 3 ? juce::String(argv[3]) : juce::String("IO91WM");

    std::printf("Connecting to %s as %s (%s)...\n", url.toRawUTF8(), callsign.toRawUTF8(), grid.toRawUTF8());

    std::atomic<bool> gotWelcome { false };
    std::atomic<bool> gotRoster { false };
    std::atomic<bool> gotSettings { false };
    std::atomic<int> stationCount { 0 };

    koden::KodenSocket socket(url);

    socket.onStatus([&](bool connected) {
        std::printf("[status] %s\n", connected ? "connected" : "disconnected");
        if (connected)
            socket.sendHello(callsign, grid);
    });

    socket.onServerMessage([&](const koden::ServerMessage& msg) {
        using T = koden::ServerMessageType;
        switch (msg.type)
        {
            case T::welcome:
                std::printf("[welcome] id=%s serverTimeMs=%.0f\n", msg.id.toRawUTF8(), msg.serverTimeMs);
                gotWelcome = true;
                break;
            case T::roster:
                stationCount = static_cast<int>(msg.stations.size());
                std::printf("[roster] %d station(s):", stationCount.load());
                for (auto& s : msg.stations)
                    std::printf(" %s(%s)", s.callsign.toRawUTF8(), s.id.toRawUTF8());
                std::printf("\n");
                gotRoster = true;
                break;
            case T::settings:
                std::printf("[settings] saved profile found: %s\n", msg.hasSettings ? "yes" : "no");
                gotSettings = true;
                break;
            case T::solar:
                std::printf("[solar] sfi=%.0f kp=%.1f\n", msg.sfi, msg.kp);
                break;
            case T::error:
                std::printf("[error] %s\n", msg.message.toRawUTF8());
                break;
            default:
                break;
        }
    });

    socket.connect();

    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(10);
    while (std::chrono::steady_clock::now() < deadline && !(gotWelcome && gotRoster && gotSettings))
        std::this_thread::sleep_for(std::chrono::milliseconds(50));

    socket.close();

    bool ok = gotWelcome && gotRoster && gotSettings;
    std::printf("\n%s: welcome=%d roster=%d(%d stations) settings=%d\n",
                ok ? "PASS" : "FAIL",
                gotWelcome.load(), gotRoster.load(), stationCount.load(), gotSettings.load());
    return ok ? 0 : 1;
}
