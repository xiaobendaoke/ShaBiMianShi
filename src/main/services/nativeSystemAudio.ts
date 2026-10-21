import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import fs from 'node:fs';
export class NativeSystemAudio {
  private child?: ChildProcessWithoutNullStreams;
  private monitor?:ReturnType<typeof setInterval>;
  private cancel?:()=>void;
  async start(executable:string,frame:(samples:Float32Array)=>void,health:(value:{frames:number;rms:number;state:string})=>void,failed:(message:string)=>void) {
    this.stop();if(!fs.existsSync(executable))throw Error('缺少系统声音采集组件，请使用最新完整安装包');
    const child=spawn(executable,[],{stdio:'pipe'});this.child=child;
    let input=Buffer.alloc(0),sum=0,count=0,offset=0,output=new Float32Array(1600),frames=0,rms=0,lastFrame=Date.now(),lastSound=0;
    let ready=false,settled=false,diagnostic='';let timeout:ReturnType<typeof setTimeout>;
    await new Promise<void>((resolve,reject)=>{
      this.cancel=()=>{if(!settled){settled=true;reject(Error('系统声音连接已取消'));}};
      const fail=(message:string)=>{if(this.child!==child)return;const wasSettled=settled;if(!settled){settled=true;reject(Error(message));}this.stop();if(wasSettled)failed(message);};
      timeout=setTimeout(()=>fail('获取系统声音超时，请检查屏幕与系统音频录制权限后重试'),20000);
      child.once('error',()=>fail('无法启动系统声音采集组件'));
      child.once('exit',()=>fail('系统声音采集已结束，请检查屏幕与系统音频录制权限后重试'));
      child.stderr.on('data',(data:Buffer)=>{
        diagnostic=(diagnostic+data.toString()).slice(-2000);
        if(diagnostic.includes('ERROR:')){
          const code=diagnostic.match(/code=(-?\d+)/)?.[1];
          fail(diagnostic.includes('ERROR:permission')?'系统声音未获得屏幕与系统音频录制权限，请授权此应用并完整重启后重试':diagnostic.includes('ERROR:pcm')?'系统声音PCM格式不兼容，采集已停止':diagnostic.includes('ERROR:stopped')?`系统声音音轨已结束${code?'（'+code+'）':''}，请重新开始`:`系统声音采集启动失败${code?'（'+code+'）':''}，请检查音源和系统权限`);return;
        }
        if(!ready&&diagnostic.includes('READY')){
          ready=true;settled=true;clearTimeout(timeout);resolve();
          this.monitor=setInterval(()=>{
            if(this.child!==child)return;
            if(Date.now()-lastFrame>5000){fail('系统音轨未持续提供PCM采样，请检查权限、设备和会议播放状态');return;}
            health({frames,rms,state:lastSound===0?'等待有效声音':Date.now()-lastSound>5000?'当前静音':'已收到声音'});
          },500);
        }
      });
      child.stdout.on('data',(data:Buffer)=>{
        if(this.child!==child)return;
        input=Buffer.concat([input,data]);const bytes=input.length-input.length%4;
        for(let i=0;i<bytes;i+=4){
          const value=input.readFloatLE(i);if(!Number.isFinite(value)){fail('系统声音返回了无效PCM采样');return;}
          sum+=value;count++;
          if(count===3){output[offset++]=sum/3;sum=0;count=0;}
          if(offset===1600){let energy=0;for(const sample of output)energy+=sample*sample;rms=Math.sqrt(energy/output.length);frames++;lastFrame=Date.now();if(rms>0.001)lastSound=Date.now();frame(output);output=new Float32Array(1600);offset=0;}
        }
        input=Buffer.from(input.subarray(bytes));
      });
    }).finally(()=>clearTimeout(timeout));
  }
  stop(){const child=this.child;this.child=undefined;this.cancel?.();this.cancel=undefined;clearInterval(this.monitor);this.monitor=undefined;if(child){child.stdout.removeAllListeners('data');child.stderr.removeAllListeners('data');child.kill('SIGTERM');}}
}
