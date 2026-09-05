const nodemailer = require("nodemailer");
require('dotenv').config();

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT),
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

async function sendAlertEmail({ to, subject, message }) {
  try {
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to,
      subject,
      text: message
    });

    console.log("Email sent:", info.messageId);

    return true;
  } catch (error) {
    console.error("Failed to send email:", error);

    return false;
  }
}

module.exports = {
  sendAlertEmail
};