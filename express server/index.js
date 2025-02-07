import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import bcrypt from "bcrypt";
import flash from "connect-flash";
import session from "express-session";
import path from "path";
import fs from "fs";
import multer from "multer";
import axios from "axios";
import { fileURLToPath } from 'url';
import FormData from 'form-data'


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 4000;
const saltRounds = 15;

// Database configuration
const db = new pg.Client({
    user: "postgres",
    host: "localhost",
    database: "prostateXAI",
    password: "xbsb435&",
    port: 5432,
});

const createTableQuery = `
  CREATE TABLE IF NOT EXISTS admins (
    id SERIAL PRIMARY KEY,
    first_name VARCHAR(255) NOT NULL,
    last_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone_number VARCHAR(50),
    password VARCHAR(255) NOT NULL
  );
`;


async function createTable() {
  try {

    await db.query(createTableQuery);
    console.log('Table "admins" setup successfully');
  } catch (err) {
    console.error('Error creating table', err);
  } 
}

createTable();

db.connect();



// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'mri_images/'); // Directory to save uploaded files
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname); // Unique filename
    }
});
const upload = multer({ storage: storage });

// Ensure the "mri_images" directory exists
const uploadsDir = path.join(__dirname, 'mri_images');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

// Middleware configuration
app.use(express.static("public"));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: "konkolukuulu",
    resave: false,
    saveUninitialized: true,
}));
app.use(flash());

app.use((req, res, next) => {
    res.locals.messages = res.locals.messages;
    next();
});

app.use((req, res, next) => {
    res.locals.messages = req.flash();
    console.log("Flash messages:", res.locals.messages);
    next();
});

// Routes

// Homepage
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Signup page
app.get("/create", (req, res) => {
    res.render("signup.ejs", { messages: res.locals.messages });
});

// Handle signup form submission
app.post("/signup", async (req, res) => {
   
    const { fname, lname, email, phone, password, cpassword } = req.body;

    if (password !== cpassword) {
        req.flash("error", "Passwords do not match. Make sure passwords match");
        return res.redirect("/create");
    }

    try {
        const checkResult = await db.query("SELECT * FROM admins WHERE email = $1", [email]);
        if (checkResult.rows.length > 0) {
            req.flash("error", `User with email ${email} already exists. Try logging in.`);
            return res.redirect("/create");
        } else {
            // Password hashing
            bcrypt.hash(password, saltRounds, async (err, hash) => {
                if (err) {
                    console.log("Error hashing password", err);
                } else {
                    await db.query(
                        "INSERT INTO admins (first_name, last_name, email, phone_number, password) VALUES ($1, $2, $3, $4, $5)",
                        [fname, lname, email, phone, hash]
                    );
                    req.flash("success", "Signup successful!");
                    res.redirect("/upload");
                }
            });
        }
    } catch (error) {
        console.error(error);
        req.flash("error", "An error occurred during signup. Please try again.");
        res.redirect("/create");
    }
});

// Login page
app.get("/signin", (req, res) => {
    res.render("login.ejs", { messages: res.locals.messages });
});

// Handle login form submission
app.post("/login", async (req, res) => {
    const { loginEmail, loginPassword } = req.body;

    try {
        const result = await db.query("SELECT * FROM admins WHERE email = $1", [loginEmail]);
        if (result.rows.length > 0) {
            const user = result.rows[0];
            const storedHashedPassword = user.password;
            bcrypt.compare(loginPassword, storedHashedPassword, (err, match) => {
                if (err) {
                    console.log("Error comparing passwords:", err);
                } else if (match) {
                    res.redirect("/upload");
                } else {
                    req.flash("error", "Incorrect password");
                    res.redirect("/signin");
                }
            });
        } else {
            req.flash("error", "User not found");
            res.redirect("/signin");
        }
    } catch (error) {
        console.error(error);
        req.flash("error", "An error occurred during login. Please try again.");
        res.redirect("/signin");
    }
});

// Upload page
app.get('/upload', (req, res) => {
    res.render('upload.ejs', { messages: res.locals.messages });
});

// Handle scan form submission
app.post("/scan", upload.single('zipFile'), async (req, res) => {
    const { patientName, patientID, gender, birthDate } = req.body;

    if (!req.file) {
        req.flash("error", "No folder uploaded, make sure to upload a zipped folder");
        return res.redirect('/upload');
    }

    if (!patientName || !patientID || !gender || !birthDate) {
        req.flash("error", "Please fill in all required fields.");
        return res.redirect('/upload');
    }

    const filePath = path.join(__dirname, req.file.path);
    try {
        // Send the zip file to the ML model
        const response = await sendToMLModel(filePath);
        const dataToRender = {
            patientID,
            patientName,
            gender,
            dateProcessed: new Date().toLocaleDateString(),
            original_image: response.original_image,   // Images coming from ML server
            results: response.model_results , // Percentages, model prediction,
            isInvalidData: response.isInvalidData,
            invalidData: response.invalidData
        }
        console.log(response)
        res.render("results.ejs", dataToRender);
    } catch (error) {
        res.status(500).send(`Error processing with ML model: ${error.message}`);
    }
});

