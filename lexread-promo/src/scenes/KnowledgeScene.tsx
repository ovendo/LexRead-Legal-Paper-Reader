import {AbsoluteFill, Easing, interpolate, staticFile, useCurrentFrame} from "remotion";
import {Aurora, Brand, Eyebrow, Window, fade} from "./shared";

export const KnowledgeScene: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{opacity:fade(frame,90),color:"white"}}>
      <Aurora tone="violet"/><Brand/>
      <div style={{position:"absolute",left:120,top:270,width:600,zIndex:4}}>
        <Eyebrow>03 · 沉淀研究资产</Eyebrow>
        <div style={{fontSize:76,lineHeight:1.18,fontWeight:760,letterSpacing:-3,opacity:interpolate(frame,[0,18],[0,1],{extrapolateRight:"clamp"}),translate:`0px ${interpolate(frame,[0,28],[35,0],{extrapolateRight:"clamp",easing:Easing.bezier(.16,1,.3,1)})}px`}}>从阅读<br/>到可复用知识</div>
        <div style={{fontSize:29,color:"#9cadc2",marginTop:35}}>观点卡 · 案例卡 · 规范卡 · 引用卡</div>
      </div>
      <Window src={staticFile("materials.jpg")} style={{right:75,top:155,width:1020,height:574,translate:`0px ${interpolate(frame,[0,90],[55,-12])}px`,scale:interpolate(frame,[0,25],[.9,1],{extrapolateRight:"clamp",easing:Easing.bezier(.16,1,.3,1)})}}/>
      <Window src={staticFile("citation.jpg")} style={{right:430,bottom:-145,width:650,height:366,translate:`${interpolate(frame,[20,70],[60,0],{extrapolateRight:"clamp"})}px 0px`,opacity:interpolate(frame,[18,35],[0,1],{extrapolateRight:"clamp"})}}/>
    </AbsoluteFill>
  );
};
