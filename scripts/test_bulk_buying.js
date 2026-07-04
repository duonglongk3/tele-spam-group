const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const GlobalSetting = require("../electron/models/Setting");
const { createJsonChatCompletion } = require("../electron/aiClient");

const DB_PATH = path.join(__dirname, "..", "data", "telegram-auto-post.sqlite3");

function getTelegramBotRolePrompt() {
  const filePath = path.join(__dirname, "..", ".agents", "knowledge", "telegram_bot_role.md");
  return fs.readFileSync(filePath, "utf8");
}

function buildSystemPrompt(settings, playbook) {
  const serviceCode = fs.readFileSync(path.join(__dirname, "..", "electron", "aiLeadService.js"), "utf8");
  
  const roleInstruction = serviceCode.match(/const roleInstruction = `([\s\S]*?)`;/)[1];
  const groupSystemContentPattern = serviceCode.match(/const groupSystemContent = `([\s\S]*?)`;/);
  
  // Dựng lại prompt giống askAi trong aiLeadService.js
  let groupSystemContent = groupSystemContentPattern 
    ? groupSystemContentPattern[1] 
    : "";
  
  // Thay thế các biến trong template string
  groupSystemContent = groupSystemContent
    .replace("${settings.aiLeadPrompt}", settings.aiLeadPrompt)
    .replace("${playbook}", playbook)
    .replace("${roleInstruction}", roleInstruction)
    .replace("${promotionPurposePrompt}", "");

  return groupSystemContent;
}

async function testBulkBuying() {
  const db = new sqlite3.Database(DB_PATH);
  
  db.get("SELECT data FROM settings WHERE type = 'global_app_settings' LIMIT 1", [], async (err, row) => {
    if (err || !row) {
      console.error("Failed to load settings");
      db.close();
      return;
    }
    
    try {
      const settings = JSON.parse(row.data);
      const playbook = getTelegramBotRolePrompt();
      const systemPrompt = buildSystemPrompt(settings, playbook);
      
      const userMessage = {
        role: "user",
        content: `Source: group\nChat: "Wholesale MMO Market"\nPurpose: discussion\nSender: SupplierTelegram\nMessage: WTS bulk steam accounts, 500+ accounts available, rate $1.5/acc. Cash App or Crypto only. Dm for bulk deals.`
      };
      
      console.log("Calling OpenAI with new Bulk Buying Mode prompt for Telegram...");
      const result = await createJsonChatCompletion(settings, [
        { role: "system", content: systemPrompt },
        userMessage
      ], {
        temperature: 0.3,
        maxTokens: 400,
        sessionPrefix: "ai-lead-bulk-telegram-test"
      });
      
      console.log("\n=== TELEGRAM BULK BUYING TEST RESULT ===");
      console.log(JSON.stringify(result, null, 2));
      console.log("========================================\n");
      
      db.close();
    } catch (e) {
      console.error("Test failed:", e.message);
      db.close();
    }
  });
}

testBulkBuying();
