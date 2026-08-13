import {AbsoluteFill, Easing, interpolate, staticFile, useCurrentFrame} from "remotion";
import {Aurora, Brand, Eyebrow, Window, fade} from "./shared";

export const ResearchScene: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{opacity: fade(frame, 105), color: "white"}}>
      <Aurora tone="violet"/><Brand/>
      <div style={{position: "absolute", left: 120, top: 260, width: 650, zIndex: 3, translate: `${interpolate(frame,[0,30],[-45,0],{extrapolateRight:"clamp",easing:Easing.bezier(.16,1,.3,1)})}px 0px`, opacity: interpolate(frame,[0,18],[0,1],{extrapolateRight:"clamp"})}}>
        <Eyebrow>01 · 从问题出发</Eyebrow>
        <div style={{fontSize: 74, lineHeight: 1.18, fontWeight: 760, letterSpacing: -3}}>一个研究问题<br/>组织全部材料</div>
        <div style={{marginTop: 40, fontSize: 30, lineHeight: 1.65, color: "#9badc2"}}>平台如何以算法重塑劳动控制？<br/>文献、裁判、观点围绕命题持续聚合。</div>
      </div>
      <Window src={staticFile("project-overview.jpg")} style={{right: -75, top: 190, width: 1110, height: 625, scale: interpolate(frame,[0,34],[.88,1],{extrapolateRight:"clamp",easing:Easing.bezier(.16,1,.3,1)}), translate: `${interpolate(frame,[0,105],[100,-20])}px ${interpolate(frame,[0,105],[30,-10])}px`}} />
      <div style={{position:"absolute",right:600,bottom:125,padding:"20px 32px",border:"1px solid rgba(43,228,200,.32)",borderRadius:18,background:"rgba(7,17,27,.86)",boxShadow:"0 18px 60px rgba(0,0,0,.4)",fontSize:24,color:"#cce9e5",opacity:interpolate(frame,[35,55],[0,1],{extrapolateRight:"clamp"})}}>核心问题 → 子问题 → 材料覆盖</div>
    </AbsoluteFill>
  );
};
