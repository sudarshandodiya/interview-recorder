import { useEffect, useRef } from "react";
import { View, StyleSheet, Animated, ViewStyle } from "react-native";

// ---------------------------------------------------------------------------
// Waveform (T-011) — lightweight animated bar visualization derived from
// expo-av metering levels. The metering value (dBFS, typically -160..0) is
// normalised to a 0..1 bar scale; we render a row of bars that interpolate
// toward the latest reading for an organic waveform feel.
//
// When `metering` is undefined (no data yet / paused), bars freeze at their
// last value and decay toward zero — matching the PRD's "waveform freezes
// during pause" constraint.
// ---------------------------------------------------------------------------

interface Props {
  /** Audio metering level in dBFS (negative). undefined = inactive/paused. */
  metering?: number;
  /** Is the mic actively capturing? When false, bars decay. */
  active: boolean;
}

/** Number of bars. Keep small for perf on a phone screen. */
const BAR_COUNT = 24;
/** Convert dBFS to a normalised 0..1 scale. -60 dBFS → ~0; 0 dBFS → 1. */
function normalise(metering: number | undefined): number {
  if (metering === undefined) return 0;
  const clamped = Math.max(-60, Math.min(0, metering));
  return Math.max(0, (clamped + 60) / 60);
}

export function Waveform({ metering, active }: Props) {
  const heights = useRef(Array.from({ length: BAR_COUNT }, () => new Animated.Value(0.05)));
  const idx = useRef(0);

  useEffect(() => {
    const level = active ? normalise(metering) : 0;
    // Decay/inflate each bar toward the newest sample to keep motion across
    // the strip; this avoids a single full-row jump on every sample.
    const target = active ? Math.max(0.05, level) : 0.03;
    const current = heights.current[idx.current % BAR_COUNT];
    Animated.timing(current, {
      toValue: target,
      duration: 80,
      useNativeDriver: false,
    }).start();
    idx.current += 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metering, active]);

  return (
    <View
      style={styles.container}
      accessibilityLabel="Recording waveform"
      accessible
    >
      {heights.current.map((h, i) => (
        <Animated.View
          key={i}
          style={[
            styles.bar,
            {
              height: Animated.multiply(h, 80),
            } as ViewStyle,
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 90,
    gap: 3,
  },
  bar: {
    width: 4,
    backgroundColor: "#0b5ed7",
    borderRadius: 2,
  },
});