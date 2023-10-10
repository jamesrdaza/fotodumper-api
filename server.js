require("dotenv").config();
const express = require("express");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);

const multer = require("multer");
const cors = require("cors");
const crypto = require("crypto");
const passport = require("passport");
const pool = require("./db");

const { S3Client, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { Upload } = require("@aws-sdk/lib-storage");

const app = express();
app.use(express.json());

function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    } else {
        res.redirect("http://localhost:5173/login");
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

// Create/upload user image
app.post("/fotos", ensureAuthenticated, upload.single("image"), async (req, res) => {
    console.log(req.body);
    console.log(req.file);

    if (!req.file.buffer) {
        res.status(400).send({ error: "No File Selected" })
    }

    let fileExtension = req.file.mimetype.split("/")[1];
    const imageName = generateImageName();

    // Insert image into DB
    await pool.query("INSERT INTO fotos (image_name, description, author_id, image_ext, title) VALUES ($1, $2, $3, $4, $5)", [
        imageName,
        req.body.description,
        req.user.user_id,
        fileExtension,
        req.body.title
    ]);

    // Upload to S3 bucket
    const upload = new Upload({
        client: s3,
        params: {
            Bucket: process.env.BUCKET_NAME,
            Key: imageName + "." + fileExtension,
            Body: req.file.buffer,
        }
    });

    await upload.done();
    res.send({ imageName: imageName });
})

// Update user image
app.put("/fotos/:name", ensureAuthenticated, async (req, res) => {
    if (!req.body.title || !req.body.description) {
        res.status(404).send({ error: "Missing title and/or description" });
    }

    const query = await pool.query("UPDATE fotos SET title = $1, description = $2 WHERE image_name = $3 AND author_id = $4", [
        req.body.title,
        req.body.description,
        req.params.name,
        req.user.user_id
    ]);

    res.send({});
})

// Delete user image
app.delete("/fotos/:name", ensureAuthenticated, async (req, res) => {
    const query = await pool.query("SELECT * FROM fotos WHERE image_name = $1 AND author_id = $2", [
        req.params.name,
        req.user.user_id
    ]);

    const command = new DeleteObjectCommand({
        Bucket: process.env.BUCKET_NAME,
        Key: req.params.name + "." + query.rows[0].image_ext
    });
    await s3.send(command);

    await pool.query("DELETE FROM fotos WHERE image_name = $1 AND author_id = $2", [
        req.params.name,
        req.user.user_id
    ]);

    res.send(query.rows[0]);
})

// Get singular image
app.get("/fotos/:name", ensureAuthenticated, async (req, res) => {
    // Query Image by name and author id
    let query = await pool.query("SELECT * FROM fotos WHERE image_name = $1 AND author_id = $2", [
        req.params.name,
        req.user.user_id
    ]);

    if (query.rows.length === 0) {
        res.status(404).send({ error: "Image does not exist" });
        return;
    }

    const command = new GetObjectCommand({
        Bucket: process.env.BUCKET_NAME,
        Key: req.params.name + "." + query.rows[0].image_ext
    });
    query.rows[0].imageURL = await getSignedUrl(s3, command, { expiresIn: 3600 });

    res.send(query.rows[0]);
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
            Key: foto.image_name + "." + foto.image_ext
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