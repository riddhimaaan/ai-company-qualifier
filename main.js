const { Actor } = require('apify');
const { chromium } = require('playwright');
const OpenAI = require('openai');

// Default ICP system prompt
const DEFAULT_SYSTEM_PROMPT = `You are a B2B SaaS lead qualification agent for a cold outreach agency.

## YOUR JOB
You receive one website URL per run. Scrape the website content, then decide if this company is a qualified prospect.

## QUALIFIED PROSPECT DEFINITION
A company qualifies if it operates in ONE OR MORE of these categories:
- Cold email software (sending infrastructure, deliverability, warmup)
- Cold LinkedIn outreach tools
- Lead generation data / prospecting databases
- Sales engagement platforms
- Email finding / contact enrichment
- AI-powered outreach automation
- Inbox / reply management for outreach
- Lead qualification or scoring tools

Reference companies to calibrate your judgment: Smartlead, Instantly, Clay, Prospeo, Heyreach, Apollo, Lemlist, La Growth Machine, Hunter.io, Dropcontact, Snov.io, Expandi, Waalaxy.

## DISQUALIFY IF
- B2C product (sells to individuals, not businesses)
- Marketing automation for paid ads (Google Ads, Meta Ads — NOT outreach)
- CRM software with no outreach component (pure pipeline management)
- Content marketing / SEO tools
- Social media scheduling tools
- HR, finance, legal, or operations SaaS
- The product is in stealth / no clear product description found

## SCORING RUBRIC (1-10)
Score based on how closely the company matches the ICP:

9-10 = Core cold outreach or lead gen infrastructure (direct competitor to Smartlead, Clay, Instantly)
7-8 = Adjacent tool used by cold outreach teams (enrichment, inbox management, sequence tools)
5-6 = Partial fit — has outreach features but it's not the core product
3-4 = Weak fit — B2B SaaS but outreach is a minor feature
1-2 = Wrong category but still B2B SaaS
0 = B2C or no clear product

## OUTPUT FORMAT
Return ONLY a valid JSON object. No explanation outside the JSON.

{
  "url": "the input URL",
  "verdict": "QUALIFY or DISQUALIFY",
  "score": "number 1-10",
  "reason": "2-3 sentences. State exactly what the product does, which category it fits or fails, and the specific reason for your score. No vague language."
}

## RULES
- If there is no content or an error, set verdict to DISQUALIFY, score to 0, reason to "Website inaccessible or no product description found."
- Do not infer or guess what a product does. Base judgment only on what the scraped website content returns.
- Do not return anything outside the JSON object.`;

let browser = null;

// Get or reuse browser instance
async function getBrowser() {
    if (!browser || !browser.isConnected()) {
        browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
    }
    return browser;
}

// Close browser on exit
async function closeBrowser() {
    if (browser) {
        await browser.close();
        browser = null;
    }
}

