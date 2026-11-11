import { expect,test } from 'vitest';
import { feeItemSchema } from '../src/modules/listings/input-rules.js';
import { summarizeRentalFees } from '../src/modules/listings/fee-summary.js';
const noDeposit={mode:'NONE',amount:null,months:null};
const fee=(value:unknown)=>feeItemSchema.parse(value);
test('R03 example, optional parking, deposit and one-time service stay separate',()=>{
 const fees=[fee({kind:'MANAGEMENT',label:'管理費',mode:'FIXED',amount:3000,frequency:'QUARTERLY',required:true}),
 fee({kind:'CAR_PARKING',label:'必租車位',mode:'FIXED',amount:2000,frequency:'MONTHLY',required:true}),
 fee({kind:'OTHER',label:'選配',mode:'FIXED',amount:1000,frequency:'MONTHLY',required:false}),
 fee({kind:'SERVICE',label:'服務費',mode:'PERCENT',percentage:50,frequency:'ONCE',required:true,payee:'房仲',paymentTiming:'簽約時'})];
 const summary=summarizeRentalFees(20000,fees,[{kind:'ELECTRICITY',mode:'BY_BILL',source:'台電'}],{mode:'MONTHS',amount:null,months:1.5});
 expect(summary.fixedMonthlyTotal).toBe(23000);expect(summary.depositAmount).toBe(30000);
 expect(summary.oneTimeFees[0]?.amount).toBe(10000);expect(summary.optionalFeeIndexes).toEqual([2]);expect(summary.guaranteedMoveInTotal).toBeNull();
});
test('sum annual fractions before rounding once; fixed utilities included',()=>{
 const fees=Array.from({length:6},()=>fee({kind:'OTHER',label:'年費',mode:'FIXED',amount:1,frequency:'YEARLY',required:true}));
 const result=summarizeRentalFees(1,fees,[{kind:'INTERNET',mode:'FIXED',amount:1,frequency:'YEARLY'}],noDeposit);
 expect(result.fixedMonthlyTotal).toBe(2);expect(result.approximate).toBe(true);
});
test('missing compulsory fixed charge never becomes zero',()=>{
 expect(summarizeRentalFees(20000,[fee({kind:'MANAGEMENT',label:'未知',mode:'FIXED',required:true})],[],noDeposit).fixedMonthlyTotal).toBeNull();
});
test.each([0,100.01,1.234])('reject service percentage %s',percentage=>{
 expect(feeItemSchema.safeParse({kind:'SERVICE',label:'費',mode:'PERCENT',percentage,required:true}).success).toBe(false);
});
test('percentage never applies to non-service fee; conflicting amounts rejected',()=>{
 expect(feeItemSchema.safeParse({kind:'OTHER',label:'費',mode:'PERCENT',percentage:10,required:true}).success).toBe(false);
 expect(feeItemSchema.safeParse({kind:'SERVICE',label:'費',mode:'PERCENT',percentage:10,amount:20,required:true}).success).toBe(false);
});
