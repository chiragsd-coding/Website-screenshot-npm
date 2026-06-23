export const PLANS = {
    free: {
        id: 'free',
        name: 'Free Tier',
        price: 0,
        limit: 50,
        viewports: ['desktop'],
        concurrency: 1,
        webhooks: false,
    },
    pro: {
        id: 'pro',
        name: 'Pro Tier',
        price: 29,
        limit: 2000,
        viewports: ['desktop', 'tablet', 'mobile'],
        concurrency: 5,
        webhooks: false,
    },
    business: {
        id: 'business',
        name: 'Business Tier',
        price: 99,
        limit: 10000,
        viewports: ['desktop', 'tablet', 'mobile'],
        concurrency: 20,
        webhooks: true,
    },
    enterprise: {
        id: 'enterprise',
        name: 'Enterprise Tier',
        price: 500, // custom placeholder
        limit: 999999999, // unlimited
        viewports: ['desktop', 'tablet', 'mobile'],
        concurrency: 50,
        webhooks: true,
    },
};
export function getPlanByTier(tier) {
    const normalized = tier.toLowerCase();
    return PLANS[normalized] || PLANS.free;
}
