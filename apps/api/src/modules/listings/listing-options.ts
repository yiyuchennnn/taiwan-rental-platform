// Confirmed in product discussion; existing stored values are not rewritten.
export const residentialRentalTypes = [
  { value: "ENTIRE_FLOOR", label: "整層住家" },
  { value: "SUITE", label: "套房" },
  { value: "ROOM", label: "雅房" },
  { value: "ENTIRE_BUILDING", label: "整棟住家" },
] as const;

export const areaInputHint = "可填估算值，請盡量提供本次出租範圍的室內使用面積，不含共用公設；套房、雅房請勿填整戶坪數。";
export const areaDisplayDisclaimer = "面積由刊登者提供，實際範圍請於看房時確認。";

export const residentialBuildingTypes = [
  { value: "APARTMENT", label: "公寓" },
  { value: "RESIDENTIAL_BUILDING", label: "住宅大樓" },
  { value: "TOWNHOUSE", label: "透天厝" },
  { value: "OTHER_RESIDENTIAL", label: "其他住宅" },
] as const;

export const sharedSpaceOptions = [
  { value: "BATHROOM", label: "衛浴" },
  { value: "KITCHEN", label: "廚房" },
  { value: "LIVING_ROOM", label: "客廳" },
  { value: "LAUNDRY", label: "洗衣空間" },
  { value: "BALCONY", label: "陽台" },
] as const;
