import { expect, test } from 'vitest';
import { checkConfirmedPublicationRules } from '../src/modules/listings/publication-check.js';
import { equipmentCodes } from '../src/modules/listings/input-rules.js';
import { residentialRentalTypes, residentialBuildingTypes } from '../src/modules/listings/listing-options.js';
const candidate = () => ({
  title:'住宅', description:'完整租屋條件', rentalType:'INDEPENDENT_SUITE', buildingType:'TOWNHOUSE', areaPings:8.5, areaSource:'INTERIOR',
  address:{cityCode:'66',districtCode:'01',addressLine:'測試路1號',roomNumber:'A室',roomIdentifierSource:'CUSTOM',addressKind:'STANDARD'},
  totalFloors:4, floorMode:'SINGLE', floorFrom:2, bathrooms:1, sharedSpaces:[], rent:20000,
  depositMode:'MONTHS',depositMonths:2,elevatorStatus:'UNKNOWN',petPolicy:'NOT_ALLOWED',cookingPolicy:'DISCUSS',
  laundryStatus:'SHARED',dryingStatus:'NONE',garbageStatus:'SELF',subsidyPolicy:'UNKNOWN',minimumLeaseMonths:1,occupancyMode:'NEGOTIABLE',
  publisherType:'LANDLORD',contactName:'陳先生',contactPhone:'0912345678',contactEmail:null,contactLine:null,
  carParkingStatus:'NO',motorcycleParkingStatus:'UNKNOWN',moderationStatus:'NONE',
  equipmentItems:equipmentCodes.map(code=>({code,status:'UNKNOWN'})),
  utilityCharges:['WATER','ELECTRICITY','GAS','INTERNET'].map(kind=>({kind,mode:'INCLUDED'})),
  feeItems:[{kind:'MANAGEMENT',label:'管理費',mode:'NONE',required:true}],
  media:Array.from({length:3},(_,i)=>({isCover:i===0,asset:{displayUrl:'private/display',thumbnailUrl:'private/thumb',gpsRemovedAt:new Date()}})),
});
const codes = (v: Record<string,unknown>) => checkConfirmedPublicationRules(v).issues.map(i=>i.code);
test('complete local fields never authorize publishing or verify external evidence',()=>{
  const v=candidate(),before=structuredClone(v),result=checkConfirmedPublicationRules(v);
  expect(result.confirmedRulesPassed).toBe(true);
  expect(result.outstandingChecks).toContain('CONTACT_CONTROL_VERIFICATION');
  expect(result).not.toHaveProperty('canPublish');
  expect(JSON.stringify(result)).not.toContain('0912345678');
  expect(v).toEqual(before);
});
test.each(residentialRentalTypes)('current rental type $value has its required layout',({value})=>{
 const v={...candidate(),rentalType:value};
 if(value==='ENTIRE_HOME'||value==='ENTIRE_BUILDING')Object.assign(v,{bedrooms:0,livingRooms:0,bathrooms:1,balconies:0});
 if(value==='ENTIRE_BUILDING')Object.assign(v,{floorMode:'ENTIRE_BUILDING',floorFrom:null});
 if(value==='ROOM')Object.assign(v,{bathrooms:0,sharedSpaces:['BATHROOM']});
 expect(checkConfirmedPublicationRules(v).confirmedRulesPassed).toBe(true);
});
test.each(residentialBuildingTypes)('current building type $value does not imply elevator',({value})=>{
 expect(checkConfirmedPublicationRules({...candidate(),buildingType:value,buildingDescription:'其他住宅'}).confirmedRulesPassed).toBe(true);
});
test.each(['SUITE','ENTIRE_FLOOR','SHOP','PARKING'])('legacy/unsupported %s requires correction',rentalType=>{
 expect(codes({...candidate(),rentalType})).toContain('INVALID_FIELD');
});
test.each([0,.001,8.125,10000.01,NaN,Infinity])('rejects area %s',areaPings=>expect(codes({...candidate(),areaPings})).toContain('INVALID_FIELD'));
test.each([.01,10000])('accepts area boundary %s',areaPings=>expect(checkConfirmedPublicationRules({...candidate(),areaPings}).confirmedRulesPassed).toBe(true));
test('email alone never satisfies phone/LINE and invalid URL is not LINE',()=>{
 expect(codes({...candidate(),contactPhone:null,contactEmail:'x@example.test'})).toContain('CONTACT_CHANNEL_REQUIRED');
 expect(codes({...candidate(),contactPhone:null,contactLine:'https://evil.test/'})).toContain('INVALID_FIELD');
 expect(checkConfirmedPublicationRules({...candidate(),contactPhone:null,contactLine:'https://lin.ee/abc123'}).confirmedRulesPassed).toBe(true);
});
test('missing area source, equipment, issuer company and fee details are explicit',()=>{
 const r=checkConfirmedPublicationRules({...candidate(),areaSource:null,equipmentItems:[],publisherType:'AGENT',feeItems:[{kind:'MANAGEMENT',label:'管理費',mode:'FIXED',required:true}]});
 expect(r.issues.map(i=>i.path)).toEqual(expect.arrayContaining(['areaSource','equipmentItems.BED','companyName','feeItems.0']));
 expect(r.feeSummary).toBeNull();
});
test('seasonal rates need description instead of a fabricated single rate',()=>{
 const v=candidate(); const utilities=v.utilityCharges.filter(u=>u.kind!=='ELECTRICITY');
 const electric={kind:'ELECTRICITY',mode:'METERED',variableRate:true,description:'夏季每度6元，非夏季每度5元'};
 expect(checkConfirmedPublicationRules({...v,utilityCharges:[...utilities,electric]}).confirmedRulesPassed).toBe(true);
 expect(codes({...v,utilityCharges:[...utilities,{...electric,description:null}]})).toContain('METERED_DETAILS_REQUIRED');
});
test('basement and nonconsecutive floors allowed; too-high and empty multiple floors rejected',()=>{
 expect(checkConfirmedPublicationRules({...candidate(),floorMode:'MULTIPLE',floorFrom:null,floors:[-1,2,4]}).confirmedRulesPassed).toBe(true);
 expect(codes({...candidate(),floorMode:'MULTIPLE',floors:[5]})).toContain('FLOOR_EXCEEDS_TOTAL');
 expect(codes({...candidate(),floorMode:'MULTIPLE',floors:[]})).toContain('FLOOR_REQUIRED');
});
test.each([0,2,31])('rejects %i photos',n=>expect(codes({...candidate(),media:Array.from({length:n},()=>candidate().media[0])})).toContain('PHOTO_COUNT_OUT_OF_RANGE'));
test('platform restrictions and unprocessed assets block local checks',()=>{
 expect(codes({...candidate(),moderationStatus:'BLOCKED'})).toContain('PLATFORM_RESTRICTED');
 expect(codes({...candidate(),media:[{isCover:true,asset:null},...candidate().media.slice(1)]})).toContain('PHOTO_PROCESSING_UNCONFIRMED');
});
test('parking status, mandatory fee and optional choice cannot contradict',()=>{
 expect(codes({...candidate(),carParkingStatus:'YES'})).toContain('PARKING_DETAILS_REQUIRED');
 expect(codes({...candidate(),feeItems:[...candidate().feeItems,{kind:'CAR_PARKING',label:'車位',mode:'FIXED',amount:2000,frequency:'MONTHLY',required:true}]})).toContain('PARKING_FEE_CONFLICT');
});
