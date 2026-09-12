cd /home/claude/coachgodbless-bot && cat > index.js << 'ENDOFFILE'
require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
const cron = require("node-cron");
const http = require("http");

// ============================================================
// ALL YOUR CONTENT LIVES RIGHT HERE — edit this section only.
// ============================================================
const kb = {
  coachName: "Coach Godbless",
  programName: "Premium Mentorship Program (Affiliate Success Academy Blueprint - ASB)",

  pricing: `
Because you've shown interest and taken action, I want to give you a special discounted rate for this mentorship:

NIGERIA - N21,500 instead of N50,000
GHANA - 145 GHC instead of 245 GHC
CAMEROON - 8,000 XAF instead of 20,000 XAF
KENYA - 1,400 KSH instead of 3,000 KSH
UGANDA - 25,000 UGX instead of 50,000 UGX

Do you have it available in your currency?
`,

  vslMessage: `
If you missed my previous class!

Here's the link to the FREE video webinar where I clearly break down everything you need to understand about this business model. Tap the link and start watching immediately.

Watch here: https://youtu.be/abaSdvmHURA

You can also join my private Telegram channel, where I share valuable insights that will help you grow faster which you won't find anywhere else.

TG link: https://t.me/coachgodbless1

NOTE: After watching, I'll ask you a few simple questions to confirm you truly paid attention.

If you can't answer them, I won't continue with you - I only work with people who are serious about changing their lives.
`,

  selarLink: "https://selar.com/1j8799",

  selarSteps: `
Option 1 - Register yourself instantly (best for Nigerians)

Click the link, then click "Register Now"
Fill in your details correctly (full name and email address)
Scroll down to payment method - pay via transfer or card, whichever you prefer
You'll get an instant email from Selar confirming payment - screenshot that and send it to me
`,

  paymentInstructions: `
Option 2 - Direct bank transfer

Account Number: 7015269313
Bank: Opay
Account Name: Godbless Paulinus Ben

NOTE: After payment, kindly send a screenshot of your payment proof so I can confirm it and proceed with your registration.
`,

  afterPaymentMessage: `Thank you! I've received your payment proof and Coach Godbless will confirm it shortly and complete your registration. Welcome aboard - while you wait, feel free to ask me any questions about the program.`,

  readyToPayTriggers: [
    "i'm ready",
    "im ready",
    "how do i pay",
    "how do i register",
    "i want to enroll",
    "i want to register",
    "send account",
    "account number",
    "how to pay",
    "ready to start",
    "i'm in",
    "let's do this",
    "how much",
    "what's the price",
    "i want to make payment",
    "i want to make the payment",
    "ready to pay",
    "i want to pay"
  ],

  objectionGuidance: `
- "It's too expensive" -> Reframe as an investment: this is a HEAVILY discounted price for a program that teaches a skill that can replace or exceed a monthly salary. Compare the one-time cost to what they'd lose staying stuck. Never pressure - just show value.
- "Let me think about it" -> Respect their pace, but create gentle urgency: mention the discount is limited, and ask what specifically they're unsure about so you can help them decide with real information, not pressure.
- "Is this a scam?" -> Be transparent and confident. Mention the community of real students, results, and that Coach Godbless personally mentors people. Never get defensive.
- "I don't have time" -> Explain the program is self-paced and designed for beginners with full-time jobs/school, with WhatsApp support for flexibility.
- "I've tried other courses before and failed" -> Acknowledge their experience, then explain what's different: hands-on mentorship, community support, and real accountability - not just video lessons.
`,

  testimonials: `
- Ibrahim Zakari made his first affiliate sale through the ASB program and thanked Coach Godbless for the support.
- Chukwu Jennifer Chiamaka made her first sale via Selar using what she learned, crediting Coach Godbless and Coach Francis for the guidance.
- Ifeanyi Maduabueke earned N7,415 in affiliate commissions through Selar and credited Coach Godbless's continuous mentorship for producing real results.
These are real students in the active community group sharing their wins.
`,

  programOverview: `
The Affiliate Success Academy Blueprint (ASB) is Coach Godbless's flagship program teaching affiliate marketing as a high-income digital skill - from beginner basics to running profitable campaigns. It includes structured lessons, mentorship, and an active WhatsApp community for support and accountability.
`
};
// ============================================================
// END OF CONTENT SECTION
// ============================================================

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Coach Godbless bot is running.");
}).listen(PORT, () => console.log(`Keep-alive server listening on port ${PORT}`));

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-flash-lite-latest" });
const OWNER_ID = process.env.OWNER_TELEGRAM_ID;

