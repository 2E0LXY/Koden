#pragma once

#include "net/KodenSocket.h"
#include <juce_gui_basics/juce_gui_basics.h>
#include <mutex>
#include <vector>

/**
 * Phase-1 GUI shell: proves the network layer wires up to a real JUCE
 * window and shows live connection status + roster. No radio panel, no
 * audio engine yet -- see apps/desktop/README.md for the roadmap.
 *
 * KodenSocket's callbacks fire on IXWebSocket's own background thread, so
 * this component never touches its member state directly from them --
 * instead it copies into a mutex-guarded snapshot and a juce::Timer on the
 * message thread polls it, which is the simplest correct way to bridge the
 * two threads for a read-mostly status display like this one.
 */
class MainComponent : public juce::Component,
                       private juce::Timer
{
public:
    MainComponent();
    ~MainComponent() override;

    void paint(juce::Graphics&) override;
    void resized() override;

private:
    void timerCallback() override;

    struct Snapshot
    {
        bool connected = false;
        std::vector<koden::StationInfo> roster;
        bool settingsKnown = false;
        bool hasSettings = false;
    };

    std::mutex snapshotMutex;
    Snapshot snapshot;

    // Generated once per process (see makeInstanceCallsign in the .cpp) and
    // reused across reconnects, so this instance's identity stays stable
    // for as long as it's running rather than changing on every reconnect.
    juce::String instanceCallsign;

    std::unique_ptr<koden::KodenSocket> socket;

    juce::Label titleLabel;
    juce::Label statusLabel;

    class RosterModel : public juce::ListBoxModel
    {
    public:
        explicit RosterModel(MainComponent& ownerIn) : owner(ownerIn) {}
        int getNumRows() override;
        void paintListBoxItem(int rowNumber, juce::Graphics&, int width, int height, bool rowIsSelected) override;

    private:
        MainComponent& owner;
    };

    RosterModel rosterModel { *this };
    juce::ListBox rosterList { "roster", &rosterModel };

    // Snapshot copy read by RosterModel::paintListBoxItem on the message
    // thread -- safe because it's only ever written by timerCallback, also
    // on the message thread.
    std::vector<koden::StationInfo> displayedRoster;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(MainComponent)
};
