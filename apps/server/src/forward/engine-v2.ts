import {configLots,floorLot,lotDecimals,type LotRules} from './lots.js';
import type {Candle} from '../backtest/candle-source.js';
import {validateCandles} from '../backtest/candle-source.js';
import {planTrendVolTargetV1,closedBtc200Detail} from '../strategy/trend-vol-target-v1.js';
import {resolvePaperRiskProfile,type RiskProfileName} from '../risk-engine/profiles.js';
import {TREND_RESEARCH_ASSUMPTIONS} from '../backtest/trend-research.js';
import {ConservativeOhlcModel} from '../backtest/fill-models.js';
import {excludedBase,median} from '../coin-quality/contracts.js';
import {paperDcaBudget,loadPaperDcaSettings} from '../dca/paper.js';
import {digest} from '../provenance/build.js';

export const DAY=86_400_000;
export const LABEL='Forschungs-Forward-Test, nicht freigegeben, keine Gewinnprognose';
export const CONFIG=Object.freeze({hypothesis:'H-025',strategy:'trend-vol-target-v1-binance-lots-v2',
 assumptions:{...TREND_RESEARCH_ASSUMPTIONS,version:'H-025-forward-binance-lots-v2',lotDecimals:null,minNotional:null},parameters:{targetAnnualVol:.20,topK:3,rebalanceTolerance:.20,atrMultiple:3},
 dca:{amount:10000,interval:'monthly',allocation:'70/30',variant:'classic'},
 profiles:['vorsichtig','normal','aggressiv'],schema:3});
export const PROFILES=CONFIG.profiles as readonly RiskProfileName[];
export const STRATEGY_ACCOUNTS=['strategy',...PROFILES] as const;
export const ACCOUNTS=['strategy',...PROFILES,'hold','dca'] as const;
export type Account=typeof ACCOUNTS[number];
/** Capped paper profile -> planner knobs; same signal, regime and exit rules as the base strategy. */
export function profileParameters(name:RiskProfileName){
 const e=resolvePaperRiskProfile(name).effective;
 return {...CONFIG.parameters,targetAnnualVol:e.targetAnnualVol,topK:Math.min(10,e.maxOpenPositions),
  maxPositionPct:Math.min(.30,e.maxPositionPct),maxInvestedPct:e.maxInvestedPct};
}
export type Wallet={cash:number;positions:Record<string,{qty:number;highestCloseSinceEntry:number|null}>};
export type Fill={day:number;account:string;symbol:string;side:'buy'|'sell';qty:number;price:number;fee:number;spread:number;slippage:number;reason:string};
export type Point={day:number;strategy:number|null;vorsichtig:number|null;normal:number|null;aggressiv:number|null;hold:number|null;dca:number|null;reason:string;
 /** Human-readable reasoning for reflection: regime distance, ranking and decisions per account. */
 details:string[]};
export type State={label:string;start:number;lastDay:number|null;configHash:string;codeHash:string;
 lotRules:LotRules;accounts:Record<Account,Wallet>;fills:Fill[];points:Point[];dcaPeriods:string[]};
