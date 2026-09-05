const { sendAlertEmail } = require("./email");

async function sendPriceAlert(user, product, oldPrice, newPrice) {
  const message = `
Your competitor's product changed price.

Product: ${product.name}
Previous price: ${oldPrice}
New price: ${newPrice}
Price change: ${oldPrice - newPrice}

Check the product:
${product.product_url}
`;

  return sendAlertEmail({
    to: user.email,
    subject: `Price change: ${product.name}`,
    message
  });
}

async function sendStockAlert(user, product, oldStock, newStock) {
  const message = `
Your competitor's product changed stock status.

Product: ${product.name}
Previous status: ${oldStock}
New status: ${newStock}

Check the product:
${product.product_url}
`;

  return sendAlertEmail({
    to: user.email,
    subject: `Stock change: ${product.name}`,
    message
  });
}

module.exports = {
  sendPriceAlert,
  sendStockAlert
};