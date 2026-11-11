/** One public-market initialization at a time. Experiment execution starts only after preparation. */
export class MarketBootstrap {
 private marketReady=false;private schedulerStarted=false;private running=false;private stopped=false;
 constructor(private startMarket:()=>Promise<void>,private startScheduler:()=>void,private prepareExperiment:(()=>void)|undefined){}
 startNormalScheduler(){if(!this.prepareExperiment&&!this.schedulerStarted&&!this.stopped){this.startScheduler();this.schedulerStarted=true;}}
 async begin(){if(this.stopped||this.running||this.marketReady&&this.schedulerStarted)return;this.running=true;
  try{if(!this.marketReady){await this.startMarket();this.marketReady=true;}if(this.stopped)return;if(!this.schedulerStarted){this.prepareExperiment?.();if(this.stopped)return;this.startScheduler();this.schedulerStarted=true;}}
  finally{this.running=false;}}
 stop(){this.stopped=true;}
}
