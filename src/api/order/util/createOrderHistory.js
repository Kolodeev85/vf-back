"use strict";

const createOrderHistory = async (strapi, data) => {
  try {
    if (!data?.order || !data?.action) {
      return null;
    }

    return await strapi.entityService.create(
      "api::order-history.order-history",
      {
        data: {
          order: data.order,
          action: data.action,
          title: data.title || "",
          message: data.message || "",
          oldStatus: data.oldStatus || null,
          newStatus: data.newStatus || null,
          meta: data.meta || {},
          user: data.user || null,
        },
      }
    );
  } catch (error) {
    console.error("ERROR CREATE ORDER HISTORY", error);
    return null;
  }
};

module.exports = createOrderHistory;
