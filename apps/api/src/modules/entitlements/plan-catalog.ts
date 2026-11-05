// 02-01, revision 2026-11-05. No invented GB, tax policy or payment activation.
export const planCatalog = {
  FREE: { price: { monthly: 0, quarterly: null, yearly: null }, quotas: { publicListings: 1, draftListings: 3, archivedListings: 10, publicArticles: 1, draftArticles: 1, archivedArticles: 5 } },
  BASIC: { price: { monthly: 199, quarterly: null, yearly: null }, quotas: { publicListings: 30, draftListings: 30, archivedListings: 50, publicArticles: 10, draftArticles: 5, archivedArticles: 30 } },
  ADVANCED: { price: { monthly: 399, quarterly: null, yearly: null }, quotas: { publicListings: 80, draftListings: 80, archivedListings: 200, publicArticles: 30, draftArticles: 15, archivedArticles: 100 } },
  FLAGSHIP: { price: { monthly: 749, quarterly: 1798, yearly: 6292 }, quotas: { publicListings: 300, draftListings: 300, archivedListings: 1000, publicArticles: 100, draftArticles: 100, archivedArticles: 300 } },
} as const;
export type Plan = keyof typeof planCatalog;
export const planNames: Record<Plan, string> = { FREE: '免費', BASIC: '基本', ADVANCED: '進階', FLAGSHIP: '旗艦' };
export function planTools(plan: Plan) {
  return { importDrafts: plan !== 'FREE', botDrafts: plan === 'ADVANCED' || plan === 'FLAGSHIP',
    createCards: plan === 'ADVANCED' || plan === 'FLAGSHIP', initiateTransfer: plan === 'ADVANCED' || plan === 'FLAGSHIP',
    receiveTransfer: true, chooseAddressVisibility: true, nearbyMap: true, generalUrlSharing: true };
}
