import {AbsoluteFill, Easing, Img, interpolate, useCurrentFrame, useVideoConfig} from "remotion";

export const fade = (frame: number, duration: number) =>
  interpolate(frame, [0, 12, duration - 12, duration], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

export const Aurora: React.FC<{tone?: "cyan" | "violet"}> = ({tone = "cyan"}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const accent = tone === "cyan" ? "27,224,197" : "126,110,255";
  return (
    <AbsoluteFill style={{overflow: "hidden", background: "radial-gradient(circle at 50% 46%, #0b1522 0%, #05080f 62%)"}}>
      <div style={{position: "absolute", inset: -300, opacity: 0.48, backgroundImage: "linear-gradient(rgba(98,122,151,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(98,122,151,.08) 1px, transparent 1px)", backgroundSize: "68px 68px", translate: `${interpolate(frame, [0, durationInFrames], [0, -34])}px ${interpolate(frame, [0, durationInFrames], [0, -34])}px`, maskImage: "radial-gradient(circle at center, black, transparent 67%)"}} />
      <div style={{position: "absolute", width: 980, height: 980, left: -260, top: -500, borderRadius: "50%", filter: "blur(95px)", background: `rgba(${accent},.15)`, translate: `${interpolate(frame, [0, durationInFrames], [0, 100])}px 0px`}} />
      <div style={{position: "absolute", width: 800, height: 800, right: -280, bottom: -500, borderRadius: "50%", filter: "blur(110px)", background: "rgba(39,93,255,.16)", translate: `${interpolate(frame, [0, durationInFrames], [0, -80])}px 0px`}} />
    </AbsoluteFill>
  );
};

export const Brand: React.FC = () => (
  <div style={{position: "absolute", left: 80, top: 62, display: "flex", alignItems: "center", gap: 16, color: "#eaf8f6", fontSize: 28, fontWeight: 700, letterSpacing: 1.5}}>
    <div style={{width: 40, height: 40, border: "1px solid rgba(48,230,201,.7)", borderRadius: 12, display: "grid", placeItems: "center", boxShadow: "0 0 28px rgba(27,224,197,.24)"}}>
      <span style={{color: "#26e0c5", fontFamily: "Georgia, serif", fontSize: 26}}>L</span>
    </div>
    LEXREAD
  </div>
);

export const Eyebrow: React.FC<{children: React.ReactNode}> = ({children}) => (
  <div style={{color: "#2be4c8", fontSize: 24, letterSpacing: 7, fontWeight: 650, marginBottom: 25}}>{children}</div>
);

export const Window: React.FC<{src: string; style?: React.CSSProperties}> = ({src, style}) => (
  <div style={{position: "absolute", borderRadius: 24, padding: 8, background: "linear-gradient(135deg, rgba(71,245,219,.65), rgba(95,111,255,.12) 38%, rgba(255,255,255,.16))", boxShadow: "0 50px 120px rgba(0,0,0,.55), 0 0 70px rgba(38,224,197,.12)", overflow: "hidden", ...style}}>
    <div style={{height: "100%", borderRadius: 18, overflow: "hidden", background: "#e9eef4"}}>
      <Img src={src} style={{width: "100%", height: "100%", objectFit: "cover", display: "block"}} />
    </div>
  </div>
);