async function sendToMLModel(filePath) {
    const formData = new FormData();
    formData.append('zipfile', fs.createReadStream(filePath));

  
    try {
      const response = await axios.post('http://127.0.0.1:5000/process-zip', formData, {
        headers: formData.getHeaders() 
      })

      const {results,predictions} = response.data
     
      let data ={}
      let isInvalidData = false
      if (!results.includes( "Prostate MRI scan")) {
        isInvalidData = true
        console.log("I runnn")
       return {
            original_image: null,
            model_results: [],
            isInvalidData,
            invalidData: results
          }
      }


      // create folder to store files
      const imagesDir = path.join(__dirname, 'public/images');

      // Ensure the directory exists
        if (!fs.existsSync(imagesDir)) {
            fs.mkdirSync(imagesDir);
        }
     const image_filenames = ['EfficientNetB0_gradcam.png', 'EfficientNetB1_gradcam.png', 'Original_T2W_Image_gradcam.png', 'ResNet50_gradcam.png']  
      const EfficientNetB0_gradcam = await axios.get('http://127.0.0.1:5000/EfficientNetB0_gradcam', {
        responseType: 'arraybuffer' // Use 'arraybuffer' to receive binary data
    })
      console.log({image: EfficientNetB0_gradcam.data})
      saveImage(image_filenames[0],EfficientNetB0_gradcam.data,imagesDir)

      const EfficientNetB1_gradcam = await axios.get('http://127.0.0.1:5000/EfficientNetB1_gradcam', {
        responseType: 'arraybuffer' // Use 'arraybuffer' to receive binary data
    })
      saveImage(image_filenames[1],EfficientNetB1_gradcam.data,imagesDir)

      const Original_T2W_Image_gradcam = await axios.get('http://127.0.0.1:5000/Original_T2W_Image_gradcam', {
        responseType: 'arraybuffer' // Use 'arraybuffer' to receive binary data
    })
      saveImage(image_filenames[2],Original_T2W_Image_gradcam.data,imagesDir)

      const ResNet50_gradcam = await axios.get('http://127.0.0.1:5000/ResNet50_gradcam', {
        responseType: 'arraybuffer' // Use 'arraybuffer' to receive binary data
    })
      saveImage(image_filenames[3],ResNet50_gradcam.data,imagesDir)

      /**
       * This is the structure of results and Prediction that is returned
       * { results: 'Prostate MRI scan' }
        {
             predictions: {
                EfficientNetB0: { label: 'Clinically Significant', probabilities: [Object] },
                EfficientNetB1: { label: 'Clinically Insignificant', probabilities: [Object] },
                Joint: { label: 'Clinically Insignificant', probabilities: [Object] },
                ResNet50: { label: 'Clinically Insignificant', probabilities: [Object] }
            }
            }
       */

    // Delete the file after successful upload
    fs.unlink(filePath, (err) => {
        if (err) {
          console.error(`Failed to delete file: ${err.message}`);
        } else {
          console.log('File successfully deleted');
        }
      });

      const image_paths = ['images/EfficientNetB0_gradcam.png', 'images/EfficientNetB1_gradcam.png', 'images/ResNet50_gradcam.png', 'images/Original_T2W_Image_gradcam.png']  

      const model_results = {
        "EfficientNetB0":{"predictions": [predictions["EfficientNetB0"].probabilities["Clinically Insignificant"],predictions["EfficientNetB0"].probabilities["Clinically Significant"]],image:image_paths[0]},
        "EfficientNetB1": {"predictions":[predictions["EfficientNetB1"].probabilities["Clinically Insignificant"],predictions["EfficientNetB1"].probabilities["Clinically Significant"]],image:image_paths[1]},
        "ResNet50":{"predictions": [predictions["ResNet50"].probabilities["Clinically Insignificant"],predictions["ResNet50"].probabilities["Clinically Significant"]],image:image_paths[2]},
        "Joint": {"predictions":[predictions["Joint"].probabilities["Clinically Insignificant"],predictions["Joint"].probabilities["Clinically Significant"]],image:"/"},
    }
       data ={
        original_image: image_paths[3],
        model_results: model_results,
        isInvalidData,
        invalidData: null
      }

      return data; 
    } catch (error) {
      console.error(error);
    }
  }

  function saveImage(imageName,imageData,imagesDir){
        // Ensure imagesDir exists
        if (!fs.existsSync(imagesDir)) {
            console.error(`Directory does not exist: ${imagesDir}`);
            return;
        }
    
        // Resolve the image path
        const imagePath = path.join(imagesDir, imageName);
    
    try {
        // Write the image data to a file
        fs.writeFileSync(imagePath, imageData, 'binary');
        console.log(`Image saved successfully: ${imagePath}`);
    } catch (error) {
        console.error(`Error saving image: ${error.message}`);
    }
  }



// Start the server
app.listen(port, () => {
    console.log(`API is running at http://localhost:${port}`);
});