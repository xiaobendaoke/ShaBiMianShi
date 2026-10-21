// Compile and execute only the reviewed, arithmetic-only subset emitted by the code-image probes.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),assert=require('node:assert/strict');
const reportPath=process.argv[2] || path.join(__dirname,'live-interview-report.json');
const report=JSON.parse(fs.readFileSync(reportPath,'utf8'));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'interviewdog-c17-'));
try{
 let count=0;
 for(const row of report.results.filter(r=>r.type==='image')){
  const code=[...row.answer.matchAll(/```(?:c|C|cpp)?\s*\n([\s\S]*?)```/g)].map(m=>m[1]).join('\n');
  assert.match(code,/^\s*int\s+solve\(int\s+x\)\s*\{\s*return\s+x\s*\*\s*\d+\s*\+\s*\d+\s*;\s*\}\s*$/,'Refuse to execute generated code outside reviewed arithmetic grammar');
  const index=Number.parseInt(row.file,10);
  const harness=`\nint main(void){int xs[]={-100,-1,0,1,100};for(int i=0;i<5;i++)if(solve(xs[i])!=xs[i]*${index+2}+${index+7})return 1;return 0;}`;
  const exe=path.join(dir,'probe');cp.execFileSync('/usr/bin/clang',['-std=c17','-xc','-o',exe,'-'],{input:code+harness});cp.execFileSync(exe,[],{timeout:2000});row.boundaryCasesPass=true;count++;
 }
 fs.writeFileSync(reportPath,JSON.stringify(report,null,2));console.log(`${count} C17 image results passed compilation and five boundary cases each.`);
}finally{fs.rmSync(dir,{recursive:true,force:true});}
