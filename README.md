# AI Website Qualifying Agent 🤖

An Apify actor that uses AI to qualify B2B SaaS websites against your Ideal Customer Profile (ICP) criteria.

## What It Does

This actor takes a list of website URLs and uses AI to analyze whether each company matches your target ICP:

1. **Scrapes** the website content using Playwright
2. **Analyzes** the product/offering using AI (via OpenRouter)
3. **Qualifies** as QUALIFY or DISQUALIFY with a score (1-10)
4. **Explains** the reasoning behind each decision

## Default ICP Criteria

The actor is pre-configured to qualify companies in:
- Cold email software (Smartlead, Instantly, etc.)
- Cold LinkedIn outreach tools
- Lead generation / prospecting databases (Clay, Apollo, etc.)
- Sales engagement platforms
- Email finding / contact enrichment
- AI-powered outreach automation

You can customize the ICP criteria by providing your own `icpSystemPrompt` in the input.

---

## 🚀 How to Use

### Option 1: Import from GitHub (Recommended)

1. **Push this code to GitHub**
2. **Go to [Apify](https://apify.com/)** and sign in
3. Click **"Create"** → **"Import from GitHub"**
4. Select your repository and the "Apify Version" folder
5. The actor will be created automatically!

### Option 2: Create Actor on Apify

1. Go to [Apify](https://apify.com/) and sign in
2. Click **"Create"** → **"New Actor"**
3. Choose **"Blank actor"**
4. Click **"Source"** → **"Upload .zip"** (zip this folder and upload)
5. Or use the Apify CLI: `apify push`

---

## 📥 Input

When running the actor, provide the following input:

```json
{
  "urls": [
    "https://www.smartlead.ai",
    "https://www.clay.com",
    "https://www.shopify.com"
  ],
  "openrouterApiKey": "sk-or-v1-xxxxxxxxxxxxx",
  "icpSystemPrompt": "Your custom ICP criteria here..."
}
```

All three core inputs are dynamic! The `icpSystemPrompt` is fully customizable.

### Input Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `urls` | array | ✅ | Array of website URLs to analyze |
| `openrouterApiKey` | string | ✅ | Your OpenRouter API key. Get a free key at https://openrouter.ai/settings/keys |
| `icpSystemPrompt` | string | ✅* | Custom ICP criteria (required - uses default if not provided) |
| `delayBetweenRequests` | integer | ❌ | Delay in ms between processing URLs (default: 2000) |
| `maxRetries` | integer | ❌ | Max retry attempts for AI calls (default: 3) |

*Note: The `icpSystemPrompt` has a default value in `apify.json`, so technically it's optional but can be customized.

---

## 📤 Output

The actor saves results to a dataset and returns a summary:

```json
{
  "total": 3,
  "qualified": 1,
  "disqualified": 2,
  "results": [
    {
      "url": "https://www.smartlead.ai",
      "verdict": "QUALIFY",
      "score": 9,
      "reason": "Smartlead is a cold email infrastructure platform..."
    },
    {
      "url": "https://www.shopify.com",
      "verdict": "DISQUALIFY",
      "score": 0,
      "reason": "Shopify is a B2C e-commerce platform..."
    }
  ]
}
```

### Result Fields

| Field | Description |
|-------|-------------|
| `url` | The analyzed website URL |
| `verdict` | "QUALIFY" or "DISQUALIFY" |
| `score` | Score from 0-10 based on ICP match |
| `reason` | 2-3 sentence explanation |

---

## 🔧 Customization

### Change ICP Criteria

Provide your own `icpSystemPrompt` in the input:

```json
{
  "urls": ["https://example.com"],
  "openrouterApiKey": "sk-or-v1-...",
  "icpSystemPrompt": "Your custom ICP criteria here..."
}
```

### Change AI Model

Edit `main.js` to use a different model:

```javascript
model: 'openai/gpt-4o-mini'  // Change to your preferred model
```

---

## 📁 Project Structure

```
Apify Version/
├── main.js           # Main actor entry point
├── package.json      # Dependencies
├── apify.json        # Actor metadata & input schema
└── README.md         # This file
```

---

## ⚠️ Important Notes

1. **API Key** - You'll need an OpenRouter API key. Get one free at https://openrouter.ai/
2. **Rate Limits** - The actor includes delays between requests to avoid rate limiting
3. **Scraping** - Some websites may block scrapers - these will be marked as DISQUALIFY
4. **Cost** - Each URL requires one AI API call (very low cost with gpt-4o-mini)

---

## 🛠️ Troubleshooting

| Issue | Solution |
|-------|----------|
| "Input must contain openrouterApiKey" | Add your OpenRouter API key to the input |
| "Scraping failed" | Some sites block scrapers - this is normal |
| "Rate limit exceeded" | Increase `delayBetweenRequests` in input |
| Actor stuck | Check the log for errors |

---

## 📜 License

MIT — Feel free to use and modify for your own purposes.