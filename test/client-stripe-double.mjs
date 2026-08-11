let sequence = 0;

export function useClientStripeDouble(clientTest) {
  process.env.STRIPE_PRICE_BASIC ||= 'price_test_basic';
  process.env.STRIPE_PRICE_PRO ||= 'price_test_pro';
  clientTest.setStripeForTests({
    customers: {
      async create() {
        sequence += 1;
        return { id: `cus_test_client_${sequence}` };
      },
    },
    subscriptions: {
      async create() {
        return { id: `sub_test_client_${sequence}` };
      },
    },
  });
}
