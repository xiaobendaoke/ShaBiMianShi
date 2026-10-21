declare const __INTERVIEW_BUILD_ID__: string;
export const BUILD_ID = typeof __INTERVIEW_BUILD_ID__ === 'string' ? __INTERVIEW_BUILD_ID__ : 'development';
export const IPC_VERSION = 2;
export const SCHEMA_VERSION = 2;
export interface RuntimeInfo {buildId:string;preloadBuildId?:string;ipcVersion:number;startedAt:number;pid:number;dataDirectory:string;schemaVersion:number;ready:boolean;capabilities:string[];keyHealth:{state:string;message?:string};}
export function runtimeMismatch(main:RuntimeInfo,preload:{buildId:string;ipcVersion:number}) {
  return !main.ready||main.buildId!==BUILD_ID||preload.buildId!==BUILD_ID||main.ipcVersion!==IPC_VERSION||preload.ipcVersion!==IPC_VERSION||main.schemaVersion!==SCHEMA_VERSION;
}
