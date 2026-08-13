import type { AppState, ReadingNode } from "./types";

const paperNodes: ReadingNode[] = [
  { id: "n1", order: 1, title: "问题提出", subtitle: "研究背景与核心问题界定", page: 8, role: "问题界定", attribution: "作者观点", summary: "平台用工关系的传统二分判断在算法管理场景中出现解释缺口。", reasons: ["劳动过程被数据化重构", "形式自由可能掩盖实质控制"], materials: ["既有劳动关系认定标准", "平台算法管理研究"], confidence: 96, status: "understood" },
  { id: "n2", order: 2, title: "学说梳理", subtitle: "既有学说与判别路径梳理", page: 23, role: "文献综述", attribution: "他人观点", summary: "作者将既有路径归纳为人格从属性、经济从属性与组织从属性三类。", reasons: ["人格从属性强调指挥监督", "经济从属性强调收入依赖"], materials: ["劳动法学说", "域外判例"], confidence: 93, status: "understood" },
  { id: "n3", order: 3, title: "通说批评", subtitle: "通说的不足与实践困境", page: 47, role: "反对意见", attribution: "作者观点", summary: "单一从属性标准难以描述平台对劳动者的复合型控制。", reasons: ["控制方式从直接命令转向评分和派单", "劳动者形式自由与经济依赖并存"], materials: ["典型平台规则", "司法裁判样本"], confidence: 88, status: "doubt" },
  { id: "n4", order: 4, title: "作者方案", subtitle: "提出三维判断框架", page: 78, role: "核心结论", attribution: "作者观点", summary: "提出“控制力—经济依赖—权利保障”三维判断框架，在类型化与实质正义之间寻求平衡。", reasons: ["算法控制可被还原为劳动过程控制", "经济依赖需要结合收入结构判断", "权利保障用于校准裁判后果"], materials: ["既有理论的综合反思", "典型裁判的类型化比较"], confidence: 92, status: "read" },
  { id: "n5", order: 5, title: "框架展开", subtitle: "三维度的内涵与适用规则", page: 92, role: "论证展开", attribution: "作者观点", summary: "分别说明控制力、经济依赖与权利保障的可观察指标。", reasons: ["评分、派单与惩戒形成控制链", "收入来源与替代成本体现依赖"], materials: ["平台服务协议", "劳动过程数据"], confidence: 90, status: "passed" },
  { id: "n6", order: 6, title: "案例检验", subtitle: "典型案例的适用与分析", page: 126, role: "案例论证", attribution: "法院观点", summary: "以不同用工平台案例检验三维框架的区分能力。", reasons: ["同类业务存在不同控制强度", "合同名称不决定法律性质"], materials: ["最高人民法院典型案例", "地方裁判样本"], confidence: 86, status: "doubt" },
  { id: "n7", order: 7, title: "结论边界", subtitle: "适用边界与限制条件", page: 183, role: "限定条件", attribution: "作者观点", summary: "三维框架仍需要行业场景与举证规则配合。", reasons: ["平台数据掌握存在信息不对称", "不同劳动形态不能机械统一"], materials: ["举证责任规则", "行业差异"], confidence: 84, status: "unread" },
  { id: "n8", order: 8, title: "研究结论", subtitle: "研究总结与制度建议", page: 202, role: "核心结论", attribution: "作者观点", summary: "建议从形式合同审查转向对平台实际控制机制的结构化审查。", reasons: ["回应数字劳动的新型控制", "维持规则可预测性"], materials: ["全文论证", "制度建议"], confidence: 94, status: "unread" },
];

