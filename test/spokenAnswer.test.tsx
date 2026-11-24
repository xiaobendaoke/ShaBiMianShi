import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AnswerContent} from '../src/renderer/src/components/AnswerContent';
import {answerPolicy, isEnglishQuestion, speechViolation} from '../src/shared/interview';

const render=(text:string)=>renderToStaticMarkup(<AnswerContent text={text}/>);
const answer='协程是**可以挂起和恢复的任务**。\n\n它适合I/O密集场景。';
const html=render(answer);
assert.equal((html.match(/<p /g)||[]).length,2);
assert.ok(html.includes('<strong'));assert.ok(!html.includes('**'));
assert.ok(html.includes('text-[15px]'));
assert.ok(render('- 线程由操作系统调度\n- 协程通常由运行时调度').includes('<ul'));
const code='int main(void) {\n  return 0;\n}';
assert.ok(render('思路：直接返回。\n\n```c\n'+code+'\n```').includes(code));
assert.ok(render('```c\nint main(').includes('int main('),'Incomplete streaming code stays visible');
assert.ok(render('<img src=x onerror=alert(1)>').includes('&lt;img'));
assert.ok(!render('<script>alert(1)</script>').includes('<script>'));
const old=Array.from({length:8},(_,i)=>`第${i}句解释必须保留原有内容，不得删除或截断。`).join('');
const oldHtml=render(old);assert.ok((oldHtml.match(/<p /g)||[]).length>1);
for(let i=0;i<8;i++)assert.ok(oldHtml.includes(`第${i}句解释必须保留原有内容`));
const policy=answerPolicy('什么是协程？','concise');assert.ok(policy.prompt.includes('第一句必须直接回答'));assert.ok(policy.prompt.includes('超过两句时用空行分段'));
assert.ok(answerPolicy('协程和线程有什么区别？','concise').prompt.includes('最多3点'));
assert.ok(answerPolicy('你的项目负责什么？','concise').prompt.includes('80至160字'));
assert.ok(answerPolicy('请详细解释协程','concise').prompt.includes('本次明确要求展开'));
assert.ok(answerPolicy('请写一个排序函数','concise').coding);

// Junior-high English mode + bottom Chinese summary + screenshot Chinese default
assert.equal(isEnglishQuestion('Can you introduce yourself?'), true);
assert.equal(isEnglishQuestion('Introduce yourself.'), true);
assert.equal(isEnglishQuestion('What is the difference between a process and a thread?'), true);
assert.equal(isEnglishQuestion('请用英文做个自我介绍'), true);
assert.equal(isEnglishQuestion('能用英语讲一下你在 RK3588 项目里做了什么吗？'), true);
assert.equal(isEnglishQuestion('嗯，好的，那 Can you tell me about a challenge in your project?'), true);
assert.equal(isEnglishQuestion('RK3588 上 YOLOv11n 怎么用 V4L2 和 RGA 做 zero-copy 优化？'), false);
assert.equal(isEnglishQuestion('C++ virtual function 和 pure virtual function 有什么区别？'), false);
assert.equal(isEnglishQuestion('FastRPC Hexagon HTP QNN'), false);
assert.equal(isEnglishQuestion('请把这段英文翻译成中文：Hello world'), false);

const enIntro = answerPolicy('Can you introduce yourself?', 'standard');
assert.equal(enIntro.english, true);
assert.equal(enIntro.project, true);
assert.match(enIntro.prompt, /初中英语水平/);
assert.match(enIntro.prompt, /严禁出现 leverage/);
assert.match(enIntro.prompt, /中文大意：/);

const zhAskEn = answerPolicy('请用英文介绍一下你的项目', 'concise');
assert.equal(zhAskEn.english, true);
assert.equal(zhAskEn.project, true);
assert.match(zhAskEn.prompt, /45 至 85 个英文词/);

const wrappedShortenEn = answerPolicy(
  '请将下面的回答压缩成一句话。问题：Can you introduce yourself?。回答：I am an embedded software engineer.',
  'standard',
  {action: 'shorten'}
);
assert.equal(wrappedShortenEn.english, true);
assert.match(wrappedShortenEn.prompt, /1 句最简单的英文短句/);
assert.match(wrappedShortenEn.prompt, /中文大意：/);

// Screenshot coding questions default to Chinese spoken explanation even if title is English
const enTitleShot = answerPolicy('Two Sum', 'standard', {images: [{id: 'img', base64: 'x', mimeType: 'image/png'}]});
assert.equal(enTitleShot.coding, true);
assert.equal(enTitleShot.english, false);
assert.match(enTitleShot.prompt, /一律用中文讲/);

// Explicit request to answer screenshot in English still honors English mode
const explicitEnShot = answerPolicy('请用英文回答截图里的情景题', 'standard', {
  images: [{id: 'img', base64: 'x', mimeType: 'image/png'}],
  targetRole: '销售'
});
assert.equal(explicitEnShot.english, true);
assert.match(explicitEnShot.prompt, /中文大意：/);

// Bottom Chinese summary passes speechViolation and renders as separated muted note
const sampleEnAnswer = 'I used **RGA** and **NPU** to make the video check faster.\n\n中文大意：我用 RGA 和 NPU 让视频检测更快。';
assert.equal(speechViolation(sampleEnAnswer), false);
const enHtml = render(sampleEnAnswer);
assert.ok(enHtml.includes('border-t'));
assert.ok(enHtml.includes('中文大意：我用 RGA 和 NPU 让视频检测更快。'));
console.log('PASS Spoken policy and actual React rendering: paragraphs, emphasis, lists, code, streaming, HTML escaping, complete history text');
