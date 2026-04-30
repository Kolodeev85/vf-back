module.exports = {
  routes: [
    {
      method: "POST",
      path: "/orders/create-full",
      handler: "order.createFullOrder",
      config: {
        auth: false,
      },
    },
  ],
};
