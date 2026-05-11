// @ts-nocheck
"use strict";

/**
 * order controller
 */

const { createCoreController } = require("@strapi/strapi").factories;
const createOrderHistory = require("../util/createOrderHistory");

module.exports = createCoreController("api::order.order", ({ strapi }) => ({
  async update(ctx) {
    try {
      const { id } = ctx.params;
      const user = ctx.state.user;
      const bodyData = ctx.request.body?.data || ctx.request.body || {};
      const newStatus = bodyData.status;

      const oldOrder = await strapi.entityService.findOne(
        "api::order.order",
        id
      );

      if (!oldOrder) {
        return ctx.notFound("Order not found");
      }

      const oldStatus = oldOrder.status;

      const updatedOrder = await strapi.entityService.update(
        "api::order.order",
        id,
        {
          data: bodyData,
          populate: {
            customer: true,
            branch: true,
            order_items: {
              populate: ["dish"],
            },
          },
        }
      );

      if (newStatus && oldStatus !== newStatus) {
        await strapi.entityService.create("api::order-history.order-history", {
          data: {
            order: id,
            user: user?.id || null,
            fromStatus: oldStatus,
            toStatus: newStatus,
            changedAt: new Date(),
          },
        });
      }

      return {
        success: true,
        order: updatedOrder,
      };
    } catch (error) {
      console.error(error);
      return ctx.internalServerError("Error updating order");
    }
  },
  async createFullOrder(ctx) {
    try {
      const {
        branchId,
        customer,
        type,
        address,
        paymentType,
        comment,
        items,
        scheduledFor,
      } = ctx.request.body;

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
          scheduledFor: scheduledFor || new Date(),
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

      await createOrderHistory(strapi, {
        order: order.id,
        action: "created",
        title: "Order created",
        message: "Order was created",
        newStatus: "new",
        user: ctx.state.user?.id || null,
        meta: {
          branchId,
          customerId: customerEntity.id,
          totalPrice,
          scheduledFor: scheduledFor || new Date(),
        },
      });

      // 8. возвращаем заказ
      const fullOrder = await strapi.entityService.findOne(
        "api::order.order",
        order.id,
        {
          populate: {
            order_histories: true,
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
      await createOrderHistory(strapi, {
        order: id,
        action: "started_cooking",
        title: "Cooking started",
        message: "Order cooking was started",
        oldStatus: "new",
        newStatus: "cooking",
        user: ctx.state.user?.id || null,
        meta: {
          startedCookingAt: now,
        },
      });

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
      await createOrderHistory(strapi, {
        order: orderId,
        action: "item_ready",
        title: "Item ready",
        message: "Order item was marked as ready",
        oldStatus: currentItem.status,
        newStatus: "ready",
        user: ctx.state.user?.id || null,
        meta: {
          itemId,
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
      const now = new Date();

      const updatedOrder = await strapi.entityService.update(
        "api::order.order",
        id,
        {
          data: {
            status: "ready",
            readyAt: now,
          },
          populate: {
            customer: true,
            order_items: {
              populate: ["dish"],
            },
          },
        }
      );
      await createOrderHistory(strapi, {
        order: id,
        action: "order_ready",
        title: "Order ready",
        message: "Order was marked as ready",
        oldStatus: "cooking",
        newStatus: "ready",
        user: ctx.state.user?.id || null,
        meta: {
          readyAt: now,
        },
      });

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
      const { branchId, date } = ctx.query;

      if (!branchId) {
        return ctx.badRequest("branchId is required");
      }

      const selectedDate = date ? new Date(date) : new Date();

      const startOfDay = new Date(selectedDate);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(selectedDate);
      endOfDay.setHours(23, 59, 59, 999);

      const orders = await strapi.entityService.findMany("api::order.order", {
        filters: {
          branch: branchId,
          scheduledFor: {
            $gte: startOfDay,
            $lte: endOfDay,
          },
        },

        sort: {
          scheduledFor: "asc",
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
          scheduledFor: order.scheduledFor,
          startedCookingAt: order.startedCookingAt,
          readyAt: order.readyAt,
          canceledAt: order.canceledAt,
          cancelReason: order.cancelReason,
          hasProductionLoss: order.hasProductionLoss,

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
            isProductionLoss: item.isProductionLoss,
            productionLossAt: item.productionLossAt,
            productionLossReason: item.productionLossReason,

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
      const now = new Date();

      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);

      const orders = await strapi.entityService.findMany("api::order.order", {
        filters: {
          status: {
            $in: activeStatuses,
          },
          branch: activeBranchId,
          scheduledFor: {
            $gte: startOfDay,
            $lte: endOfDay,
          },
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
          const now = new Date();

          const totalCookingTime = queueItems.reduce((sum, item) => {
            return sum + Number(item.totalCookingTime || 0);
          }, 0);

          const startedCookingAt = order.startedCookingAt
            ? new Date(order.startedCookingAt)
            : null;

          const cookingPassed = startedCookingAt
            ? Math.floor((now - startedCookingAt) / 1000 / 60)
            : 0;

          const remainingTime = startedCookingAt
            ? totalCookingTime - cookingPassed
            : totalCookingTime;

          const lateMinutes = remainingTime < 0 ? Math.abs(remainingTime) : 0;

          const isLate = Boolean(startedCookingAt && remainingTime < 0);

          const isSoonLate = Boolean(
            startedCookingAt && remainingTime >= 0 && remainingTime <= 5
          );

          let priority = 3;

          if (isLate) {
            priority = 1;
          } else if (isSoonLate) {
            priority = 2;
          }

          dishesQueue.push({
            orderId: order.id,
            orderStatus: order.status,
            createdAt: order.createdAt,
            startedCookingAt: order.startedCookingAt,
            totalCookingTime,
            cookingPassed,
            remainingTime: remainingTime > 0 ? remainingTime : 0,
            lateMinutes,
            isLate,
            isSoonLate,
            priority,
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
      dishesQueue.sort((a, b) => {
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }

        if (a.isLate && b.isLate) {
          return b.lateMinutes - a.lateMinutes;
        }

        if (a.isSoonLate && b.isSoonLate) {
          return a.remainingTime - b.remainingTime;
        }

        return new Date(a.createdAt) - new Date(b.createdAt);
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
  async cancelOrder(ctx) {
    try {
      const { id } = ctx.params;
      const { reason } = ctx.request.body || {};

      if (!id) {
        return ctx.badRequest("order id is required");
      }

      const order = await strapi.entityService.findOne("api::order.order", id, {
        populate: {
          branch: true,
        },
      });

      if (!order) {
        return ctx.notFound("Order not found");
      }

      if (order.status === "done") {
        return ctx.badRequest("Done order cannot be canceled");
      }

      if (order.status === "canceled") {
        return ctx.badRequest("Order already canceled");
      }

      const user = ctx.state.user;
      const userRole = user?.roles || user?.role || null;

      const isAdmin = userRole === "admin";
      const isManager = userRole === "manager";

      if (order.status === "delivering" && !isAdmin && !isManager) {
        return ctx.forbidden(
          "Only manager or admin can cancel delivering order"
        );
      }

      const branchId = order.branch?.id || order.branch;

      const orderItems = await strapi.entityService.findMany(
        "api::order-item.order-item",
        {
          filters: {
            order: id,
          },
          populate: {
            dish: true,
          },
        }
      );

      let itemsForDeduct = [];

      if (order.status === "new") {
        itemsForDeduct = [];
      }

      if (order.status === "cooking") {
        itemsForDeduct = orderItems.filter((item) => {
          return item.status === "ready";
        });
      }

      if (order.status === "ready" || order.status === "delivering") {
        itemsForDeduct = orderItems;
      }

      const deductIngredientsForItems = async (items) => {
        for (const item of items) {
          const dish = item.dish;
          const orderItemQuantity = Number(item.quantity || 0);

          if (!dish || !dish.id || orderItemQuantity <= 0) {
            continue;
          }

          const recipes = await strapi.entityService.findMany(
            "api::recipe.recipe",
            {
              filters: {
                dish: dish.id,
              },
              populate: {
                ingredient: true,
              },
            }
          );

          for (const recipe of recipes) {
            const ingredient = recipe.ingredient;

            if (!ingredient) continue;

            const neededQuantity =
              Number(recipe.quantity || 0) * orderItemQuantity;

            if (neededQuantity <= 0) continue;

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

            if (!branchIngredient) continue;

            const currentStock = Number(branchIngredient.stock || 0);
            const newStock = currentStock - neededQuantity;

            await strapi.entityService.update(
              "api::branch-ingredient.branch-ingredient",
              branchIngredient.id,
              {
                data: {
                  stock: newStock < 0 ? 0 : newStock,
                },
              }
            );
          }

          await strapi.entityService.update(
            "api::order-item.order-item",
            item.id,
            {
              data: {
                isProductionLoss: true,
                productionLossAt: new Date(),
                productionLossReason: reason || "Order canceled",
              },
            }
          );
        }
      };

      const hasProductionLoss = itemsForDeduct.length > 0;

      if (hasProductionLoss) {
        await deductIngredientsForItems(itemsForDeduct);
      }

      const updatedOrder = await strapi.entityService.update(
        "api::order.order",
        id,
        {
          data: {
            status: "canceled",
            canceledAt: new Date(),
            cancelReason: reason || null,
            hasProductionLoss,
          },
          populate: {
            customer: true,
            branch: true,
            order_items: {
              populate: ["dish"],
            },
          },
        }
      );
      await createOrderHistory(strapi, {
        order: id,
        action: "canceled",
        title: "Order canceled",
        message: reason || "Order was canceled",
        oldStatus: order.status,
        newStatus: "canceled",
        user: ctx.state.user?.id || null,
        meta: {
          reason: reason || null,
          hasProductionLoss,
          deductedItemsCount: itemsForDeduct.length,
        },
      });
      if (hasProductionLoss) {
        await createOrderHistory(strapi, {
          order: id,
          action: "production_loss",
          title: "Production loss",
          message: "Kitchen production loss was created",
          user: ctx.state.user?.id || null,
          meta: {
            reason: reason || "Order canceled",
            deductedItemsCount: itemsForDeduct.length,
          },
        });
      }

      return {
        success: true,
        hasProductionLoss,
        deductedItemsCount: itemsForDeduct.length,
        order: updatedOrder,
      };
    } catch (error) {
      console.error(error);
      return ctx.internalServerError("Error canceling order");
    }
  },
  async ordersPageList(ctx) {
    try {
      const { branchId, date, dateFrom, dateTo, status, type, paymentType } =
        ctx.query;

      if (!branchId) {
        return ctx.badRequest("branchId is required");
      }

      const selectedDate = date ? new Date(date) : new Date();

      const startOfDay = dateFrom ? new Date(dateFrom) : new Date(selectedDate);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = dateTo ? new Date(dateTo) : new Date(selectedDate);
      endOfDay.setHours(23, 59, 59, 999);

      const filters = {
        scheduledFor: {
          $gte: startOfDay,
          $lte: endOfDay,
        },
      };

      if (branchId !== "all") {
        filters.branch = branchId;
      }

      if (status && status !== "all") {
        filters.status = status;
      }

      if (type && type !== "all") {
        filters.type = type;
      }

      if (paymentType && paymentType !== "all") {
        filters.paymentType = paymentType;
      }

      const orders = await strapi.entityService.findMany("api::order.order", {
        filters,
        sort: {
          scheduledFor: "asc",
        },
        populate: {
          customer: true,
          branch: true,
          order_items: {
            populate: ["dish"],
          },
          order_histories: {
            sort: {
              createdAt: "asc",
            },
            populate: {
              user: true,
            },
          },
        },
      });

      const normalizedOrders = orders.map((order) => {
        const items = order.order_items || [];

        const totalCookingTime = items.reduce((sum, item) => {
          const quantity = Number(item.quantity || 0);
          const cookingTime = Number(item.dish?.cookingTime || 0);

          return sum + quantity * cookingTime;
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
          scheduledFor: order.scheduledFor,
          startedCookingAt: order.startedCookingAt,
          readyAt: order.readyAt,
          canceledAt: order.canceledAt,
          cancelReason: order.cancelReason,
          hasProductionLoss: order.hasProductionLoss,

          branch: order.branch
            ? {
                id: order.branch.id,
                name: order.branch.name,
              }
            : null,

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
            isProductionLoss: item.isProductionLoss,
            productionLossAt: item.productionLossAt,
            productionLossReason: item.productionLossReason,
            dish: item.dish
              ? {
                  id: item.dish.id,
                  name: item.dish.name,
                  cookingTime: Number(item.dish.cookingTime || 0),
                }
              : null,
          })),

          histories: (order.order_histories || []).map((history) => ({
            id: history.id,
            action: history.action,
            title: history.title,
            message: history.message,
            oldStatus: history.oldStatus,
            newStatus: history.newStatus,
            meta: history.meta,
            createdAt: history.createdAt,
            user: history.user
              ? {
                  id: history.user.id,
                  username: history.user.username,
                  name: history.user.name,
                  fullName: history.user.fullName,
                  email: history.user.email,
                }
              : null,
          })),
        };
      });

      return {
        dateFrom: startOfDay,
        dateTo: endOfDay,
        total: normalizedOrders.length,
        orders: normalizedOrders,
      };
    } catch (error) {
      console.error(error);
      return ctx.internalServerError("Error loading orders page list");
    }
  },
  async sendToDelivery(ctx) {
    try {
      const { id } = ctx.params;

      if (!id) {
        return ctx.badRequest("order id is required");
      }

      const order = await strapi.entityService.findOne("api::order.order", id);

      if (!order) {
        return ctx.notFound("Order not found");
      }

      if (order.status !== "ready") {
        return ctx.badRequest("Only ready orders can be sent to delivery");
      }

      const updatedOrder = await strapi.entityService.update(
        "api::order.order",
        id,
        {
          data: {
            status: "delivering",
            deliveryStartedAt: new Date(),
          },
          populate: {
            customer: true,
            branch: true,
            order_items: {
              populate: ["dish"],
            },
          },
        }
      );

      await createOrderHistory(strapi, {
        order: id,
        action: "sent_to_delivery",
        title: "Sent to delivery",
        message: "Order was sent to delivery",
        oldStatus: "ready",
        newStatus: "delivering",
        user: ctx.state.user?.id || null,
        meta: {
          deliveryStartedAt: new Date(),
        },
      });
      const user = ctx.state.user;
      const userRole = user?.roles || user?.role || null;

      const isAdmin = userRole === "admin";
      const isManager = userRole === "manager";

      if (!isAdmin && !isManager) {
        return ctx.forbidden(
          "Only manager or admin can send order to delivery"
        );
      }

      return {
        success: true,
        order: updatedOrder,
      };
    } catch (error) {
      console.error(error);
      return ctx.internalServerError("Error sending order to delivery");
    }
  },
  async completeOrder(ctx) {
    try {
      const { id } = ctx.params;

      if (!id) {
        return ctx.badRequest("order id is required");
      }

      const order = await strapi.entityService.findOne("api::order.order", id, {
        populate: {
          branch: true,
        },
      });

      if (!order) {
        return ctx.notFound("Order not found");
      }

      if (order.status === "done") {
        return ctx.badRequest("Order already completed");
      }

      if (order.status === "canceled") {
        return ctx.badRequest("Canceled order cannot be completed");
      }

      if (order.status !== "ready" && order.status !== "delivering") {
        return ctx.badRequest(
          "Only ready or delivering orders can be completed"
        );
      }

      const branchId = order.branch?.id || order.branch;

      const orderItems = await strapi.entityService.findMany(
        "api::order-item.order-item",
        {
          filters: {
            order: id,
          },
          populate: {
            dish: true,
          },
        }
      );

      const deductIngredientsForItems = async (items) => {
        for (const item of items) {
          const dish = item.dish;
          const orderItemQuantity = Number(item.quantity || 0);

          if (!dish || !dish.id || orderItemQuantity <= 0) {
            continue;
          }

          const recipes = await strapi.entityService.findMany(
            "api::recipe.recipe",
            {
              filters: {
                dish: dish.id,
              },
              populate: {
                ingredient: true,
              },
            }
          );

          for (const recipe of recipes) {
            const ingredient = recipe.ingredient;

            if (!ingredient) continue;

            const neededQuantity =
              Number(recipe.quantity || 0) * orderItemQuantity;

            if (neededQuantity <= 0) continue;

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

            if (!branchIngredient) continue;

            const currentStock = Number(branchIngredient.stock || 0);
            const newStock = currentStock - neededQuantity;

            await strapi.entityService.update(
              "api::branch-ingredient.branch-ingredient",
              branchIngredient.id,
              {
                data: {
                  stock: newStock < 0 ? 0 : newStock,
                },
              }
            );
          }
        }
      };

      await deductIngredientsForItems(orderItems || []);

      const now = new Date();

      const updatedOrder = await strapi.entityService.update(
        "api::order.order",
        id,
        {
          data: {
            status: "done",
            deliveredAt: now,
          },
          populate: {
            customer: true,
            branch: true,
            order_items: {
              populate: ["dish"],
            },
          },
        }
      );

      await createOrderHistory(strapi, {
        order: id,
        action: "completed",
        title: "Order completed",
        message: "Order was completed",
        oldStatus: order.status,
        newStatus: "done",
        user: ctx.state.user?.id || null,
        meta: {
          deliveredAt: now,
          deductedItemsCount: orderItems.length,
        },
      });

      return {
        success: true,
        deductedItemsCount: orderItems.length,
        order: updatedOrder,
      };
    } catch (error) {
      console.error(error);
      return ctx.internalServerError("Error completing order");
    }
  },
}));
