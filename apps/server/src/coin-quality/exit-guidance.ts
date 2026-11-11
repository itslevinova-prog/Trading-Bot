import type {PublicSignal,QualityInput,RiskProfile} from './contracts.js';

const DAY=86_400_000;
export type ExitGuidance = Readonly<{
  symbol:string;
  asOf:number;
  action:'no-exit-indication'|'review'|'hold-only'|'exit-now'|'exit-by';
  deadlineMs:number|null;
  reason:string;
  sources:'unofficial-public-signals';
  automaticExecution:false;
}>;

/** A conservative human/Paper-only EXIT ADVISORY, never an order.
 * Positive signals must be observed by the decision cutoff, and negative
 * claims need explicit per-symbol coverage. No current tags can be
 * back-projected into an historical candle or used as a past signal.
 */
export function adviseQualityExit(
  input:Pick<QualityInput,'symbol'|'tags'|'delistings'>,
  asOf:number,profile:RiskProfile,staleHours=48,
):ExitGuidance {
  if(!Number.isSafeInteger(asOf)||asOf<0||
    !Number.isFinite(staleHours)||staleHours<0||staleHours>48||
    !['vorsichtig','normal','aggressiv'].includes(profile))
    throw Error('Invalid point-in-time exit guidance parameters');
  const symbol=input.symbol;
  if(!/^[A-Z0-9]{4,30}$/.test(symbol))
    throw Error('Invalid exit guidance symbol');
  const result=(action:ExitGuidance['action'],reason:string,deadlineMs:number|null=null):ExitGuidance=>
    Object.freeze({symbol,asOf,action,deadlineMs,reason,
      sources:'unofficial-public-signals',automaticExecution:false});
  const usable=(feed:PublicSignal|null):feed is PublicSignal=>
    !!feed&&feed.available===true&&Number.isSafeInteger(feed.fetchedAt)&&
    feed.fetchedAt>=0&&feed.fetchedAt<=asOf&&
    asOf-feed.fetchedAt<=staleHours*3_600_000&&
    Array.isArray(feed.symbols)&&feed.symbols.every(s=>typeof s==='string');
  const delist=usable(input.delistings)&&input.delistings.symbols.includes(symbol);
  const monitored=usable(input.tags)&&input.tags.symbols.includes(symbol);

  if(delist){
    const rawDeadline=input.delistings!.effectiveAt?.[symbol];
    const knownDeadline=typeof rawDeadline==='number'&&Number.isSafeInteger(rawDeadline)&&
      rawDeadline>=0?rawDeadline:null;
    if(profile==='vorsichtig'||knownDeadline!==null&&knownDeadline<=asOf)
      return result('exit-now','Delisting signal observed; immediate manual/Paper exit review (unofficial)');
    if(profile==='normal')
      return result('exit-by','Delisting signal observed; review exit within 24h (unofficial)',
        knownDeadline===null?asOf+DAY:Math.min(asOf+DAY,knownDeadline));
    if(knownDeadline===null)
      return result('review','Delisting signal but no reliable effective time; manual exit review now');
    return result('exit-by','Delisting signal; review exit before observed deadline (unofficial)',
      knownDeadline-1);
  }
  if(monitored){
    if(profile==='vorsichtig')
      return result('exit-by','Monitoring/Seed signal; review exit within 24h (unofficial)',asOf+DAY);
    return result('hold-only','Monitoring/Seed signal; no new entries; review existing position (unofficial)');
  }
  // An absent/expired/incomplete public website feed is NOT proof that a
  // previously held symbol has no delisting/monitoring warning.
  const clears=(feed:PublicSignal|null)=>
    usable(feed)&&feed.clearForAll===true&&Array.isArray(feed.coverage)&&
    feed.coverage.includes(symbol);
  if(!clears(input.tags)||!clears(input.delistings))
    return result('review','Monitoring/delisting source missing, stale or without per-symbol coverage');
  return result('no-exit-indication','No positive warning within covered public feeds; not proof of safety');
}