export const initialState: AppState = {
  selectedProjectId: "p1",
  toast: null,
  projects: [
    { id: "p1", title: "平台劳动者劳动关系认定", question: "在数字经济平台用工模式下，何种情形下平台与劳动者之间构成劳动关系？", stage: "文献研究", progress: 62, createdAt: "2024-05-15", updatedAt: "2026-07-20 10:30", questionTree: [
      { id: "q1", text: "平台与劳动者是否存在人格从属性？", materialCount: 68 },
      { id: "q2", text: "平台是否对劳动者工作进行组织与管理？", materialCount: 74 },
      { id: "q3", text: "劳动者是否具备经济上的从属性？", materialCount: 41 },
      { id: "q4", text: "不同平台用工模式下的裁判倾向？", materialCount: 29 },
    ], outline: [
      { id: "o1", title: "第一章 平台用工模式的类型与特征", sections: 3 },
      { id: "o2", title: "第二章 劳动关系认定的法律框架", sections: 4 },
      { id: "o3", title: "第三章 人身从属性的认定", sections: 5 },
      { id: "o4", title: "第四章 组织管理从属性的认定", sections: 4 },
      { id: "o5", title: "第五章 经济从属性的认定", sections: 4 },
    ] },
    { id: "p2", title: "算法推荐机制研究", question: "算法推荐中的平台义务与责任边界如何确定？", stage: "资料收集", progress: 48, createdAt: "2024-05-12", updatedAt: "2026-07-18", questionTree: [], outline: [] },
    { id: "p3", title: "数据权益保护比较研究", question: "数据权益保护制度如何协调个人权利与产业利用？", stage: "问题形成", progress: 35, createdAt: "2024-05-10", updatedAt: "2026-07-15", questionTree: [], outline: [] },
  ],
  documents: [
    { id: "d1", projectId: "p1", kind: "paper", title: "平台用工中劳动关系认定的司法路径研究", source: "《法学研究》2023年第4期", author: "周若衡", pages: 210, currentPage: 78, status: "ready", readingStatus: "readable", ocrStatus: "completed", analysisStatus: "completed", confidence: 92, nodes: paperNodes, activeNodeId: "n4", updatedAt: "2026-07-20 10:30" },
    { id: "d2", projectId: "p1", kind: "judgment", title: "（2023）京0105民初12345号 机动车交通事故责任纠纷案", source: "北京市朝阳区人民法院", author: "北京市朝阳区人民法院", pages: 36, currentPage: 12, status: "ready", readingStatus: "readable", ocrStatus: "completed", analysisStatus: "completed", confidence: 95, activeIssueId: "i4", updatedAt: "2026-07-20 09:45", issues: [
      { id: "i1", title: "诉讼请求", page: 2, status: "已完成", claim: "原告请求被告承担全部赔偿责任。", courtFact: "法院已记录原告诉讼请求。", evidence: ["起诉状"], laws: [] },
      { id: "i2", title: "答辩意见", page: 4, status: "已完成", claim: "被告主张原告违法变更车道，应减轻责任。", courtFact: "被告对责任比例存在异议。", evidence: ["答辩状"], laws: [] },
      { id: "i3", title: "无争议事实", page: 7, status: "已完成", claim: "双方对事故发生时间、地点无异议。", courtFact: "事故于2023年5月10日发生。", evidence: ["道路交通事故认定书"], laws: [] },
      { id: "i4", title: "争议焦点一", page: 12, status: "进行中", claim: "被告是否应承担事故赔偿责任及责任比例？", courtFact: "被告未保持安全车距追尾原告，原告变更车道未尽注意义务。", evidence: ["道路交通事故认定书", "现场勘查笔录及照片", "行车记录仪视频"], laws: ["《道路交通安全法》第四十三条", "《民法典》第一千二百零八条"] },
      { id: "i5", title: "证据认证", page: 17, status: "进行中", claim: "各项证据的真实性、关联性与证明力。", courtFact: "交通事故认定书与视频能够相互印证。", evidence: ["证据目录", "质证笔录"], laws: ["《民事诉讼法》第六十七条"] },
      { id: "i6", title: "法律适用", page: 23, status: "待读取", claim: "过错责任及机动车事故责任规则。", courtFact: "依双方过错程度分配责任。", evidence: [], laws: ["《民法典》第一千二百零八条"] },
      { id: "i7", title: "责任比例", page: 28, status: "待读取", claim: "被告承担主要责任，原告承担次要责任。", courtFact: "责任比例需结合违法行为与原因力。", evidence: ["事故认定书"], laws: [] },
      { id: "i8", title: "裁判结果", page: 34, status: "待读取", claim: "赔偿项目与数额。", courtFact: "法院按责任比例确定赔偿金额。", evidence: ["医疗费票据", "收入证明"], laws: [] },
    ] },
    { id: "d3", projectId: "p1", kind: "paper", title: "最高人民法院相关判决书（合集）", source: "司法案例汇编", author: "最高人民法院", pages: 64, currentPage: 52, status: "ready", readingStatus: "readable", ocrStatus: "completed", analysisStatus: "idle", confidence: 89, updatedAt: "2026-07-19 18:20" },
  ],
  annotations: [],
  matrixEntries: [],
  writingDrafts: [],
  cards: [
    { id: "c1", projectId: "p1", documentId: "d1", type: "观点卡", title: "算法调度构成新型人格从属性", excerpt: "互联网平台企业基于算法的调度行为，实质上行使了人身管理的权力。", note: "可作为平台控制力判断的理论依据。", source: "平台用工中劳动关系认定的司法路径研究", page: 78, tags: ["平台用工", "从属性", "算法管理"], verifyStatus: "已核验", relation: "支持", outlineNode: "第一部分 平台用工的法律定性", targetId: "n4", updatedAt: "2026-07-20 10:32" },
    { id: "c2", projectId: "p1", documentId: "d2", type: "案例卡", title: "变更车道与追尾事故的责任分配", excerpt: "法院依据双方违法行为对事故发生的原因力确定责任比例。", note: "用于说明事实—要件匹配的分析方法。", source: "（2023）京0105民初12345号", page: 12, tags: ["交通事故", "责任比例"], verifyStatus: "已核验", relation: "背景", outlineNode: "第三部分 司法实践裁判分析", targetId: "i4", updatedAt: "2026-07-20 09:45" },
    { id: "c3", projectId: "p1", documentId: "d1", type: "规范卡", title: "劳动合同法（2012修正）", excerpt: "建立劳动关系，应当订立书面劳动合同。", note: "需要结合劳动关系认定通知理解。", source: "全国人大常委会", page: 1, tags: ["劳动派遣", "劳动保障"], verifyStatus: "已核验", relation: "背景", outlineNode: "第二部分 相关规范梳理", updatedAt: "2026-07-19 16:20" },
    { id: "c4", projectId: "p1", documentId: "d1", type: "引用卡", title: "经济从属性的判断标准", excerpt: "经济依赖不仅表现为收入来源的单一化，更体现为劳动者是否将平台作为主要谋生手段。", note: "定义经济从属性时可直接引用，需复核脚注。", source: "平台用工中劳动关系认定的司法路径研究", page: 81, tags: ["平台用工", "研究方法"], verifyStatus: "待核验", relation: "支持", outlineNode: "第四部分 认定标准构建", targetId: "n4", updatedAt: "2026-07-19 14:10" },
  ],
  tasks: [
    { id: "t1", title: "精读并标注3篇核心论文", time: "10:00", done: true, priority: "high" },
    { id: "t2", title: "研读2份相关裁判文书", time: "11:30", done: true, priority: "normal" },
    { id: "t3", title: "整理劳动关系认定要素清单", time: "14:00", done: false, priority: "high" },
    { id: "t4", title: "完善项目研究框架", time: "16:00", done: false, priority: "normal" },
  ],
};
