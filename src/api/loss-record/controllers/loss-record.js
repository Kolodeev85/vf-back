// @ts-nocheck
"use strict";

const { createCoreController } = require("@strapi/strapi").factories;

module.exports = createCoreController(
  "api::loss-record.loss-record",
  ({ strapi }) => ({
    async pageList(ctx) {
      try {
        const { branchId, dateFrom, dateTo, status } = ctx.query;

        const filters = {};

        if (branchId && branchId !== "all") {
          filters.branch = branchId;
        }

        if (status && status !== "all") {
          filters.status = status;
        }

        if (dateFrom || dateTo) {
          filters.createdAt = {};

          if (dateFrom) {
            const startOfDay = new Date(dateFrom);
            startOfDay.setHours(0, 0, 0, 0);
            filters.createdAt.$gte = startOfDay;
          }

          if (dateTo) {
            const endOfDay = new Date(dateTo);
            endOfDay.setHours(23, 59, 59, 999);
            filters.createdAt.$lte = endOfDay;
          }
        }

        const records = await strapi.entityService.findMany(
          "api::loss-record.loss-record",
          {
            filters,
            sort: {
              createdAt: "desc",
            },
            populate: {
              order: {
                populate: {
                  customer: true,
                  branch: true,
                },
              },
              order_item: {
                populate: {
                  dish: true,
                },
              },
              branch: true,
              dish: true,
              user: true,
              resolvedBy: true,
            },
          }
        );

        const normalizedRecords = records.map((record) => ({
          id: record.id,
          quantity: Number(record.quantity || 0),
          costPrice: Number(record.costPrice || 0),
          lossAmount: Number(record.lossAmount || 0),
          status: record.status,
          reason: record.reason,
          comment: record.comment,
          meta: record.meta,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          resolvedAt: record.resolvedAt,

          order: record.order
            ? {
                id: record.order.id,
                status: record.order.status,
                totalPrice: Number(record.order.totalPrice || 0),
                createdAt: record.order.createdAt,
                scheduledFor: record.order.scheduledFor,
                customer: record.order.customer
                  ? {
                      id: record.order.customer.id,
                      name: record.order.customer.name,
                      phone: record.order.customer.phone,
                    }
                  : null,
              }
            : null,

          orderItem: record.order_item
            ? {
                id: record.order_item.id,
                quantity: Number(record.order_item.quantity || 0),
                status: record.order_item.status,
                isProductionLoss: record.order_item.isProductionLoss,
                productionLossReason: record.order_item.productionLossReason,
                dish: record.order_item.dish
                  ? {
                      id: record.order_item.dish.id,
                      name: record.order_item.dish.name,
                    }
                  : null,
              }
            : null,

          branch: record.branch
            ? {
                id: record.branch.id,
                name: record.branch.name,
              }
            : null,

          dish: record.dish
            ? {
                id: record.dish.id,
                name: record.dish.name,
              }
            : null,

          user: record.user
            ? {
                id: record.user.id,
                username: record.user.username,
                name: record.user.name,
                fullName: record.user.email,
              }
            : null,

          resolvedBy: record.resolvedBy
            ? {
                id: record.resolvedBy.id,
                username: record.resolvedBy.username,
                name: record.resolvedBy.name,
                fullName: record.resolvedBy.fullName,
                email: record.resolvedBy.email,
              }
            : null,
        }));

        const totalLossAmount = normalizedRecords.reduce((sum, item) => {
          return sum + Number(item.lossAmount || 0);
        }, 0);

        const pendingCount = normalizedRecords.filter((item) => {
          return item.status === "pending";
        }).length;

        return {
          total: normalizedRecords.length,
          totalLossAmount: Number(totalLossAmount.toFixed(2)),
          pendingCount,
          records: normalizedRecords,
        };
      } catch (error) {
        console.error("ERROR LOSS RECORDS PAGE LIST:", error);
        return ctx.internalServerError("Error loading loss records");
      }
    },
    async resolve(ctx) {
      try {
        const { id } = ctx.params;
        const { status, comment } = ctx.request.body || {};

        if (!id) {
          return ctx.badRequest("loss record id is required");
        }

        if (!status) {
          return ctx.badRequest("status is required");
        }

        const allowedStatuses = [
          "pending",
          "trashed",
          "staff_taken",
          "bonus_given",
          "reworked",
          "other",
        ];

        if (!allowedStatuses.includes(status)) {
          return ctx.badRequest("Invalid loss status");
        }

        const existingRecord = await strapi.entityService.findOne(
          "api::loss-record.loss-record",
          id
        );

        if (!existingRecord) {
          return ctx.notFound("Loss record not found");
        }

        const now = new Date();
        const user = ctx.state.user;

        const updatedRecord = await strapi.entityService.update(
          "api::loss-record.loss-record",
          id,
          {
            data: {
              status,
              comment: comment || null,
              resolvedAt: status === "pending" ? null : now,
              resolvedBy: status === "pending" ? null : user?.id || null,
            },
            populate: {
              order: true,
              order_item: {
                populate: {
                  dish: true,
                },
              },
              branch: true,
              dish: true,
              user: true,
              resolvedBy: true,
            },
          }
        );

        return {
          success: true,
          record: updatedRecord,
        };
      } catch (error) {
        console.error("ERROR RESOLVE LOSS RECORD:", error);
        return ctx.internalServerError("Error resolving loss record");
      }
    },
  })
);