export function initialState(start:number,codeHash:string,rules:LotRules):State {
 if(!Number.isSafeInteger(start)||start%DAY!==0||start< Date.UTC(2025,0,1))throw Error('Invalid forward start');
 const lotRules=configLots(rules);
 const wallet=():Wallet=>({cash:10000,positions:{}});
 return {label:LABEL,start,lastDay:null,configHash:digest(JSON.stringify({config:CONFIG,lotRules})),codeHash,lotRules,
 accounts:{strategy:wallet(),vorsichtig:wallet(),normal:wallet(),aggressiv:wallet(),hold:wallet(),dca:{cash:0,positions:{}}},fills:[],points:[],dcaPeriods:[]};
}
export const seriesId=(s:State)=>`${new Date(s.start).toISOString().slice(0,10)}-${s.configHash.slice(0,16)}-${s.codeHash.slice(0,16)}`;
const model=new ConservativeOhlcModel(TREND_RESEARCH_ASSUMPTIONS);
const settings=loadPaperDcaSettings({DCA_AMOUNT:'10000',DCA_INTERVAL:'monthly',DCA_ALLOCATION:'70/30',DCA_VARIANT:'classic'});
export function advance(input:State,data:Record<string,Candle[]>,until:number,now:number):State {
 if(!Number.isSafeInteger(until)||until%DAY!==0||until>Math.floor(now/DAY)*DAY)throw Error('Only completed days');
 if(input.configHash!==digest(JSON.stringify({config:CONFIG,lotRules:configLots(input.lotRules)})))throw Error('Changed config requires a new series');
 const rows=Object.fromEntries(Object.entries(data).map(([symbol,candles])=>[symbol,candles.filter(c=>c.ts+DAY<=until)]));
 const s:State=structuredClone(input);
 const a=CONFIG.assumptions;
 for(const list of Object.values(rows))validateCandles(list,1440,0,until);
 for(let day=s.lastDay===null?s.start:s.lastDay+DAY;day<until;day+=DAY){
  const at=(symbol:string,ts:number)=>rows[symbol]?.find(c=>c.ts===ts);
  const history=(symbol:string)=>rows[symbol]?.filter(c=>c.ts<day).slice(-240)??[];
  const complete=(symbol:string)=>history(symbol).length===240&&history(symbol).every((c,i)=>c.ts===day-(240-i)*DAY);
  const symbols=Object.keys(rows).filter(x=>x.endsWith('USDT')&&!excludedBase(x.slice(0,-4))).sort();
  const required=new Set(['BTCUSDT','ETHUSDT',...Object.values(s.accounts).flatMap(w=>Object.keys(w.positions))]);
  // Missing data blocks all accounts together; no invented marks, fills or zero-valued holdings.
  const bad=[...required].some(x=>!at(x,day)||!complete(x));
  const value=(w:Wallet,field:'open'|'close')=>w.cash+Object.entries(w.positions).reduce((n,[symbol,p])=>n+p.qty*at(symbol,day)![field],0);
  const fill=(account:Account,symbol:string,side:'buy'|'sell',amount:number,reason:string)=>{
   const bar=at(symbol,day);if(!bar)return;
   const w=s.accounts[account],quote=model.entry(bar,side),p=w.positions[symbol];
   const rule=s.lotRules[symbol];if(!rule)throw Error('Missing frozen lot rule: '+symbol);
   const raw=side==='buy'?Math.min(amount,w.cash)/(quote.price*(1+a.feeRate)):Math.min(amount,p?.qty??0);
   const qty=floorLot(raw,rule);
   const notional=qty*quote.price,fee=notional*a.feeRate;
   if(qty<Number(rule.minQty)||qty<=0||notional<Number(rule.minNotional))return;
   w.cash+=side==='buy'?-(notional+fee):notional-fee;
   const total=(p?.qty??0)+(side==='buy'?qty:-qty);
   if(total>1e-10)w.positions[symbol]={qty:total,highestCloseSinceEntry:p?.highestCloseSinceEntry??bar.open};else delete w.positions[symbol];
   s.fills.push({day,account,symbol,side,qty,price:quote.price,fee,spread:qty*quote.spreadCost,slippage:qty*quote.slippageCost,reason});
  };
  let reason='Fehlende oder veraltete Tagesdaten: kein Handel; Bewertung unbekannt';
  const details:string[]=[];
  if(!bad){
   const markets=symbols.filter(pair=>complete(pair)&&s.lotRules[pair]).map(pair=>{
    const daily=history(pair),volumes=daily.slice(-30).map(c=>c.quoteVolume??NaN);
    return {pair,daily,quality:(daily[0]!.ts<=day-a.minAgeDays*DAY&&(median(volumes)??0)>=a.minMedianQuoteVolume30d?'allowed':'unknown') as 'allowed'|'unknown',
     assumedRoundtripBps:2*a.feeRate*10000+a.spreadBps+2*a.slippageBps,
     lot:{minQty:Number(s.lotRules[pair]!.minQty),minNotional:Number(s.lotRules[pair]!.minNotional),decimals:lotDecimals(s.lotRules[pair]!)}};
   });
   const btc=closedBtc200Detail(history('BTCUSDT'),day);
   if(btc){
    const gap=btc.close/btc.ema200-1;
    details.push(`BTC-Schluss Vortag ${btc.close.toFixed(2)} USDT, 200-Tage-EMA ${btc.ema200.toFixed(2)} USDT, Abstand ${(gap*100).toFixed(2)} % `+
     (gap>0?'(über EMA: Einstiege erlaubt).':`(unter EMA: nur Cash; Kaufsignal erst bei Schluss über ${btc.ema200.toFixed(2)} USDT, also +${((btc.ema200/btc.close-1)*100).toFixed(2)} %).`));
   }
   const pct=(x:number)=>(x*100).toFixed(1)+' %';
   for(const account of STRATEGY_ACCOUNTS){
    const w=s.accounts[account];
    // Only yesterday's close and older candles enter the strategy. Today's candle is execution/valuation only.
    const previousEquity=w.cash+Object.entries(w.positions).reduce((n,[symbol,p])=>n+p.qty*at(symbol,day-DAY)!.close,0);
    // Base = planner defaults (30 % max position, 100 % max invested), unchanged behaviour.
    const parameters=account==='strategy'?{...CONFIG.parameters,maxPositionPct:.30,maxInvestedPct:1}:profileParameters(account);
    const plan=planTrendVolTargetV1({asOf:day,quote:a.quote,equity:previousEquity,cash:w.cash,markets,
     positions:Object.entries(w.positions).map(([pair,p])=>({pair,...p})),...parameters});
    if(account==='strategy'){
     reason=plan.reason;
     details.push(plan.ranked.length?'Rangliste (Momentum/Volatilität): '+plan.ranked.map(x=>`${x.pair} Trendstärke ${pct(x.strength)}, Vol ${pct(x.annualVol)}, Zielgewicht ${pct(x.weight)}`).join('; ')+'.':
      'Rangliste: kein Coin erfüllt Trend-, Qualitäts- und Kostenfilter.');
    }
    const before=s.fills.length;
    for(const action of plan.actions){
     if(action.type==='buy')fill(account,action.pair,'buy',action.amountEur,action.reasoning);
     if(action.type==='sell')fill(account,action.pair,'sell',(w.positions[action.pair]?.qty??0)*action.sellFraction,action.reasoning);
    }
    const done=s.fills.slice(before).map(f=>`${f.side==='buy'?'Kauf':'Verkauf'} ${f.qty} ${f.symbol} zu ${f.price.toFixed(2)} (${f.reason})`);
    const holds=plan.actions.filter(x=>x.type==='hold').map(x=>x.reasoning);
    details.push(`${account==='strategy'?'Basis':account} (Vol-Ziel ${pct(parameters.targetAnnualVol)}, max. ${parameters.topK} Positionen, max. investiert ${pct(parameters.maxInvestedPct)}): `+
     (done.length?done.join('; '):'kein Trade – '+(holds[0]??'Signal unter Rebalancing-Toleranz oder unter Mindestmenge'))+'.');
   }
   if(!s.fills.some(f=>f.account==='hold'))fill('hold','BTCUSDT','buy',s.accounts.hold.cash,'BTC Buy & Hold ab S');
   const period=new Date(day).toISOString().slice(0,7);
   if(!s.dcaPeriods.includes(period)){
    s.accounts.dca.cash+=settings.amount;s.dcaPeriods.push(period);
    const budget=paperDcaBudget(settings,settings.amount,s.accounts.dca.cash,null)!;
    fill('dca','BTCUSDT','buy',budget*settings.allocation.btc,'Monatlicher Sparplan 70/30');
    fill('dca','ETHUSDT','buy',budget*settings.allocation.eth,'Monatlicher Sparplan 70/30');
   }
   for(const wallet of Object.values(s.accounts))for(const [symbol,p] of Object.entries(wallet.positions))
    p.highestCloseSinceEntry=Math.max(p.highestCloseSinceEntry??0,at(symbol,day)!.close);
  }
  const v=(x:Account)=>bad?null:value(s.accounts[x],'close');
  s.points.push({day,strategy:v('strategy'),vorsichtig:v('vorsichtig'),normal:v('normal'),aggressiv:v('aggressiv'),hold:v('hold'),dca:v('dca'),reason,details});
  s.lastDay=day;
 }
 return s;
}