const DB_FILE = "./leads.json";

function loadLeads() {
  if (!fs.existsSync(DB_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return {};
  }
}
function saveLeads(leads) {
  fs.writeFileSync(DB_FILE, JSON.stringify(leads, null, 2));
}

function getLead(userId, name) {
  const leads = loadLeads();
  if (!leads[userId]) {
    leads[userId] = {
      name,
      stage: "new",
      lastMessageAt: Date.now(),
      history: []
    };
    saveLeads(leads);
  }
  return leads[userId];
}
function updateLead(userId, updates) {
  const leads = loadLeads();
  leads[userId] = { ...leads[userId], ...updates, lastMessageAt: Date.now() };
  saveLeads(leads);
  return leads[userId];
}

function appendHistory(userId, role, text) {
  const leads = loadLeads();
  const lead = leads[userId];
  if (!lead) return;
  const history = lead.history || [];
  history.push({ role, text });
  leads[userId].history = history.slice(-10);
  saveLeads(leads);
}

async function generateReply(userMessage, context, history = []) {
  const systemPrompt = `
You are the official assistant for ${kb.coachName} and ${kb.programName}. Present yourself clearly as the official assistant - never claim to literally BE Coach Godbless, and never say "I'm an AI" or "as an assistant" in a way that sounds robotic. Just talk like a real, warm, knowledgeable human on the team.

CORE OBJECTIVE:
Your job is NOT to force a sale. It's to understand the prospect, identify their real problem, educate them, build trust, and guide genuinely interested people toward the mentorship as the right next step - while being honest with people who aren't a fit yet.

FLEXIBLE FRAMEWORK (use naturally, skip stages that don't apply, never follow a fixed script):
PROBLEM -> GOAL -> UNDERSTANDING -> EDUCATION -> TRUST -> SOLUTION -> OBJECTION HANDLING -> CLOSE -> FOLLOW-UP

RULES:
- Look at the conversation history below. NEVER repeat a question, phrase, opening, or explanation you've already used earlier in this conversation. Every reply should feel fresh, not scripted.
- Ask only ONE question at a time, and only when it's genuinely useful - never stack multiple questions in one message.
- Don't sell immediately. Understand their situation, goal, or challenge first when it's early in the conversation. Once you already know their situation (check history), move forward - don't re-ask.
- Educate before pitching: explain what affiliate marketing is, how it works, or what's involved when relevant - don't make every message about buying.
- Never guarantee income or promise they'll "get rich" - be honest that results depend on learning, consistency, and effort.
- Never invent testimonials, numbers, discounts, deadlines, or scarcity beyond what's explicitly provided below.
- When someone raises an objection, understand it first (ask what specifically concerns them if unclear) before responding - never argue or dismiss.
- When closing, ROTATE your approach naturally instead of reusing the same closing line - vary between direct ("want me to show you how to register?"), choice ("want the registration link, or should I explain the payment process first?"), goal-based (reference their stated goal), summary (recap what they've told you), soft ("what would you need to know to feel comfortable starting?"), or commitment-based ("are you ready to stay consistent with this?").
- If asked the price, answer directly and honestly using only the real pricing below - never hide it.
- If someone wants to register or pay, let them know there are two simple options: instant self-registration via the Selar link, or a direct bank transfer - the bot will send the exact details when they say they're ready.
- If the prospect says something like "I'm done watching" or "finished the video" (referring to the free webinar), ask them ONE simple question to confirm they actually paid attention - e.g. "What was the one thing that stood out to you most from the video?" If their answer shows they didn't watch it or is completely unrelated, gently say you only continue with people who are serious and ask them to actually watch it first. If their answer makes sense, continue normally and compliment their takeaway briefly.
- Personalize using what you know from the conversation history - their name, goal, challenge, objections, anything they've shared. Reference it naturally rather than treating every message as a blank slate.
- Avoid cliches like "wow that's amazing", "life-changing opportunity", "you don't want to miss this" - sound like a real person, not hype copy.

TONE:
Short, natural, conversational - like texting a helpful person, not reading a script. 2-4 sentences typically, more only when explaining pricing/details. Light emojis, not excessive.

PROGRAM INFO:
${kb.programOverview}

PRICING (only mention if asked, or if user is clearly close to ready):
${kb.pricing}

OBJECTION HANDLING GUIDANCE:
${kb.objectionGuidance}

REAL TESTIMONIALS (use naturally when trust-building is relevant, never force them, never invent additional ones):
${kb.testimonials}

Context: ${context}

CONVERSATION SO FAR (most recent last):
${history.map(h => `${h.role === "user" ? "Prospect" : "You"}: ${h.text}`).join("\n") || "(this is the first message)"}

Do NOT invent information you don't have. If unsure, say Coach Godbless will personally follow up rather than guessing.
`;

  const fullPrompt = `${systemPrompt}\n\nUser's message: ${userMessage}`;
  const result = await geminiModel.generateContent(fullPrompt);
  const response = result.response;
  return response.text().trim();
}

function isReadyToPay(text) {
  const lower = text.toLowerCase();
  return kb.readyToPayTriggers.some((trigger) => lower.includes(trigger));
}

bot.on("message", async (ctx, next) => {
  const chatType = ctx.chat.type;
  if (chatType === "group" || chatType === "supergroup") {
    const text = ctx.message.text;
    if (!text) return;

    const botUsername = ctx.botInfo.username.toLowerCase();
    const mentioned = text.toLowerCase().includes("@" + botUsername);
    const looksLikeQuestion = text.trim().endsWith("?");

    if (!mentioned && !looksLikeQuestion) return;

    try {
      const reply = await generateReply(text, "This is a message inside the student group. Answer helpfully as a course assistant.");
      await ctx.reply(reply, { reply_to_message_id: ctx.message.message_id });
    } catch (err) {
      console.error("Group reply error:", err);
    }
    return;
  }
  return next();
});

bot.on("message", async (ctx) => {
  if (ctx.chat.type !== "private") return;

  const userId = ctx.from.id;
  const name = ctx.from.first_name || "there";
  const lead = getLead(userId, name);

  if (ctx.message.photo) {
    updateLead(userId, { stage: "awaiting_confirmation" });
    await ctx.reply(
      `Got it, thank you! To confirm this quickly, can you reply with:\n1) The exact amount you paid\n2) The date/time you made the payment\n\nOnce I have that, Coach Godbless will verify and complete your registration right away.`
    );
    if (OWNER_ID) {
      await bot.telegram.sendMessage(
        OWNER_ID,
        `Payment screenshot received from <a href="tg://user?id=${userId}">${name}</a> (@${ctx.from.username || "no username"}). Waiting on them to confirm exact amount + date - please verify once they reply.`,
        { parse_mode: "HTML" }
      );
    }
    return;
  }

  const text = ctx.message.text;
  if (!text) return;

  if (lead.stage === "awaiting_confirmation") {
    updateLead(userId, { stage: "closed", paymentDetails: text });
    await ctx.reply(`Perfect, thanks for confirming! Coach Godbless will verify this shortly and get your registration completed. Welcome to the family - feel free to ask anything in the meantime.`);
    if (OWNER_ID) {
      await bot.telegram.sendMessage(
        OWNER_ID,
        `<a href="tg://user?id=${userId}">${name}</a> confirmed payment details: "${text}" - please verify against the screenshot and complete their registration.`,
        { parse_mode: "HTML" }
      );
    }
    return;
  }

  if (text.startsWith("/start")) {
    const parts = text.split(" ");
    const source = parts[1] || "direct";
    const isNew = lead.stage === "new";
    updateLead(userId, { stage: "engaged", source });
    if (isNew && OWNER_ID) {
      await bot.telegram.sendMessage(
        OWNER_ID,
        `New prospect started chatting (source: ${source}): <a href="tg://user?id=${userId}">${name}</a>`,
        { parse_mode: "HTML" }
      );
    }

    let welcomeText;
    let openingQuestion = null;
    if (source === "fbads") {
      welcomeText = `Hey ${name}! Thanks for checking us out from Facebook - I'm here to help you learn about ${kb.programName} and how you can start earning with affiliate marketing.`;
      openingQuestion = "Hello, can I get more information on affiliate marketing?";
    } else if (source === "website") {
      welcomeText = `Hey ${name}! Great to have you here from our website - I'm here to walk you through ${kb.programName} and answer anything you're curious about.`;
      openingQuestion = "Hello, I'd like to know more about this program and how it can help me.";
    } else {
      welcomeText = `Hey ${name}! Welcome - I'm here to help you learn about ${kb.programName} and answer any questions you have.`;
    }

    await ctx.reply(
      `${welcomeText}\n\nBefore we continue, join our community group where students connect and share results:`,
      Markup.inlineKeyboard([
        Markup.button.url("Join the Group First", "https://t.me/+0YjQKFOMnaY3MTM0")
      ])
    );

    if (isNew) {
      await ctx.reply(kb.vslMessage);
      updateLead(userId, { vslSent: true });
    }

    if (openingQuestion) {
      try {
        const reply = await generateReply(openingQuestion, `This is a private conversation with a prospect named ${name} who just clicked in from ${source === "fbads" ? "a Facebook Ad" : "the website"}. Do NOT ask a discovery question here - go straight into explaining what affiliate marketing is and how ${kb.programName} helps them start, in a warm, exciting way. End with a soft next-step question like whether they'd like to know pricing or how to begin.`);
        await ctx.reply(reply);
        appendHistory(userId, "user", openingQuestion);
        appendHistory(userId, "bot", reply);
        if (OWNER_ID) {
          await bot.telegram.sendMessage(
            OWNER_ID,
            `<a href="tg://user?id=${userId}">${name}</a> (from ${source}): ${openingQuestion}\nBot replied: ${reply}`,
            { parse_mode: "HTML" }
          );
        }
      } catch (err) {
        console.error("Opening question reply error:", err);
      }
    } else {
      await ctx.reply(`What would you like to know? (e.g. what it includes, pricing, or how to get started)`);
    }
    return;
  }

  if (isReadyToPay(text) && lead.stage !== "awaiting_confirmation" && lead.stage !== "closed") {
    updateLead(userId, { stage: "payment_sent" });
    await ctx.reply(`Awesome, ${name}! Here's the pricing for your country:\n${kb.pricing}`);
    await ctx.reply(
      `You've got two ways to get registered - pick whichever's easier for you:`,
      Markup.inlineKeyboard([
        Markup.button.url("Pay & Register via Selar (Instant)", kb.selarLink)
      ])
    );
    await ctx.reply(kb.selarSteps);
    await ctx.reply(kb.paymentInstructions);
    if (OWNER_ID) {
      await bot.telegram.sendMessage(OWNER_ID, `${name} just asked about pricing/payment - sent them both options.`);
    }
    return;
  }

  try {
    updateLead(userId, { stage: lead.stage === "new" ? "engaged" : lead.stage });
    const reply = await generateReply(text, `This is a private conversation with a prospect named ${name}. Current stage: ${lead.stage}.`, lead.history || []);
    await ctx.reply(reply);
    appendHistory(userId, "user", text);
    appendHistory(userId, "bot", reply);
    if (OWNER_ID) {
      await bot.telegram.sendMessage(
        OWNER_ID,
        `<a href="tg://user?id=${userId}">${name}</a>: ${text}\nBot replied: ${reply}`,
        { parse_mode: "HTML" }
      );
    }
  } catch (err) {
    console.error("DM reply error:", err);
    await ctx.reply("Sorry, I had trouble processing that - Coach Godbless will follow up with you shortly!");
  }
});

const followUpMessages = [
  `Hey {name}, just checking in - were you able to go through everything we talked about?`,
  `Hi {name}, still thinking things over? Happy to answer anything that's still unclear.`,
  `{name}, based on what you shared earlier, are you still looking to move forward with that goal?`,
  `Just checking on you, {name} - if you're still interested, I'm here for any questions.`,
  `Hey {name}, no pressure at all. If something specific is holding you back, let me know and I'll help however I can.`,
  `I don't want to keep disturbing you, {name}. Whenever you're ready to continue, just message me and I'll help with the next step.`
];

cron.schedule("0 * * * *", async () => {
  const leads = loadLeads();
  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;

  for (const [userId, lead] of Object.entries(leads)) {
    const quietFor = now - lead.lastMessageAt;
    const eligibleStage = lead.stage === "engaged" || lead.stage === "payment_sent";
    const count = lead.followUpCount || 0;

    if (eligibleStage && quietFor > ONE_DAY && count < followUpMessages.length) {
      try {
        const message = followUpMessages[count].replace("{name}", lead.name);
        await bot.telegram.sendMessage(userId, message);
        updateLead(userId, { followUpCount: count + 1, lastMessageAt: Date.now() });
      } catch (err) {
        console.error(`Follow-up failed for ${userId}:`, err.message);
      }
    }
  }
});

bot.launch();
console.log("Coach Godbless bot is running...");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
ENDOFFILE
node -c index.js && echo "SYNTAX OK" && wc -l index.js
