/**
 * Deterministic, single-pair candle-based paper research.
 * No broker, network, execution adapter or exchange credentials are accessible here.
 * Signals use only fully CLOSED bars. An order always fills no earlier than the NEXT bar open.
 * Intrabar stop and target ordering is unknowable with OHLC, so a stop wins a simultaneous hit.
 */
export type ResearchCandle = {ts:number;open:number;high:number;low:number;close:number;volume:number};
export type StrategyPreset = 'trend' | 'breakout' | 'defensive' | 'quality';
export type ResearchRequest = {strategy:StrategyPreset;startingBalance:number;feeRate:number;slippagePct:number;testFraction?:number};
export type ResearchTrade = {entryTs:number;exitTs:number;entry:number;exit:number;qty:number;pnlEur:number;pnlPct:number;exitReason:string;feesEur:number};
export type ResearchPoint = {ts:number;equity:number;benchmark:number;drawdownPct:number};
export type ResearchSummary = {startingBalance:number;finalEquity:number;returnPct:number;benchmarkReturnPct:number;maxDrawdownPct:number;trades:number;winRatePct:number|null;profitFactor:number|null;feesEur:number;exposurePct:number;avgTradeEur:number|null;biggestLossEur:number|null;bars:number};
export type ResearchSegment = {summary:ResearchSummary;curve:ResearchPoint[];trades:ResearchTrade[];from:number;to:number};
export type ResearchResult = {strategy:StrategyPreset;pair:string;period:'15m';inSample:ResearchSegment;outOfSample:ResearchSegment;stressTest:ResearchSummary;sampleSizeWarning:string|null;assumptions:string[];candles:number;splitTs:number};

const finite=(n:number)=>Number.isFinite(n);
const round=(n:number)=>Math.round(n*1e8)/1e8;
export function cleanCandles(rows:ResearchCandle[]):ResearchCandle[]{
 const ordered=[...rows].filter(c=>[c.ts,c.open,c.high,c.low,c.close,c.volume].every(finite)&&c.open>0&&c.close>0&&c.low>0&&c.high>=Math.max(c.open,c.close,c.low)&&c.low<=Math.min(c.open,c.close)&&c.volume>=0).sort((a,b)=>a.ts-b.ts);
 return ordered.filter((c,i)=>i===0||c.ts!==ordered[i-1]!.ts);
}
export function emaSeries(values:number[],period:number):number[]{const result=Array(values.length).fill(NaN) as number[];if(values.length<period)return result;let value=values.slice(0,period).reduce((s,x)=>s+x,0)/period;result[period-1]=value;const weight=2/(period+1);for(let i=period;i<values.length;i++){value=values[i]!*weight+value*(1-weight);result[i]=value;}return result;}
export function rsiSeries(values:number[],period=14):number[]{const out=Array(values.length).fill(NaN) as number[];if(values.length<=period)return out;let gains=0,losses=0;for(let i=1;i<=period;i++){const move=values[i]!-values[i-1]!;gains+=Math.max(0,move);losses+=Math.max(0,-move);}gains/=period;losses/=period;const compute=()=>losses===0?gains===0?50:100:100-100/(1+gains/losses);out[period]=compute();for(let i=period+1;i<values.length;i++){const move=values[i]!-values[i-1]!;gains=(gains*(period-1)+Math.max(0,move))/period;losses=(losses*(period-1)+Math.max(0,-move))/period;out[i]=compute();}return out;}
function maximumDrawdown(equity:number[]):number{let peak=0,worst=0;for(const value of equity){peak=Math.max(peak,value);if(peak>0)worst=Math.max(worst,(peak-value)/peak*100);}return worst;}

