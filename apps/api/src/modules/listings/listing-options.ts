// Confirmed in product discussion; existing stored values are not rewritten.
export const residentialRentalTypes = [
  { value: "ENTIRE_HOME", label: "整戶" }, { value: "ENTIRE_BUILDING", label: "整棟" },
  { value: "INDEPENDENT_SUITE", label: "獨立套房" }, { value: "SHARED_SUITE", label: "分租套房" },
  { value: "ROOM", label: "雅房" },
] as const;
export const areaInputHint = "請填本次出租範圍的面積，並選擇室內使用、權狀或刊登者估計；分租不填整戶面積，共用面積另說明。";
export const areaDisplayDisclaimer = "面積及來源由刊登者提供，實際範圍請於看房時確認。";
export const residentialBuildingTypes = [
  { value: "APARTMENT", label: "公寓" }, { value: "ELEVATOR_BUILDING", label: "電梯大樓" },
  { value: "MID_RISE", label: "華廈" }, { value: "TOWNHOUSE", label: "透天" },
  { value: "OTHER_RESIDENTIAL", label: "其他" },
] as const;

export const sharedSpaceOptions = [
  { value: "BATHROOM", label: "衛浴" },
  { value: "KITCHEN", label: "廚房" },
  { value: "LIVING_ROOM", label: "客廳" },
  { value: "LAUNDRY", label: "洗衣空間" },
  { value: "BALCONY", label: "陽台" },
] as const;
