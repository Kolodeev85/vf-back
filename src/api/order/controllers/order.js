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

      const { branchId } = ctx.query;
      if (!branchId) {
        return ctx.badRequest("branchId is required");
      }

      const orders = await strapi.entityService.findMany("api::order.order", {
        filters: {
          status: {
            $in: activeStatuses,
          },
          branch: branchId,
        },
        populate: {
          order_items: {
            populate: ["dish"],
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

          if (!groupedDishesMap[dishId]) {
            groupedDishesMap[dishId] = {
              dishId,
              name: dish.name,
              quantity: 0,
              orderIds: new Set(),
            };
          }

          groupedDishesMap[dishId].quantity += Number(item.quantity || 0);
          groupedDishesMap[dishId].orderIds.add(order.id);
        }
      }

      const groupedDishes = Object.values(groupedDishesMap).map((dish) => ({
        dishId: dish.dishId,
        name: dish.name,
        quantity: dish.quantity,
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
            populate: ["ingredient"],
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
                  branch: branchId,
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
          percent,
          status,
        };
      });

      return {
        groupedDishes,
        ingredients,
      };
    } catch (error) {
      console.error(error);
      return ctx.internalServerError("Error calculating ingredients summary");
    }
  },
}));
