import {AbsoluteFill, Easing, interpolate, staticFile, useCurrentFrame} from "remotion";
import {Aurora, Brand, Eyebrow, Window, fade} from "./shared";

export const ReaderScene: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{opacity: fade(frame,105),color:"white"}}>
      <Aurora/><Brand/>
      <Window src={staticFile("paper-reader.jpg")} style={{left:-70,top:175,width:1200,height:675,scale:interpolate(frame,[0,30],[.9,1],{extrapolateRight:"clamp",easing:Easing.bezier(.16,1,.3,1)}),translate:`${interpolate(frame,[0,105],[-70,10])}px 0px`}}/>
      <div style={{position:"absolute",right:120,top:255,width:610,zIndex:3,opacity:interpolate(frame,[0,20],[0,1],{extrapolateRight:"clamp"}),translate:`${interpolate(frame,[0,30],[45,0],{extrapolateRight:"clamp",easing:Easing.bezier(.16,1,.3,1)})}px 0px`}}>
        <Eyebrow>02 · 让判断可核验</Eyebrow>
        <div style={{fontSize:72,lineHeight:1.18,fontWeight:760,letterSpacing:-3}}>AI 拆解论证<br/><span style={{color:"#2be4c8"}}>每一步回到原文</span></div>
        <div style={{display:"flex",gap:14,marginTop:42,flexWrap:"wrap"}}>{["问题界定","通说批评","作者方案","适用边界"].map((x,i)=><div key={x} style={{padding:"14px 20px",borderRadius:12,border:"1px solid rgba(137,164,196,.22)",background:"rgba(12,22,35,.72)",fontSize:23,color:i===2?"#36e2ca":"#9fb0c4",opacity:interpolate(frame,[28+i*6,42+i*6],[0,1],{extrapolateRight:"clamp"})}}>{x}</div>)}</div>
      </div>
    </AbsoluteFill>
  );
};
