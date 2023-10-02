require("dotenv").config();
const express = require("express");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);

const multer = require("multer");
const cors = require("cors");
const crypto = require("crypto");
const passport = require("passport");
const pool = require("./db");

const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { Upload } = require("@aws-sdk/lib-storage");

const app = express();

function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    } else {
        res.redirect("/notAuthenticated");
    }
}

function generateImageName() {
    return crypto.randomBytes(32).toString("hex");
}

const s3 = new S3Client({
    credentials: {
        accessKeyId: process.env.ACCESS_KEY,
        secretAccessKey: process.env.SECRET_KEY,
    },
    region: process.env.BUCKET_REGION
});

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(cors({
    credentials: true,
    origin: "http://localhost:5173"
}))

app.use(session({
    secret: process.env.SECRET,
    resave: false,
    saveUninitialized: false,
    store: new pgSession({
        pool: pool,
        tableName: "session"
    })
}));

app.use(passport.initialize());
app.use(passport.session());

const authRouter = require("./routes/auth");

app.use("/user", ensureAuthenticated, async (req, res) => {
    const query = await pool.query("SELECT * FROM users WHERE id = $1", [req.user.user_id])
    res.json(query.rows[0]);
});

app.use("/notAuthenticated", (req, res) => {
    res.send("NOT AUTHENTICATED");
})


// Create/upload user image
app.post("/fotos", ensureAuthenticated, upload.single("image"), async (req, res) => {
    console.log(req.body);
    console.log(req.file);
    console.log(req.file.buffer);

    let fileExtension = req.file.mimetype.split("/")[1];
    const imageName = generateImageName() + "." + fileExtension;

    const query = await pool.query("INSERT INTO fotos (image_name, description, author_id) VALUES ($1, $2, $3)", [
        imageName,
        "",
        req.user.user_id
    ]);

    const upload = new Upload({
        client: s3,
        params: {
            Bucket: process.env.BUCKET_NAME,
            Key: imageName,
            Body: req.file.buffer,
        }
    });

    await upload.done();
    res.send({});
})

// Update user image
app.put("/fotos/:name", ensureAuthenticated, (req, res) => {

})

// Delete user image
app.delete("/fotos/:name", ensureAuthenticated, (req, res) => {

})

// Get singular image
app.get("/fotos/:name", ensureAuthenticated, (req, res) => {

})

// Get all user images
app.get("/fotos", ensureAuthenticated, async (req, res) => {
    // Get User Posts
    let query = await pool.query("SELECT * FROM fotos WHERE author_id = $1", [
        req.user.user_id
    ]);

    // Generate Signed URL for each image
    for (let foto of query.rows) {
        const command = new GetObjectCommand({
            Bucket: process.env.BUCKET_NAME,
            Key: foto.image_name
        });
        const url = await getSignedUrl(s3, command, { expiresIn: 3600 });

        // Attatch image to response object
        foto.imageURL = url;
    }

    res.send(query.rows);
})

app.use("/", authRouter);

app.listen(process.env.PORT || 3000, () => {
    console.log("Server listening...");
});