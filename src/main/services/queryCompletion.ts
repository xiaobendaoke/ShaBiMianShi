import type { AnswerOptions } from '../types';

export interface QueryCompletionDoc {
  id: string;
  fileName: string;
  kind: 'md' | 'pdf' | 'other';
  title?: string;
}

export interface QueryCompletionTurn {
  question: string;
  answerSummary?: string;
  project?: string;
}

export interface QueryCompletionInput {
  question: string;
  fromAudio?: boolean;
  recentTurns: QueryCompletionTurn[];
  activeProject?: string;
  documents: QueryCompletionDoc[];
}

export interface QueryCompletionResult {
  intent: 'project_or_resume' | 'general_tech' | 'chatter';
  rewrittenQuestion: string;
  searchQuery: string;
  targetDocIds: string[];
  usedLlm: boolean;
}

const HOMOPHONE_RULES: [RegExp, string][] = [
  [/\bcircle\s*light\b/gi, 'SQLite'],
  [/(?:塞口|思科)\s*light\b/gi, 'SQLite'],
  [/\b(?:vcl\s*2|we\s*sell\s*two|v4l\s*two|v\s*for\s*l\s*2)\b/gi, 'V4L2'],
  [/\barsa\b/gi, 'ALSA'],
  [/阿萨(?=驱动|音频|采集|播放|接口|缓冲)/g, 'ALSA'],
  [/(?:不输在|部署的|不熟在|不署在)(?:单次|单词|端测|单侧|端侧)/g, '部署在端侧'],
  [/部署在(?:单次|单词|端测|单侧)/g, '部署在端侧'],
  [/高通\s*(?:八?二九五|8295)/g, '高通8295'],
  [/(?:r\s*k\s*的?\s*)?三五八八/gi, 'RK3588'],
  [/\br\s*k\s*的?\s*(?:三五八|3588)\b/gi, 'RK3588'],
  [/\bsteam\s*c\s*r\b/gi, 'STM32'],
  [/\bs\s*t\s*m\s*(?:三二|32)\b/gi, 'STM32'],
  [/杰特森|杰斯森/g, 'Jetson'],
  [/(?:样品|应聘)(?:研试|延时|延迟)/g, '音频延时'],
  [/检测到人参/g, '检测到人声'],
  [/血汗说/g, '虚函数'],
  [/多肽/g, '多态'],
  [/串子/g, '算子'],
  [/(?:尤洛|优洛)\s*v?\s*(?:11|十一|幺幺)n?/gi, 'YOLOv11n']
];

export function normalizeCjkText(raw: string): string {
  return raw.replace(/[\u2e80-\u2fdf\uf900-\ufaff\uff10-\uff19\uff21-\uff3a\uff41-\uff5a]/g, ch => ch.normalize('NFKC'));
}

export function preCorrectAsrText(raw: string): string {
  let text = normalizeCjkText(raw).trim();
  if (!text) return text;
  for (const [pattern, replacement] of HOMOPHONE_RULES) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

export function shouldRunLlmCompletion(params: {
  question: string;
  options: AnswerOptions;
  hasLibraries: boolean;
  historyCount: number;
  focusReason: string;
}): boolean {
  const { options, hasLibraries, historyCount, focusReason } = params;
  if (options.images?.length || options.action === 'extract' || options.action === 'shorten') return false;
  if (!hasLibraries && !options.audioTiming) return false;
  if (options.audioTiming) return true;
  if (historyCount > 0 && focusReason !== '本题项目标识匹配') return true;
  return false;
}

export function buildCompletionMessages(input: QueryCompletionInput): { role: string; content: string }[] {
  const system =
    '你是技术面试实时语音纠错与上下文指代补全器。仅输出单行JSON对象，不要代码块或额外说明：\n' +
    '{"intent":"project_or_resume"|"general_tech"|"chatter","rewrittenQuestion":"...","searchQuery":"...","targetDocIds":["..."]}\n' +
    '规则：\n' +
    '1. 结合近期对话与文档目录，纠正语音同音错字（芯片型号、技术缩写、框架名、口语误听），并将“这个方案/它/那块/刚才说的/帧率多少”等省略指代补全为完整明确的面试问题写入 rewrittenQuestion。保持原提问意图，严禁编造未提及的参数。\n' +
    '   只对 source 为 audio 的问题执行同音纠错。对 source 为 typed 的问题，保留用户输入的字词和专有名词，仅补全指代。\n' +
    '2. intent：涉及候选人个人经历、自我介绍、学校学历、论文、实习、具体项目细节或追问项目指标填 "project_or_resume"；纯编程语言/OS/网络通用八股概念且与个人项目无关填 "general_tech"；纯试音寒暄（如“能听到吗”“稍等一下”）填 "chatter"。\n' +
    '3. searchQuery：提取最利于知识库 BM25+向量检索的核心关键词串（包含定位到的项目名/芯片平台 + 核心技术名词，空格分隔）。\n' +
    '4. targetDocIds：若明确指向某 1~2 份具体文档则填其 id（同一项目同时存在 .md 详案与 .pdf 简历时，只填 .md 文档 id；仅当询问自我介绍、学校学历、论文、兵装所/深蓝实习、Jetson/STM32、KNN-DDPG 等仅在简历中的经历时才填 .pdf 文档 id）；跨项目开放题或通用题填 []。';

  const payload = {
    activeProject: input.activeProject || undefined,
    documents: input.documents.map(d => ({
      id: d.id,
      fileName: d.fileName,
      kind: d.kind,
      title: d.title
    })),
    recentTurns: input.recentTurns.slice(-4).map(t => ({
      q: t.question.slice(0, 260),
      a: t.answerSummary ? t.answerSummary.slice(0, 220) : undefined,
      project: t.project || undefined
    })),
    currentQuestion: input.question,
    source: input.fromAudio ? 'audio' : 'typed'
  };

  return [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify(payload) }
  ];
}

export function parseCompletionResponse(
  rawText: string,
  fallbackQuestion: string,
  validDocIds: Set<string>
): QueryCompletionResult {
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('补全返回非 JSON');
  const parsed = JSON.parse(match[0]) as any;
  const intent: QueryCompletionResult['intent'] =
    parsed.intent === 'general_tech' || parsed.intent === 'chatter' || parsed.intent === 'project_or_resume'
      ? parsed.intent
      : 'project_or_resume';
  const rewrittenQuestion =
    typeof parsed.rewrittenQuestion === 'string' && parsed.rewrittenQuestion.trim().length >= 2
      ? normalizeCjkText(parsed.rewrittenQuestion).trim()
      : fallbackQuestion;
  const searchQuery =
    typeof parsed.searchQuery === 'string' && parsed.searchQuery.trim().length >= 2
      ? normalizeCjkText(parsed.searchQuery).trim()
      : rewrittenQuestion;
  const targetDocIds: string[] = Array.isArray(parsed.targetDocIds)
    ? [...new Set((parsed.targetDocIds as unknown[]).filter((id): id is string => typeof id === 'string' && validDocIds.has(id)))]
    : [];
  return {
    intent,
    rewrittenQuestion,
    searchQuery,
    targetDocIds,
    usedLlm: true
  };
}
