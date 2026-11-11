import { z } from 'zod';
import { Prisma } from '@prisma/client';
// R02 uses visible graphemes, not UTF-16 code units or bytes.
const segmenter = new Intl.Segmenter('zh-TW', { granularity: 'grapheme' });
export const visibleLength = (s: string) => Array.from(segmenter.segment(s)).length;
export const textField = (max: number, min = 1) => z.string().trim().refine(s => visibleLength(s) >= min && visibleLength(s) <= max, `請填寫 ${min}～${max} 個可見字元`).refine(s => !/<\/?[A-Za-z!][^>]*>/.test(s), '不接受 HTML／可執行標記');
export const freeText = z.string().trim().min(1).refine(s => !/<\/?[A-Za-z!][^>]*>/.test(s), '不接受 HTML／可執行標記');
export const decimalWithin = (min: string, max: string, places = 2) => z.number().finite().refine(value => {
  const d = new Prisma.Decimal(value); return d.gte(min) && d.lte(max) && d.decimalPlaces() <= places;
}, `數值需介於 ${min}～${max}，最多 ${places} 位小數，不自動四捨五入`);
export const rentalTypes = ['ENTIRE_HOME','ENTIRE_BUILDING','INDEPENDENT_SUITE','SHARED_SUITE','ROOM'] as const;
export const buildingTypes = ['APARTMENT','ELEVATOR_BUILDING','MID_RISE','TOWNHOUSE','OTHER_RESIDENTIAL'] as const;
export const status3 = z.enum(['YES','NO','UNKNOWN']);
export const permission3 = z.enum(['ALLOWED','NOT_ALLOWED','DISCUSS']);
export const floorNumber = z.number().int().min(-20).max(200).refine(n => n !== 0, '地下樓以負數表示，不使用0樓');
export const feeFrequency = z.enum(['MONTHLY','QUARTERLY','YEARLY','ONCE']);
export const phoneSchema = z.string().trim().regex(/^\+?[0-9][0-9 ()-]{5,24}$/, '請填可辨識國碼及號碼，不含任意網址').refine(s => (s.match(/\d/g) ?? []).length >= 7 && (s.match(/\d/g) ?? []).length <= 15, '電話需7～15位數字');
export const lineSchema = z.string().trim().refine(value => {
  if (/^[A-Za-z0-9._-]{4,20}$/.test(value)) return true;
  try { const u=new URL(value); return u.protocol==='https:' && !u.username && !u.password && !u.port && !u.search && !u.hash &&
    ((u.hostname==='line.me' && /^\/(?:ti\/p\/[A-Za-z0-9_@~.-]+|R\/ti\/p\/[@A-Za-z0-9_.-]+)$/.test(u.pathname)) || (u.hostname==='lin.ee' && /^\/[A-Za-z0-9]+$/.test(u.pathname))); } catch { return false; }
}, '請填 LINE ID 或允許的 LINE 官方聯絡連結');
export function taiwanDate(at = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Taipei', year:'numeric',month:'2-digit',day:'2-digit' }).format(at); }
export function validNewOccupancy(date: string, at = new Date()) {
  const today=taiwanDate(at), [y,m,d]=today.split('-').map(Number);
  const lastDay=new Date(Date.UTC(y!+5,m!,0)).getUTCDate();
  const max=`${y!+5}-${String(m).padStart(2,'0')}-${String(Math.min(d!,lastDay)).padStart(2,'0')}`;
  return date>=today && date<=max;
}
const utilityKind = z.enum(['WATER','ELECTRICITY','GAS','INTERNET']);
export const utilityChargeSchema = z.object({ kind:utilityKind, mode:z.enum(['INCLUDED','BY_BILL','METERED','FIXED','NOT_PROVIDED']),
  amount:z.number().int().min(1).max(10000000).nullable().optional(), rate:decimalWithin('0.01','10000').nullable().optional(),
  unit:freeText.nullable().optional(), frequency:feeFrequency.nullable().optional(), source:freeText.nullable().optional(),
  description:freeText.nullable().optional(), variableRate:z.boolean().optional(),
}).strict().superRefine((v,c) => {
  // Drafts may omit required details; publication completeness is a separate check.
  const reject=(path:string)=>c.addIssue({code:'custom',path:[path],message:'所選計費方式不使用此欄位'});
  if(v.mode!=='FIXED' && v.amount!=null)reject('amount');
  if(v.mode!=='FIXED' && v.frequency!=null)reject('frequency');
  if(v.mode!=='METERED' && v.rate!=null)reject('rate');
  if(v.mode!=='METERED' && v.unit!=null)reject('unit');
  if(v.variableRate && (v.mode!=='METERED' || v.rate!=null))reject('variableRate');
});
export const equipmentCodes=['BED','WARDROBE','DESK_CHAIR','SOFA','REFRIGERATOR','AIR_CONDITIONER','WASHING_MACHINE','WATER_HEATER','TELEVISION'] as const;
export const equipmentItemSchema=z.object({code:z.enum(equipmentCodes),status:status3}).strict();
export const feeItemSchema=z.object({kind:z.enum(['MANAGEMENT','CAR_PARKING','MOTORCYCLE_PARKING','PET','SERVICE','OTHER']),
  label:freeText,mode:z.enum(['INCLUDED','NONE','FIXED','USAGE','PERCENT']),amount:z.number().int().min(1).max(10000000).nullable().optional(),
  frequency:feeFrequency.nullable().optional(),required:z.boolean(),description:freeText.nullable().optional(),
  percentage:decimalWithin('0.01','100').nullable().optional(), paymentTiming:freeText.nullable().optional(), payee:freeText.nullable().optional(),
}).strict().superRefine((v,c)=>{
  if(v.kind==='SERVICE' && !['NONE','FIXED','PERCENT'].includes(v.mode))c.addIssue({code:'custom',path:['mode'],message:'服務費須明確免收、固定金額或比例'});
  if(v.kind==='SERVICE' && v.frequency!=null && v.frequency!=='ONCE')c.addIssue({code:'custom',path:['frequency'],message:'一次服務費不混入週期租金'});
  if(v.mode!=='FIXED' && v.amount!=null)c.addIssue({code:'custom',path:['amount'],message:'只有固定另收使用金額'});
  if(v.mode!=='FIXED' && v.mode!=='PERCENT' && v.frequency!=null)c.addIssue({code:'custom',path:['frequency'],message:'此模式不使用固定週期'});
  if((v.mode==='PERCENT' && v.kind!=='SERVICE') || (v.mode!=='PERCENT' && v.percentage!=null))c.addIssue({code:'custom',path:['percentage'],message:'只有服務費比例模式使用百分比'});
});
export const uniqueArray = <T extends z.ZodType>(schema:T,key:string,max?:number) => {
  const a=z.array(schema); return (max===undefined?a:a.max(max)).refine(items=>new Set(items.map(item=>(item as Record<string,unknown>)[key])).size===items.length,'同一項目不可重複');
};
