require("dotenv").config();

const { sendPriceAlert } = require("./alertEmail");
async function test() {
  const user = {
    email: process.env.EMAIL_USER
  };

  const product = {
    name: "Test Nike Shoe",
    product_url: "https://example.com/product"
  };

  const result = await sendPriceAlert(
    user,
    product,
    140,
    120
  );

  console.log("Alert result:", result);
}

test();