import express from 'express';
import cors from 'cors';
import { OpenAI } from 'openai';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config();

// Create express app first
const app = express();

// Comprehensive CORS configuration
// CORS configuration
app.use(cors({
  origin: [
    'http://localhost:3000', 
    'https://localhost:3000',
    'https://ai.rossmguthrie.com',
    'http://ai.rossmguthrie.com'
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging middleware
app.use((req, res, next) => {
  console.log('Incoming Request:', {
    method: req.method,
    path: req.path,
    headers: req.headers,
    body: req.body
  });
  next();
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', {
    message: err.message,
    stack: err.stack
  });
  res.status(500).json({ 
    error: 'Internal Server Error',
    details: err.message 
  });
});

// Search route with extensive error handling
app.post('/api/search', async (req, res) => {
  try {
    const { query } = req.body;
    
    // Validate input
    if (!query) {
      return res.status(400).json({ 
        error: 'Query is required' 
      });
    }

    console.log('Server received query:', query);
    console.log('Client origin:', req.headers.origin);
    
    const results = await searchContent(query);
    
    if (!results || results.length === 0) {
      return res.status(404).json({ 
        message: 'No results found',
        query: query 
      });
    }

    console.log('Server sending results:', results);
    res.json(results);
  } catch (error) {
    console.error('Search error:', {
      message: error.message,
      stack: error.stack,
      query: req.body?.query
    });
    
    res.status(500).json({ 
      error: 'Search failed',
      details: error.message 
    });
  }
});

// Health check route
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// Start the server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Allowed origins: http://localhost:3000, https://ai.rossmguthrie.com`);
});