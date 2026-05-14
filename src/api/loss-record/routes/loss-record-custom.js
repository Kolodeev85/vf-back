"use strict";

module.exports = {
  routes: [
    {
      method: "GET",
      path: "/loss-records/page-list",
      handler: "loss-record.pageList",
    },
    {
      method: "PUT",
      path: "/loss-records/:id/resolve",
      handler: "loss-record.resolve",
    },
  ],
};
