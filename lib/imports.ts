export const IMPORT_PIPELINE = ["Queued","Resolving company","Loading company profile","Loading annual statements","Loading quarterly statements","Loading market prices","Normalizing data","Calculating metrics","Validating data","Complete"] as const;
export type ImportPipelineState = typeof IMPORT_PIPELINE[number] | "Partial" | "Failed";
export function resumeImportState(state: ImportPipelineState) { if(state==="Complete")return "Complete" as const; if(state==="Partial"||state==="Failed")return "Queued" as const; return state; }
export function nextImportState(state: ImportPipelineState) { const index=IMPORT_PIPELINE.indexOf(state as typeof IMPORT_PIPELINE[number]); return index<0?"Queued":IMPORT_PIPELINE[Math.min(index+1,IMPORT_PIPELINE.length-1)]; }
