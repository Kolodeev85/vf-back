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

      for (const order of orders) {
        const items = order.order_items || [];

        for (const item of items) {
          const dish = item.dish;
          if (!dish) continue;

          const dishId = dish.id;
          const quantity = Number(item.quantity || 0);
          const cookingTime = Number(dish.cookingTime || 0);

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
        ingredients,
        orders: kitchenOrders,
      };
    } catch (error) {
      console.error(error);
      return ctx.internalServerError("Error calculating ingredients summary");
    }
  },
}));
