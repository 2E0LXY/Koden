import { MeterBar } from "./MeterBar.js";

interface WattMeterProps {
  watts: number;
  transmitting: boolean;
}

/** Like a real RF wattmeter, this only deflects while actually keyed -- it sits at zero on receive. */
export function WattMeter({ watts, transmitting }: WattMeterProps) {
  const normalized = transmitting ? Math.max(0, Math.min(1, watts / 200)) : 0;
  return (
    <MeterBar
      label="WATT"
      value={normalized}
      colorAt={(pos) => (pos < 0.7 ? "#28d17c" : pos < 0.9 ? "#e8c73a" : "#e14b3a")}
      readout={transmitting ? `${Math.round(watts)}W` : "0W"}
    />
  );
}
