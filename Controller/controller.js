const fs = require('fs');
const csv = require('csv-parser');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const sharp = require('sharp');
const axios = require('axios');
const path = require('path');

const uploadCSV = (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).send('No file uploaded.');
  }

  const requestId = uuidv4();
  const results = [];

  fs.createReadStream(file.path)
    .pipe(csv())
    .on('data', (data) => results.push(data))
    .on('end', async () => {
      // Validate CSV data
      const isValid = results.every(row => row['Serial Number'] && row['Product Name'] && row['Input Image Urls']);
      if (!isValid) {
        return res.status(400).send('Invalid CSV format.');
      }

      // Insert initial status to database
      await db.query('INSERT INTO data.processing_requests (id, status) VALUES ($1, $2)', [requestId, 'Processing']);

      // Ensure the downloads directory exists
      const downloadsDir = path.join(__dirname, 'downloads');
      if (!fs.existsSync(downloadsDir)) {
        fs.mkdirSync(downloadsDir);
      }

      // Process images asynchronously
      processImages(results, requestId);

      res.status(200).send({ requestId });
    });
};

const downloadImage = async (url, filepath) => {
  try {
    const response = await axios({
      url,
      responseType: 'stream'
    });

    return new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(filepath);
      response.data.pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  } catch (error) {
    console.error(`Failed to download image from ${url}: ${error.message}`);
    throw error;
  }
};

const processImages = async (rows, requestId) => {
  const processedData = [];

  for (const row of rows) {
    const inputUrls = row['Input Image Urls'].split(',');
    const outputUrls = await Promise.all(inputUrls.map(async (url) => {
      try {
        const filename = path.basename(url);
        const inputFilePath = path.join(__dirname, 'downloads', filename);
        const outputFilePath = path.join(__dirname, 'downloads', `processed_${filename}`); // Unique output path
        
        // Download the image
        await downloadImage(url, inputFilePath);

        // Process the image
        await sharp(inputFilePath).resize({ width: 200 }).toFile(outputFilePath);

        // Clean up the downloaded file
        fs.unlinkSync(inputFilePath);

        return outputFilePath;
      } catch (error) {
        // Log the error and continue with the next URL
        console.error(`Error processing image ${url}: ${error.message}`);
        return null; // Return null for failed URLs
      }
    }));

    // Filter out null values from outputUrls
    const validOutputUrls = outputUrls.filter(url => url !== null);
    processedData.push({ ...row, 'Output Image Urls': validOutputUrls.join(',') });
  }

  // Update database with processed data
  await db.query('UPDATE data.processing_requests SET status = $1, data = $2 WHERE id = $3', ['Completed', JSON.stringify(processedData), requestId]);

  // Optionally, trigger webhook here
};

const checkStatus = async (req, res) => {
  const requestId = req.params.id;

  const result = await db.query('SELECT status, data FROM data.processing_requests WHERE id = $1', [requestId]);
  if (result.rows.length === 0) {
    return res.status(404).send('Request ID not found.');
  }

  res.status(200).send(result.rows[0]);
};

module.exports = { uploadCSV, checkStatus };
