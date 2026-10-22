import React from 'react';

// A small, text-only renderer: model output never becomes executable HTML.
function Inline({text}: {text:string}) {
  return <>{text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g).map((part,i)=>
    part.startsWith('**')&&part.endsWith('**')?<strong key={i} className="font-semibold text-label">{part.slice(2,-2)}</strong>:
    part.startsWith('`')&&part.endsWith('`')?<code key={i} className="rounded-[5px] bg-fill px-1.5 py-px font-mono text-[0.88em]">{part.slice(1,-1)}</code>:part)}</>;
}

function paragraphs(text:string):string[] {
  // Improve old unbroken prose without deleting words or modifying stored answers.
  if(text.length<=140)return [text];
  const sentences=text.match(/[^。！？!?]+[。！？!?]*|[。！？!?]+/g)||[text];
  const parts:string[]=[];let current='';
  for(const sentence of sentences){if(current.length>=70){parts.push(current);current='';}current+=sentence;}
  if(current)parts.push(current);return parts;
}

export function AnswerContent({text}: {text:string}) {
  const blocks:React.ReactNode[]=[];const lines=text.replace(/\r\n/g,'\n').split('\n');
  for(let i=0;i<lines.length;){
    const line=lines[i];
    if(!line.trim()){i++;continue;}
    if(/^\s*```/.test(line)){
      const language=line.trim().slice(3);const code:string[]=[];i++;
      while(i<lines.length&&!/^\s*```/.test(lines[i]))code.push(lines[i++]);
      if(i<lines.length)i++;
      const source=code.join('\n');
      blocks.push(<div key={blocks.length} className="min-w-0 rounded-xl bg-code border border-separator overflow-hidden"><div className="flex items-center justify-between h-8 pl-3.5 pr-1.5 border-b border-separator text-[11px] font-medium text-label-2"><span>{language||'代码'}</span><button type="button" title="复制代码" onClick={()=>void navigator.clipboard?.writeText(source)} className="h-6 px-2 rounded-md hover:bg-fill hover:text-label">复制</button></div><pre className="overflow-x-auto px-3.5 py-3 font-mono text-[12.5px] leading-6 whitespace-pre select-text"><code>{source}</code></pre></div>);continue;
    }
    const list=line.match(/^\s*(?:[-*+]\s+|\d+[.)、]\s+)/);
    if(list){
      const items:string[]=[];
      while(i<lines.length&&/^\s*(?:[-*+]\s+|\d+[.)、]\s+)/.test(lines[i]))items.push(lines[i++].replace(/^\s*(?:[-*+]\s+|\d+[.)、]\s+)/,''));
      blocks.push(<ul key={blocks.length} className="list-disc pl-5 space-y-1.5 marker:text-label-3">{items.map((item,j)=><li key={j}><Inline text={item}/></li>)}</ul>);continue;
    }
    const heading=line.match(/^\s*#{1,6}\s+(.+)/);
    if(heading){blocks.push(<p key={blocks.length} className="font-semibold text-label text-[16px] pt-1"><Inline text={heading[1]}/></p>);i++;continue;}
    let prose=line.replace(/^>\s?/,'');i++;
    while(i<lines.length&&lines[i].trim()&&!/^\s*(?:```|#{1,6}\s|[-*+]\s|\d+[.)、]\s)/.test(lines[i]))prose+='\n'+lines[i++].replace(/^>\s?/,'');
    for(const part of paragraphs(prose))blocks.push(<p key={blocks.length} className="whitespace-pre-wrap"><Inline text={part}/></p>);
  }
  return <div className="space-y-4 text-[15px] leading-[1.75] text-label font-sans break-words min-w-0" data-answer-content>{blocks}</div>;
}
