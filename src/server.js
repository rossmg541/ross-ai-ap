import express from 'express';
import cors from 'cors';
import { OpenAI } from 'openai';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
dotenv.config();

const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const mongoUri = process.env.MONGODB_URI;
const geminiApiKey = process.env.IMAGE_API_KEY;
const options = {
  useNewUrlParser: true,
  useUnifiedTopology: true
};

app.use(cors({
  origin: ['http://localhost:3000', 'https://ai.rossmguthrie.com', 'http://ai.rossmguthrie.com'],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: true
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
  const contextText = relevantDocs.map(d => d.text).join('\n\n');
  
  // Step 1: Generate initial response
  const initialResponse = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [{
      role: "system",
      content: `You are Ross M.G. Generate a response based on the context provided from your writings and experiences. Answer in first person, be conversational and specific.

FORMATTING RULES (always follow):
- Use short paragraphs (2-3 sentences max)
- Add a blank line between paragraphs for readability
- Use bullet points (•) when listing 3+ items
- Bold key terms or important phrases for emphasis
- Keep total response to 3-4 paragraphs unless the question requires more detail
- For experience questions, naturally weave in situation, action, and result
- End with a relevant follow-up question if appropriate`
    }, {
      role: "user",
      content: `Context from your writings: ${contextText}\n\nQuestion: ${query}`
    }],
    temperature: 0.7
  });

  const draft = initialResponse.choices[0].message.content;

  // Step 2: Critique the response
  const critiqueResponse = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [{
      role: "system",
      content: `You are a critical editor reviewing Ross's response. Analyze:
- Does it accurately reflect the context provided?
- Is it natural and conversational as Ross speaking in first person?
- Are there factual errors or inconsistencies?
- Could it be more specific or engaging?
- Does it stay true to Ross's voice and experiences?
- Does it follow the formatting rules (short paragraphs, bullet points, bold text, proper structure)?`
    }, {
      role: "user",
      content: `Original question: ${query}\n\nContext: ${contextText}\n\nDraft response: ${draft}\n\nProvide constructive critique.`
    }],
    temperature: 0.3
  });

  const critique = critiqueResponse.choices[0].message.content;

  // Step 3: Generate improved response
  const finalResponse = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [{
      role: "system",
      content: `You are Ross M.G. Revise your response based on the critique to make it better, more accurate, and more engaging.

FORMATTING RULES (always follow):
- Use short paragraphs (2-3 sentences max)
- Add a blank line between paragraphs for readability
- Use bullet points (•) when listing 3+ items
- Bold key terms or important phrases for emphasis
- Keep total response to 3-4 paragraphs unless the question requires more detail
- For experience questions, naturally weave in situation, action, and result
- End with a relevant follow-up question if appropriate`
    }, {
      role: "user",
      content: `Question: ${query}
      
Context from your writings: ${contextText}

Your draft: ${draft}

Critique: ${critique}

Now write an improved response addressing the critique.`
    }],
    temperature: 0.7
  });

  return finalResponse.choices[0].message.content;
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
    
    // Debug: Look at document structure
    const sampleDoc = await collection.findOne();
    console.log('Sample document structure:', Object.keys(sampleDoc || {}));
    if (sampleDoc?.text) {
      console.log('Sample text preview:', sampleDoc.text.substring(0, 100));
    }
    
    const queryEmbedding = await createEmbedding(query);
    console.log('Generated embedding vector of length:', queryEmbedding.length);
    
    // First try vector search
    let results = [];
    try {
      results = await collection.aggregate([
        {
          $vectorSearch: {
            index: "vector_index",
            path: "embedding",
            queryVector: queryEmbedding,
            numCandidates: 10,
            limit: 3
          }
        }
      ]).toArray();
    } catch (vectorError) {
      console.log('Vector search failed, trying text search fallback:', vectorError.message);
      // Fallback to text search
      results = await collection.find({
        $text: { $search: query }
      }).limit(3).toArray();
    }
    
    // If no vector or text results, try simple regex search
    if (results.length === 0) {
      console.log('No results from vector or text search, trying regex search');
      
      // Extract key words from query and search for them
      const keywords = query.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 1 && !['tell', 'about', 'what', 'how', 'the', 'and', 'for', 'with', 'you', 'your', 'me', 'my'].includes(word));
      
      console.log('Extracted keywords:', keywords);
      
      if (keywords.length > 0) {
        const regexPattern = keywords.join('|');
        results = await collection.find({
          text: { $regex: regexPattern, $options: 'i' }
        }).limit(3).toArray();
      }
      
      // If still no results, try just the first meaningful word
      if (results.length === 0 && keywords.length > 0) {
        results = await collection.find({
          text: { $regex: keywords[0], $options: 'i' }
        }).limit(3).toArray();
      }
      
      // Final fallback: get any documents if no keywords found
      if (results.length === 0 && keywords.length === 0) {
        console.log('No keywords found, returning sample documents');
        results = await collection.find({}).limit(3).toArray();
      }
    }

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

