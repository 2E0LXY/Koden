import { useEffect, useState, type ReactNode } from "react";

interface HelpModalProps {
  onClose: () => void;
}

interface HelpSection {
  id: string;
  title: string;
  content: ReactNode;
}

const SECTIONS: HelpSection[] = [
  {
    id: "getting-started",
    title: "Getting Started",
    content: (
      <>
        <p>
          Koden is a multiplayer virtual HF transceiver: everyone connected shares the same simulated
          radio spectrum, complete with real propagation, band noise, and fading -- so what you hear
          depends on your frequency, mode, antenna, and grid square, exactly like a real rig.
        </p>
        <img className="help-modal__img" src="/help/join-form.png" alt="The join screen, asking for a callsign and grid locator" />
        <ol>
          <li>
            Enter a <strong>callsign</strong> (any short handle works, but a real-format one like
            <code>M0EXAMPLE</code> fits the theme) and a <strong>grid locator</strong> (Maidenhead
            format, e.g. <code>IO91WM</code> -- your grid determines your position on the world map and
            your real distance/bearing to every other station).
          </li>
          <li>
            Click <strong>Power On</strong>. Your browser will ask for microphone permission -- allow
            it, since transmitting uses your real mic.
          </li>
          <li>
            Your callsign and grid, and every knob/setting you touch afterward, are saved automatically
            on the server under your callsign, so logging back in with the same callsign (from any
            browser or device) restores your whole setup.
          </li>
        </ol>
      </>
    ),
  },
  {
    id: "panel-overview",
    title: "Panel Overview",
    content: (
      <>
        <p>The panel mirrors a real dual-VFO HF transceiver. Everything below is covered in its own section -- this is just the map.</p>
        <img className="help-modal__img" src="/help/full-panel.png" alt="The full Koden radio panel, labeled by area" />
        <ul>
          <li><strong>Top-left:</strong> POWER, TUNER, MONI, VOX, MOX, and the PTT bar.</li>
          <li><strong>Top-center:</strong> the LCD display -- S-meter/SWR/COMP/watt meters, frequency readout, waterfall, and the memory bank.</li>
          <li><strong>Top-right:</strong> nameplate, AF GAIN/RF GAIN/SQL knobs, and the direct frequency entry keypad.</li>
          <li><strong>Button row:</strong> MENU, DISP, SCOPE, and the receiver's ATT/IPO/NB/NR/APF/NOTCH/R.FLT/CMP/DNR/AGC controls.</li>
          <li><strong>Lower-left:</strong> MIC GAIN/RF POWER/KEY SPEED knobs and the antenna + rotator compass.</li>
          <li><strong>Lower-center:</strong> mode buttons, tuning step buttons, the main VFO dial, and the band grid.</li>
          <li><strong>Lower-center, below that:</strong> Twin PBT, RIT/XIT/XFC, and Split Shift.</li>
          <li><strong>Lower-right:</strong> VFO/memory buttons (A/B, A&#8644;B, SPLIT, M.IN, M&gt;VFO, MW, VFO/M) and the IF WIDTH/NOTCH/PROC/MONI/VOX DELAY/VOX GAIN/AF&#8658;RF knobs.</li>
          <li><strong>Floating windows</strong> (drag by their title bar): <strong>Stations on Frequency</strong> (top-left) lists everyone connected; the <strong>world map</strong> (top-right) plots them geographically.</li>
        </ul>
      </>
    ),
  },
  {
    id: "tuning",
    title: "Tuning & VFOs",
    content: (
      <>
        <img className="help-modal__img" src="/help/display-closeup.png" alt="The frequency display and memory bank" />
        <ul>
          <li><strong>Main dial:</strong> drag vertically, or scroll the mouse wheel over it, to tune.</li>
          <li>
            <strong>Frequency readout:</strong> scroll the wheel over it to tune by the current step size,
            or click directly on a digit to select it as the step size (click it again to deselect).
          </li>
          <li><strong>Step buttons</strong> (FINE/COARSE, plus the &#9650;/&#9660; arrows): cycle the tuning step from 10Hz up to 10kHz per click/scroll.</li>
          <li><strong>Direct entry:</strong> the numeric keypad (top-right) types a frequency in MHz directly -- digits, a decimal point, backspace, and ENT.</li>
          <li><strong>Mode buttons</strong> (LSB/USB/CW/AM/FM/DIG:DATA): select the demodulation mode. AGC automatically switches to a sensible default time constant for the new mode (except FM, which isn't adjustable).</li>
          <li><strong>Band grid</strong> (160m&ndash;6m): jumps straight to a band, restoring whatever frequency/mode/ATT/IPO you last used there.</li>
          <li><strong>LOCK:</strong> freezes the VFO against accidental tuning.</li>
          <li><strong>SCAN:</strong> sweeps upward across the current band automatically; <strong>CLEAR</strong> resets RIT/XIT offset to zero.</li>
          <li><strong>A.TUNE</strong> (CW mode only): snaps to the nearest audible CW signal within &plusmn;500Hz.</li>
        </ul>
      </>
    ),
  },
  {
    id: "dual-vfo",
    title: "Dual VFO, RIT/XIT & Split",
    content: (
      <>
        <p>Koden has two independent VFOs (A and B), like a real dual-VFO rig, plus the classic RIT/XIT/Twin-PBT cluster:</p>
        <ul>
          <li><strong>A/B:</strong> switches which VFO is the active (displayed/tuned) one.</li>
          <li><strong>A&#8644;B:</strong> copies the active VFO's frequency/mode onto the other one.</li>
          <li><strong>SPLIT:</strong> transmits on VFO B while listening on VFO A (or vice versa) -- the classic DX-pileup technique. The <strong>SPLIT SHIFT</strong> knob sets the offset between them directly.</li>
          <li><strong>RIT</strong> (Receiver Incremental Tuning): offsets what you <em>hear</em> without moving your transmit frequency. Toggle it on, then use the <strong>OFFSET</strong> knob.</li>
          <li><strong>XIT</strong> (Transmitter Incremental Tuning): the mirror image -- offsets what you <em>transmit</em> without moving your receive frequency. Shares the same OFFSET knob as RIT (only one is active at a time).</li>
          <li><strong>XFC</strong> (held): temporarily switches your receiver to monitor your actual transmit frequency, so you can check it's clear before calling -- release to go back to normal receive.</li>
          <li>
            <strong>Twin PBT</strong> (PBT1/PBT2 knobs): a real dual-control passband tuning setup. Turning
            both knobs the <em>same</em> direction shifts the whole passband (handy for dodging an
            interfering signal to one side); turning them <em>opposite</em> directions narrows the
            passband from both edges at once (handy for splitting two closely-spaced signals apart).
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "memory",
    title: "Memory Channels",
    content: (
      <>
        <p>Ten memory channels (0&ndash;9), shown as the row of buttons under the display:</p>
        <ul>
          <li><strong>Tap</strong> a memory button to recall it into the working VFO.</li>
          <li><strong>Press and hold</strong> a memory button (or right-click it) to program the current VFO's frequency/mode into that slot.</li>
          <li><strong>M.IN:</strong> programs the currently-selected memory slot from the working VFO (same effect as holding that slot's button).</li>
          <li><strong>M&gt;VFO:</strong> recalls the currently-selected memory into the working VFO and switches back to VFO mode.</li>
          <li><strong>VFO/M:</strong> toggles between VFO mode (the main dial tunes normally) and Memory mode (the dial instead browses between your programmed memory channels).</li>
          <li><strong>MW:</strong> memory scan -- automatically cycles through every programmed (non-empty) memory channel.</li>
        </ul>
      </>
    ),
  },
  {
    id: "receiver",
    title: "Receiver Controls",
    content: (
      <>
        <img className="help-modal__img" src="/help/receiver-buttons.png" alt="The receiver control button row" />
        <ul>
          <li><strong>AF GAIN / RF GAIN / SQL:</strong> volume, receiver sensitivity, and squelch threshold (0 = squelch always open).</li>
          <li><strong>AGC</strong> (OFF/FAST/MID/SLOW): how quickly the receiver compresses strong-to-weak signal swings into a comfortable listening range.</li>
          <li><strong>ATT:</strong> front-end attenuator, for handling very strong nearby signals. <strong>IPO:</strong> bypasses the preamp (less gain, better strong-signal handling) -- both visibly pull the S-meter down when engaged, just like a real front end.</li>
          <li><strong>NB</strong> (noise blanker) and <strong>NR</strong> (noise reduction): reduce impulse noise and background hiss respectively; <strong>DNR</strong> stacks extra digital noise reduction on top of NR.</li>
          <li><strong>NOTCH:</strong> cycles Auto Notch (AN, continuously hunts down and nulls a whistling interfering tone) &rarr; Manual Notch (MN, set the frequency/depth yourself with the NOTCH knob) &rarr; off. The <strong>WIDTH</strong> button next to it cycles the notch's width (WIDE/MID/NAR).</li>
          <li><strong>APF</strong> (Audio Peak Filter): a narrow peaking boost around 700Hz that makes CW tones easier to pick out of noise.</li>
          <li><strong>R.FLT</strong> (roofing filter): cycles the IF bandwidth narrow/normal/wide, trading selectivity against audio fullness. <strong>IF WIDTH</strong> (knob, lower-right cluster) is the finer-grained version of the same idea.</li>
          <li><strong>AF&#8658;RF</strong> (knob): a balance trim applied to both AF and RF gain together.</li>
        </ul>
      </>
    ),
  },
  {
    id: "transmit",
    title: "Transmitting",
    content: (
      <>
        <img className="help-modal__img" src="/help/quick-controls.png" alt="POWER, TUNER, MONI, VOX, MOX, and PTT buttons" />
        <ul>
          <li><strong>PTT:</strong> press and hold to transmit, like a real microphone's push-to-talk bar -- release to receive again.</li>
          <li><strong>MOX:</strong> manual transmit toggle -- click once to key up, click again to unkey, without holding anything down.</li>
          <li><strong>VOX:</strong> voice-activated transmit -- starts transmitting automatically when you speak. <strong>VOX GAIN</strong> sets how sensitive it is; <strong>VOX DELAY</strong> sets how long it stays keyed after you stop talking (the "hang time").</li>
          <li><strong>MIC GAIN:</strong> microphone input level. <strong>RF POWER:</strong> transmit power in watts (0.5&ndash;200W) -- this is real, in that other stations' received signal strength from you actually depends on it.</li>
          <li><strong>CMP</strong> (speech processor) + <strong>PROC</strong> knob: compresses your voice for more consistent punch, like a real processor -- watch the COMP meter for gain reduction.</li>
          <li><strong>MONI</strong> + its level knob: sidetone -- lets you hear your own processed transmit audio locally while keyed.</li>
          <li><strong>KEY SPEED:</strong> a cosmetic panel control (matches the real rig's layout); Koden doesn't include an automatic CW keyer, so CW mode is really just a different audio character on your mic'd voice/tone rather than true Morse keying.</li>
          <li><strong>TUNER:</strong> runs a simulated antenna tuner sequence and settles your SWR near 1:1 -- watch the SWR bar chatter and settle, same as a real ATU.</li>
        </ul>
      </>
    ),
  },
  {
    id: "antenna",
    title: "Antenna & Rotator",
    content: (
      <>
        <img className="help-modal__img" src="/help/rotator-compass.png" alt="The rotator compass with tick marks and CW/CCW buttons" />
        <p>Six antenna types, selected from the grid of buttons: Longwire, Vertical, Dipole, G5RV, and 2/3/5-element Yagi beams. Each has a different gain pattern:</p>
        <ul>
          <li>Longwire/Vertical/Dipole/G5RV are omnidirectional (heading doesn't matter) but differ in overall gain.</li>
          <li>
            The Yagi beams are <strong>directional</strong> -- heading matters. A rotatable beam has to
            actually be pointed at the real bearing to a station (computed from your grid square) to get
            full gain; aimed the wrong way, a weak station can drop below audibility entirely, exactly
            like working real DX.
          </li>
          <li>Drag the compass dial directly to set a heading, or use the <strong>CW &#9656; / &#9666; CCW</strong> buttons -- tap for a 5&deg; nudge, or press and hold to slew continuously all the way around.</li>
          <li>Click any station's dot on the compass (or on the world map) to automatically point the beam at it.</li>
          <li>Stations currently transmitting flash on both the compass and the world map, so an active QSO is obvious at a glance.</li>
        </ul>
      </>
    ),
  },
  {
    id: "meters-waterfall",
    title: "Meters & Waterfall",
    content: (
      <>
        <ul>
          <li><strong>S-meter:</strong> received signal strength, calibrated in real S-units (6dB per S-unit).</li>
          <li><strong>SWR:</strong> antenna match -- worsens whenever you change bands until you run the TUNER.</li>
          <li><strong>COMP:</strong> live gain-reduction from the speech processor while transmitting.</li>
          <li><strong>WATT:</strong> live transmit power envelope, following your actual voice peaks.</li>
          <li>
            <strong>Waterfall/panadapter:</strong> shows the band around your tuned frequency, with every
            other station plotted at their real frequency offset. Click anywhere on it to tune there
            directly. <strong>SPAN</strong> zooms in/out, <strong>CENT/FIX</strong> switches between the
            tuned frequency always staying centered vs. a fixed window you scroll within,{" "}
            <strong>HOLD</strong> freezes a peak-hold trace, <strong>REF</strong> adjusts the display's
            reference gain, and <strong>SPEED</strong> controls how fast it scrolls.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "stations",
    title: "On-Air Stations",
    content: (
      <>
        <p>A few always-on fixed stations, useful for calibrating your setup or just for atmosphere:</p>
        <ul>
          <li><strong>BEACON</strong> &mdash; 7000.0 kHz CW. A steady reference signal, handy for checking your CW mode/AGC/notch behavior.</li>
          <li><strong>PARROT</strong> &mdash; 50999.9 kHz. An echo test: transmit, and it plays your own audio back so you can hear exactly how you sound over the air (mic gain, processor, etc.).</li>
          <li><strong>TIME SIG</strong> &mdash; 14100.0 kHz USB. A WWV-style time station with tick marks and a minute announcement.</li>
          <li><strong>VOLMET</strong> &mdash; 18100.0 kHz USB. A droning aviation-weather-style announcer, for background atmosphere.</li>
          <li>
            A <strong>numbers station</strong> exists too, deliberately not listed anywhere -- like the
            real thing, it's only ever found by tuning around.
          </li>
          <li>
            <strong>M0AI</strong> &mdash; 14275.0 kHz USB. A live AI-operated station (built on a
            real-time voice model, not scripted playback), based in Leeds, UK. Tune in, key up, and call
            it like a real DX station ("CQ CQ, this is [your callsign], calling M0AI, over") -- it
            answers one caller at a time, pileup-style, following real amateur radio etiquette (proper
            phonetics, RS signal reports, waiting your turn). It's location- and antenna-aware just like
            any other station: a beam has to actually be pointed at Leeds to work it well.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "settings",
    title: "Settings & Persistence",
    content: (
      <>
        <p>
          Click <strong>MENU</strong> to open the settings overlay: edit your callsign/grid, pick a
          specific microphone or speaker device, and toggle UI sound effects (clicks, beeps, relay
          clunks) on or off.
        </p>
        <p>
          Every setting -- both VFOs, all ten memory channels, every receiver/transmit knob, your
          antenna and heading, device selections -- is saved automatically to the server under your
          callsign a moment after you change it. Log back in later with the same callsign, from any
          browser or computer, and it's all restored exactly as you left it.
        </p>
      </>
    ),
  },
  {
    id: "tips",
    title: "Tips & Troubleshooting",
    content: (
      <ul>
        <li>
          <strong>No audio / other stations can't hear you:</strong> check your browser actually granted
          microphone permission (look for a mic icon in the address bar), and that PTT/MOX/VOX is
          actually engaged (the TX indicator should light up) while you talk.
        </li>
        <li>
          <strong>Can't hear anything:</strong> check AF GAIN isn't at zero, SQL isn't set above the
          signal you're trying to hear, and that you're tuned within a station's actual passband.
        </li>
        <li>
          <strong>A weak/directional station won't come through:</strong> if you're on a Yagi beam,
          confirm the compass is actually pointed at that station's bearing -- a badly-aimed beam can
          genuinely drop a signal below audibility.
        </li>
        <li>
          This is a shared, multiplayer simulation -- other real people's stations, transmissions, and
          antenna choices all affect what you hear, the same as a real, busy HF band.
        </li>
        <li>Find the UI sound effects distracting? Turn them off from the MENU overlay's SFX toggle.</li>
      </ul>
    ),
  },
];

export function HelpModal({ onClose }: HelpModalProps) {
  const [activeId, setActiveId] = useState(SECTIONS[0].id);
  const active = SECTIONS.find((s) => s.id === activeId) ?? SECTIONS[0];

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="help-modal__backdrop" onClick={onClose}>
      <div className="help-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Koden help">
        <div className="help-modal__header">
          <h2 className="help-modal__title">KODEN DX-9000 &mdash; Operator&apos;s Manual</h2>
          <button className="help-modal__close" onClick={onClose} title="Close" aria-label="Close help">
            &times;
          </button>
        </div>
        <div className="help-modal__body">
          <nav className="help-modal__nav">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                className={`help-modal__nav-item ${s.id === activeId ? "help-modal__nav-item--active" : ""}`}
                onClick={() => setActiveId(s.id)}
              >
                {s.title}
              </button>
            ))}
          </nav>
          <div className="help-modal__content">
            <h3>{active.title}</h3>
            {active.content}
          </div>
        </div>
      </div>
    </div>
  );
}
