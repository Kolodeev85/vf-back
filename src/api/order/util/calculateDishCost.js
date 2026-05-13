"use strict";

const getPricePerRecipeUnit = (purchasePrice, purchaseUnit, ingredientUnit) => {
  const price = Number(purchasePrice || 0);

  if (price <= 0) {
    return 0;
  }

  if (purchaseUnit === ingredientUnit) {
    return price;
  }

  if (purchaseUnit === "kg" && ingredientUnit === "g") {
    return price / 1000;
  }

  if (purchaseUnit === "g" && ingredientUnit === "kg") {
    return price * 1000;
  }

  if (purchaseUnit === "l" && ingredientUnit === "ml") {
    return price / 1000;
  }

  if (purchaseUnit === "ml" && ingredientUnit === "l") {
    return price * 1000;
  }

  return price;
};

const calculateDishCost = async (strapi, dishId, branchId) => {
  if (!dishId || !branchId) {
    return {
      costPrice: 0,
      ingredients: [],
    };
  }

  const recipes = await strapi.entityService.findMany("api::recipe.recipe", {
    filters: {
      dish: dishId,
    },
    populate: {
      ingredient: true,
    },
  });

  let costPrice = 0;
  const ingredients = [];

  for (const recipe of recipes) {
    const ingredient = recipe.ingredient;

    if (!ingredient) continue;

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

    if (!branchIngredient) {
      continue;
    }

    const recipeQuantity = Number(recipe.quantity || 0);
    const pricePerBaseUnit = getPricePerRecipeUnit(
      branchIngredient.purchasePrice,
      branchIngredient.purchaseUnit,
      ingredient.unit
    );

    const ingredientCost = recipeQuantity * pricePerBaseUnit;

    costPrice += ingredientCost;

    ingredients.push({
      ingredientId: ingredient.id,
      name: ingredient.name,
      unit: ingredient.unit,
      recipeQuantity,
      purchasePrice: Number(branchIngredient.purchasePrice || 0),
      purchaseUnit: branchIngredient.purchaseUnit,
      pricePerBaseUnit,
      cost: ingredientCost,
    });
  }

  return {
    costPrice: Number(costPrice.toFixed(2)),
    ingredients,
  };
};

module.exports = calculateDishCost;
