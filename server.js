import express from 'express';
import cors from 'cors';
import { OpenAI } from 'openai';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config();

const cors = require('cors');
const bodyParser = require('body-parser');

// Comprehensive CORS configuration
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    const allowedOrigins = [
      'http://localhost:3000', 
      'https://localhost:3000',
      'https://ai.rossmguthrie.com',
      'http://ai.rossmguthrie.com'
    ];
    
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Middleware for parsing JSON
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

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