// @ts-nocheck
"use strict";

/**
 * order controller
 */

const { createCoreController } = require("@strapi/strapi").factories;

module.exports = createCoreController("api::order.order", ({ strapi }) => ({
  async createFullOrder(ctx) {
    try {
      const { branchId, customer, type, address, paymentType, comment, items } =
        ctx.request.body;

      // 1. проверка клиента
      if (!customer || !customer.phone) {
        return ctx.badRequest("Customer phone is required");
      }
      // проверка филиала
      if (!branchId) {
        return ctx.badRequest("branchId is required");
      }

      // 2. ищем клиента по телефону
      const existingCustomers = await strapi.entityService.findMany(
        "api::customer.customer",
        {
          filters: {
            phone: customer.phone,
          },
          limit: 1,
        }
      );

      let customerEntity = existingCustomers[0];

      // 3. если нет — создаём
      if (!customerEntity) {
        customerEntity = await strapi.entityService.create(
          "api::customer.customer",
          {
            data: {
              name: customer.name,
              phone: customer.phone,
            },
          }
        );
      }

      // 4. проверка items
      if (!items || !Array.isArray(items) || items.length === 0) {
        return ctx.badRequest("Items are required");
      }

      let totalPrice = 0;
      const preparedItems = [];

      // 5. обрабатываем блюда
      for (const item of items) {
        const dish = await strapi.entityService.findOne(
          "api::dish.dish",
          item.dishId
        );

        if (!dish) {
          return ctx.badRequest(`Dish with id ${item.dishId} not found`);
        }

        const quantity = Number(item.quantity);

        if (!quantity || quantity <= 0) {
          return ctx.badRequest("Quantity must be greater than 0");
        }

        const price = Number(dish.price);
        const subtotal = price * quantity;

        totalPrice += subtotal;

        preparedItems.push({
          dish: dish.id,
          quantity,
          price,
          subtotal,
        });
      }

      // 6. создаём заказ
      const order = await strapi.entityService.create("api::order.order", {
        data: {
          status: "new",
          type,
          totalPrice,
          address,
          paymentType,
          comment,
          customer: customerEntity.id,
          branch: branchId,
        },
      });

      // 7. создаём order-items
      for (const item of preparedItems) {
        await strapi.entityService.create("api::order-item.order-item", {
          data: {
            order: order.id,
            dish: item.dish,
            quantity: item.quantity,
            price: item.price,
            subtotal: item.subtotal,
          },
        });
      }

      // 8. возвращаем заказ
      const fullOrder = await strapi.entityService.findOne(
        "api::order.order",
        order.id,
        {
          populate: {
            customer: true,
            order_items: {
              populate: ["dish"],
            },
          },
        }
      );

      return {
        success: true,
        order: fullOrder,
      };
    } catch (error) {
      console.error(error);
      return ctx.internalServerError("Error creating order");
    }
  },
  async startCooking(ctx) {
    try {
      const { id } = ctx.params;

      if (!id) {
        return ctx.badRequest("order id is required");
      }

      const order = await strapi.entityService.findOne("api::order.order", id, {
        populate: {
          order_items: true,
        },
      });

      if (!order) {
        return ctx.notFound("Order not found");
      }

      if (order.status !== "new") {
        return ctx.badRequest("Only new orders can be started");
      }

      const now = new Date();

      await strapi.entityService.update("api::order.order", id, {
        data: {
          status: "cooking",
          startedCookingAt: now,
        },
      });

      const items = order.order_items || [];

      for (const item of items) {
        await strapi.entityService.update(
          "api::order-item.order-item",
          item.id,
          {
            data: {
              status: "cooking",
            },
          }
        );
      }

      const updatedOrder = await strapi.entityService.findOne(
        "api::order.order",
        id,
        {
          populate: {
            customer: true,
            order_items: {
              populate: ["dish"],
            },
          },
        }
      );

      return {
        success: true,
        order: updatedOrder,
      };
    } catch (error) {
      console.error(error);
      return ctx.internalServerError("Error starting cooking");
    }
  },
  async markItemReady(ctx) {
    try {
      const { orderId, itemId } = ctx.params;

      if (!orderId) {
        return ctx.badRequest("orderId is required");
      }

      if (!itemId) {
        return ctx.badRequest("itemId is required");
      }

      const order = await strapi.entityService.findOne(
        "api::order.order",
        orderId,
        {
          populate: {
            order_items: true,
          },
        }
      );

      if (!order) {
        return ctx.notFound("Order not found");
      }

      if (order.status !== "cooking") {
        return ctx.badRequest("Only cooking orders can be updated");
      }

      const items = order.order_items || [];

      const currentItem = items.find(
        (item) => Number(item.id) === Number(itemId)
      );

      if (!currentItem) {
        return ctx.badRequest("Order item not found in this order");
      }

      if (currentItem.status === "ready") {
        return {
          success: true,
          message: "Item already ready",
        };
      }

      await strapi.entityService.update("api::order-item.order-item", itemId, {
        data: {
          status: "ready",
        },
      });

      const updatedItems = await strapi.entityService.findMany(
        "api::order-item.order-item",
        {
          filters: {
            order: orderId,
          },
        }
      );

      const allItemsReady =
        updatedItems.length > 0 &&
        updatedItems.every((item) => item.status === "ready");

      const updatedOrder = await strapi.entityService.findOne(
        "api::order.order",
        orderId,
        {
          populate: {
            customer: true,
            order_items: {
              populate: ["dish"],
            },
          },
        }
      );

      return {
        success: true,
        allItemsReady,
        order: updatedOrder,
      };
    } catch (error) {
      console.error(error);
      return ctx.internalServerError("Error marking item ready");
    }
  },
  async orderReady(ctx) {
    try {
      const { id } = ctx.params;

      if (!id) {
        return ctx.badRequest("order id is required");
      }

      const order = await strapi.entityService.findOne("api::order.order", id, {
        populate: {
          order_items: true,
        },
      });

      if (!order) {
        return ctx.notFound("Order not found");
      }

      if (order.status !== "cooking") {
        return ctx.badRequest("Only cooking orders can be marked as ready");
      }

      const items = order.order_items || [];

      const allItemsReady =
        items.length > 0 && items.every((item) => item.status === "ready");

      if (!allItemsReady) {
        return ctx.badRequest("All order items must be ready first");
      }

      const updatedOrder = await strapi.entityService.update(
        "api::order.order",
        id,
        {
          data: {
            status: "ready",
            readyAt: new Date(),
          },
          populate: {
            customer: true,
            order_items: {
              populate: ["dish"],
            },
          },
        }
      );

      return {
        success: true,
        order: updatedOrder,
      };
    } catch (error) {
      console.error(error);
      return ctx.internalServerError("Error marking order ready");
    }
  },
  async kitchenOrders(ctx) {
    try {
      const { branchId } = ctx.query;

      if (!branchId) {
        return ctx.badRequest("branchId is required");
      }

      const orders = await strapi.entityService.findMany("api::order.order", {
        filters: {
          branch: branchId,
        },

        sort: {
          createdAt: "desc",
        },

        populate: {
          customer: true,

          order_items: {
            populate: ["dish"],
          },
        },
      });

      const normalizedOrders = orders.map((order) => {
        const items = order.order_items || [];

        const totalCookingTime = items.reduce((acc, item) => {
          const cookingTime = Number(item?.dish?.cookingTime || 0);
          const quantity = Number(item?.quantity || 0);

          return acc + cookingTime * quantity;
        }, 0);

        return {
          id: order.id,
          status: order.status,
          type: order.type,
          address: order.address,
          paymentType: order.paymentType,
          comment: order.comment,
          totalPrice: Number(order.totalPrice || 0),

          createdAt: order.createdAt,
          startedCookingAt: order.startedCookingAt,
          readyAt: order.readyAt,

          totalCookingTime,

          customer: order.customer
            ? {
                id: order.customer.id,
                name: order.customer.name,
                phone: order.customer.phone,
              }
            : null,

          items: items.map((item) => ({
            id: item.id,
            quantity: Number(item.quantity || 0),
            price: Number(item.price || 0),
            status: item.status,

            dish: item.dish
              ? {
                  id: item.dish.id,
                  name: item.dish.name,
                  cookingTime: Number(item.dish.cookingTime || 0),
                }
              : null,
          })),
        };
      });

      return normalizedOrders;
    } catch (error) {
      console.error(error);

      return ctx.internalServerError("Error getting kitchen orders");
    }
  },
  async ingredientsSummary(ctx) {
    try {
      const activeStatuses = ["new", "cooking"];

      const { branchId, userId } = ctx.query;

      if (!userId) {
        return ctx.badRequest("userId is required");
      }

      const user = await strapi.entityService.findOne(
        "plugin::users-permissions.user",
        userId,
        {
          populate: ["branch"],
        }
      );

      if (!user) {
        return ctx.badRequest("User not found");
      }

      let activeBranchId = branchId;

      if (user.roles !== "admin") {
        activeBranchId = user.branch?.id;
      }

      if (!activeBranchId) {
        return ctx.badRequest("branchId is required");
      }

      const getImageUrl = (file) => {
        if (!file) return null;

        const image = file.formats?.thumbnail || file.formats?.small || file;

        if (!image?.url) return null;

        if (image.url.startsWith("http")) {
          return image.url;
        }

        return `${strapi.config.server.url}${image.url}`;
      };

      const orders = await strapi.entityService.findMany("api::order.order", {
        filters: {
          status: {
            $in: activeStatuses,
          },
          branch: activeBranchId,
        },
        sort: {
          createdAt: "asc",
        },
        populate: {
          customer: true,
          order_items: {
            populate: {
              dish: {
                populate: ["foto"],
              },
            },
          },
        },
      });

      const groupedDishesMap = {};
      const dishesQueue = [];

      for (const order of orders) {
        const items = order.order_items || [];
        const queueItems = [];

        for (const item of items) {
          // готовые позиции больше не нужны для кухни
          if (item.status === "ready") continue;

          const dish = item.dish;
          if (!dish) continue;

          const dishId = dish.id;
          const quantity = Number(item.quantity || 0);
          const cookingTime = Number(dish.cookingTime || 0);

          queueItems.push({
            orderItemId: item.id,
            dishId,
            name: dish.name,
            imageUrl: getImageUrl(dish.foto),
            quantity,
            cookingTime,
            totalCookingTime: cookingTime * quantity,
            status: item.status,
          });

          if (!groupedDishesMap[dishId]) {
            groupedDishesMap[dishId] = {
              dishId,
              name: dish.name,
              imageUrl: getImageUrl(dish.foto),
              cookingTime,
              quantity: 0,
              totalCookingTime: 0,
              orderIds: new Set(),
            };
          }

          groupedDishesMap[dishId].quantity += quantity;
          groupedDishesMap[dishId].totalCookingTime += cookingTime * quantity;
          groupedDishesMap[dishId].orderIds.add(order.id);
        }

        if (queueItems.length > 0) {
          dishesQueue.push({
            orderId: order.id,
            orderStatus: order.status,
            createdAt: order.createdAt,
            customer: order.customer
              ? {
                  id: order.customer.id,
                  name: order.customer.name,
                  phone: order.customer.phone,
                }
              : null,
            items: queueItems,
          });
        }
      }

      const groupedDishes = Object.values(groupedDishesMap).map((dish) => ({
        dishId: dish.dishId,
        name: dish.name,
        imageUrl: dish.imageUrl,
        cookingTime: dish.cookingTime,
        quantity: dish.quantity,
        totalCookingTime: dish.totalCookingTime,
        ordersCount: dish.orderIds.size,
      }));

      const ingredientsMap = {};

      for (const dish of groupedDishes) {
        const recipes = await strapi.entityService.findMany(
          "api::recipe.recipe",
          {
            filters: {
              dish: dish.dishId,
            },
            populate: {
              ingredient: {
                populate: ["foto"],
              },
            },
          }
        );

        for (const recipe of recipes) {
          const ingredient = recipe.ingredient;
          if (!ingredient) continue;

          const ingredientId = ingredient.id;

          const needed =
            Number(recipe.quantity || 0) * Number(dish.quantity || 0);

          if (!ingredientsMap[ingredientId]) {
            const branchIngredients = await strapi.entityService.findMany(
              "api::branch-ingredient.branch-ingredient",
              {
                filters: {
                  branch: activeBranchId,
                  ingredient: ingredient.id,
                },
                limit: 1,
              }
            );

            const branchIngredient = branchIngredients[0];

            ingredientsMap[ingredientId] = {
              ingredientId,
              name: ingredient.name,
              unit: ingredient.unit,
              imageUrl: getImageUrl(ingredient.foto),
              needed: 0,
              stock: Number(branchIngredient?.stock || 0),
              minStock: Number(branchIngredient?.minStock || 0),
            };
          }

          ingredientsMap[ingredientId].needed += needed;
        }
      }

      const ingredients = Object.values(ingredientsMap).map((item) => {
        let percent = 100;

        if (item.needed > 0) {
          percent = Math.round((item.stock / item.needed) * 100);
        }

        let status = "ok";

        if (item.stock < item.needed) {
          status = "danger";
        } else if (percent <= 120) {
          status = "warning";
        }

        return {
          ...item,
          needed: Number(item.needed.toFixed(3)),
          stock: Number(item.stock.toFixed(3)),
          minStock: Number(item.minStock.toFixed(3)),
          percent,
          status,
        };
      });

      const kitchenOrders = orders.map((order) => {
        const items = order.order_items || [];

        const totalCookingTime = items.reduce((sum, item) => {
          const quantity = Number(item.quantity || 0);
          const cookingTime = Number(item.dish?.cookingTime || 0);

          return sum + cookingTime * quantity;
        }, 0);

        return {
          id: order.id,
          status: order.status,
          type: order.type,
          address: order.address,
          paymentType: order.paymentType,
          comment: order.comment,
          totalPrice: Number(order.totalPrice || 0),
          createdAt: order.createdAt,
          startedCookingAt: order.startedCookingAt,
          readyAt: order.readyAt,
          customer: order.customer
            ? {
                id: order.customer.id,
                name: order.customer.name,
                phone: order.customer.phone,
              }
            : null,
          totalCookingTime,
          items: items.map((item) => ({
            id: item.id,
            quantity: Number(item.quantity || 0),
            price: Number(item.price || 0),
            status: item.status,
            dish: item.dish
              ? {
                  id: item.dish.id,
                  name: item.dish.name,
                  imageUrl: getImageUrl(item.dish.foto),
                  cookingTime: Number(item.dish.cookingTime || 0),
                }
              : null,
          })),
        };
      });

      return {
        branchId: activeBranchId,
        groupedDishes,
        dishesQueue,
        ingredients,
        orders: kitchenOrders,
      };
    } catch (error) {
      console.error(error);
      return ctx.internalServerError("Error calculating ingredients summary");
    }
  },
}));
