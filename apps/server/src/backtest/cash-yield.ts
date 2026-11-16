/**
 * Pure optional cash-yield assumption for research and forward simulations.
 * Not a historical rate series, guaranteed yield, or implementation of staking.
 * Exchange and stablecoin counterparty/depeg risks are not modelled.
 */
export const CASH_YIELD_SENSITIVITIES=[0,0.03,0.06] as const;
export type CashYieldApy=typeof CASH_YIELD_SENSITIVITIES[number];
export const CASH_YIELD_WARNING='Annahme, kein belegter historischer Zins; Gegenparteirisiko nicht modelliert.';

export function validateCashYieldApy(value:number|undefined):CashYieldApy {
 const apy=value??0;
 if(apy!==0&&apy!==0.03&&apy!==0.06)
  throw Error('Cash yield APY must be one of the preregistered 0%, 3% or 6% sensitivities');
 return apy;
}

/** Non-invested quote cash only; no compounding on unrealized position values. */
export function dailyCashYield(cash:number,apy:CashYieldApy):number {
 if(!Number.isFinite(cash)||cash<0)throw Error('Invalid cash balance for research yield');
 return cash*apy/365;
}
