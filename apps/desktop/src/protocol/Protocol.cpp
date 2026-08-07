#include "Protocol.h"

namespace koden {

namespace {

juce::String toJson(juce::DynamicObject::Ptr obj)
{
    return juce::JSON::toString(juce::var(obj.get()), true);
}

} // namespace

ServerMessage parseServerMessage(const juce::String& json)
{
    ServerMessage msg;

    auto parsed = juce::JSON::parse(json);
    if (!parsed.isObject())
        return msg;

    auto type = parsed.getProperty("type", juce::var()).toString();

    if (type == "welcome")
    {
        msg.type = ServerMessageType::welcome;
        msg.id = parsed.getProperty("id", "").toString();
        msg.serverTimeMs = static_cast<double>(parsed.getProperty("serverTimeMs", 0.0));
    }
    else if (type == "roster")
    {
        msg.type = ServerMessageType::roster;
        if (auto* arr = parsed.getProperty("stations", juce::var()).getArray())
        {
            for (auto& s : *arr)
            {
                StationInfo st;
                st.id = s.getProperty("id", "").toString();
                st.callsign = s.getProperty("callsign", "").toString();
                st.grid = s.getProperty("grid", "").toString();
                st.freqKHz = static_cast<double>(s.getProperty("freqKHz", 0.0));
                st.txFreqKHz = static_cast<double>(s.getProperty("txFreqKHz", 0.0));
                st.mode = s.getProperty("mode", "").toString();
                st.transmitting = static_cast<bool>(s.getProperty("transmitting", false));
                st.antenna = s.getProperty("antenna", "").toString();
                st.headingDeg = static_cast<double>(s.getProperty("headingDeg", 0.0));
                msg.stations.push_back(std::move(st));
            }
        }
    }
    else if (type == "meter")
    {
        msg.type = ServerMessageType::meter;
        msg.sMeterDb = static_cast<double>(parsed.getProperty("sMeterDb", 0.0));
        msg.noiseFloorDb = static_cast<double>(parsed.getProperty("noiseFloorDb", 0.0));
        if (auto* arr = parsed.getProperty("audibleStationIds", juce::var()).getArray())
            for (auto& id : *arr)
                msg.audibleStationIds.push_back(id.toString());
    }
    else if (type == "solar")
    {
        msg.type = ServerMessageType::solar;
        msg.sfi = static_cast<double>(parsed.getProperty("sfi", 0.0));
        msg.kp = static_cast<double>(parsed.getProperty("kp", 0.0));
    }
    else if (type == "band_event")
    {
        msg.type = ServerMessageType::bandEvent;
        msg.bandEventKind = parsed.getProperty("kind", "").toString();
        msg.bandId = parsed.getProperty("bandId", "").toString();
        msg.message = parsed.getProperty("message", "").toString();
    }
    else if (type == "error")
    {
        msg.type = ServerMessageType::error;
        msg.message = parsed.getProperty("message", "").toString();
    }
    else if (type == "settings")
    {
        msg.type = ServerMessageType::settings;
        auto settingsVar = parsed.getProperty("settings", juce::var());
        msg.hasSettings = !settingsVar.isVoid() && !settingsVar.isUndefined() && settingsVar.toString() != "null";
        msg.settingsRaw = settingsVar;
    }

    return msg;
}

juce::String encodeHello(const juce::String& callsign, const juce::String& grid)
{
    auto obj = new juce::DynamicObject();
    obj->setProperty("type", "hello");
    obj->setProperty("callsign", callsign);
    obj->setProperty("grid", grid);
    return toJson(obj);
}

juce::String encodeTune(double freqKHz, const juce::String& mode, std::optional<double> txFreqKHz, std::optional<juce::String> filterWidth)
{
    auto obj = new juce::DynamicObject();
    obj->setProperty("type", "tune");
    obj->setProperty("freqKHz", freqKHz);
    obj->setProperty("mode", mode);
    if (txFreqKHz)
        obj->setProperty("txFreqKHz", *txFreqKHz);
    if (filterWidth)
        obj->setProperty("filterWidth", *filterWidth);
    return toJson(obj);
}

juce::String encodePtt(bool active)
{
    auto obj = new juce::DynamicObject();
    obj->setProperty("type", "ptt");
    obj->setProperty("active", active);
    return toJson(obj);
}

juce::String encodeAntenna(const juce::String& antenna, double headingDeg)
{
    auto obj = new juce::DynamicObject();
    obj->setProperty("type", "antenna");
    obj->setProperty("antenna", antenna);
    obj->setProperty("headingDeg", headingDeg);
    return toJson(obj);
}

juce::String encodeProfile(const juce::String& callsign, const juce::String& grid)
{
    auto obj = new juce::DynamicObject();
    obj->setProperty("type", "profile");
    obj->setProperty("callsign", callsign);
    obj->setProperty("grid", grid);
    return toJson(obj);
}

juce::String encodePower(double watts)
{
    auto obj = new juce::DynamicObject();
    obj->setProperty("type", "power");
    obj->setProperty("watts", watts);
    return toJson(obj);
}

juce::String encodeSwr(double swr)
{
    auto obj = new juce::DynamicObject();
    obj->setProperty("type", "swr");
    obj->setProperty("swr", swr);
    return toJson(obj);
}

} // namespace koden
