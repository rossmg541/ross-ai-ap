import express from 'express';
import cors from 'cors';
import { OpenAI } from 'openai';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const mongoUri = process.env.MONGODB_URI;

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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Add these functions back
async function createEmbedding(text) {
  const response = await openai.embeddings.create({
    model: "text-embedding-ada-002",
    input: text
  });
  return response.data[0].embedding;
}

async function generateNaturalResponse(query, relevantDocs) {
  const prompt = `You are an AI representation of Ross. Using the following relevant content from Ross's writings, generate a natural response to the query. 
Important rules:
- Choose the SINGLE most relevant story/example that best answers the query
- Stick to the specific details of that one story
- Don't combine or mix details from different stories
- If no story fits well, say you don't have a relevant example

Context from Ross's writings:
${relevantDocs.map(d => d.text).join('\n\n')}

Query: ${query}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [{ role: "user", content: prompt }]
  });

  return completion.choices[0].message.content;
}

async function searchContent(query) {
  let client;
  try {
    console.log('-----Debug Info-----');
    console.log('Query:', query);
    console.log('Environment:', process.env.NODE_ENV);
    console.log('MongoDB URI (sanitized):', mongoUri.replace(/\/\/[^@]+@/, '//***:***@'));
    
    client = await MongoClient.connect(mongoUri, options);
    console.log('MongoDB Connected');
    
    const collection = client.db('ross-ai').collection('content');
    const count = await collection.countDocuments();
    console.log('Documents in collection:', count);
    
    const queryEmbedding = await createEmbedding(query);
    console.log('Generated embedding vector of length:', queryEmbedding.length);
    
    const results = await collection.aggregate([
      {
        $vectorSearch: {
          index: "ross-ai-knowledge-index1",
          path: "embedding",
          queryVector: queryEmbedding,
          numCandidates: 10,
          limit: 3
        }
      }
    ]).toArray();

    console.log('Vector search results:', results.length);
    console.log('First result preview:', results[0] ? results[0].text.substring(0, 100) : 'No results');
    console.log('------------------');

    if (results.length > 0) {
      const response = await generateNaturalResponse(query, results);
      return [{ text: response }];
    }
    return [];
  } catch (error) {
    console.error('Detailed search error:', error);
    throw error;
  } finally {
    if (client) await client.close();
  }
}

// Rest of your routes...
app.post('/api/search', async (req, res) => {
  try {
    const { query } = req.body;
    console.log('Server received query:', query);
    
    const results = await searchContent(query);
    console.log('Server sending results:', results);
    
    res.json(results);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed', details: error.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});