// Scrape a single website
async function scrapeWebsite(url, log) {
    // Normalize the URL
    let normalizedUrl = url.trim();
    if (normalizedUrl.endsWith('/')) {
        normalizedUrl = normalizedUrl.slice(0, -1);
    }
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
        normalizedUrl = 'https://' + normalizedUrl;
    }

    let page = null;
    
    try {
        const browserInstance = await getBrowser();
        page = await browserInstance.newPage();
        
        // Set user agent
        await page.setExtraHTTPHeaders({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });

        // Navigate with timeout
        await page.goto(normalizedUrl, { 
            waitUntil: 'networkidle',
            timeout: 30000 
        });

        // Extract content from the page
        const content = await page.evaluate(() => {
            // Remove unwanted elements
            const removeSelectors = ['script', 'style', 'nav', 'header', 'footer', 'noscript', 'iframe', 'svg', 'button', 'input', 'form', 'aside', '.sidebar', '#sidebar', '.menu', '.footer', '.header'];
            removeSelectors.forEach(selector => {
                document.querySelectorAll(selector).forEach(el => el.remove());
            });

            // Get all paragraph text
            const paragraphs = Array.from(document.querySelectorAll('p'))
                .map(p => p.textContent.trim())
                .filter(t => t.length > 20)
                .join(' ')
                .substring(0, 15000);

            // Get headings
            const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
                .map(h => h.textContent.trim())
                .filter(t => t.length > 0)
                .join(' | ');

            // Get meta description
            const metaDesc = document.querySelector('meta[name="description"]')?.content || 
                            document.querySelector('meta[property="og:description"]')?.content || '';

            // Get main heading
            const h1 = document.querySelector('h1')?.textContent.trim() || '';

            // Get hero text (large paragraphs)
            const heroTexts = Array.from(document.querySelectorAll('p, span, div'))
                .filter(el => {
                    const style = window.getComputedStyle(el);
                    const fontSize = parseFloat(style.fontSize);
                    return fontSize >= 16 && el.textContent.trim().length > 50;
                })
                .map(el => el.textContent.trim())
                .join(' ')
                .substring(0, 5000);

            return {
                title: document.title,
                metaDescription: metaDesc,
                h1: h1,
                headings: headings,
                bodyText: paragraphs,
                heroText: heroTexts
            };
        });

        // Combine all content
        const scrapedContent = [
            content.title,
            content.metaDescription,
            content.h1,
            content.headings,
            content.heroText,
            content.bodyText,
        ].filter(Boolean).join('\n\n');

        if (scrapedContent.length < 50) {
            return {
                url: normalizedUrl,
                content: '',
                title: '',
                success: false,
                error: 'Insufficient content scraped - page may be empty or blocked',
            };
        }

        return {
            url: normalizedUrl,
            content: scrapedContent,
            title: content.title,
            success: true,
        };

    } catch (error) {
        log.error(`Error scraping ${normalizedUrl}:`, error.message);
        return {
            url: url,
            content: '',
            title: '',
            success: false,
            error: `Scraping failed: ${error.message}`,
        };
    } finally {
        if (page) {
            await page.close();
        }
    }
}

