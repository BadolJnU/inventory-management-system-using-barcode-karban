
// server.js - Express.js Backend for Inventory Management System

// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios'); // For making HTTP requests to external API

const app = express();
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/inventory_db';
const API_KEY = process.env.API_KEY || 'your_secret_api_key'; // Use a strong, unique key in production

// Middleware
app.use(cors()); // Enable CORS for all origins, you might want to restrict this in production
app.use(express.json()); // Enable parsing of JSON request bodies

// --- MongoDB Connection ---
mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB connected successfully'))
    .catch(err => console.error('MongoDB connection error:', err));

// --- Product Schema and Model ---
const productSchema = new mongoose.Schema({
    barcode: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    description: { type: String },
    price: { type: Number },
    imageUrl: { type: String },
    category: { type: String, default: 'Uncategorized' }, // Default category
    createdAt: { type: Date, default: Date.now }
});

const Product = mongoose.model('Product', productSchema);

// --- Authentication Middleware ---
const authenticateAPIKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || apiKey !== API_KEY) {
        return res.status(401).json({ message: 'Unauthorized: Invalid API Key' });
    }
    next();
};

// --- API Routes ---

// Root endpoint for testing
app.get('/', (req, res) => {
    res.send('Inventory Management Backend is running!');
});

// 1. Add Product (Scan Barcode & Save)
// This endpoint will:
// - Take a barcode from the request body.
// - Call the external product API to get details.
// - Save the product details to MongoDB in 'Uncategorized' category.
app.post('/api/products', authenticateAPIKey, async (req, res) => {
    const { barcode } = req.body;

    if (!barcode) {
        return res.status(400).json({ message: 'Barcode is required' });
    }

    try {
        // Check if product already exists in our DB
        let product = await Product.findOne({ barcode });
        if (product) {
            return res.status(200).json({ message: 'Product already exists in inventory', product });
        }

        // Fetch product details from external API
        const externalApiUrl = `https://products-test-aci.onrender.com/product/${barcode}`;
        const externalApiResponse = await axios.get(externalApiUrl);
        const externalProductData = externalApiResponse.data;

        if (!externalProductData || !externalProductData.name) {
            return res.status(404).json({ message: 'Product details not found from external API' });
        }

        // Create new product in our database
        product = new Product({
            barcode: externalProductData.barcode || barcode,
            name: externalProductData.name,
            description: externalProductData.description || 'No description available',
            price: externalProductData.price || 0,
            imageUrl: externalProductData.imageUrl || `https://placehold.co/150x150/cccccc/333333?text=No+Image`, // Placeholder image
            category: 'Uncategorized', // Default category
        });

        await product.save();
        res.status(201).json({ message: 'Product added successfully', product });

    } catch (error) {
        console.error('Error adding product:', error.message);
        if (error.response && error.response.status === 404) {
            return res.status(404).json({ message: 'Product not found with this barcode on external API' });
        }
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// 2. Retrieve All Products (optionally filtered by category)
app.get('/api/products', authenticateAPIKey, async (req, res) => {
    const { category, search } = req.query;
    let query = {};

    if (category && category !== 'All') {
        query.category = category;
    }

    if (search) {
        // Case-insensitive search by name or barcode
        query.$or = [
            { name: { $regex: search, $options: 'i' } },
            { barcode: { $regex: search, $options: 'i' } }
        ];
    }

    try {
        const products = await Product.find(query).sort({ createdAt: -1 }); // Sort by most recently added
        res.status(200).json(products);
    } catch (error) {
        console.error('Error retrieving products:', error.message);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// 3. Update a Product's Category
app.put('/api/products/:id/category', authenticateAPIKey, async (req, res) => {
    const { id } = req.params;
    const { category } = req.body;

    if (!category) {
        return res.status(400).json({ message: 'Category is required' });
    }

    try {
        const product = await Product.findByIdAndUpdate(
            id,
            { category },
            { new: true, runValidators: true } // Return the updated document and run schema validators
        );

        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }

        res.status(200).json({ message: 'Product category updated successfully', product });
    } catch (error) {
        console.error('Error updating product category:', error.message);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// 4. Get Analytics Data
app.get('/api/analytics', authenticateAPIKey, async (req, res) => {
    try {
        // Number of products in each category
        const productsByCategory = await Product.aggregate([
            { $group: { _id: '$category', count: { $sum: 1 } } },
            { $project: { category: '$_id', count: 1, _id: 0 } }
        ]);

        // Recently added products (e.g., last 5)
        const recentlyAddedProducts = await Product.find({})
            .sort({ createdAt: -1 })
            .limit(5);

        // Total number of products
        const totalProducts = await Product.countDocuments({});

        res.status(200).json({
            productsByCategory,
            recentlyAddedProducts,
            totalProducts
        });

    } catch (error) {
        console.error('Error fetching analytics:', error.message);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});


// --- Start Server ---
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

