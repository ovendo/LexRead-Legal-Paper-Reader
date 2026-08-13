import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from "remotion";
import {Aurora} from "./shared";

export const FinaleScene: React.FC = () => {
  const frame=useCurrentFrame();
  return <AbsoluteFill style={{color:"white",display:"flex",alignItems:"center",justifyContent:"center",textAlign:"center"}}>
    <Aurora/>
    <div style={{position:"relative",opacity:interpolate(frame,[0,14,52,60],[0,1,1,0],{extrapolateRight:"clamp"}),scale:interpolate(frame,[0,28],[.86,1],{extrapolateRight:"clamp",easing:Easing.bezier(.16,1,.3,1)})}}>
      <div style={{width:104,height:104,margin:"0 auto 28px",border:"1px solid rgba(43,228,200,.7)",borderRadius:30,display:"grid",placeItems:"center",fontFamily:"Georgia,serif",fontSize:68,color:"#2be4c8",boxShadow:"0 0 80px rgba(43,228,200,.2)"}}>L</div>
      <div style={{fontSize:100,fontWeight:780,letterSpacing:12}}>LEXREAD</div>
      <div style={{marginTop:24,fontSize:34,color:"#b0bfce",letterSpacing:4}}>原文可溯源 · 推理可校正 · 成果可复用</div>
    </div>
  </AbsoluteFill>;
};
