import {AbsoluteFill, Composition, Sequence} from "remotion";
import {IntroScene} from "./scenes/IntroScene";
import {ResearchScene} from "./scenes/ResearchScene";
import {ReaderScene} from "./scenes/ReaderScene";
import {KnowledgeScene} from "./scenes/KnowledgeScene";
import {FinaleScene} from "./scenes/FinaleScene";

export const LexReadPromo: React.FC = () => {
  return (
    <AbsoluteFill style={{backgroundColor: "#05080f"}}>
      <Sequence durationInFrames={90} name="研究命题">
        <IntroScene />
      </Sequence>
      <Sequence from={90} durationInFrames={105} name="项目空间">
        <ResearchScene />
      </Sequence>
      <Sequence from={195} durationInFrames={105} name="原文核验">
        <ReaderScene />
      </Sequence>
      <Sequence from={300} durationInFrames={90} name="知识沉淀">
        <KnowledgeScene />
      </Sequence>
      <Sequence from={390} durationInFrames={60} name="品牌收束">
        <FinaleScene />
      </Sequence>
    </AbsoluteFill>
  );
};

export const MyComposition = () => (
  <Composition
    id="LexRead-15s"
    component={LexReadPromo}
    durationInFrames={450}
    fps={30}
    width={1920}
    height={1080}
  />
);
