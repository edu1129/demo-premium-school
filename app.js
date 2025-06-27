// app.js
const express = require('express');
const path = require('path');
const fetch = require('node-fetch'); // Ensure you have node-fetch installed (npm install node-fetch)
require('dotenv').config(); // Ensure you have dotenv installed (npm install dotenv)

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const GAS_URL = process.env.GAS_URL;

if (!GAS_URL) {
  console.error("FATAL ERROR: GAS_URL environment variable is not set.");
  process.exit(1);
}

// Serve static files from 'public' directory (if you have CSS/JS files there)
// For this example, assuming index.html and tools.json are in the root.
// If you create a public folder: app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html for the root route
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      console.error("Error sending index.html:", err);
      if (!res.headersSent) {
        res.status(500).send("Error loading application shell.");
      }
    }
  });
});

// Serve tools.json
app.get('/tools.json', (req, res) => {
  const toolsPath = path.join(__dirname, 'tools.json');
  res.sendFile(toolsPath, (err) => {
    if (err) {
      console.error("Error sending tools.json:", err);
      if (!res.headersSent) {
        res.status(err.status || 500).send("Error loading tools configuration.");
      }
    }
  });
});


// Login endpoint proxy
app.post('/login', async (req, res) => {
  const { mobile, password } = req.body;
  if (!mobile || !password) {
    return res.status(400).json({ success: false, error: 'Mobile and password required' });
  }
  
  try {
    const gasResponse = await fetch(GAS_URL, {
      method: 'POST',
      // Removed 'credentials: 'omit'' as it's default for same-origin and not typically needed for server-to-server
      headers: {
        'Content-Type': 'application/json' // Sending JSON to GAS
      },
      body: JSON.stringify({ action: 'login', mobile, password }) // Send data as JSON
    });
    
    const responseBodyText = await gasResponse.text();
    let result;
    try {
      result = JSON.parse(responseBodyText);
    } catch (parseError) {
      console.error('Failed to parse GAS response for login:', responseBodyText.substring(0, 500)); // Log snippet
      return res.status(500).json({ success: false, error: `GAS returned non-JSON response. Status: ${gasResponse.status}` });
    }
    
    // GAS script might return 200 OK even for logical failures (e.g. bad creds)
    // The 'result.success' field from GAS is the true indicator for client.
    // The HTTP status here is about the proxy-to-GAS communication.
    if (!gasResponse.ok) {
      console.error(`GAS login request failed with HTTP Status: ${gasResponse.status}`, result);
      // Forward GAS error status if meaningful, or use a generic one.
      return res.status(gasResponse.status || 502).json(result || { success: false, error: `Upstream GAS error: ${gasResponse.status}` });
    }
    
    // If GAS request was ok (e.g. 200), send the result from GAS.
    // This result will contain { success: true/false, spreadsheetId, schoolName, message, etc. }
    res.status(200).json(result);
    
  } catch (error) {
    console.error('Login proxy error:', error);
    res.status(500).json({ success: false, error: 'Proxy server error during login.', details: error.message });
  }
});


// Generic API proxy for other actions
app.post('/api/:action', async (req, res) => {
  const action = req.params.action;
  const payload = req.body || {}; // Payload from client
  
  if (!action) {
    return res.status(400).json({ success: false, error: 'Action parameter is required' });
  }
  
  try {
    // Prepare payload to send to GAS (it already contains action from client)
    const bodyToGAS = JSON.stringify({ action, ...payload });
    
    const gasResponse = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }, // GAS expects JSON now
      body: bodyToGAS
    });
    
    const responseBodyText = await gasResponse.text();
    let result;
    try {
      result = JSON.parse(responseBodyText);
    } catch (parseError) {
      console.error(`Failed to parse GAS response for action "${action}":`, responseBodyText.substring(0, 500));
      return res.status(500).json({ success: false, error: `GAS returned non-JSON response for action ${action}. Status: ${gasResponse.status}` });
    }
    
    if (!gasResponse.ok) {
      console.error(`GAS API request failed for action "${action}" with HTTP Status: ${gasResponse.status}`, result);
      return res.status(gasResponse.status || 502).json(result || { success: false, error: `Upstream GAS error for ${action}: ${gasResponse.status}` });
    }
    
    res.status(200).json(result); // Forward the JSON result from GAS
    
  } catch (error) {
    console.error(`API proxy error for action "${action}":`, error);
    res.status(500).json({ success: false, error: `Proxy server error during action: ${action}.`, details: error.message });
  }
});


// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});


// Catch-all for 404 Not Found routes (should be last)
app.use((req, res) => {
  if (!res.headersSent) {
    res.status(404).send("Resource not found on proxy.");
  }
});

app.listen(PORT, () => {
  console.log(`Node.js proxy server listening on port ${PORT}`);
  console.log(`Forwarding requests to GAS URL: ${GAS_URL}`);
});