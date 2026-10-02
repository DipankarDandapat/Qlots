import React from 'react';
import Svg, { Path, Circle, Rect, Defs, LinearGradient, Stop, ClipPath, G } from 'react-native-svg';

export default function QlotsLogo({ size = 56 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#1A4D35" />
          <Stop offset="1" stopColor="#0D2B1E" />
        </LinearGradient>
        <LinearGradient id="lineGrad" x1="0" y1="1" x2="1" y2="0">
          <Stop offset="0" stopColor="#C8E8A9" />
          <Stop offset="1" stopColor="#7ECBA1" />
        </LinearGradient>
        <ClipPath id="roundClip">
          <Rect x="0" y="0" width="100" height="100" rx="28" ry="28" />
        </ClipPath>
      </Defs>

      {/* Background rounded square */}
      <Rect x="0" y="0" width="100" height="100" rx="28" ry="28" fill="url(#bgGrad)" />

      {/* Outer Q circle */}
      <Circle cx="50" cy="47" r="28" fill="none" stroke="#2A6B47" strokeWidth="5" />

      {/* Growth chart line inside Q */}
      <Path
        d="M28 58 L38 46 L48 52 L60 36 L72 40"
        fill="none"
        stroke="url(#lineGrad)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Dot at end of chart line */}
      <Circle cx="72" cy="40" r="3.5" fill="#C8E8A9" />

      {/* Q tail — the distinctive serif of Q */}
      <Path
        d="M62 60 L74 72"
        stroke="#C8E8A9"
        strokeWidth="5.5"
        strokeLinecap="round"
      />
    </Svg>
  );
}
