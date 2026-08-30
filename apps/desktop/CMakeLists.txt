cmake_minimum_required(VERSION 3.22)
project(KodenDesktop VERSION 0.1.0 LANGUAGES CXX C)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Static MSVC runtime for every target in this build, not just the final
# executable -- must be set before any target exists (including JUCE's and
# IXWebSocket's own, created later via FetchContent) for CMake's CMP0091
# NEW behavior (default here since cmake_minimum_required is well past
# 3.15) to apply it uniformly. Setting this only on the KodenDesktop target
# itself, further down, left every fetched dependency on CMake's default
# dynamic runtime (/MD) instead -- a guaranteed LNK2038 runtime-library
# mismatch the first time a static-runtime executable links against a
# dynamic-runtime .lib, not something introduced by any particular TLS
# backend choice.
if (WIN32)
  set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
endif()

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
# IXWebSocket has no Windows-native TLS backend -- left to its own defaults
# it picks MbedTLS on Windows, which needs `find_package(MbedTLS)` to
# succeed against a system install that plain windows-latest doesn't have
# (Configure fails with "Could NOT find MbedTLS"). OpenSSL is the one TLS
# backend GitHub's Windows runner images pre-install specifically for
# CMake's find_package(OpenSSL) to pick up, so request it explicitly here
# rather than letting IXWebSocket fall through to its Windows default.
if (WIN32)
  set(USE_OPEN_SSL ON CACHE BOOL "" FORCE)
  # IXWebSocket's USE_ZLIB defaults on regardless of platform (for the
  # optional permessage-deflate compression extension) and unconditionally
  # requires find_package(ZLIB) when enabled. zlib comes for free as part of
  # the Linux build's system libraries, but plain windows-latest has no
  # zlib to find, and installing one is unwarranted complexity just to
  # negotiate an optional extension -- the client and server still talk
  # fine uncompressed.
  set(USE_ZLIB OFF CACHE BOOL "" FORCE)
endif()
set(BUILD_DEMO OFF CACHE BOOL "" FORCE)
# IXWebSocket's own test suite is gated by USE_TEST, not BUILD_TESTS -- it
# defaults off already, but set the real variable so this stays true if that
# default ever changes upstream.
set(USE_TEST OFF CACHE BOOL "" FORCE)
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

# --- Packaging: a real "download and run" artifact per platform ----------
# Debian: a proper .deb (dpkg-shlibdeps auto-detects the ALSA/X11/OpenSSL/
# etc. runtime deps this binary actually dynamically links against, so the
# package declares correct Depends: instead of a hand-maintained guess).
# Windows: a zip of the exe -- built with the static MSVC runtime (set
# globally near the top of this file) so it doesn't also require installing
# the VC++ redistributable.

# JUCE names the built binary after PRODUCT_NAME ("Koden Desktop", with a
# space) -- fine for a window title, awkward for an installed /usr/bin
# entry and the .desktop launcher's Exec= line, so give the file itself a
# plain lowercase-hyphen name without touching the displayed title.
set_target_properties(KodenDesktop PROPERTIES OUTPUT_NAME "koden-desktop")

# JUCE's own CMakeLists registers install() rules for juceaide and its full
# module source tree (it supports being installed as an SDK) -- those get
# swept into our install tree too via FetchContent, so everything we
# actually want to ship is tagged with its own component and CPack is told
# to package only that component, not "everything install() touched".
install(TARGETS KodenDesktop RUNTIME DESTINATION bin COMPONENT koden_desktop_runtime)

if (UNIX AND NOT APPLE)
  install(FILES packaging/koden-desktop.desktop DESTINATION share/applications COMPONENT koden_desktop_runtime)
endif()

set(CPACK_COMPONENTS_ALL koden_desktop_runtime)
set(CPACK_DEB_COMPONENT_INSTALL ON)
set(CPACK_ARCHIVE_COMPONENT_INSTALL ON)

set(CPACK_PACKAGE_NAME "koden-desktop")
set(CPACK_PACKAGE_VERSION ${PROJECT_VERSION})
set(CPACK_PACKAGE_VENDOR "Koden")
set(CPACK_PACKAGE_DESCRIPTION_SUMMARY "Native desktop client for the Koden virtual HF radio simulator")
set(CPACK_PACKAGE_HOMEPAGE_URL "https://kodenradio.uk/")

if (UNIX AND NOT APPLE)
  set(CPACK_GENERATOR "DEB")
  set(CPACK_PACKAGING_INSTALL_PREFIX "/usr")
  set(CPACK_DEBIAN_PACKAGE_MAINTAINER "Koden Project <noreply@kodenradio.uk>")
  set(CPACK_DEBIAN_PACKAGE_SECTION "hamradio")
  set(CPACK_DEBIAN_PACKAGE_SHLIBDEPS ON)
  # JUCE's Linux backend dlopen()s X11 (and, once phase 2 adds real audio
  # device access, ALSA) rather than linking them directly, so dpkg-shlibdeps
  # can't see this dependency on its own -- listed explicitly and merged
  # with the auto-detected shlib deps above.
  set(CPACK_DEBIAN_PACKAGE_DEPENDS "libx11-6, libxext6, libxrandr2, libxinerama1, libxcursor1, libxrender1")
  set(CPACK_DEBIAN_FILE_NAME "DEB-DEFAULT")
  # Component-specific override so the single package we ship is still
  # named plain "koden-desktop", not "koden-desktop-koden-desktop-runtime".
  set(CPACK_DEBIAN_KODEN_DESKTOP_RUNTIME_PACKAGE_NAME "koden-desktop")
elseif (WIN32)
  set(CPACK_GENERATOR "ZIP")
  set(CPACK_ARCHIVE_KODEN_DESKTOP_RUNTIME_FILE_NAME "koden-desktop-${PROJECT_VERSION}-win64")
endif()

include(CPack)
