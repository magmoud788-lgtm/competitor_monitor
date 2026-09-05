require("dotenv").config();

const { sendAlertEmail } = require("./email");

async function test() {
  const result = await sendAlertEmail({
    to: process.env.EMAIL_USER,
    subject: "Competitor Monitor Test",
    message: "This is a test email from your Competitor Monitor."
  });

  console.log("Email result:", result);
}

test();