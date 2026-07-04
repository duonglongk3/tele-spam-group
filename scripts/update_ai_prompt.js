const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const DB_PATH = path.join(__dirname, "..", "data", "telegram-auto-post.sqlite3");
console.log("Database path:", DB_PATH);

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error("Failed to connect to database:", err.message);
    process.exit(1);
  }
  console.log("Connected to database successfully.");
  updatePrompt();
});

function updatePrompt() {
  db.get("SELECT data FROM settings WHERE type = 'global_app_settings' LIMIT 1", [], (err, row) => {
    if (err) {
      console.error("Error reading settings:", err.message);
      db.close();
      process.exit(1);
    }

    if (!row || !row.data) {
      console.error("No global settings row found to update.");
      db.close();
      process.exit(1);
    }

    try {
      const dataObj = JSON.parse(row.data);
      const oldPrompt = dataObj.aiLeadPrompt;
      
      const newPrompt = "You are an AI Lead Watcher for Telegram/Discord. Your job is to detect valuable group messages, private messages, follow-ups, and relevant MMO/online-selling opportunities. All prompts and generated replies must be in English. Reply like a real experienced online buyer, bulk importer, or MMO discussant, stay defensive, and never self-identify as a bot, AI, automation, script, tool, seeding account, or automated account even if directly challenged. Never send direct links, never spam. You are ONLY a buyer or a discussant in public chats; you NEVER sell game accounts/items. Only answer messages related to online selling, Telegram shops, digital goods, automation for shop operations, QR/bank payment handling, affiliates, customer support, or soft buying opportunities where you act as a buyer or bulk wholesale importer. Do not answer coding/programming/HTML/CSS/JavaScript/Python/API implementation questions, web-search requests, or broad general-knowledge questions. If a message is a buyer asking to buy or asking for pricing, skip it. If a seller is offering to sell, you may reply as a buyer asking with casual questions. If a seller is offering bulk/wholesale deals, reply as a wholesale buyer asking for bulk rates for large volumes (e.g. price for 100+ or 500+ units) and warranty in private message. Do not use market abbreviations like 'MOQ' (minimum order quantity), 'WTS' (want to sell), 'WTB' (want to buy), 'PM' (private message), or 'DM' (direct message) in your suggested reply. Instead, write them out fully or use clear words like 'bulk rate for 500 units', 'large volume pricing', 'selling', 'buying', or 'message me in private'.";

      dataObj.aiLeadPrompt = newPrompt;
      const updatedDataJson = JSON.stringify(dataObj);

      db.run(
        "UPDATE settings SET data = ?, updatedAt = ? WHERE type = 'global_app_settings'",
        [updatedDataJson, new Date().toISOString()],
        function (updateErr) {
          if (updateErr) {
            console.error("Failed to update database:", updateErr.message);
            db.close();
            process.exit(1);
          }
          console.log("\n=================================");
          console.log("SUCCESS: aiLeadPrompt has been updated in SQLite for Telegram!");
          console.log("\n--- OLD PROMPT ---");
          console.log(oldPrompt);
          console.log("\n--- NEW PROMPT ---");
          console.log(newPrompt);
          console.log("=================================");
          db.close();
          process.exit(0);
        }
      );
    } catch (e) {
      console.error("Failed to parse settings data JSON:", e.message);
      db.close();
      process.exit(1);
    }
  });
}
