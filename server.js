const express = require("express");
const app = express();

const authRouter = require("./routes/auth");

app.use("/", authRouter);

app.listen(process.env.PORT || 3000, () => {
    console.log("Server listening...");
});