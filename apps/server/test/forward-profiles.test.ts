import {describe,it,expect} from 'vitest';
import {advance,initialState,DAY,ACCOUNTS,PROFILES,profileParameters,summary,stableLike} from '../src/forward/engine-v2.js';
import {dayReport,overviewReport} from '../src/forward/report.js';
import type {LotRules} from '../src/forward/lots.js';
const start=Date.UTC(2026,10,12);
const rules:LotRules=Object.fromEntries(['BTCUSDT','ETHUSDT'].map(s=>[s,{stepSize:'0.00001000',minQty:'0.00001000',minNotional:'5.00000000'}]));
const candles=(slope:number)=>Object.fromEntries(['BTCUSDT','ETHUSDT'].map(symbol=>[symbol,Array.from({length:265},(_,i)=>{
 const price=50000+i*slope+Math.sin(i)*400;
 return {ts:start+(i-260)*DAY,open:price,high:price+1000,low:price-1000,close:price+100,volume:1e6,quoteVolume:1e8};
})]));
describe('forward risk profiles',()=>{
 it('maps the three capped paper profiles to monotone planner knobs',()=>{
  const [v,n,a]=PROFILES.map(profileParameters);
  expect(PROFILES).toEqual(['vorsichtig','normal','aggressiv']);
  expect(v!.maxInvestedPct).toBeLessThan(n!.maxInvestedPct);expect(n!.maxInvestedPct).toBeLessThanOrEqual(a!.maxInvestedPct);
  expect(v!.targetAnnualVol).toBeLessThan(n!.targetAnnualVol);expect(n!.targetAnnualVol).toBeLessThan(a!.targetAnnualVol);
  for(const p of [v,n,a])expect(p!.maxPositionPct).toBeLessThanOrEqual(.30);
 });
 it('trades every profile independently in an uptrend and documents each decision',()=>{
  const s=advance(initialState(start,'code',rules),candles(200),start+DAY,start+DAY);
  for(const account of ACCOUNTS){expect(s.accounts[account].cash).toBeGreaterThanOrEqual(0);expect(s.points[0]![account]).not.toBeNull();}
  for(const account of PROFILES)expect(s.fills.some(f=>f.account===account)).toBe(true);
  const invested=(a:'vorsichtig'|'aggressiv')=>s.fills.filter(f=>f.account===a).reduce((n,f)=>n+f.qty*f.price,0);
  expect(invested('vorsichtig')).toBeLessThan(invested('aggressiv'));
  const details=s.points[0]!.details.join('\n');
  expect(details).toMatch(/200-Tage-EMA .* Abstand/);expect(details).toMatch(/Rangliste/);
  for(const p of PROFILES)expect(details).toContain(p+' (Vol-Ziel');
 });
 it('explains how far BTC is from a buy signal in a downtrend',()=>{
  const s=advance(initialState(start,'code',rules),candles(-100),start+DAY,start+DAY);
  expect(s.fills.filter(f=>!['hold','dca'].includes(f.account))).toHaveLength(0);
  expect(s.points[0]!.details[0]).toMatch(/unter EMA: nur Cash; Kaufsignal erst bei Schluss über [\d.]+ USDT, also \+[\d.]+ %/);
 });
 it('writes readable day and overview reports with all six accounts',()=>{
  const s=advance(initialState(start,'code',rules),candles(200),start+3*DAY,start+3*DAY);
  const day=dayReport(s,s.points[0]!);
  for(const h of ['## Entscheidung','## Begründung','## Kontostände','## Simulierte Trades','Profil aggressiv'])expect(day).toContain(h);
  const metrics=Object.fromEntries(ACCOUNTS.map(a=>[a,summary(s,a)])) as Parameters<typeof overviewReport>[2];
  const overview=overviewReport(s,'id',metrics);
  for(const h of ['## Gesamtstand','## Letzte Begründung','## Letzte 7 Tage','Wochenveränderung','Profil vorsichtig','BTC kaufen und halten'])expect(overview).toContain(h);
 });
});

describe('forward stablecoin guard',()=>{
 const flat=(p:number,amp:number)=>Array.from({length:265},(_,i)=>{const c=p+Math.sin(i)*amp;return {ts:start+(i-260)*DAY,open:c,high:c*1.001,low:c*.999,close:c,volume:1e6,quoteVolume:1e8};});
 it('detects pegged coins by behaviour and keeps volatile coins',()=>{
  expect(stableLike(flat(1,.0005))).toBe(true);
  expect(stableLike(flat(1,.05))).toBe(false);
  expect(stableLike(flat(50000,100))).toBe(false);
 });
 it('excludes stable-like coins from the ranking and documents it',()=>{
  const data={...candles(200),NEWUSDUSDT:flat(1,.0005)};
  const lots={...rules,NEWUSDUSDT:{stepSize:'0.01000000',minQty:'0.01000000',minNotional:'5.00000000'}};
  const s=advance(initialState(start,'code',lots),data,start+DAY,start+DAY);
  expect(s.fills.some(f=>f.symbol==='NEWUSDUSDT')).toBe(false);
  const text=s.points[0]!.details.join('\n');
  expect(text).toContain('Als Stablecoin erkannt und ausgeschlossen');expect(text).toContain('NEWUSDUSDT');
  expect(text).not.toMatch(/Rangliste[^\n]*NEWUSDUSDT/);
 });
 it('names the BTC regime as the reason for no trade in risk-off',()=>{
  const s=advance(initialState(start,'code',rules),candles(-100),start+DAY,start+DAY);
  expect(s.points[0]!.details.find(d=>d.startsWith('Basis'))).toContain('BTC unter 200-Tage-EMA, deshalb kein Einstieg');
 });
});