// Retry helper function with exponential backoff
async function withRetry(fn, maxRetries = 3, baseDelay = 2000, log) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            const isRateLimit = error.message?.includes('rate_limit') || error.message?.includes('429');
            const isServerError = error.message?.includes('500') || error.message?.includes('503');
            
            if (attempt === maxRetries || (!isRateLimit && !isServerError)) {
                throw error;
            }
            
            const delay = baseDelay * Math.pow(2, attempt - 1);
            log.info(`Rate limited or error (attempt ${attempt}/${maxRetries}). Waiting ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// Qualify a website using AI
async function qualifyWebsite(url, scrapedContent, openai, systemPrompt, maxRetries, log) {
    try {
        if (!scrapedContent || scrapedContent.length < 20) {
            return {
                url,
                verdict: 'DISQUALIFY',
                score: 0,
                reason: 'Website inaccessible or no product description found.',
            };
        }

        const userMessage = `Please analyze this website and determine if it matches our ICP. 

Website URL: ${url}

Scraped website content:
${scrapedContent}

Based on the content above, determine if this company is a qualified prospect according to the ICP criteria provided in your system prompt. Return your response in the exact JSON format specified.`;

        const completion = await withRetry(async () => {
            return await openai.chat.completions.create({
                model: 'openai/gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: systemPrompt,
                    },
                    {
                        role: 'user',
                        content: userMessage,
                    },
                ],
                response_format: { type: 'json_object' },
                max_tokens: 1000,
                temperature: 0.1,
            });
        }, maxRetries, 2000, log);

        const responseText = completion.choices[0]?.message?.content;
        
        if (!responseText) {
            throw new Error('No response from AI');
        }

        // Parse the JSON response
        let result;
        try {
            result = JSON.parse(responseText);
        } catch (parseError) {
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                result = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('Failed to parse AI response as JSON');
            }
        }

        return {
            url: url,
            verdict: result.verdict || 'DISQUALIFY',
            score: parseInt(result.score) || 0,
            reason: result.reason || 'Unable to determine qualification.',
        };

    } catch (error) {
        log.error(`Error qualifying ${url}:`, error.message);
        return {
            url,
            verdict: 'DISQUALIFY',
            score: 0,
            reason: `Error: ${error.message}`,
        };
    }
}

// Main actor function
async function main() {
    const input = await Actor.getInput();
    
    // Validate input
    if (!input || !input.urls || !Array.isArray(input.urls) || input.urls.length === 0) {
        throw new Error('Input must contain a "urls" array with at least one URL');
    }
    
    if (!input.openrouterApiKey) {
        throw new Error('Input must contain "openrouterApiKey"');
    }

    const { 
        urls, 
        openrouterApiKey, 
        icpSystemPrompt = DEFAULT_SYSTEM_PROMPT,
        delayBetweenRequests = 2000,
        maxRetries = 3
    } = input;

    // Initialize OpenAI client
    const openai = new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: openrouterApiKey,
        defaultHeaders: {
            'HTTP-Referer': 'https://apify.com',
            'X-Title': 'AI Website Qualifying Agent',
        },
    });

    // Get default dataset for results
    const dataset = await Actor.openDataset();
    
    // Log start
    console.log(`\n🤖 Starting AI Website Qualifying Agent`);
    console.log(`📋 Processing ${urls.length} URLs\n`);

    const results = [];

    for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        console.log(`\n📡 Processing: ${url} (${i + 1}/${urls.length})`);
        
        // Step 1: Scrape the website
        console.log(`🔍 Scraping website...`);
        const scraped = await scrapeWebsite(url, console);
        
        if (!scraped.success) {
            console.log(`❌ Scraping failed: ${scraped.error}`);
            const result = {
                url,
                verdict: 'DISQUALIFY',
                score: 0,
                reason: `Website inaccessible or no product description found. Error: ${scraped.error}`,
            };
            results.push(result);
            await dataset.pushData(result);
            
            // Delay between URLs
            if (i < urls.length - 1) {
                console.log(`⏳ Waiting ${delayBetweenRequests}ms before next URL...`);
                await new Promise(resolve => setTimeout(resolve, delayBetweenRequests));
            }
            continue;
        }

        console.log(`✅ Scraped successfully: ${scraped.title}`);
        
        // Step 2: Qualify with AI
        console.log(`🤖 Qualifying with AI...`);
        const qualification = await qualifyWebsite(url, scraped.content, openai, icpSystemPrompt, maxRetries, console);
        
        console.log(`📊 Result: ${qualification.verdict} (Score: ${qualification.score})`);
        console.log(`💬 Reason: ${qualification.reason}`);
        
        results.push(qualification);
        await dataset.pushData(qualification);
        
        // Delay between URLs to avoid rate limiting
        if (i < urls.length - 1) {
            console.log(`⏳ Waiting ${delayBetweenRequests}ms before next URL to avoid rate limiting...`);
            await new Promise(resolve => setTimeout(resolve, delayBetweenRequests));
        }
    }

    // Summary
    const qualified = results.filter(r => r.verdict === 'QUALIFY').length;
    const disqualified = results.filter(r => r.verdict === 'DISQUALIFY').length;
    
    console.log(`\n🎉 Complete!`);
    console.log(`   Total: ${results.length}`);
    console.log(`   Qualified: ${qualified}`);
    console.log(`   Disqualified: ${disqualified}`);
    console.log(`\n📊 Results saved to dataset.`);

    // Clean up browser
    await closeBrowser();

    // Return summary
    await Actor.setOutput({
        total: urls.length,
        qualified,
        disqualified,
        results
    });
}

// Run the actor
Actor.main(main);