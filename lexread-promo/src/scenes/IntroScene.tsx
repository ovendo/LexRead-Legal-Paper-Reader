import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from "remotion";
import {Aurora, Brand, fade} from "./shared";

export const IntroScene: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{opacity: fade(frame, 90), color: "white"}}>
      <Aurora />
      <Brand />
      <div style={{position: "absolute", left: 170, top: 300, width: 1580}}>
        <div style={{color: "#7e91aa", fontSize: 26, letterSpacing: 8, opacity: interpolate(frame, [4, 22], [0, 1], {extrapolateRight: "clamp"})}}>LEGAL · SOCIOLOGY · RESEARCH</div>
        <div style={{fontSize: 100, fontWeight: 760, lineHeight: 1.15, letterSpacing: -5, marginTop: 28, translate: `0px ${interpolate(frame, [0, 28], [55, 0], {extrapolateRight: "clamp", easing: Easing.bezier(.16,1,.3,1)})}px`, opacity: interpolate(frame, [0, 18], [0, 1], {extrapolateRight: "clamp"})}}>
          法社会学研究<br/><span style={{background: "linear-gradient(90deg, #f7fbff, #25e0c4 75%)", WebkitBackgroundClip: "text", color: "transparent"}}>不该困在碎片里</span>
        </div>
      </div>
      <div style={{position: "absolute", left: 172, bottom: 150, width: interpolate(frame, [18, 60], [0, 650], {extrapolateRight: "clamp", easing: Easing.bezier(.16,1,.3,1)}), height: 2, background: "linear-gradient(90deg, #2be4c8, transparent)"}} />
    </AbsoluteFill>
  );
};
