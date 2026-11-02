// 02-01 confirmed values only. No tax, storage-GB or undefined sharing policy.
export const planCatalog = {
  FREE: { price: { monthly: 0, quarterly: null, yearly: null }, quotas: { publicListings: 3, draftListings: 1, archivedListings: 10, publicArticles: 1, draftArticles: 1, archivedArticles: 5 } },
  BASIC: { price: { monthly: 299, quarterly: 718, yearly: 2512 }, quotas: { publicListings: 30, draftListings: 30, archivedListings: 100, publicArticles: 50, draftArticles: 100, archivedArticles: 100 } },
  ADVANCED: { price: { monthly: 499, quarterly: 1198, yearly: 4192 }, quotas: { publicListings: 100, draftListings: 100, archivedListings: 300, publicArticles: 100, draftArticles: 100, archivedArticles: 200 } },
  UNLIMITED: { price: { monthly: 749, quarterly: 1798, yearly: 6292 }, quotas: { publicListings: null, draftListings: 300, archivedListings: 1000, publicArticles: 100, draftArticles: 100, archivedArticles: 300 } },
} as const;
export type Plan = keyof typeof planCatalog;