/** Cash-flow-neutral DCA returns; missing valuation days invalidate aggregate claims. */
export function summary(s:State,account:Account) {
 const points=s.points;
 if(!points.length||points.some(p=>p[account]===null))return null;
 let previous=account==='dca'?0:CONFIG.assumptions.initialCash,index=1,peak=1,drawdown=0;
 const returns:number[]=[];
 for(const p of points){
  const deposit=account==='dca'&&(p.day===s.start||new Date(p.day).getUTCDate()===1)?CONFIG.dca.amount:0;
  const r=p[account]!/(previous+deposit)-1;
  if(!Number.isFinite(r))return null;
  returns.push(r);index*=1+r;peak=Math.max(peak,index);drawdown=Math.max(drawdown,1-index/peak);previous=p[account]!;
 }
 const mean=returns.reduce((n,x)=>n+x,0)/returns.length;
 const sd=Math.sqrt(returns.reduce((n,x)=>n+(x-mean)**2,0)/Math.max(1,returns.length-1));
 const fills=s.fills.filter(f=>f.account===account);
 return {return:index-1,maxDrawdown:drawdown,sharpe:returns.length>=30&&sd>0?mean/sd*Math.sqrt(365):null,
 turnover:fills.reduce((n,f)=>n+f.qty*f.price,0)/CONFIG.assumptions.initialCash,
 costs:fills.reduce((n,f)=>n+f.fee+f.spread+f.slippage,0)};
}
