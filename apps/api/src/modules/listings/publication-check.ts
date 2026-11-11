import { draftPatchSchema } from './draft.schema.js';
import { equipmentCodes, validNewOccupancy } from './input-rules.js';
import { summarizeRentalFees } from './fee-summary.js';

export interface PublicationCandidate { [key: string]: unknown }
export interface PublicationIssue { code: string; path: string; rule: '02-06' | '02-09' }
// These checks need trustworthy server evidence/transactions, never client booleans.
export const outstandingPublicationChecks = [
  'AUTHENTICATED_OWNER_AND_PUBLISHER_ELIGIBILITY', 'CURRENT_STATE_AND_ATOMIC_PUBLIC_QUOTA',
  'ADDRESS_VERIFICATION_REGION_GROUPING_AND_PUBLIC_PRIVACY', 'CONTACT_CONTROL_VERIFICATION',
  'ORIGINAL_IMAGE_FORMAT_SIZE_AND_USAGE_RIGHTS', 'CURRENT_REVISION_AND_PUBLIC_PREVIEW_CONFIRMATION',
] as const;

/** Read-only diagnostics on the canonical draft DTO. Never authorizes publication. */
export function checkConfirmedPublicationRules(candidate: PublicationCandidate, at = new Date()) {
  const issues: PublicationIssue[] = [];
  const add = (code: string, path: string, rule: PublicationIssue['rule'] = '02-06') => issues.push({ code, path, rule });
  const input = Object.fromEntries(Object.keys(draftPatchSchema.shape).filter(key => Object.hasOwn(candidate, key)).map(key => [key, candidate[key]]));
  const parsed = draftPatchSchema.safeParse(input);
  if (!parsed.success) for (const issue of parsed.error.issues) add('INVALID_FIELD', issue.path.join('.'));
  const v = parsed.success ? parsed.data : {};
  const required = ['title','description','rentalType','buildingType','areaPings','areaSource','totalFloors','floorMode',
    'rent','depositMode','elevatorStatus','petPolicy','cookingPolicy','laundryStatus','dryingStatus','garbageStatus',
    'subsidyPolicy','minimumLeaseMonths','occupancyMode','publisherType','contactName','carParkingStatus','motorcycleParkingStatus'] as const;
  for (const key of required) if (v[key] == null) add('REQUIRED_FIELD', key);
  if (candidate.moderationStatus !== 'NONE') add('PLATFORM_RESTRICTED','moderationStatus','02-09');
  if (!v.contactPhone && !v.contactLine) add('CONTACT_CHANNEL_REQUIRED','contact');
  if (v.contactExtension && !v.contactPhone) add('PHONE_REQUIRED_FOR_EXTENSION','contactExtension');
  if (v.buildingType === 'OTHER_RESIDENTIAL' && !v.buildingDescription) add('REQUIRED_FIELD','buildingDescription');
  if (!v.address?.cityCode || !v.address.districtCode || !v.address.addressLine || !v.address.addressKind) add('ADDRESS_REQUIRED','address');
  if (['INDEPENDENT_SUITE','SHARED_SUITE','ROOM'].includes(v.rentalType ?? '') && (!v.address?.roomNumber || !v.address.roomIdentifierSource)) add('UNIT_IDENTIFIER_REQUIRED','address.roomNumber');
  if (v.rentalType === 'ENTIRE_BUILDING' ? v.floorMode !== 'ENTIRE_BUILDING' : v.floorMode === 'ENTIRE_BUILDING') add('FLOOR_MODE_CONFLICT','floorMode');
  if ((v.floorMode !== 'MULTIPLE' && v.floors?.length) || ((v.floorMode === 'MULTIPLE' || v.floorMode === 'ENTIRE_BUILDING') && (v.floorFrom != null || v.floorTo != null)) || (v.floorMode === 'SINGLE' && v.floorTo != null)) add('FLOOR_MODE_CONFLICT','floorMode');
  if(v.floorMode==='RANGE') add('LEGACY_FLOOR_CONFIRMATION_REQUIRED','floorMode');
  const levels = v.floorMode === 'MULTIPLE' ? v.floors ?? [] : v.floorMode === 'RANGE' ? [v.floorFrom,v.floorTo] : v.floorMode === 'SINGLE' ? [v.floorFrom] : [];
  if (v.floorMode && v.floorMode !== 'ENTIRE_BUILDING' && (!levels.length || levels.some(n => n == null))) add('FLOOR_REQUIRED','floors');
  if (levels.some(n => n != null && v.totalFloors != null && n > v.totalFloors)) add('FLOOR_EXCEEDS_TOTAL','floors');
  if (v.floorMode === 'RANGE' && v.floorFrom != null && v.floorTo != null && v.floorFrom >= v.floorTo) add('FLOOR_RANGE_INVALID','floorTo');
  if (v.rentalType === 'ENTIRE_HOME' || v.rentalType === 'ENTIRE_BUILDING') {
    for (const key of ['bedrooms','livingRooms','bathrooms','balconies'] as const) if (v[key] == null) add('REQUIRED_FIELD',key);
  } else if (v.rentalType) {
    if (!v.sharedSpaces) add('REQUIRED_FIELD','sharedSpaces');
    if (v.rentalType === 'ROOM') {
      if (v.bathrooms !== 0) add('ROOM_HAS_NO_PRIVATE_BATHROOM','bathrooms');
      if (!v.sharedSpaces?.includes('BATHROOM')) add('SHARED_BATHROOM_REQUIRED','sharedSpaces');
    } else if (v.bathrooms == null || v.bathrooms < 1) add('PRIVATE_BATHROOM_REQUIRED','bathrooms');
  }
  if ((v.depositMode === 'NONE' && v.deposit != null && v.deposit !== 0) || (v.depositMode === 'MONTHS' && v.deposit != null) || (v.depositMode !== 'MONTHS' && v.depositMonths != null)) add('DEPOSIT_MODE_CONFLICT','depositMode');
  if (v.depositMode === 'FIXED' && (!v.deposit || v.deposit < 1)) add('DEPOSIT_REQUIRED','deposit');
  if (v.depositMode === 'MONTHS' && v.depositMonths == null) add('DEPOSIT_MONTHS_REQUIRED','depositMonths');
  if ((v.occupancyMode === 'IMMEDIATE' || v.occupancyMode === 'NEGOTIABLE') && v.availableFrom != null) add('OCCUPANCY_MODE_CONFLICT','availableFrom');
  if (v.occupancyMode === 'DATE' && (!v.availableFrom || !validNewOccupancy(v.availableFrom,at))) add('OCCUPANCY_DATE_INVALID','availableFrom');
  if ((v.petPolicy === 'ALLOWED' || v.petPolicy === 'DISCUSS') && !v.petConditions) add('PET_CONDITIONS_REQUIRED','petConditions');
  if (v.publisherType === 'AGENT' && !v.companyName) add('COMPANY_REQUIRED','companyName');
  if (v.publisherType === 'AUTHORIZED_REPRESENTATIVE' && !v.authorizationDescription) add('AUTHORIZATION_DESCRIPTION_REQUIRED','authorizationDescription');
  for (const code of equipmentCodes) if (!v.equipmentItems?.some(item => item.code === code)) add('EQUIPMENT_STATUS_REQUIRED',`equipmentItems.${code}`);
  const utilities = v.utilityCharges ?? [];
  for (const kind of ['WATER','ELECTRICITY','GAS','INTERNET']) {
    const u = utilities.find(item => item.kind === kind);
    if (!u) { add('UTILITY_REQUIRED',`utilityCharges.${kind}`); continue; }
    if (u.mode === 'BY_BILL' && !u.source) add('BILL_SOURCE_REQUIRED',`utilityCharges.${kind}.source`);
    if (u.mode === 'FIXED' && (u.amount == null || !u.frequency)) add('FIXED_FEE_REQUIRED',`utilityCharges.${kind}`);
    if (u.mode === 'METERED' && (u.variableRate ? !u.description : u.rate == null || !u.unit)) add('METERED_DETAILS_REQUIRED',`utilityCharges.${kind}`);
  }
  const fees = v.feeItems ?? [];
  if(v.serviceFeeDescription && !fees.some(f=>f.kind==='SERVICE')) add('SERVICE_FEE_DETAILS_REQUIRED','feeItems');
  if (!fees.some(f => f.kind === 'MANAGEMENT')) add('MANAGEMENT_FEE_REQUIRED','feeItems');
  fees.forEach((f,index) => {
    const path = `feeItems.${index}`;
    if (f.mode === 'FIXED' && (f.amount == null || !f.frequency)) add('FIXED_FEE_REQUIRED',path);
    if (f.mode === 'PERCENT' && (f.percentage == null || !f.frequency)) add('PERCENTAGE_FEE_REQUIRED',path);
    if (f.mode === 'USAGE' && !f.description) add('USAGE_DESCRIPTION_REQUIRED',path);
    if (f.kind === 'SERVICE' && !['NONE','FIXED','PERCENT'].includes(f.mode)) add('SERVICE_FEE_MODE_INVALID',path);
    if (f.kind === 'SERVICE' && f.mode !== 'NONE' && (f.frequency !== 'ONCE' || !f.paymentTiming || !f.payee)) add('SERVICE_PAYMENT_DETAILS_REQUIRED',path);
    if (f.kind === 'MANAGEMENT' && !f.required) add('MANAGEMENT_IS_REQUIRED',path);
  });
  for (const prefix of ['car','motorcycle'] as const) {
    const status = v[`${prefix}ParkingStatus`], kind = prefix === 'car' ? 'CAR_PARKING' : 'MOTORCYCLE_PARKING';
    const f = fees.filter(item => item.kind === kind);
    if (status === 'YES' && (!['FLAT','MECHANICAL','OTHER'].includes(v[`${prefix}ParkingType`] ?? '') || v[`${prefix}ParkingRequired`] == null || f.length !== 1)) add('PARKING_DETAILS_REQUIRED',`${prefix}ParkingStatus`);
    if (f.some(item => status !== 'YES' || item.required !== v[`${prefix}ParkingRequired`])) add('PARKING_FEE_CONFLICT',`${prefix}ParkingStatus`);
  }
  const media = Array.isArray(candidate.media) ? candidate.media as Array<{isCover?: boolean; asset?: {displayUrl?: string; thumbnailUrl?: string; gpsRemovedAt?: unknown} | null}> : [];
  if (media.length < 3 || media.length > 30) add('PHOTO_COUNT_OUT_OF_RANGE','media');
  if (media.filter(p => p.isCover === true).length !== 1) add('EXACTLY_ONE_COVER_REQUIRED','media');
  media.forEach((photo,index) => { if (!photo.asset?.displayUrl?.trim() || !photo.asset.thumbnailUrl?.trim() || !photo.asset.gpsRemovedAt) add('PHOTO_PROCESSING_UNCONFIRMED',`media.${index}.asset`); });
  return { confirmedRulesPassed: issues.length === 0, issues, outstandingChecks: outstandingPublicationChecks,
    feeSummary: parsed.success && v.rent != null && !issues.some(i => i.path.startsWith('feeItems') || i.path.startsWith('utilityCharges') || i.path.startsWith('deposit')) ? summarizeRentalFees(v.rent,fees,utilities,{mode:v.depositMode ?? null,amount:v.deposit ?? null,months:v.depositMonths ?? null}) : null };
}