// Search route
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

// Helper function to generate image using Gemini API
async function generateImageWithGemini(prompt) {
  try {
    // Try Gemini 2.5 Flash Image generation model
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${geminiApiKey}`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `Generate an image: ${prompt}`
          }]
        }],
        generationConfig: {
          temperature: 1.0,
          topP: 0.95,
          topK: 40,
          maxOutputTokens: 8192
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API error:', response.status, errorText);
      // Return placeholder if API fails
      return null;
    }

    const data = await response.json();

    // Extract image from inline_data if present
    if (data.candidates && data.candidates.length > 0) {
      const candidate = data.candidates[0];
      if (candidate.content && candidate.content.parts) {
        for (const part of candidate.content.parts) {
          if (part.inline_data && part.inline_data.data) {
            const mimeType = part.inline_data.mime_type || 'image/png';
            return `data:${mimeType};base64,${part.inline_data.data}`;
          }
        }
      }
    }

    console.log('No image data found in Gemini response');
    return null;
  } catch (error) {
    console.error('Error generating image with Gemini:', error.message);
    return null;
  }
}

// Market Localizer - Generate campaign variations
app.post('/api/generate-campaign', async (req, res) => {
  try {
    const { campaign, industry, markets } = req.body;

    console.log('Generating campaign variations for:', { campaign, industry, markets });

    // Validate input
    if (!campaign || !industry || !markets || markets.length < 2) {
      return res.status(400).json({
        error: 'Invalid request. Campaign, industry, and at least 2 markets required.'
      });
    }

    // Market cultural adaptations
    const marketAdaptations = {
      us: ['Bold, direct messaging', 'Red/white/blue accent colors', 'Action-oriented CTAs'],
      japan: ['Minimal text overlay', 'Soft color palette', 'Group harmony themes'],
      germany: ['Technical specifications prominent', 'Clean, structured layout', 'Quality certifications visible'],
      brazil: ['Vibrant colors and energy', 'Community and celebration themes', 'Warm, personal tone'],
      uae: ['Luxury positioning', 'Gold accent colors', 'Premium imagery and styling'],
      uk: ['Clever wordplay', 'Heritage visual cues', 'Understated elegance']
    };

    const marketInfo = {
      us: { name: 'United States', culture: 'Direct, value-focused' },
      japan: { name: 'Japan', culture: 'Subtle, harmony-oriented' },
      germany: { name: 'Germany', culture: 'Technical, quality-driven' },
      brazil: { name: 'Brazil', culture: 'Vibrant, emotional' },
      uae: { name: 'UAE', culture: 'Luxury, aspirational' },
      uk: { name: 'United Kingdom', culture: 'Witty, understated' }
    };

    // Generate variations for each market
    const variationPromises = markets.map(async (marketId) => {
      const market = marketInfo[marketId];
      const adaptations = marketAdaptations[marketId] || [];

      // Generate culturally-adapted prompt
      const prompts = {
        us: `${campaign}, bold and direct style, red white blue accents, aspirational lifestyle`,
        japan: `${campaign}, minimalist japanese aesthetic, soft colors, harmonious composition`,
        germany: `${campaign}, clean technical style, precision and quality focus, structured layout`,
        brazil: `${campaign}, vibrant and energetic, warm colors, celebration and community`,
        uae: `${campaign}, luxury premium style, gold accents, sophisticated and aspirational`,
        uk: `${campaign}, refined british aesthetic, heritage elements, understated elegance`
      };

      const prompt = prompts[marketId] || campaign;

      // Generate image with Gemini API
      let imageUrl = null;
      if (geminiApiKey) {
        imageUrl = await generateImageWithGemini(prompt);
      }

      // Fallback to placeholder if image generation fails or no API key
      if (!imageUrl) {
        const placeholderColors = {
          us: '1d3557/e63946',
          japan: 'f1faee/e63946',
          germany: '457b9d/1d3557',
          brazil: 'e63946/f1faee',
          uae: '1d3557/FFD700',
          uk: '457b9d/e63946'
        };
        imageUrl = `https://placehold.co/800x600/${placeholderColors[marketId]}?text=${encodeURIComponent(market.name)}`;
      }

      return {
        market: market.name,
        culture: market.culture,
        adaptations,
        imageUrl,
        prompt
      };
    });

    // Wait for all image generation to complete
    const variations = await Promise.all(variationPromises);

    // Calculate metrics
    const traditionalHours = markets.length * 8;
    const aiHours = markets.length * 0.5;
    const costPerHour = 75;

    const metrics = {
      timeSaved: traditionalHours - aiHours,
      costSaved: (traditionalHours - aiHours) * costPerHour,
      speedIncrease: Math.round((traditionalHours / aiHours) * 100),
      assetsCreated: markets.length
    };

    console.log('Generated variations:', variations.length);

    res.json({
      variations,
      metrics
    });

  } catch (error) {
    console.error('Campaign generation error:', error);
    res.status(500).json({
      error: 'Failed to generate campaign variations',
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
});