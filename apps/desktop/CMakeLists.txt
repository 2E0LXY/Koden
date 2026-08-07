cmake_minimum_required(VERSION 3.22)
project(KodenDesktop VERSION 0.1.0 LANGUAGES CXX C)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(FetchContent)

# Pinned to known-good release tags rather than a moving branch so the build
# is reproducible -- bump deliberately, not by surprise on a future clone.
FetchContent_Declare(
  JUCE
  GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
  GIT_TAG 8.0.15
  GIT_SHALLOW TRUE
)

set(USE_TLS ON CACHE BOOL "" FORCE)
set(BUILD_DEMO OFF CACHE BOOL "" FORCE)
set(BUILD_TESTS OFF CACHE BOOL "" FORCE)
FetchContent_Declare(
  IXWebSocket
  GIT_REPOSITORY https://github.com/machinezone/IXWebSocket.git
  GIT_TAG v12.0.1
  GIT_SHALLOW TRUE
)

FetchContent_MakeAvailable(JUCE IXWebSocket)

# --- koden_net: platform-neutral protocol + WebSocket client -------------
# No GUI/audio deps -- links only juce_core (JSON) and ixwebsocket, so it
# builds and is testable in a plain headless environment (no display, no
# audio device required), independent of the JUCE GUI/audio app below.
add_library(koden_net STATIC
  src/protocol/Protocol.cpp
  src/net/KodenSocket.cpp
)
target_include_directories(koden_net PUBLIC src)
target_link_libraries(koden_net PUBLIC juce::juce_core ixwebsocket)
target_compile_definitions(koden_net PUBLIC
  JUCE_STANDALONE_APPLICATION=1
  # We use IXWebSocket for networking, not JUCE's own HTTP stack -- avoids
  # pulling in a libcurl link dependency for JUCE's WebInputStream/URL
  # classes, which this library never calls.
  JUCE_USE_CURL=0
)

# --- koden_net_smoketest: headless console verification -------------------
# Connects to a real Koden server and exercises the hello/welcome/roster/
# settings handshake with no GUI or audio device involved -- this is the
# part of the native client we can actually verify automatically in CI or a
# sandboxed build environment.
add_executable(koden_net_smoketest src/net/smoketest_main.cpp)
target_link_libraries(koden_net_smoketest PRIVATE koden_net)

# --- KodenDesktop: minimal GUI shell (phase 1 -- status/roster only) -----
# No audio engine yet; proves the GUI-to-network wiring compiles and links.
# See README.md in this directory for what's implemented vs. still to come.
juce_add_gui_app(KodenDesktop
  PRODUCT_NAME "Koden Desktop"
  COMPANY_NAME "Koden"
)

target_sources(KodenDesktop PRIVATE
  src/Main.cpp
  src/MainComponent.cpp
)

target_compile_definitions(KodenDesktop PRIVATE
  JUCE_WEB_BROWSER=0
  JUCE_APPLICATION_NAME_STRING="$<TARGET_PROPERTY:KodenDesktop,JUCE_PRODUCT_NAME>"
  JUCE_APPLICATION_VERSION_STRING="$<TARGET_PROPERTY:KodenDesktop,JUCE_VERSION>"
)

target_link_libraries(KodenDesktop PRIVATE
  koden_net
  juce::juce_gui_extra
  juce::juce_audio_utils
  juce::juce_recommended_config_flags
  juce::juce_recommended_lto_flags
)
