module.exports = {
  routes: [
    {
      method: "GET",
      path: "/kitchen/ingredients-summary",
      handler: "order.ingredientsSummary",
      config: {
        auth: false,
      },
    },
    {
      method: "PUT",
      path: "/kitchen/orders/:id/start-cooking",
      handler: "order.startCooking",
      config: {
        auth: false,
      },
    },
    {
      method: "PUT",
      path: "/kitchen/orders/:orderId/items/:itemId/ready",
      handler: "order.markItemReady",
      config: {
        auth: false,
      },
    },
    {
      method: "PUT",
      path: "/kitchen/orders/:id/ready",
      handler: "order.orderReady",
      config: {
        auth: false,
      },
    },
    {
      method: "GET",
      path: "/kitchen/orders",
      handler: "order.kitchenOrders",
      config: {
        auth: false,
      },
    },
    {
      method: "PUT",
      path: "/kitchen/orders/:id/cancel",
      handler: "order.cancelOrder",
      config: {
        auth: false,
      },
    },
    {
      method: "GET",
      path: "/orders-page/orders",
      handler: "order.ordersPageList",
      config: {
        auth: false,
      },
    },
  ],
};
