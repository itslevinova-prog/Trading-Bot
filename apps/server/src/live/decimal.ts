/** Exact decimal step arithmetic. Numbers are converted to plain decimals first. */
function parts(input:string){if(typeof input==='string'&&input.startsWith('.'))input='0'+input;if(typeof input!=='string'||input.length>80||!/^\d+(\.\d+)?$/.test(input)||(input.split('.')[1]?.length??0)>40)throw Error('Invalid positive decimal');const [whole,fraction='']=input.split('.');return {digits:BigInt(whole!+fraction),scale:fraction.length};}
export function floorStep(value:string,step:string):string{
 const v=parts(value),s=parts(step);if(s.digits===0n)throw Error('Zero step');const scale=Math.max(v.scale,s.scale),unit=s.digits*10n**BigInt(scale-s.scale),n=v.digits*10n**BigInt(scale-v.scale),result=n/unit*unit;return format(result,scale);
}
export function ceilStep(value:string,step:string):string{const v=parts(value),s=parts(step);if(s.digits===0n)throw Error('Zero step');const scale=Math.max(v.scale,s.scale),unit=s.digits*10n**BigInt(scale-s.scale),n=v.digits*10n**BigInt(scale-v.scale);return format((n+unit-1n)/unit*unit,scale);}
function format(n:bigint,scale:number){const text=n.toString().padStart(scale+1,'0');return scale?`${text.slice(0,-scale)}.${text.slice(-scale)}`:text;}
export const plain=(value:number)=>{if(!Number.isFinite(value)||value<0||value>=1e15)throw Error('Invalid amount');return value.toFixed(12);};

export function addDecimal(a:string,b:string){const x=parts(a),y=parts(b),scale=Math.max(x.scale,y.scale);return format(x.digits*10n**BigInt(scale-x.scale)+y.digits*10n**BigInt(scale-y.scale),scale);}
export function compareDecimal(a:string,b:string){const x=parts(a),y=parts(b),scale=Math.max(x.scale,y.scale),left=x.digits*10n**BigInt(scale-x.scale),right=y.digits*10n**BigInt(scale-y.scale);return left<right?-1:left>right?1:0;}
export function commonStep(values:string[]){const parsed=values.map(parts).filter(x=>x.digits>0n);if(!parsed.length)throw Error('No positive quantity step');const scale=Math.max(...parsed.map(x=>x.scale));const gcd=(a:bigint,b:bigint):bigint=>{while(b){const rest=a%b;a=b;b=rest;}return a;};let result=1n;for(const value of parsed){const n=value.digits*10n**BigInt(scale-value.scale);result=result/gcd(result,n)*n;}return format(result,scale);}

export function subtractDecimal(a:string,b:string){const x=parts(a),y=parts(b),scale=Math.max(x.scale,y.scale),difference=x.digits*10n**BigInt(scale-x.scale)-y.digits*10n**BigInt(scale-y.scale);if(difference<0n)throw Error('Negative decimal remainder');return format(difference,scale);}

/** Preserve the exact decimal spelling of a finite JS number; never round a fraction upward. */
export function numberDecimal(value:number){
 if(!Number.isFinite(value)||value<0||value>=1e15)throw Error('Invalid decimal number');const text=String(value);if(!text.includes('e')){parts(text);return text;}
 const [mantissa,exponentText]=text.split('e'),exponent=Number(exponentText),digits=mantissa!.replace('.',''),point=(mantissa!.split('.')[0]!.length)+exponent;
 const result=point<=0?'0.'+'0'.repeat(-point)+digits:point>=digits.length?digits+'0'.repeat(point-digits.length):digits.slice(0,point)+'.'+digits.slice(point);parts(result);return result;
}
/** Exact multiplication and quantum rounding, including fractions written with an exponent. */
export function multiplyToStep(value:string,factor:string,step:string,roundUp=false){
 const a=parts(value),b=parts(factor),s=parts(step);if(s.digits===0n)throw Error('Zero step');const productScale=a.scale+b.scale,scale=Math.max(productScale,s.scale),unit=s.digits*10n**BigInt(scale-s.scale),n=a.digits*b.digits*10n**BigInt(scale-productScale),rounded=(roundUp?(n+unit-1n)/unit:n/unit)*unit;
 const text=format(rounded,scale);return text.includes('.')?text.replace(/0+$/,'').replace(/\.$/,''):text;
}
export function basisPointFraction(value:number){const p=parts(numberDecimal(value));return format(p.digits,p.scale+4);}
