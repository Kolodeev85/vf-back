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
  ],
};
