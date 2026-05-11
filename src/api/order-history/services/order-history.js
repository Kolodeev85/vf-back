'use strict';

/**
 * order-history service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::order-history.order-history');
