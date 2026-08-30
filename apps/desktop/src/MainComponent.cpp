#include "MainComponent.h"

namespace {
// TODO(phase 2): make this configurable from a setup screen, matching
// JoinForm.tsx's callsign/grid entry -- hardcoded for the phase-1 proof.
const juce::String kServerUrl = "wss://kodenradio.uk/ws";
const juce::String kCallsignBase = "M0JUCE";
const juce::String kGrid = "IO91WM";

// Two copies of this hardcoded identity would otherwise present as the
// literal same station to the server (and to each other) the moment both
// are connected -- e.g. running a second instance to test something while
// the first is still open. A random per-process suffix isn't a real
// identity system, just enough to stop that collision until phase 2's
// setup screen replaces this with a real one.
juce::String makeInstanceCallsign()
{
    return kCallsignBase + juce::String(juce::Random::getSystemRandom().nextInt(100));
}
} // namespace

MainComponent::MainComponent()
    : instanceCallsign(makeInstanceCallsign())
{
    titleLabel.setText("KODEN DESKTOP (phase 1: network status only)", juce::dontSendNotification);
    titleLabel.setFont(juce::Font(16.0f, juce::Font::bold));
    addAndMakeVisible(titleLabel);

    statusLabel.setText("Connecting...", juce::dontSendNotification);
    addAndMakeVisible(statusLabel);

    rosterList.setRowHeight(20);
    addAndMakeVisible(rosterList);

    setSize(480, 360);

    socket = std::make_unique<koden::KodenSocket>(kServerUrl);

    socket->onStatus([this](bool connected) {
        std::lock_guard<std::mutex> lock(snapshotMutex);
        snapshot.connected = connected;
        if (connected)
        {
            socket->sendHello(instanceCallsign, kGrid);
        }
        else
        {
            // Otherwise the last-known roster (including a station that may
            // still be shown mid-transmit) and settings state keep rendering
            // as current, live data for however long the reconnect takes --
            // stale ground truth presented with no visual distinction from
            // the real thing.
            snapshot.roster.clear();
            snapshot.settingsKnown = false;
            snapshot.hasSettings = false;
        }
    });

    socket->onServerMessage([this](const koden::ServerMessage& msg) {
        std::lock_guard<std::mutex> lock(snapshotMutex);
        using T = koden::ServerMessageType;
        if (msg.type == T::roster)
            snapshot.roster = msg.stations;
        else if (msg.type == T::settings)
        {
            snapshot.settingsKnown = true;
            snapshot.hasSettings = msg.hasSettings;
        }
    });

    socket->connect();
    startTimerHz(5);
}

MainComponent::~MainComponent()
{
    stopTimer();
}

void MainComponent::paint(juce::Graphics& g)
{
    g.fillAll(juce::Colours::black);
}

void MainComponent::resized()
{
    auto area = getLocalBounds().reduced(12);
    titleLabel.setBounds(area.removeFromTop(24));
    area.removeFromTop(6);
    statusLabel.setBounds(area.removeFromTop(24));
    area.removeFromTop(6);
    rosterList.setBounds(area);
}

void MainComponent::timerCallback()
{
    Snapshot copy;
    {
        std::lock_guard<std::mutex> lock(snapshotMutex);
        copy = snapshot;
    }

    juce::String status = copy.connected ? "Connected as " + instanceCallsign : "Disconnected";
    if (copy.settingsKnown)
        status << (copy.hasSettings ? "  |  saved profile loaded" : "  |  no saved profile");
    statusLabel.setText(status, juce::dontSendNotification);

    if (copy.roster != displayedRoster)
    {
        displayedRoster = copy.roster;
        rosterList.updateContent();
        rosterList.repaint();
    }
}

int MainComponent::RosterModel::getNumRows()
{
    return static_cast<int>(owner.displayedRoster.size());
}

void MainComponent::RosterModel::paintListBoxItem(int rowNumber, juce::Graphics& g, int width, int height, bool)
{
    if (rowNumber < 0 || rowNumber >= static_cast<int>(owner.displayedRoster.size()))
        return;
    const auto& s = owner.displayedRoster[static_cast<size_t>(rowNumber)];
    g.setColour(s.transmitting ? juce::Colours::orangered : juce::Colours::lightgrey);
    juce::String line = s.callsign + "  " + juce::String(s.txFreqKHz, 1) + " kHz  " + s.mode;
    if (s.transmitting)
        line << "  [TX]";
    g.drawText(line, 4, 0, width - 8, height, juce::Justification::centredLeft);
}