export function runSegment(candles:ResearchCandle[],fromIndex:number,toIndex:number,options:ResearchRequest):ResearchSegment{
 const closes=candles.map(c=>c.close),fast=emaSeries(closes,20),slow=emaSeries(closes,50),rsi=rsiSeries(closes);
 // Each hourly value is the last fully completed 60m candle. Precomputing this
 // once prevents quadratic work on the 90-day data history and avoids future bars.
 const hourlyClose:number[]=[],hourEmaAt:number[]=[],hourMomentumAt:boolean[]=[];
 let currentHourEma=NaN;
 for(let j=0;j<candles.length;j++){
  const bar=candles[j]!;
  if(Math.floor(bar.ts/900000)%4===3&&j>=3&&[1,2,3].every(back=>candles[j-back]!.ts===bar.ts-back*900000)){
   hourlyClose.push(bar.close);
   const count=hourlyClose.length;
   if(count===50)currentHourEma=hourlyClose.reduce((a,b)=>a+b,0)/50;
   else if(count>50)currentHourEma=currentHourEma*(49/51)+bar.close*(2/51);
  }
  hourEmaAt.push(currentHourEma);
  hourMomentumAt.push(hourlyClose.length>=55&&hourlyClose.at(-1)!>hourlyClose.at(-5)!);
 }
 const start=Math.max(fromIndex,52),startCandle=candles[start];if(!startCandle||toIndex<=start)return {from:0,to:0,curve:[],trades:[],summary:{startingBalance:options.startingBalance,finalEquity:options.startingBalance,returnPct:0,benchmarkReturnPct:0,maxDrawdownPct:0,trades:0,winRatePct:null,profitFactor:null,feesEur:0,exposurePct:0,avgTradeEur:null,biggestLossEur:null,bars:0}};
 let cash=options.startingBalance,qty=0,entry=0,entryTs=0,entryFee=0,stop=0,target=0,fees=0,holdingBars=0,restUntil=0,peakEquity=options.startingBalance,haltNewPositions=false,curvePeak=options.startingBalance,curveDrawdown=0;
 const trades:ResearchTrade[]=[],curve:ResearchPoint[]=[],values:number[]=[];
 const firstPrice=startCandle.open*(1+options.slippagePct);const benchmarkQty=options.startingBalance/(firstPrice*(1+options.feeRate));
 const buy=(c:ResearchCandle,sl:number,tp:number)=>{const riskFraction=options.strategy==='quality'?.0075: .0125;const budget=Math.min(cash*.25,(cash+qty*c.open)*riskFraction/sl);if(options.strategy==='quality'&&budget<10)return;const fill=c.open*(1+options.slippagePct),gross=budget/(1+options.feeRate);const acquired=gross/fill;if(acquired<=0)return;entryFee=gross*options.feeRate;fees+=entryFee;cash-=gross+entryFee;qty=acquired;entry=fill;entryTs=c.ts;stop=entry*(1-sl);target=entry*(1+tp);};
 const sell=(c:ResearchCandle,price:number,reason:string)=>{if(qty<=0)return;const fill=price*(1-options.slippagePct),gross=qty*fill,fee=gross*options.feeRate;fees+=fee;const pnl=gross-fee-(qty*entry+entryFee);cash+=gross-fee;trades.push({entryTs,exitTs:c.ts,entry:round(entry),exit:round(fill),qty:round(qty),pnlEur:round(pnl),pnlPct:round((fill/entry-1)*100-(entryFee/(qty*entry)+options.feeRate)*100),exitReason:reason,feesEur:round(entryFee+fee)});qty=0;entryFee=0;restUntil=Math.max(restUntil,Math.round((c.ts-candles[0]!.ts)/900000)+8);};
 for(let i=start;i<toIndex;i++){
  const candle=candles[i]!,previous=i-1,before=i-2;
  const crossedUp=fast[before]!<=slow[before]!&&fast[previous]!>slow[previous]!;
  const crossedDown=fast[before]!>=slow[before]!&&fast[previous]!<slow[previous]!;
  const momentum=closes[previous]!>Math.max(...closes.slice(Math.max(0,previous-20),previous));
  const volumeAverage=candles.slice(previous-20,previous).reduce((v,c)=>v+c.volume,0)/20;
  const volumeOk=volumeAverage>0&&candles[previous]!.volume/volumeAverage>=1.2;
  const previousRsi=rsi[previous]!;
  const bullish=fast[previous]!>slow[previous]!;
  // Only data from bars closed before the current execution candle.
  const past=candles.slice(Math.max(0,previous-15),previous);
  const priorVol=past.length?past.reduce((sum,c)=>sum+c.volume,0)/past.length:0;
  const atrWindow=candles.slice(Math.max(1,previous-14),previous+1);
  const trueRanges=atrWindow.map((b,j)=>{const prior=j?atrWindow[j-1]!:candles[previous-14]!;return Math.max(b.high-b.low,Math.abs(b.high-prior.close),Math.abs(b.low-prior.close));});
  const atrFraction=trueRanges.reduce((a,b)=>a+b,0)/Math.max(trueRanges.length,1)/closes[previous]!;
  const hourlyEma=hourEmaAt[previous]!;
  const priceAboveHour=Number.isFinite(hourlyEma)&&closes[previous]!>hourlyEma;
  const hourlyTrend=hourMomentumAt[previous]===true;
  const qualityEntry=bullish&&priceAboveHour&&hourlyTrend&&closes[previous]!>fast[previous]!
    &&closes[previous-2]!<=fast[previous-2]!&&previousRsi>=50&&previousRsi<=68
    &&atrFraction>=.009&&atrFraction<=.045&&priorVol>0&&candles[previous]!.volume>=priorVol*.9
    &&fast[previous]!>fast[previous-4]!;
  const equityAtOpen=cash+qty*candle.open;peakEquity=Math.max(peakEquity,equityAtOpen);
  if(equityAtOpen<peakEquity*.88)haltNewPositions=true;
  if(qty>0&&(crossedDown||previousRsi>80))sell(candle,candle.open,'Gegensignal zum nächsten Open');
  const enter=options.strategy==='trend'?crossedUp&&previousRsi>=45&&previousRsi<=70
     :options.strategy==='breakout'?bullish&&momentum&&volumeOk&&previousRsi<75
     :options.strategy==='quality'?qualityEntry
     :crossedUp&&previousRsi>=47&&previousRsi<=62&&closes[previous]!>=slow[previous]!;
  if(qty===0&&cash>options.startingBalance*.05&&enter&&(!haltNewPositions||options.strategy!=='quality')&&(options.strategy!=='quality'||i>=restUntil)){
   const sl=options.strategy==='quality'?Math.min(.08,Math.max(.035,atrFraction*2)):options.strategy==='defensive'?.035:.05;
   const tp=options.strategy==='quality'?Math.min(.30,sl*2.6):options.strategy==='breakout'?.12:.1;
   buy(candle,sl,tp);
  }
  if(qty>0){holdingBars++;
   const stopHit=candle.low<=stop;const takeHit=candle.high>=target;
   if(stopHit)sell(candle,Math.min(stop,candle.open),'Stop-Loss (bei Doppelberührung zuerst)');
   else if(takeHit)sell(candle,target,'Take-Profit');
  }
  const equity=cash+qty*candle.close;values.push(equity);
  const benchmarkValue=benchmarkQty*candle.close*(1-options.feeRate)*(1-options.slippagePct);
  curvePeak=Math.max(curvePeak,equity);curveDrawdown=Math.max(curveDrawdown,(curvePeak-equity)/curvePeak*100);
  curve.push({ts:candle.ts,equity:round(equity),benchmark:round(benchmarkValue),drawdownPct:round(curveDrawdown)});
 }
 if(qty>0){const last=candles[toIndex-1]!;sell(last,last.close,'Ende des Testfensters');const end=curve.at(-1);if(end){end.equity=round(cash);values[values.length-1]=cash;end.drawdownPct=round(maximumDrawdown([options.startingBalance,...values]));}}
 const wins=trades.filter(t=>t.pnlEur>0),losses=trades.filter(t=>t.pnlEur<0),gain=wins.reduce((s,t)=>s+t.pnlEur,0),loss=-losses.reduce((s,t)=>s+t.pnlEur,0);
 const benchmarkFinish=curve.at(-1)?.benchmark??options.startingBalance;
 return {from:startCandle.ts,to:candles[toIndex-1]!.ts,trades,curve,summary:{startingBalance:options.startingBalance,finalEquity:round(cash),returnPct:round((cash/options.startingBalance-1)*100),benchmarkReturnPct:round((benchmarkFinish/options.startingBalance-1)*100),maxDrawdownPct:round(maximumDrawdown([options.startingBalance,...values])),trades:trades.length,winRatePct:trades.length?round(wins.length/trades.length*100):null,profitFactor:loss>0?round(gain/loss):gain>0?null:null,feesEur:round(fees),exposurePct:round(holdingBars/(toIndex-start)*100),avgTradeEur:trades.length?round(trades.reduce((s,t)=>s+t.pnlEur,0)/trades.length):null,biggestLossEur:losses.length?round(Math.min(...losses.map(t=>t.pnlEur))):null,bars:toIndex-start}};
}
export function runResearch(pair:string,rows:ResearchCandle[],request:ResearchRequest):ResearchResult{
 if(!['trend','breakout','defensive','quality'].includes(request.strategy))throw Error('Unbekanntes Strategiemodell');
 if(!finite(request.startingBalance)||request.startingBalance<=0||!finite(request.feeRate)||request.feeRate<0||request.feeRate>.05||!finite(request.slippagePct)||request.slippagePct<0||request.slippagePct>.05)throw Error('Ungültige Simulationsparameter');
 const candles=cleanCandles(rows);if(candles.length<130)throw Error('Mindestens 130 geschlossene 15-Minuten-Kerzen nötig.');
 const fraction=request.testFraction??.3;if(fraction<.2||fraction>.5)throw Error('Testanteil muss 20–50 % betragen');
 const split=Math.max(65,Math.floor(candles.length*(1-fraction)));
 const inSample=runSegment(candles,52,split,request),outOfSample=runSegment(candles,split,candles.length,request);
 const stressed=runSegment(candles,split,candles.length,{...request,feeRate:Math.min(.05,request.feeRate*2),slippagePct:request.slippagePct*2});
 return {strategy:request.strategy,pair,period:'15m',inSample,outOfSample,stressTest:stressed.summary,candles:candles.length,splitTs:candles[split]!.ts,
  sampleSizeWarning:outOfSample.summary.trades<20?'Wenig abgeschlossene Trades im Testzeitraum: Trefferquote und Rendite sind statistisch nicht belastbar.':null,
  assumptions:['Keine Zukunftsdaten: Signal auf abgeschlossener Kerze, Ausführung frühestens zum nächsten Open.','Pro Position werden maximal 25 % des verfügbaren Kapitals verwendet; kein Hebel oder Short.','Market-Fill als Candle-Open plus/minus feste Slippage; keine historische Orderbuchtiefe vorhanden.','Stop-Loss wird im ungünstigen Fall vor Take-Profit ausgeführt, wenn beide im selben Zeitfenster getroffen werden.','Die 30 % jüngsten Daten bleiben ein separater Testzeitraum. Keine automatische Parameteroptimierung.','Konfigurierte Börsengebühren werden bei jedem Ein- und Ausstieg berücksichtigt. Historische Ergebnisse sind keine Prognose.','Qualitätsstrategie: nur bestätigter Aufwärtstrend, Volatilitätsfenster, RSI, Pausen zwischen Signalen, dynamische Stops und maximal 0,75 % nominelles Positionsrisiko (ohne Gaps/Kosten).']};
}
